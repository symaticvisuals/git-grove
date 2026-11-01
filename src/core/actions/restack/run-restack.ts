import type { Sha } from "../../facts/facts.types.js";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { runGit } from "../../git/run-git.js";
import { classifyTipChange } from "../../journal/classify-tip-change.js";
import { plural } from "../../rules/plural.js";
import type { ActionContext, ExecuteResult, RunContext } from "../action.types.js";
import { displayPath } from "../display-path.js";
import { errorLine } from "../error-line.js";
import { listPaths } from "../list-paths.js";
import type { RestoreTarget } from "../plan.types.js";
import { StalePlanError } from "../stale-plan.error.js";
import { moveLevel, type PutBack } from "./move-level.js";
import { recheckBeforeMove } from "./recheck-before-move.js";
import type { RestackLevel, RestackRead } from "./restack.types.js";

type Done = { level: RestackLevel; onto: Sha; tip: Sha; replayed: number | null; putBack: PutBack };

type Stop = { reason: string; lines: string[] };

async function revParse(cwd: string, rev: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function countCommits(cwd: string, range: string): Promise<number> {
  return Number((await runGit(["rev-list", "--count", range], { cwd })).stdout.trim());
}

function putBackLines(putBack: PutBack, folder: string, message: string): string[] {
  if (putBack.state === "none") return [];
  if (putBack.state === "back") return [`Your uncommitted changes in ${folder} are back`];
  const { stash, touched, conflicted } = putBack;
  const named = `${stash.slice(0, 7)} ("${message}")`;
  if (putBack.why === "rebase-in-progress") {
    return [`Your change was not put back, because a rebase is still in progress in ${folder}; it is in the stash as ${named}`];
  }
  const apply = `git stash apply ${stash}`;
  if (touched.length === 0) {
    return [`Your change is kept in the stash as ${named}. It did not apply cleanly; ${folder} is unchanged. Apply it by hand with ${apply}.`];
  }
  const also = `The whole change is also kept in the stash as ${stash.slice(0, 7)}, if you need it: ${apply}.`;
  if (conflicted.length === 0) return [`Your change is partly back in ${folder}, in ${listPaths(touched)}. ${also}`];
  const resolve = `resolve the conflicts in ${listPaths(conflicted)}, and the rest is already in place`;
  return [`Your change is partly back in ${folder}: ${resolve}. ${also}`];
}

function undoOf(done: Done[], pins: Map<string, string>): RestoreTarget[] | null {
  const undo = done.flatMap(({ level }) => {
    const pinRef = pins.get(level.move.branch);
    return pinRef === undefined ? [] : [{ branch: level.move.branch, pinRef }];
  });
  return undo.length > 0 ? undo : null;
}

function movedLines(root: string, read: RestackRead, done: Done[]): string[] {
  return done.flatMap(({ level, replayed, putBack }) => [
    `${level.move.branch} is on ${level.move.onto}${replayed === null ? "" : `, ${replayed} of ${level.own} commits replayed`}`,
    ...(level.holder === undefined ? [] : putBackLines(putBack, displayPath(root, level.holder.path), read.stashMessage)),
  ]);
}

async function lostChanges(root: string, done: Done[], pins: Map<string, string>): Promise<string[]> {
  const lost: string[] = [];
  for (const { level, onto, tip } of done) {
    const { branch } = level.move;
    const pinRef = pins.get(branch);
    const oldTip = pinRef === undefined ? null : await revParse(root, pinRef);
    if (pinRef === undefined || oldTip === null) throw new Error(`${branch} has no pin to compare with`);
    const change = await classifyTipChange({ cwd: root, branch, oldTip, newTip: tip, oldBase: level.fork, newBase: onto });
    if (change.kind !== "rebased" && change.kind !== "advanced") {
      lost.push(`${branch} lost ${plural(change.lost.length || 1, "change")}; git grove restore ${branch} ${pinRef}`);
    }
  }
  return lost;
}

/**
 * Runs a restack plan, level by level and parent first, from `run.firstStep`. Before each level it re-checks what the
 * plan read (everything, before the first); a mismatch before anything moved throws StalePlanError. A level that
 * conflicts or fails is left where it was, with its set-aside change back or named in the stash, and the run stops
 * there: levels already moved stay moved and are offered as undo. The last step classifies every level that moved
 * against its pin, on a stopped run too, and reports any change lost.
 */
export async function runRestack(ctx: ActionContext, read: RestackRead, run: RunContext): Promise<ExecuteResult> {
  const { root } = run.facts;
  const done: Done[] = [];
  const halted: { stop: Stop | null } = { stop: null };
  const halt = (stop: Stop): never => {
    halted.stop = stop;
    throw new Error(stop.reason);
  };
  const verify = async (): Promise<string[]> => {
    const found: string[] = [];
    try {
      await run.step(run.firstStep + read.levels.length, async () => {
        found.push(...(await lostChanges(root, done, run.pins)));
        if (found.length > 0) throw new Error(found.join("; "));
        return "every old commit matched";
      });
      return [];
    } catch (error) {
      return found.length > 0 ? found : [errorLine(error)];
    }
  };

  for (const [at, level] of read.levels.entries()) {
    const { branch } = level.move;
    try {
      await run.step(run.firstStep + at, async () => {
        const fresh = await readRepoFacts(root);
        const movedTips = new Map(done.map((entry) => [entry.level.move.branch, entry.tip]));
        const mismatches = await recheckBeforeMove(ctx, read, { level, first: at === 0, fresh, pins: run.pins, movedTips });
        if (mismatches.length > 0 && done.length === 0) throw new StalePlanError(mismatches);
        if (mismatches.length > 0) return halt({ reason: mismatches.join("; "), lines: [`${branch} was not restacked`] });
        const parentTip = fresh.branches.find((candidate) => candidate.name === level.move.onto)?.tip ?? null;
        const onto = level.move.ontoTrunk ? read.trunk.sha : parentTip;
        if (onto === null || level.holder === undefined) throw new StalePlanError([`${branch} cannot move onto ${level.move.onto}`]);

        const folder = displayPath(root, level.holder.path);
        const result = await moveLevel({
          worktree: level.holder.path,
          branch,
          fork: level.fork,
          onto,
          parent: level.move.ontoTrunk ? read.trunk.name : null,
          feature: read.feature.name,
          setAside: read.stash,
          stashMessage: read.stashMessage,
        });
        if (result.kind !== "moved") {
          const where = result.rebaseLeft
            ? `${folder} still has a rebase in progress; finish or abort it there`
            : `${branch} is where it was, with no rebase in progress`;
          const reason = result.kind === "conflict" ? `conflict in ${listPaths(result.paths)}` : result.reason;
          return halt({ reason, lines: [where, ...putBackLines(result.putBack, folder, read.stashMessage)] });
        }
        const entry: Done = { level, onto, tip: result.tip, replayed: null, putBack: result.putBack };
        done.push(entry);
        if (result.putBack.state === "kept") {
          return halt({ reason: "your change did not apply cleanly", lines: putBackLines(result.putBack, folder, read.stashMessage) });
        }
        if (result.unrecorded !== null) {
          return halt({ reason: `its new fork point was not recorded: ${result.unrecorded}`, lines: [] });
        }
        entry.replayed = await countCommits(root, `${onto}..${result.tip}`).catch(() => null);
        const replayed = entry.replayed === null ? "moved" : `${entry.replayed} of ${level.own} commits replayed`;
        return `${replayed}${result.putBack.state === "back" ? ", your change is back" : ""}`;
      });
    } catch (error) {
      if (halted.stop === null && done.length === 0) throw error;
      const untouched = done.some((entry) => entry.level === level) ? [] : [`${branch} was not restacked`];
      const stop = halted.stop ?? { reason: errorLine(error), lines: untouched };
      const lost = done.length > 0 ? await verify() : [];
      return {
        ok: false,
        title: `Stopped at level ${level.number}: ${stop.reason}`,
        lines: [
          ...done.map((entry) => `${entry.level.move.branch} is restacked and stays done`),
          ...lost,
          ...stop.lines,
          ...read.levels.slice(at + 1).map((later) => `${later.move.branch} was not restacked`),
        ],
        undo: undoOf(done, run.pins),
      };
    }
  }

  const lost = await verify();
  if (lost.length > 0) {
    const lines = [...movedLines(root, read, done), ...lost];
    return { ok: false, title: "Stopped: Check nothing was lost", lines, undo: undoOf(done, run.pins) };
  }
  return {
    ok: true,
    title: `Restacked ${plural(done.length, "level")}`,
    lines: [...movedLines(root, read, done), "Every old commit matched", "Nothing was pushed"],
    undo: undoOf(done, run.pins),
  };
}
