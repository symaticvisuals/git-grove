import { existsSync } from "node:fs";
import { basename } from "node:path";
import { findWorktree } from "../../facts/find-worktree.js";
import type { RepoFacts, Sha, WorktreeFacts } from "../../facts/facts.types.js";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { runGit } from "../../git/run-git.js";
import { plural } from "../../rules/plural.js";
import { strandedCommits } from "../../snapshot/stranded-commits.js";
import { RefusedError } from "../../runner/refused.error.js";
import type { ActionContext, ActionDef, Prepared } from "../action.types.js";
import { displayPath } from "../display-path.js";
import { InvalidInputError } from "../invalid-input.error.js";
import { listPaths } from "../list-paths.js";
import type { Check, Expectation, Plan } from "../plan.types.js";
import { shellWord } from "../shell-word.js";

const SHAPE = "forget takes { worktree, force? } or { all: true }";

type ForgetInput = { all: true } | { all: false; worktree: string; force: boolean };

type Gone = { path: string; shown: string; branch: string | null; head: Sha | null; stranded: number };

function parseInput(raw: unknown): ForgetInput {
  if (typeof raw !== "object" || raw === null) throw new InvalidInputError(SHAPE);
  const force = "force" in raw ? raw.force : undefined;
  if ("all" in raw && raw.all !== true) throw new InvalidInputError(SHAPE);
  if (force !== undefined && typeof force !== "boolean") throw new InvalidInputError(SHAPE);
  if ("all" in raw && raw.all === true) {
    if ("worktree" in raw || force === true) throw new InvalidInputError(SHAPE);
    return { all: true };
  }
  if (!("worktree" in raw) || typeof raw.worktree !== "string" || raw.worktree === "") throw new InvalidInputError(SHAPE);
  return { all: false, worktree: raw.worktree, force: force === true };
}

function strandedSentence(count: number): string {
  return count === 1
    ? "1 gone worktree still holds commits only its detached HEAD has; forget it on its own"
    : `${count} gone worktrees still hold commits only their detached HEADs have; forget each one on its own`;
}

function unknownSentence(count: number): string {
  return count === 1 ? "1 gone worktree could not be checked" : `${count} gone worktrees could not be checked`;
}

/** Commits only this detached HEAD holds, 0 when it has a branch or no HEAD, null when the count failed. */
function strandedOf(worktree: WorktreeFacts, counts: Map<string, number | null>): number | null {
  if (worktree.branch !== null || worktree.head === null) return 0;
  return counts.get(worktree.path) ?? null;
}

function goneOf(facts: RepoFacts, worktree: WorktreeFacts, stranded: number): Gone {
  return {
    path: worktree.path,
    shown: displayPath(facts.root, worktree.path),
    branch: worktree.branch,
    head: worktree.head,
    stranded,
  };
}

/** Why one named worktree cannot be forgotten, or null when it can. `force` is the only way past stranded commits. */
function blockerFor(worktree: WorktreeFacts, stranded: number | null, force: boolean): string | null {
  if (worktree.isMain) return "the main worktree is never forgotten";
  if (worktree.locked) return "locked; unlock it with git worktree unlock first";
  if (existsSync(worktree.path)) return "its folder is still there; clean it up instead";
  if (!worktree.prunable) return "its folder is gone, but git does not list it as prunable";
  if (stranded === null) return "could not check the commits only its detached HEAD holds";
  if (stranded > 0 && !force) {
    const head = worktree.head ?? "HEAD";
    return `${plural(stranded, "commit")} only on its detached HEAD would be lost. To keep them, run git branch rescue/${basename(worktree.path)} ${head} first.`;
  }
  return null;
}

function expectsOf(facts: RepoFacts, targets: readonly Gone[]): Expectation[] {
  return targets.flatMap((target) => {
    if (target.branch === null) return [];
    const branch = facts.branches.find((candidate) => candidate.name === target.branch);
    return [{ kind: "tip" as const, branch: target.branch, sha: branch?.tip ?? null }];
  });
}

function planFor(facts: RepoFacts, targets: readonly Gone[], blockers: string[], notes: string[], forceLosing: boolean, subject: Gone | null, all: boolean): Plan {
  const one = all ? undefined : (targets[0] ?? subject ?? undefined);
  const losing = forceLosing && one !== undefined && one.stranded > 0;
  const label = one !== undefined ? (one.branch ?? one.shown) : targets.length === 0 ? "gone worktrees" : plural(targets.length, "gone worktree");
  const checks: Check[] = [];
  if (blockers.length > 0) checks.push({ ok: false, text: blockers[0] ?? "", why: null });
  else if (losing && one !== undefined) {
    checks.push({ ok: false, text: `${plural(one.stranded, "commit")} only on its detached HEAD`, why: "Forgetting makes them unreachable" });
  } else if (targets.length > 0) {
    checks.push({
      ok: true,
      text: one === undefined ? plural(targets.length, "gone worktree") : "Folder is already gone",
      why: one === undefined ? listPaths(targets.map((target) => target.shown)) : one.shown,
    });
    if (targets.some((target) => target.branch !== null)) checks.push({ ok: true, text: "The branch stays", why: null });
  }
  const effects = losing && one !== undefined
    ? [`${plural(one.stranded, "commit")} become unreachable`]
    : targets.length === 0
      ? []
      : ["Git's record of the folder is dropped", ...(targets.some((target) => target.branch !== null) ? ["The branch stays"] : [])];
  return {
    action: "forget",
    context: one === undefined ? "Gone worktrees" : (one.branch ?? one.shown),
    title: `Forget ${label}`,
    summary: losing
      ? "Drops git's record. Commits only on the detached HEAD become unreachable."
      : one === undefined
        ? "Drops git's record of each folder that is already gone. Branches stay. A detached HEAD that still holds commits is left to forget on its own."
        : one.branch === null
          ? "Drops git's record of a folder that is already gone."
          : "Drops git's record of a folder that is already gone and keeps the branch.",
    confirm: losing ? "Force forget" : "Forget",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks,
    effects,
    commands: targets.map((target) => `git worktree remove ${shellWord(target.shown)}`),
    steps: [
      { title: "Check nothing moved since you looked", detail: targets.length === 0 ? "Nothing to forget" : `${plural(targets.length, "folder")} still gone` },
      {
        title: losing ? "Force forget the worktree" : `Forget ${label}`,
        detail: losing ? "Commits only on the detached HEAD become unreachable" : "Keeping each branch",
      },
    ],
    blockers,
    note: notes.length === 0 ? null : notes.join(" "),
    undoable: false,
    moves: [],
    expects: expectsOf(facts, targets),
    readAt: facts.readAt,
  };
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const input = parseInput(raw);
  const facts = await readRepoFacts(ctx.root);
  const counts = await strandedCommits(facts);
  const targets: Gone[] = [];
  const blockers: string[] = [];
  const notes: string[] = [];
  let forceLosing = false;
  let subject: Gone | null = null;

  if (input.all) {
    let stranded = 0;
    let unknown = 0;
    for (const worktree of facts.worktrees) {
      if (worktree.isMain || worktree.locked || !worktree.prunable || existsSync(worktree.path)) continue;
      const count = strandedOf(worktree, counts);
      if (count === null) unknown += 1;
      else if (count > 0) stranded += 1;
      else targets.push(goneOf(facts, worktree, 0));
    }
    if (targets.length === 0 && stranded > 0) blockers.push(strandedSentence(stranded));
    else if (targets.length === 0 && unknown > 0) blockers.push(unknownSentence(unknown));
    else if (targets.length === 0) blockers.push("No gone worktree to forget");
    else {
      if (stranded > 0) notes.push(strandedSentence(stranded));
      if (unknown > 0) notes.push(unknownSentence(unknown));
    }
  } else {
    const worktree = await findWorktree(facts, ctx.root, input.worktree);
    const count = strandedOf(worktree, counts);
    const stranded = count ?? 0;
    subject = goneOf(facts, worktree, stranded);
    const blocker = blockerFor(worktree, count, input.force);
    if (blocker !== null) blockers.push(blocker);
    else {
      forceLosing = input.force && stranded > 0;
      targets.push(subject);
      if (forceLosing && worktree.head !== null) {
        notes.push(`To keep them, run git branch rescue/${basename(worktree.path)} ${worktree.head} first.`);
      }
    }
  }

  const planned = targets;
  return {
    plan: planFor(facts, planned, blockers, notes, forceLosing, subject, input.all),
    async execute(run) {
      let forgotten = 0;
      let already = 0;
      const detail = await run.step(run.firstStep, async () => {
        const lines: string[] = [];
        for (const target of planned) {
          const current = run.facts.worktrees.find((worktree) => worktree.path === target.path);
          if (current === undefined) {
            already += 1;
            lines.push(`${target.shown} was already forgotten`);
            continue;
          }
          if (existsSync(current.path) || !current.prunable || current.locked || current.head !== target.head) {
            throw new RefusedError(`${target.shown} is no longer a gone worktree`);
          }
          await runGit(["worktree", "remove", current.path], { cwd: run.facts.root, write: true });
          forgotten += 1;
          lines.push(`Forgot ${target.branch ?? target.shown}`);
        }
        return lines.join("\n");
      });
      const title =
        forgotten === 0 && already > 0
          ? "Already forgotten"
          : planned.length === 1
            ? `Forgot ${planned[0]?.branch ?? planned[0]?.shown ?? "the worktree"}`
            : `Forgot ${plural(forgotten, "gone worktree")}`;
      return { ok: true, title, lines: detail === "" ? [] : detail.split("\n"), undo: null };
    },
  };
}

/**
 * Drops git's record of a worktree whose folder is already gone: `{ worktree, force? }` or `{ all: true }`. The branch
 * stays. `{ all: true }` skips a detached HEAD that still holds commits, or whose commits could not be counted.
 * `force` is what the dashboard sends after Force forget; without it those commits block. A folder that is still
 * there, the main worktree, and a locked one are refused. Never passes `--force` to `git worktree remove`.
 */
export const forgetAction: ActionDef = { name: "forget", prepare };
