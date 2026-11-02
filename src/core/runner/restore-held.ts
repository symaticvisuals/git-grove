import { busyIn } from "../facts/busy-in.js";
import type { RepoFacts, Sha } from "../facts/facts.types.js";
import { holderIn } from "../facts/holder-in.js";
import { countCommits } from "../git/count-commits.js";
import { resolveCommit } from "../git/resolve-commit.js";
import { runGit } from "../git/run-git.js";
import { pin } from "./pin.js";
import { RefusedError } from "./refused.error.js";

function refuseMidOperation(facts: RepoFacts, branch: string): void {
  const busy = busyIn(facts, branch);
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
 * Moves `branch` back to the pin `target`, after pinning its current tip, or creates it at the pin
 * when the branch no longer exists. The caller holds the repo lock and read `facts` under it. Refuses if the branch
 * tip changes before the move (`beforeMove` is a test seam). Refuses, before pinning anything, while any worktree has
 * a rebase, merge, cherry-pick or bisect of the branch in progress, when the worktree holding the branch has
 * uncommitted changes, and when a worktree still has a deleted branch checked out. A worktree whose folder is gone
 * holds nothing: the ref is moved directly.
 */
export async function restoreHeld(
  facts: RepoFacts,
  branch: string,
  target: string,
  beforeMove?: () => Promise<void>,
): Promise<RestoreResult> {
  const to = await resolveCommit(facts.root, target);
  if (to === null) throw new RefusedError(`git-grove: cannot resolve ${target}`);
  refuseMidOperation(facts, branch);
  const from = await resolveCommit(facts.root, `refs/heads/${branch}`);
  const holder = holderIn(facts, branch);
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

  const pinnedCurrent = (await pin(facts.root, branch, from, new Date())).ref;
  await beforeMove?.();
  if ((await resolveCommit(facts.root, `refs/heads/${branch}`)) !== from) {
    throw new RefusedError(`git-grove: ${branch} moved while restoring; run again`);
  }
  if (holder) await runGit(["reset", "--keep", to], { cwd: holder.path, write: true });
  else await runGit(["update-ref", `refs/heads/${branch}`, to, from], { cwd: facts.root, write: true });
  const commitsBack = await countCommits(facts.root, [`${from}..${to}`]);
  return { kind: "moved", from, to, pinnedCurrent, pinRef: target, commitsBack };
}
