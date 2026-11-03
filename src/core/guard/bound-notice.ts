/** What a new Claude Code session is told: this agent is bounded by the guard, and which commands to use instead. */
export const BOUND_NOTICE =
  "This agent is bounded by git grove. Worktree remove, deleting a worktree folder, and discarding another worktree's files are blocked. Use git grove rm, which refuses anything that would lose work, or git grove forget when the folder is already gone.";
