export class StoreCorruptError extends Error {
  constructor(readonly column: string) {
    super(`git-grove: grove.db holds an unexpected value in ${column}`);
    this.name = "StoreCorruptError";
  }
}
