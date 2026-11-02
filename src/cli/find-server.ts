import { setTimeout as sleep } from "node:timers/promises";
import { readServerFile } from "../server/read-server-file.js";
import { serverAlive } from "../server/server-alive.js";
import type { ServerInfo } from "../server/server-info.types.js";

const POLL_MS = 100;

/**
 * The server `<home>/server.json` names, once it answers as itself (`serverAlive`), looked for every 100 ms for up
 * to `waitMs`; null when none did. The server `except` names (the same pid on the same port) does not count.
 */
export async function findServer(home: string, options: { waitMs: number; except?: ServerInfo }): Promise<ServerInfo | null> {
  const deadline = Date.now() + options.waitMs;
  for (;;) {
    const info = readServerFile(home);
    const old = info !== null && info.pid === options.except?.pid && info.port === options.except.port;
    if (info !== null && !old && (await serverAlive(info))) return info;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}
