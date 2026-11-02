import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { groveHome } from "../core/grove-home.js";
import { openStore } from "../core/journal/open-store.js";
import type { Store } from "../core/journal/store.types.js";
import { createPlanCache } from "./actions/plan-cache.js";
import { createRuns } from "./actions/runs.js";
import { createGuardInstaller } from "./guard/guard-installer.js";
import type { GuardSetup } from "./guard/guard-setup.types.js";
import { createHub, type Hub } from "./live/hub.js";
import { createSnapshots } from "./live/snapshots.js";
import { registerApi } from "./api/register-api.js";
import { readOrCreateToken } from "./auth/read-or-create-token.js";
import { clearServerFile } from "./clear-server-file.js";
import { handleRequest, type RequestDeps } from "./http/handle-request.js";
import { listenOnLoopback } from "./http/listen-on-loopback.js";
import { createRouter } from "./http/router.js";
import { lockServer } from "./lock-server.js";
import { privateHome } from "./private-home.js";
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
  /** How long the watcher waits after a change, and how often it polls; 300 ms and 30 s by default. */
  watch?: { debounceMs?: number | undefined; pollMs?: number | undefined };
  /** How long `close` waits for runs in progress; 60 s by default. */
  closeWaitMs?: number;
  /** Where the agent guard's hook runs from and the settings file it goes into, read when asked; without it the guard routes answer 503. */
  guard?: () => GuardSetup;
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
 * Starts the dashboard server: makes sure `<home>` exists (`privateHome`), takes `<home>/server.lock` (`lockServer`), listens on
 * 127.0.0.1 and `[::1]` at `port` (default 47683) or the next of 20 free on both, and records `{ pid, port, version }`
 * in `<home>/server.json`. `close` refuses new runs and waits up to 60 s for those in progress, then stops it, giving
 * open connections a second, and removes server.json and the lock. A run still going after the wait keeps the store
 * open, so its journal and receipt can still be written.
 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const home = options.home ?? groveHome();
  const uiDir = options.uiDir ?? fileURLToPath(new URL("../ui/", import.meta.url));
  await privateHome(home);
  const release = await lockServer(home);
  let servers: Server[] = [];
  let store: Store | null = null;
  let hub: Hub | null = null;
  try {
    const token = await readOrCreateToken(home);
    store = openStore(join(home, "grove.db"));
    const opened = store;
    let closing: Promise<void> | null = null;
    const snapshots = createSnapshots(opened, options.now);
    const liveHub = createHub({ snapshots, store: opened, ...options.watch });
    hub = liveHub;
    const runs = createRuns({ hub: liveHub, store: opened, snapshots, home });
    const close = (): Promise<void> => {
      closing ??= (async () => {
        try {
          const drained = await runs.close(options.closeWaitMs === undefined ? {} : { timeoutMs: options.closeWaitMs });
          liveHub.close();
          await Promise.all(servers.map(stopListening));
          clearServerFile(home, process.pid);
          if (drained) opened.close();
        } finally {
          await release();
        }
      })();
      return closing;
    };
    const context: ServerContext = {
      store: opened,
      snapshots,
      hub: liveHub,
      plans: createPlanCache(),
      runs,
      guard: createGuardInstaller(options.guard ?? null),
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
    hub?.close();
    store?.close();
    await Promise.all(servers.map(stopListening));
    await release();
    throw error;
  }
}
