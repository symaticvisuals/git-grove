import { countDetachedOnly } from "../facts/count-detached-only.js";
import type { RepoFacts } from "../facts/facts.types.js";
import { unlessGitFails } from "../git/unless-git-fails.js";

/** Commits only the detached HEAD of each prunable worktree holds; null for a worktree git fails to count. */
export async function strandedCommits(facts: RepoFacts): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>();
  for (const worktree of facts.worktrees) {
    if (!worktree.prunable || worktree.branch !== null || worktree.head === null) continue;
    counts.set(worktree.path, await unlessGitFails(countDetachedOnly(facts.root, worktree.head), null));
  }
  return counts;
}
