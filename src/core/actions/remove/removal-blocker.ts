import { existsSync } from "node:fs";
import type { WorktreeFacts } from "../../facts/facts.types.js";

/**
 * Why grove never removes this worktree as it stands, whatever it holds: it is the main worktree, it is locked, git no
 * longer tracks its folder, or an operation is in progress there. Null when none of these holds.
 */
export function removalBlocker(worktree: WorktreeFacts): string | null {
  if (worktree.isMain) return "the main worktree is never removed";
  if (worktree.locked) return "locked; unlock it with git worktree unlock first";
  if (worktree.prunable || !existsSync(worktree.path)) {
    return existsSync(worktree.path)
      ? "git no longer tracks this folder as a worktree; look through it by hand, then run git grove forget"
      : "its folder is gone; run git grove forget";
  }
  if (worktree.operation !== null) return `a ${worktree.operation} is in progress; finish or abort it first`;
  return null;
}
