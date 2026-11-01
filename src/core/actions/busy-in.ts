import type { RepoFacts, WorktreeFacts } from "../facts/facts.types.js";

/** The worktree with a rebase, merge, cherry-pick or bisect in progress on `branch`, if any. */
export function busyIn(facts: RepoFacts, branch: string): WorktreeFacts | undefined {
  return facts.worktrees.find(
    (worktree) => worktree.operation !== null && (worktree.operationBranch === branch || worktree.branch === branch),
  );
}
