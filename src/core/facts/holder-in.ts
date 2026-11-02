import { existsSync } from "node:fs";
import type { RepoFacts, WorktreeFacts } from "./facts.types.js";

/** The worktree that has `branch` checked out and still exists on disk, if any. */
export function holderIn(facts: RepoFacts, branch: string): WorktreeFacts | undefined {
  return facts.worktrees.find((worktree) => worktree.branch === branch && !worktree.prunable && existsSync(worktree.path));
}
