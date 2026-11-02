import { readFile, stat } from "node:fs/promises";
import { predatesBoot } from "../../core/runner/predates-boot.js";

const UNREADABLE_GRACE_MS = 2000;
const HONOURED_MS = 15 * 60_000;

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/**
 * Whether the `grove.lock` at `path` should hold a scan back: it names a running process, or it is empty or unparsable
 * and under 2 s old (its writer is mid-write). A missing lock, a dead pid, a lock written before the last boot and one
 * older than 15 minutes do not. The lock is never touched.
 */
export async function lockBlocksScan(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (info === null || Date.now() - info.mtimeMs > HONOURED_MS || (await predatesBoot(path))) return false;
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return false;
  const trimmed = text.trim();
  const pid = /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
  if (Number.isSafeInteger(pid) && pid > 0) return running(pid);
  return Date.now() - info.mtimeMs <= UNREADABLE_GRACE_MS;
}
