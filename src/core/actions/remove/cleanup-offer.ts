import type { WorktreeFacts } from "../../facts/facts.types.js";
import type { Verdict } from "../../rules/verdict.types.js";
import { removalBlocker } from "./removal-blocker.js";

export type CleanupOffer = "safe" | "rescue";

/**
 * How clean up offers a candidate worktree with its removal `verdict`: `safe` when nothing keeps it, `rescue` when
 * only precious ignored files do, which it copies to main first. Null when it cannot be picked: the main worktree, a
 * locked one, one whose folder is gone or untracked, one with an operation in progress, or any other reason.
 */
export function cleanupOffer(worktree: WorktreeFacts, verdict: Verdict | null): CleanupOffer | null {
  if (verdict === null || removalBlocker(worktree) !== null) return null;
  if (!verdict.reasons.every((reason) => reason.code === "precious-ignored")) return null;
  return verdict.reasons.length > 0 ? "rescue" : "safe";
}
