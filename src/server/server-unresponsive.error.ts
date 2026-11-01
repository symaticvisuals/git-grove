/** A live process holds the server lock at `lockPath`, but nothing shows whether its server is stuck or gone. */
export class ServerUnresponsiveError extends Error {
  constructor(
    readonly pid: number,
    readonly lockPath: string,
    reason: string,
  ) {
    super(
      `git-grove: process ${pid} holds the server lock, but ${reason}; ` +
        `if no git grove server is running, delete ${lockPath} and start again`,
    );
    this.name = "ServerUnresponsiveError";
  }
}
