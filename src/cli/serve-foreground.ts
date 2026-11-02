import { type RunningServer, startServer } from "../server/start-server.js";
import { packageVersion } from "./package-version.js";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Starts the dashboard server in this process and resolves once it listens. The open server keeps the process
 * alive until SIGINT, SIGTERM or SIGHUP stops it; `POST /api/shutdown` stops it too, leaving exit code 75.
 */
export async function serveForeground(): Promise<RunningServer> {
  const stop = (): void => {
    for (const signal of SIGNALS) process.off(signal, stop);
    void server.close();
  };
  const server = await startServer({
    version: packageVersion(),
    onShutdown: (code) => {
      for (const signal of SIGNALS) process.off(signal, stop);
      process.exitCode = code;
    },
  });
  for (const signal of SIGNALS) process.on(signal, stop);
  return server;
}
