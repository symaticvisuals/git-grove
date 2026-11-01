export class MainWorktreeError extends Error {
  constructor(path: string) {
    super(`${path} is the main worktree and cannot be removed`);
    this.name = "MainWorktreeError";
  }
}
