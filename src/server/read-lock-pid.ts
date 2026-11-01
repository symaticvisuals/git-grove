import { readFileSync } from "node:fs";

/** The pid a lock file names, or null when it is missing, empty, unreadable or holds anything but a pid. */
export function readLockPid(path: string): number | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
  const pid = /^\d+$/.test(text) ? Number(text) : 0;
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}
