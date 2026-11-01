import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { groveHome } from "../core/grove-home.js";
import { openStore } from "../core/journal/open-store.js";
import type { Store } from "../core/journal/store.types.js";
import { registerApi } from "./api/register-api.js";
import { readOrCreateToken } from "./auth/read-or-create-token.js";
import { clearServerFile } from "./clear-server-file.js";
import { handleRequest } from "./http/handle-request.js";
import { listenOnFreePort } from "./http/listen-on-free-port.js";
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

/**
 * Starts the dashboard server on 127.0.0.1: takes `<home>/server.lock` (`lockServer`; ServerRunningError while another
 * server holds it), listens on `port` (default 47683) or the next free one of 20, and records `{ pid, port, version }` in
 * `<home>/server.json`. `close` stops it, giving open connections a second, and removes server.json and the lock.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const home = options.home ?? groveHome();
  const uiDir = options.uiDir ?? fileURLToPath(new URL("../ui/", import.meta.url));
  await mkdir(home, { recursive: true, mode: 0o700 });
  const release = await lockServer(home);
  const http = createServer();
  let store: Store | null = null;
  try {
    const token = await readOrCreateToken(home);
    store = openStore(join(home, "grove.db"));
    const opened = store;
    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        try {
          await stopListening(http);
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
    const deps = { router, context, uiDir, closing: () => closing !== null };
    http.on("request", (req, res) => void handleRequest(req, res, deps));
    const port = await listenOnFreePort(http, options.port ?? DEFAULT_PORT);
    context.port = port;
    writeServerFile(home, { pid: process.pid, port, version: options.version });
    return { port, url: `http://127.0.0.1:${port}/`, token, context, close };
  } catch (error) {
    store?.close();
    await stopListening(http);
    await release();
    throw error;
  }
}
