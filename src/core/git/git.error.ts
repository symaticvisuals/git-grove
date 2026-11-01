/**
 * A git call that failed. `code` is git's exit status, or -1 when git did not exit on its own
 * (it could not start in the folder, was killed, or printed more than grove reads); `reason` then says which.
 */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number,
    readonly stderr: string,
    reason?: string,
  ) {
    super(`git ${args.join(" ")} ${reason ?? `failed with code ${code}: ${stderr.trim()}`}`);
    this.name = "GitError";
  }
}
