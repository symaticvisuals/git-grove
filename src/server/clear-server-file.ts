import { rmSync } from "node:fs";
import { join } from "node:path";
import { readServerFile } from "./read-server-file.js";

/** Removes `<home>/server.json` while it still names `pid`, leaving another server's record alone. */
export function clearServerFile(home: string, pid: number): void {
  if (readServerFile(home)?.pid === pid) rmSync(join(home, "server.json"), { force: true });
}
