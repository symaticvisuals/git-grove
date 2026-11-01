export class StoreUnavailableError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`git-grove: cannot open ${path}: ${reason}`);
    this.name = "StoreUnavailableError";
  }
}
