import { chmod, mkdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { groveHome } from "../core/grove-home.js";
import { openStore } from "../core/journal/open-store.js";
import type { Store } from "../core/journal/store.types.js";
import { createSnapshots } from "./live/snapshots.js";
import { registerApi } from "./api/register-api.js";
import { readOrCreateToken } from "./auth/read-or-create-token.js";
import { clearServerFile } from "./clear-server-file.js";
import { handleRequest, type RequestDeps } from "./http/handle-request.js";
import { listenOnLoopback } from "./http/listen-on-loopback.js";
import { createRouter } from "./http/router.js";
import { lockServer } from "./lock-server.js";
import type { ServerContext } from "./server-context.types.js";
import { writeServerFile } from "./write-server-file.js";

export type StartServerOptions = {
  port?: number;
  home?: string;
  uiDir?: string;
  version: string;
  onShutdown?: (code: number) => void;
  /** The clock the snapshots use; `Date.now` by default. */
  now?: () => number;
};

export type RunningServer = { port: number; url: string; token: string; context: ServerContext; close(): Promise<void> };

const DEFAULT_PORT = 47683;
const CLOSE_GRACE_MS = 1000;

function stopListening(http: Server): Promise<void> {
  return new Promise((resolve) => {
    const grace = setTimeout(() => http.closeAllConnections(), CLOSE_GRACE_MS);
    http.close(() => {
      clearTimeout(grace);
      resolve();
    });
    http.closeIdleConnections();
  });
}

async function privateHome(home: string): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  if (((await stat(home)).mode & 0o077) !== 0) await chmod(home, 0o700);
}

/**
 * Starts the dashboard server: makes `<home>` private (0700), takes `<home>/server.lock` (`lockServer`), listens on
 * 127.0.0.1 and `[::1]` at `port` (default 47683) or the next of 20 free on both, and records `{ pid, port, version }`
 * in `<home>/server.json`. `close` stops it, giving open connections a second, and removes server.json and the lock.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const home = options.home ?? groveHome();
  const uiDir = options.uiDir ?? fileURLToPath(new URL("../ui/", import.meta.url));
  await privateHome(home);
  const release = await lockServer(home);
  let servers: Server[] = [];
  let store: Store | null = null;
  try {
    const token = await readOrCreateToken(home);
    store = openStore(join(home, "grove.db"));
    const opened = store;
    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        try {
          await Promise.all(servers.map(stopListening));
          clearServerFile(home, process.pid);
          opened.close();
        } finally {
          await release();
        }
      })();
      return closing;
    };
    const context: ServerContext = {
      store: opened,
      snapshots: createSnapshots(opened, options.now),
      token,
      port: 0,
      version: options.version,
      home,
      shutdown(code) {
        if (closing !== null) return;
        void close()
          .catch((error: unknown) => process.stderr.write(`git-grove: stopping the server: ${String(error)}\n`))
          .then(() => options.onShutdown?.(code));
      },
    };
    const router = createRouter();
    registerApi(router);
    const deps: RequestDeps = { router, context, uiDir, closing: () => closing !== null };
    const onRequest = (req: IncomingMessage, res: ServerResponse): void => void handleRequest(req, res, deps);
    const listening = await listenOnLoopback(() => createServer(onRequest), options.port ?? DEFAULT_PORT);
    servers = listening.servers;
    context.port = listening.port;
    writeServerFile(home, { pid: process.pid, port: listening.port, version: options.version });
    return { port: listening.port, url: `http://127.0.0.1:${listening.port}/`, token, context, close };
  } catch (error) {
    store?.close();
    await Promise.all(servers.map(stopListening));
    await release();
    throw error;
  }
}
