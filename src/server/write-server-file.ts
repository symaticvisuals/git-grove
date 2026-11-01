import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerInfo } from "./server-info.types.js";

/** Replaces `<home>/server.json` in one rename, so a reader never sees half of it. */
export function writeServerFile(home: string, info: ServerInfo): void {
  const path = join(home, "server.json");
  const temp = `${path}.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temp, `${JSON.stringify({ pid: info.pid, port: info.port, version: info.version })}\n`);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
