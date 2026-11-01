import type { Verdict } from "../rules/verdict.types.js";
import { branchLanded } from "../stacks/branch-landed.js";
import type { RepoFacts } from "./facts.types.js";
import { verdictFor } from "./verdict-for.js";

/** Verdicts for the linked worktrees, off the trunk, whose branch has landed on it, keyed by worktree path. */
export async function readMergedRemovals(facts: RepoFacts): Promise<Map<string, Verdict>> {
  const removals = new Map<string, Verdict>();
  for (const worktree of facts.worktrees) {
    const branch = facts.branches.find((candidate) => candidate.name === worktree.branch);
    if (worktree.isMain || branch === undefined || branch.name === facts.trunk.name) continue;
    if (!(await branchLanded(facts.root, branch, facts.trunk.ref))) continue;
    removals.set(worktree.path, await verdictFor(facts, worktree.path));
  }
  return removals;
}
