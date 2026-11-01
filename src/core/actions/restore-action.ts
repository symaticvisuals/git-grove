import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { RepoFacts, Sha, WorktreeFacts } from "../facts/facts.types.js";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { runGit } from "../git/run-git.js";
import { alertPin } from "../journal/alert-pin.js";
import { settleRestoredTip } from "../journal/settle-restored-tip.js";
import { plural } from "../rules/plural.js";
import { listPins } from "../runner/list-pins.js";
import { PINS_PREFIX } from "../runner/pins-prefix.js";
import { restoreHeld, type RestoreResult } from "../runner/restore.js";
import type { ActionContext, ActionDef, Prepared } from "./action.types.js";
import { branchContext } from "./branch-context.js";
import { displayPath } from "./display-path.js";
import { InvalidInputError } from "./invalid-input.error.js";
import type { Check, Expectation, Plan, RestoreTarget } from "./plan.types.js";
import { readDirtyPaths } from "./read-dirty-paths.js";
import { readLane } from "./read-lane.js";

type Target = { branch: string; pinRef?: string };

/** One target as the plan read it. `from` is the branch's tip, null when the branch is gone. */
type Read = {
  branch: string;
  pinRef: string;
  to: Sha;
  from: Sha | null;
  base: Sha;
  back: number;
  parent: string;
  holder: WorktreeFacts | undefined;
  dirty: string[];
  busy: WorktreeFacts | undefined;
  children: string[];
};

const MAX_PATHS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function short(sha: Sha): string {
  return sha.slice(0, 7);
}

function parseTarget(item: unknown): Target {
  const branch = isRecord(item) ? item["branch"] : undefined;
  if (!isRecord(item) || typeof branch !== "string" || branch === "" || branch.startsWith("-")) {
    throw new InvalidInputError("each restore target needs a branch");
  }
  const pinRef = item["pinRef"];
  if (pinRef === undefined) return { branch };
  if (typeof pinRef !== "string" || !pinRef.startsWith(PINS_PREFIX)) throw new InvalidInputError(`not a grove pin: ${String(pinRef)}`);
  return { branch, pinRef };
}

function parseTargets(raw: unknown): Target[] {
  const list: unknown = isRecord(raw) ? raw["targets"] : undefined;
  if (!Array.isArray(list)) throw new InvalidInputError("restore takes { targets: [{ branch, pinRef? }] }");
  const items: unknown[] = list;
  if (items.length === 0) throw new InvalidInputError("restore needs at least one target");
  const targets = items.map(parseTarget);
  if (new Set(targets.map((target) => target.branch)).size !== targets.length) {
    throw new InvalidInputError("each branch can be restored once");
  }
  return targets;
}

async function revParse(cwd: string, rev: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function countCommits(cwd: string, args: string[]): Promise<number> {
  return Number((await runGit(["rev-list", "--count", ...args], { cwd })).stdout.trim());
}

async function mergeBase(cwd: string, one: Sha, other: Sha): Promise<Sha> {
  const result = await runGit(["merge-base", one, other], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : other;
}

async function readTarget(ctx: ActionContext, facts: RepoFacts, { branch, pinRef }: Target): Promise<Read> {
  const pin = pinRef ?? alertPin(ctx.store, facts, branch) ?? (await listPins(facts.root, branch))[0]?.ref;
  if (pin === undefined) throw new InvalidInputError(`no pin found for ${branch}`);
  const to = await revParse(facts.root, pin);
  if (to === null) throw new InvalidInputError(`cannot resolve ${pin}`);
  const from = facts.branches.find((candidate) => candidate.name === branch)?.tip ?? null;
  const parent = facts.edges.find((edge) => edge.branch === branch)?.parent ?? facts.trunk.name;
  const parentTip = facts.branches.find((candidate) => candidate.name === parent)?.tip ?? facts.trunk.sha;
  const holder = facts.worktrees.find((worktree) => worktree.branch === branch && !worktree.prunable && existsSync(worktree.path));
  const existing = new Set(facts.branches.map((candidate) => candidate.name));
  return {
    branch,
    pinRef: pin,
    to,
    from,
    parent,
    base: await mergeBase(facts.root, from ?? parentTip, to),
    back: await countCommits(facts.root, from === null ? [to, "--not", "--branches", "--remotes", "--tags"] : [`${from}..${to}`]),
    holder,
    dirty: holder !== undefined && from !== null ? await readDirtyPaths(holder.path) : [],
    busy: facts.worktrees.find(
      (worktree) => worktree.operation !== null && (worktree.operationBranch === branch || worktree.branch === branch),
    ),
    children: facts.edges.filter((edge) => edge.parent === branch && existing.has(edge.branch)).map((edge) => edge.branch),
  };
}

function listPaths(paths: string[]): string {
  const shown = paths.slice(0, MAX_PATHS).join(", ");
  return paths.length > MAX_PATHS ? `${shown} and ${paths.length - MAX_PATHS} more` : shown;
}

function checksOf(facts: RepoFacts, read: Read): { checks: Check[]; blockers: string[] } {
  const { branch, holder, busy } = read;
  const checks: Check[] = [];
  const blockers: string[] = [];
  const where = holder === undefined ? "" : displayPath(facts.root, holder.path);
  if (holder !== undefined && read.from === null) {
    checks.push({ ok: false, text: `${where} has ${branch} checked out, but the branch is gone`, why: "Check out another branch there first." });
    blockers.push(`${where} has ${branch} checked out but the branch is gone`);
  } else if (holder !== undefined && read.dirty.length > 0) {
    checks.push({ ok: false, text: `Uncommitted changes in ${where}`, why: listPaths(read.dirty) });
    blockers.push(`${where} has uncommitted changes. Commit or stash them first.`);
  } else if (holder !== undefined) {
    checks.push({ ok: true, text: `No local edits in ${where}`, why: null });
  } else {
    checks.push({ ok: true, text: `No worktree has ${branch} checked out`, why: null });
  }
  if (busy?.operation) {
    const there = displayPath(facts.root, busy.path);
    checks.push({ ok: false, text: `A ${busy.operation} is in progress in ${there}`, why: "Finish or abort it first." });
    blockers.push(`${branch} has a ${busy.operation} in progress in ${there}. Finish or abort it first.`);
  } else {
    checks.push({ ok: true, text: `No rebase, merge, cherry-pick or bisect of ${branch} in progress`, why: null });
  }
  if (read.from === read.to) blockers.push(`${branch} is already at ${short(read.to)}`);
  return { checks, blockers };
}

function effectsOf(facts: RepoFacts, read: Read): string[] {
  const effects: string[] = [];
  if (read.from === null) effects.push(`Create ${read.branch} again at ${short(read.to)}.`);
  else effects.push(`Keep the current tip, ${short(read.from)}, in its own pin, so you can undo this.`);
  if (read.from !== null && read.holder !== undefined) {
    effects.push(`Update the files in ${displayPath(facts.root, read.holder.path)}. No local edits there to lose.`);
  } else if (read.from !== null) {
    effects.push(`No worktree has ${read.branch} checked out, so no files change.`);
  }
  for (const child of read.children) effects.push(`Offer to restack ${child} afterwards.`);
  return effects;
}

function expectsOf(read: Read): Expectation[] {
  const tip: Expectation = { kind: "tip", branch: read.branch, sha: read.from };
  if (read.from === null || read.holder === undefined) return [tip];
  const { path, head, operation } = read.holder;
  return [tip, { kind: "worktree", path, head, dirty: read.dirty, operation }];
}

function verifyTitle(total: number): string {
  if (total === 0) return "Check the branch is at the pin";
  return total === 1 ? "Check the commit is back" : `Check all ${total} commits are back`;
}

function describeMove(result: RestoreResult): string {
  return result.kind === "moved" ? `${short(result.from)} → ${short(result.to)}` : `created at ${short(result.to)}`;
}

/** Prefixes each detail with its branch when there is more than one. */
function joined(reads: Read[], detail: (read: Read) => string): string {
  return reads.map((read) => (reads.length > 1 ? `${read.branch}: ${detail(read)}` : detail(read))).join("; ");
}

function summaryOf(reads: Read[]): string {
  const [only] = reads;
  if (reads.length > 1 || only === undefined) return "Each branch goes back to the tip grove pinned. Nothing is deleted.";
  return `The branch ${only.from === null ? "comes back" : "goes back"} at ${short(only.to)}, the tip grove pinned. Nothing is deleted.`;
}

function stepsOf(reads: Read[], total: number): Plan["steps"] {
  const moved = reads.filter((read) => read.from !== null);
  const still = (read: Read): string =>
    read.from === null ? "still missing" : `Still at ${short(read.from)}${read.holder ? ", worktree clean" : ""}`;
  const move = (read: Read): string =>
    read.from === null ? `create at ${short(read.to)}` : `${short(read.from)} → ${short(read.to)}`;
  return [
    { title: "Check nothing moved since you looked", detail: joined(reads, still) },
    ...(moved.length > 0 ? [{ title: "Pin the current tip", detail: joined(moved, (read) => short(read.from ?? "")) }] : []),
    { title: moved.length > 0 ? "Move the branch back" : "Bring the branch back", detail: joined(reads, move) },
    { title: verifyTitle(total), detail: total > 0 ? `${total} of ${total} expected` : "at the pin" },
  ];
}

function planOf(facts: RepoFacts, reads: Read[], lanes: Pick<Plan, "before" | "after">): Plan {
  const [only] = reads.length === 1 ? reads : [];
  const total = reads.reduce((sum, read) => sum + read.back, 0);
  const moved = reads.filter((read) => read.from !== null);
  const where = only ? only.branch : `${reads.length} branches`;
  const checked = reads.map((read) => checksOf(facts, read));
  return {
    action: "restore",
    context: only ? branchContext(facts, only.branch) : basename(facts.root),
    title: total > 0 ? `Bring back ${plural(total, "commit")} on ${where}` : `Move ${where} back to its pin`,
    summary: summaryOf(reads),
    confirm: total > 0 ? `Bring back ${plural(total, "commit")}` : "Move the branch back",
    ...lanes,
    folders: null,
    choices: null,
    checks: checked.flatMap((each) => each.checks),
    effects: reads.flatMap((read) => effectsOf(facts, read)),
    commands: reads.map((read) => `git grove restore ${read.branch} ${read.pinRef}`),
    steps: stepsOf(reads, total),
    blockers: checked.flatMap((each) => each.blockers),
    note: null,
    undoable: moved.length > 0,
    moves: moved.map((read) => read.branch),
    expects: reads.flatMap(expectsOf),
    readAt: facts.readAt,
  };
}

async function lanesOf(facts: RepoFacts, reads: Read[]): Promise<Pick<Plan, "before" | "after">> {
  const [only] = reads;
  if (reads.length > 1 || only === undefined) return { before: null, after: null };
  const options = (caption: string): { caption: string; baseLabel: string } => ({ caption, baseLabel: only.parent });
  return {
    before: only.from === null ? null : await readLane(facts.root, only.base, only.from, options("Now")),
    after: await readLane(facts.root, only.base, only.to, options("After")),
  };
}

function receiptLines(results: { read: Read; result: RestoreResult }[], total: number): string[] {
  const lines: string[] = [];
  for (const { read, result } of results) {
    if (result.kind === "created") lines.push(`Created ${read.branch} at ${short(result.to)}`);
    else {
      lines.push(`Moved ${read.branch} from ${short(result.from)} to ${short(result.to)}`);
      lines.push(`The previous tip${results.length > 1 ? ` of ${read.branch}` : ""} is pinned, so this can be undone`);
    }
  }
  if (total > 0) lines.push(`${total} of ${total} commits are back`);
  for (const { read } of results) for (const child of read.children) lines.push(`${child} is still on the old ${read.branch}; restack it next`);
  return lines;
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const targets = parseTargets(raw);
  const facts = await readRepoFacts(ctx.root);
  const reads: Read[] = [];
  for (const target of targets) reads.push(await readTarget(ctx, facts, target));
  const plan = planOf(facts, reads, await lanesOf(facts, reads));
  const total = reads.reduce((sum, read) => sum + read.back, 0);
  const where = reads.length === 1 ? (reads[0]?.branch ?? "") : `${reads.length} branches`;

  return {
    plan,
    async execute(run) {
      const results: { read: Read; result: RestoreResult }[] = [];
      await run.step(run.firstStep, async () => {
        for (const read of reads) {
          const result = await restoreHeld(run.facts, read.branch, read.pinRef);
          results.push({ read, result });
          await settleRestoredTip(ctx.store, run.facts, read.branch, result.to);
        }
        return results.map(({ result }) => describeMove(result)).join("; ");
      });
      await run.step(run.firstStep + 1, async () => {
        for (const { read, result } of results) {
          const missing = await countCommits(run.facts.root, [result.to, "--not", `refs/heads/${read.branch}`]);
          if (missing > 0) throw new Error(`${plural(missing, "commit")} of ${read.branch}'s pin are not on it`);
        }
        const back = results.reduce((sum, { result }) => sum + result.commitsBack, 0);
        return total > 0 ? `${back} of ${total} found` : "at the pin";
      });
      const undo: RestoreTarget[] = results.flatMap(({ read, result }) =>
        result.kind === "moved" ? [{ branch: read.branch, pinRef: result.pinnedCurrent }] : [],
      );
      return {
        ok: true,
        title: total > 0 ? `Restored ${plural(total, "commit")} on ${where}` : `Moved ${where} back`,
        lines: receiptLines(results, total),
        undo: undo.length > 0 ? undo : null,
      };
    },
  };
}

/**
 * Restores branches to pins: `{ targets: [{ branch, pinRef? }] }`, at least one. A target without a pin takes the pin
 * of its newest open alert, else its newest pin. A branch that still exists is pinned and moved back; a deleted one
 * is created at the pin, with nothing to pin and nothing to undo.
 */
export const restoreAction: ActionDef = { name: "restore", prepare };
