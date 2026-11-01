import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseServerInfo } from "./parse-server-info.js";
import type { ServerInfo } from "./server-info.types.js";

/** Reads `<home>/server.json`, or null when it is missing or not a server record. */
export function readServerFile(home: string): ServerInfo | null {
  try {
    return parseServerInfo(readFileSync(join(home, "server.json"), "utf8"));
  } catch {
    return null;
  }
}
