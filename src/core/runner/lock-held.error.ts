export class LockHeldError extends Error {
  constructor(
    readonly path: string,
    readonly pid: number | null,
  ) {
    super(`git-grove: ${path} is held${pid === null ? "" : ` by process ${pid}`}`);
    this.name = "LockHeldError";
  }
}
