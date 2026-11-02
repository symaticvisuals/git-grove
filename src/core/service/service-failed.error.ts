/** A `launchctl` or `systemctl` command that installs, starts or loads the login service exited non-zero. */
export class ServiceFailedError extends Error {
  constructor(
    readonly command: string,
    readonly code: number,
    stderr: string,
  ) {
    const why = stderr.trim().split("\n")[0] ?? "";
    super(`git-grove: ${command} failed (exit ${code})${why === "" ? "" : `: ${why}`}`);
    this.name = "ServiceFailedError";
  }
}
