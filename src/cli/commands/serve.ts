import { join } from "node:path";
import { groveHome } from "../../core/grove-home.js";
import { ServerRunningError } from "../../server/server-running.error.js";
import { startServer } from "../../server/start-server.js";
import type { CliIo } from "../cli-io.types.js";
import { packageVersion } from "../package-version.js";
import { rotateLog } from "../rotate-log.js";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function whereItRuns(error: ServerRunningError): string {
  if (error.url !== null) return `already running at ${error.url}`;
  return error.pid === null ? "already running" : `already running as process ${error.pid}`;
}

/**
 * Runs `git grove serve [--port <n>]` in the foreground. First a `server.log` over 5 MB in grove's folder becomes
 * `server.log.1` (`rotateLog`), even when the server then cannot start. Resolves 0 after SIGINT, SIGTERM or SIGHUP,
 * and 75 once `POST /api/shutdown` has stopped it. When another server already runs, says where and resolves 0.
 */
export async function serveCommand(io: CliIo, options: { port?: number }): Promise<number> {
  await rotateLog(join(groveHome(), "server.log"), MAX_LOG_BYTES).catch((error: unknown) =>
    io.err(`git-grove: server.log was not rotated: ${error instanceof Error ? error.message : String(error)}\n`),
  );
  let finish: (code: number) => void = () => undefined;
  const finished = new Promise<number>((resolve) => (finish = resolve));
  const server = await startServer({ port: options.port, version: packageVersion(), onShutdown: (code) => finish(code) }).catch(
    (error: unknown) => {
      if (error instanceof ServerRunningError) return error;
      throw error;
    },
  );
  if (server instanceof ServerRunningError) {
    io.out(`${whereItRuns(server)}\n`);
    return 0;
  }
  const onSignal = (): void => {
    for (const signal of SIGNALS) process.off(signal, onSignal);
    void server.close().then(() => finish(0));
  };
  for (const signal of SIGNALS) process.on(signal, onSignal);
  io.out(`git grove is serving at ${server.url}\n`);
  try {
    return await finished;
  } finally {
    for (const signal of SIGNALS) process.off(signal, onSignal);
  }
}
