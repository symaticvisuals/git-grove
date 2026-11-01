/** A live process holds `$GIT_GROVE_HOME/server.lock`, but nothing shows whether its server is stuck or gone. */
export class ServerUnresponsiveError extends Error {
  constructor(
    readonly pid: number,
    reason: string,
  ) {
    super(`git-grove: process ${pid} holds the server lock, but ${reason}; try again in a moment`);
    this.name = "ServerUnresponsiveError";
  }
}
