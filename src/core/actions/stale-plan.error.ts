/** The repository no longer matches what a plan read; `mismatches` says what changed, one line each. */
export class StalePlanError extends Error {
  constructor(readonly mismatches: string[]) {
    super(`git-grove: changed since you looked: ${mismatches.join("; ")}`);
    this.name = "StalePlanError";
  }
}
