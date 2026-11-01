import type { RepoFacts } from "../../facts/facts.types.js";
import { readMergedRemovals } from "../../facts/read-merged-removals.js";
import { verdictFor } from "../../facts/verdict-for.js";
import { readRemoval, type Removal } from "./read-removal.js";

/**
 * The worktrees clean up offers: each linked worktree whose branch has landed on the trunk, then each detached one
 * whose folder git still tracks, with its verdict. A candidate can be picked when nothing but precious ignored files,
 * which it copies to main first, keeps it.
 */
export async function readCleanupCandidates(facts: RepoFacts): Promise<Removal[]> {
  const candidates: Removal[] = [];
  for (const [path, verdict] of await readMergedRemovals(facts)) {
    const worktree = facts.worktrees.find((candidate) => candidate.path === path);
    if (worktree !== undefined) candidates.push(await readRemoval(facts, worktree, verdict));
  }
  for (const worktree of facts.worktrees) {
    if (worktree.isMain || worktree.branch !== null || worktree.prunable) continue;
    candidates.push(await readRemoval(facts, worktree, await verdictFor(facts, worktree.path)));
  }
  return candidates;
}
