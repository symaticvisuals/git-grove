export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed with code ${code}: ${stderr.trim()}`);
    this.name = "GitError";
  }
}
