import { setTimeout as sleep } from "node:timers/promises";
import { readServerFile } from "../server/read-server-file.js";
import { serverAlive } from "../server/server-alive.js";
import type { ServerInfo } from "../server/server-info.types.js";

const POLL_MS = 100;

/**
 * The server `<home>/server.json` names, once it answers as itself (`serverAlive`), looked for every 100 ms for up
 * to `waitMs`; null when none did. A server whose pid is `except` does not count.
 */
export async function findServer(home: string, options: { waitMs: number; except?: number }): Promise<ServerInfo | null> {
  const deadline = Date.now() + options.waitMs;
  for (;;) {
    const info = readServerFile(home);
    if (info !== null && info.pid !== options.except && (await serverAlive(info))) return info;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}
