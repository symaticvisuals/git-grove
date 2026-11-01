import { existsSync } from "node:fs";
import type { RepoFacts, Sha, WorktreeFacts } from "../facts/facts.types.js";
import { runGit } from "../git/run-git.js";
import { listPins } from "./list-pins.js";
import { pin } from "./pin.js";
import { RefusedError } from "./refused.error.js";

async function revParse(cwd: string, rev: string): Promise<Sha | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

async function countCommits(cwd: string, args: string[]): Promise<number> {
  return Number((await runGit(["rev-list", "--count", ...args], { cwd })).stdout.trim());
}

/** The worktree that has `branch` checked out and still exists on disk; a missing folder holds nothing. */
function holderOf(facts: RepoFacts, branch: string): WorktreeFacts | undefined {
  return facts.worktrees.find((worktree) => worktree.branch === branch && !worktree.prunable && existsSync(worktree.path));
}

function refuseMidOperation(facts: RepoFacts, branch: string): void {
  const busy = facts.worktrees.find(
    (worktree) => worktree.operation !== null && (worktree.operationBranch === branch || worktree.branch === branch),
  );
  if (busy?.operation) {
    throw new RefusedError(`git-grove: ${branch} has a ${busy.operation} in progress in ${busy.path}; finish or abort it first`);
  }
}

/**
 * `moved`: an existing branch was reset to the pin; `created`: a branch that no longer existed was made at it.
 * `commitsBack` counts the commits the branch has now that it did not have before.
 */
export type RestoreResult =
  | { kind: "moved"; from: Sha; to: Sha; pinnedCurrent: string; pinRef: string; commitsBack: number }
  | { kind: "created"; to: Sha; pinRef: string; commitsBack: number };

/**
 * Moves `branch` back to a pin (default: its newest), after pinning its current tip, or creates it at the pin
 * when the branch no longer exists. The caller holds the repo lock and read `facts` under it. Refuses if the branch
 * tip changes before the move (`beforeMove` is a test seam). Refuses, before pinning anything, while any worktree has
 * a rebase, merge, cherry-pick or bisect of the branch in progress, when the worktree holding the branch has
 * uncommitted changes, and when a worktree still has a deleted branch checked out. A worktree whose folder is gone
 * holds nothing: the ref is moved directly.
 */
export async function restoreHeld(
  facts: RepoFacts,
  branch: string,
  pinRef?: string,
  beforeMove?: () => Promise<void>,
): Promise<RestoreResult> {
  const target = pinRef ?? (await listPins(facts.root, branch))[0]?.ref;
  if (target === undefined) throw new RefusedError(`git-grove: no pin found for ${branch}`);
  const to = await revParse(facts.root, target);
  if (to === null) throw new RefusedError(`git-grove: cannot resolve ${target}`);
  refuseMidOperation(facts, branch);
  const from = await revParse(facts.root, `refs/heads/${branch}`);
  const holder = holderOf(facts, branch);
  if (from === null) {
    if (holder) throw new RefusedError(`git-grove: ${holder.path} has ${branch} checked out but the branch is gone`);
    const commitsBack = await countCommits(facts.root, [to, "--not", "--branches", "--remotes", "--tags"]);
    await runGit(["update-ref", `refs/heads/${branch}`, to, ""], { cwd: facts.root, write: true });
    return { kind: "created", to, pinRef: target, commitsBack };
  }

  const changes = holder?.changes;
  if (changes && changes.staged + changes.unstaged + changes.untracked > 0) {
    throw new RefusedError(`git-grove: ${holder.path} has uncommitted changes`);
  }

  const pinnedCurrent = await pin(facts.root, branch, from, new Date());
  await beforeMove?.();
  if ((await revParse(facts.root, `refs/heads/${branch}`)) !== from) {
    throw new RefusedError(`git-grove: ${branch} moved while restoring; run again`);
  }
  if (holder) await runGit(["reset", "--keep", to], { cwd: holder.path, write: true });
  else await runGit(["update-ref", `refs/heads/${branch}`, to, from], { cwd: facts.root, write: true });
  const commitsBack = await countCommits(facts.root, [`${from}..${to}`]);
  return { kind: "moved", from, to, pinnedCurrent, pinRef: target, commitsBack };
}
