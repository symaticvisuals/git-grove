import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseServerInfo } from "./parse-server-info.js";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Removes `<home>/server.json` while it still names `pid`. The file is moved aside and checked there, so a record
 * another server writes meanwhile is never removed: one that is not ours is put back, unless a newer one replaced it.
 */
export function clearServerFile(home: string, pid: number): void {
  const path = join(home, "server.json");
  const aside = `${path}.${process.pid}.${randomUUID()}`;
  try {
    renameSync(path, aside);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  if (parseServerInfo(readFileSync(aside, "utf8"))?.pid !== pid) {
    try {
      linkSync(aside, path);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        renameSync(aside, path);
        return;
      }
    }
  }
  rmSync(aside, { force: true });
}
