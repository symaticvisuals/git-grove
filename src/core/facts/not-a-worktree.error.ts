export class NotAWorktreeError extends Error {
  constructor(readonly target: string) {
    super(`git-grove: ${target} is not a worktree of this repository`);
    this.name = "NotAWorktreeError";
  }
}
