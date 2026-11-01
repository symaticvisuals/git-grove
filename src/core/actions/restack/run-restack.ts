import type { RepoFacts, Sha } from "../../facts/facts.types.js";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { runGit } from "../../git/run-git.js";
import { classifyTipChange } from "../../journal/classify-tip-change.js";
import { plural } from "../../rules/plural.js";
import type { ActionContext, ExecuteResult, RunContext } from "../action.types.js";
import { busyIn } from "../busy-in.js";
import { displayPath } from "../display-path.js";
import { errorLine } from "../error-line.js";
import { holderIn } from "../holder-in.js";
import { listPaths } from "../list-paths.js";
import type { RestoreTarget } from "../plan.types.js";
import { StalePlanError } from "../stale-plan.error.js";
import { moveLevel, type PutBack } from "./move-level.js";
import type { RestackLevel, RestackRead } from "./restack.types.js";
import { rewrittenLevels } from "./rewritten-levels.js";

type Done = { level: RestackLevel; onto: Sha; tip: Sha; replayed: number; putBack: PutBack };

type Stop = { reason: string; lines: string[] };

function short(sha: Sha | null): string {
  return sha === null ? "nothing" : sha.slice(0, 7);
}

async function revParse(cwd: string, rev: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

function tipIn(facts: RepoFacts, branch: string): Sha | null {
  return facts.branches.find((candidate) => candidate.name === branch)?.tip ?? null;
}

function moved(name: string, was: Sha | null, now: Sha | null): string[] {
  if (was === now) return [];
  return [now === null ? `${name} was deleted` : `${name} moved: was ${short(was)}, now ${short(now)}`];
}

function putBackLines(putBack: PutBack, folder: string): string[] {
  if (putBack === "back") return [`Your uncommitted changes in ${folder} are back`];
  if (putBack === "kept") return [`Your change is kept in the stash of ${folder}; it did not apply cleanly`];
  return [];
}

async function recheckRun(ctx: ActionContext, read: RestackRead, fresh: RepoFacts, pins: Map<string, string>): Promise<string[]> {
  const lines: string[] = [];
  if (fresh.trunk.ref !== read.trunk.ref) lines.push(`The trunk is now ${fresh.trunk.ref}, not ${read.trunk.ref}`);
  lines.push(...moved(read.trunk.name, read.trunk.sha, await revParse(fresh.root, read.trunk.ref)));
  for (const [branch, sha] of read.tips) lines.push(...moved(branch, sha, tipIn(fresh, branch)));
  for (const level of read.levels) {
    const { branch } = level.move;
    const edge = fresh.edges.find((candidate) => candidate.branch === branch);
    if (edge?.parent !== level.edge?.parent) {
      lines.push(`${branch}'s parent changed: was ${level.edge?.parent ?? "none"}, now ${edge?.parent ?? "none"}`);
    } else if (edge?.forkPoint !== level.edge?.forkPoint) {
      lines.push(`${branch}'s recorded fork point changed`);
    }
    const pinRef = pins.get(branch);
    const pinned = pinRef === undefined ? null : await revParse(fresh.root, pinRef);
    if (pinned !== level.tip) lines.push(`${branch} is not pinned at ${short(level.tip)}`);
  }
  const rewritten = rewrittenLevels(ctx.store, fresh.commonDir, [...read.tips.keys()]);
  for (const branch of rewritten) lines.push(`${branch} has a rewrite to restore or keep first`);
  return lines;
}

async function recheckLevel(read: RestackRead, level: RestackLevel, fresh: RepoFacts, done: Done[]): Promise<string[]> {
  const { branch, onto, ontoTrunk } = level.move;
  const lines = moved(branch, level.tip, tipIn(fresh, branch));
  const holder = holderIn(fresh, branch);
  if (holder?.path !== level.holder?.path) {
    lines.push(
      holder === undefined
        ? `${displayPath(fresh.root, level.holder?.path ?? "")} no longer has ${branch} checked out`
        : `${branch} is now checked out in ${displayPath(fresh.root, holder.path)}`,
    );
  }
  const busy = busyIn(fresh, branch);
  if (busy?.operation) lines.push(`${branch} has a ${busy.operation} in progress in ${displayPath(fresh.root, busy.path)}`);
  if (ontoTrunk) {
    lines.push(...moved(read.trunk.name, read.trunk.sha, await revParse(fresh.root, read.trunk.ref)));
  } else {
    const expected = done.find((entry) => entry.level.move.branch === onto)?.tip ?? read.tips.get(onto) ?? null;
    lines.push(...moved(onto, expected, tipIn(fresh, onto)));
  }
  return lines;
}

function undoOf(done: Done[], pins: Map<string, string>): RestoreTarget[] | null {
  const undo = done.flatMap(({ level }) => {
    const pinRef = pins.get(level.move.branch);
    return pinRef === undefined ? [] : [{ branch: level.move.branch, pinRef }];
  });
  return undo.length > 0 ? undo : null;
}

function movedLines(root: string, done: Done[]): string[] {
  return done.flatMap(({ level, replayed, putBack }) => [
    `${level.move.branch} is on ${level.move.onto}, ${replayed} of ${level.own} commits replayed`,
    ...(putBack === "back" && level.holder !== undefined ? putBackLines(putBack, displayPath(root, level.holder.path)) : []),
  ]);
}

function stopped(read: RestackRead, at: number, stop: Stop, done: Done[], pins: Map<string, string>): ExecuteResult {
  return {
    ok: false,
    title: `Stopped at level ${read.levels[at]?.number ?? "?"}: ${stop.reason}`,
    lines: [
      ...done.map(({ level }) => `${level.move.branch} is restacked and stays done`),
      ...stop.lines,
      ...read.levels.slice(at + 1).map((level) => `${level.move.branch} was not restacked`),
    ],
    undo: undoOf(done, pins),
  };
}

async function countCommits(cwd: string, range: string): Promise<number> {
  return Number((await runGit(["rev-list", "--count", range], { cwd })).stdout.trim());
}

/**
 * Runs a restack plan, level by level and parent first, from `run.firstStep`. Before the first move it re-checks
 * everything the plan read, and before each level that the level and its new base are as expected; a mismatch before
 * anything moved throws StalePlanError. A level that conflicts or fails is left where it was, with its set-aside change
 * back, and the run stops there: levels already moved stay moved and are offered as undo. The last step classifies
 * each moved level against its pin and stops when any change is lost.
 */
export async function runRestack(ctx: ActionContext, read: RestackRead, run: RunContext): Promise<ExecuteResult> {
  const { root } = run.facts;
  const done: Done[] = [];
  const halted: { stop: Stop | null } = { stop: null };
  const halt = (stop: Stop): never => {
    halted.stop = stop;
    throw new Error(stop.reason);
  };

  for (const [at, level] of read.levels.entries()) {
    const { branch } = level.move;
    try {
      await run.step(run.firstStep + at, async () => {
        const fresh = await readRepoFacts(root);
        const before = at === 0 ? await recheckRun(ctx, read, fresh, run.pins) : [];
        const mismatches = [...new Set([...before, ...(await recheckLevel(read, level, fresh, done))])];
        if (mismatches.length > 0 && done.length === 0) throw new StalePlanError(mismatches);
        if (mismatches.length > 0) return halt({ reason: mismatches.join("; "), lines: [`${branch} was not restacked`] });
        const onto = level.move.ontoTrunk ? read.trunk.sha : tipIn(fresh, level.move.onto);
        if (onto === null || level.holder === undefined) throw new StalePlanError([`${branch} cannot move onto ${level.move.onto}`]);

        const folder = displayPath(root, level.holder.path);
        const parent = level.move.ontoTrunk ? read.trunk.name : null;
        const { fork } = level;
        const { stash: setAside, stashMessage } = read;
        const result = await moveLevel({ worktree: level.holder.path, branch, fork, onto, parent, setAside, stashMessage });
        if (result.kind !== "moved") {
          const where = result.rebaseLeft
            ? `${folder} still has a rebase in progress; finish or abort it there`
            : `${branch} is where it was, with no rebase in progress`;
          const reason = result.kind === "conflict" ? `conflict in ${listPaths(result.paths)}` : result.reason;
          return halt({ reason, lines: [where, ...putBackLines(result.putBack, folder)] });
        }
        const entry: Done = { level, onto, tip: result.tip, replayed: level.own, putBack: result.putBack };
        done.push(entry);
        entry.replayed = await countCommits(root, `${onto}..${result.tip}`);
        if (result.putBack === "kept") {
          return halt({ reason: "your change did not apply cleanly", lines: putBackLines("kept", folder) });
        }
        if (result.unrecorded !== null) {
          return halt({ reason: `its new fork point was not recorded: ${result.unrecorded}`, lines: [] });
        }
        return `${entry.replayed} of ${level.own} commits replayed${result.putBack === "back" ? ", your change is back" : ""}`;
      });
    } catch (error) {
      if (halted.stop === null && done.length === 0) throw error;
      const untouched = done.some((entry) => entry.level === level) ? [] : [`${branch} was not restacked`];
      const stop = halted.stop ?? { reason: errorLine(error), lines: untouched };
      return stopped(read, at, stop, done, run.pins);
    }
  }

  const lost: string[] = [];
  try {
    await run.step(run.firstStep + read.levels.length, async () => {
      for (const { level, onto, tip } of done) {
        const { branch } = level.move;
        const pinRef = run.pins.get(branch);
        const oldTip = pinRef === undefined ? null : await revParse(root, pinRef);
        if (pinRef === undefined || oldTip === null) throw new Error(`${branch} has no pin to compare with`);
        const change = await classifyTipChange({ cwd: root, branch, oldTip, newTip: tip, oldBase: level.fork, newBase: onto });
        if (change.kind !== "rebased" && change.kind !== "advanced") {
          lost.push(`${branch} lost ${plural(change.lost.length || 1, "change")}; git grove restore ${branch} ${pinRef}`);
        }
      }
      if (lost.length > 0) throw new Error(lost.join("; "));
      return "every old commit matched";
    });
  } catch (error) {
    const lines = [...movedLines(root, done), ...(lost.length > 0 ? lost : [errorLine(error)])];
    return { ok: false, title: "Stopped: Check nothing was lost", lines, undo: undoOf(done, run.pins) };
  }
  return {
    ok: true,
    title: `Restacked ${plural(done.length, "level")}`,
    lines: [...movedLines(root, done), "Every old commit matched", "Nothing was pushed"],
    undo: undoOf(done, run.pins),
  };
}
