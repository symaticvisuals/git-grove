import type { Verdict } from "../rules/verdict.types.js";
import type { RepoFacts } from "./facts.types.js";
import { verdictFor } from "./verdict-for.js";

/** Verdicts for the detached linked worktrees whose folder git still tracks, keyed by worktree path. */
export async function readSandboxRemovals(facts: RepoFacts): Promise<Map<string, Verdict>> {
  const removals = new Map<string, Verdict>();
  for (const worktree of facts.worktrees) {
    if (worktree.isMain || worktree.branch !== null || worktree.prunable) continue;
    removals.set(worktree.path, await verdictFor(facts, worktree.path));
  }
  return removals;
}
