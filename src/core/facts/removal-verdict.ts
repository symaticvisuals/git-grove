import { safeToRemove } from "../rules/safe-to-remove.js";
import type { Verdict } from "../rules/verdict.types.js";
import type { RepoFacts, WorktreeFacts } from "./facts.types.js";
import { readRemovalFacts } from "./read-removal-facts.js";

const MAIN_WORKTREE: Verdict = {
  ok: false,
  reasons: [{ code: "main-worktree", detail: "the main worktree is never removed", paths: [] }],
};

/**
 * Whether `worktree` can be deleted without losing work: the verdict `git grove check remove` prints and the agent
 * guard enforces. The main worktree is never safe. A failed git call rejects rather than counting as safe.
 */
export async function removalVerdict(facts: RepoFacts, worktree: WorktreeFacts): Promise<Verdict> {
  return worktree.isMain ? MAIN_WORKTREE : safeToRemove(await readRemovalFacts(facts.root, worktree.path, facts));
}
