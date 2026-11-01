/** Another server already holds `$GIT_GROVE_HOME/server.lock`; `port` is null when its server.json is not written yet. */
export class ServerRunningError extends Error {
  readonly url: string | null;

  constructor(
    readonly port: number | null,
    readonly pid: number | null,
  ) {
    const url = port === null ? null : `http://127.0.0.1:${port}/`;
    const where = url !== null ? ` at ${url}` : pid !== null ? ` as process ${pid}` : "";
    super(`git-grove: already running${where}`);
    this.name = "ServerRunningError";
    this.url = url;
  }
}
