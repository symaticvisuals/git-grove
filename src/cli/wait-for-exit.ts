import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pidRuns } from "../core/runner/pid-runs.js";
import { readLockPid } from "../server/read-lock-pid.js";
import type { ServerInfo } from "../server/server-info.types.js";

const POLL_MS = 100;

/**
 * Waits, checking every 100 ms for up to `waitMs`, until `server` has stopped: its process is gone, or
 * `<home>/server.lock`, which a server releases last, no longer names it. Resolves whether it stopped.
 */
export async function waitForExit(home: string, server: ServerInfo, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (!pidRuns(server.pid) || readLockPid(join(home, "server.lock")) !== server.pid) return true;
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
}
