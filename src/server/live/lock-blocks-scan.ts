import { readFile, stat } from "node:fs/promises";

const UNREADABLE_GRACE_MS = 2000;

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
 * and under 2 s old (its writer is mid-write). A missing lock, a dead pid or an older unreadable file does not.
 * The lock is never touched.
 */
export async function lockBlocksScan(path: string): Promise<boolean> {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return false;
  const trimmed = text.trim();
  const pid = /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
  if (Number.isSafeInteger(pid) && pid > 0) return running(pid);
  const info = await stat(path).catch(() => null);
  return info !== null && Date.now() - info.mtimeMs <= UNREADABLE_GRACE_MS;
}
