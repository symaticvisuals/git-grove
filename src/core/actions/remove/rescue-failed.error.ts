/** A precious ignored file, `path` relative to its worktree, could not be copied into main, or its copy differs. */
export class RescueFailedError extends Error {
  constructor(
    readonly path: string,
    readonly reason = "its copy in main does not match",
  ) {
    super(`git-grove: could not rescue ${path}: ${reason}`);
    this.name = "RescueFailedError";
  }
}
