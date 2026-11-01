import type { ServerInfo } from "./server-info.types.js";

function isServerInfo(value: unknown): value is ServerInfo {
  if (typeof value !== "object" || value === null || !("pid" in value) || !("port" in value) || !("version" in value)) return false;
  const { pid, port, version } = value;
  const pidOk = typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0;
  const portOk = typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
  return pidOk && portOk && typeof version === "string";
}

/** Parses the text of a server.json, or null when it is not JSON or not a server record. */
export function parseServerInfo(text: string): ServerInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isServerInfo(parsed) ? { pid: parsed.pid, port: parsed.port, version: parsed.version } : null;
}
