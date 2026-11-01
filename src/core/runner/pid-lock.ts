import { open, readFile, rm } from "node:fs/promises";
import { LockHeldError } from "./lock-held.error.js";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Creates `path` holding this process's pid, or returns false when it already exists. */
async function create(path: string): Promise<boolean> {
  const handle = await open(path, "wx").catch((error: unknown) => {
    if (hasCode(error, "EEXIST")) return null;
    throw error;
  });
  if (handle === null) return false;
  try {
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(path, { force: true });
    throw error;
  }
}

async function holderPid(path: string): Promise<number | null> {
  const text = (await readFile(path, "utf8").catch(() => "")).trim();
  const pid = /^\d+$/.test(text) ? Number(text) : 0;
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasCode(error, "ESRCH");
  }
}

/**
 * Takes the lock file at `path` by creating it exclusively with this process's pid, and resolves to its release.
 * A lock whose pid no longer runs is removed and taken over, once. Throws LockHeldError when the file exists and
 * names a running process, or names none (an empty file counts as held).
 */
export async function acquirePidLock(path: string): Promise<() => Promise<void>> {
  const release = (): Promise<void> => rm(path, { force: true });
  if (await create(path)) return release;
  const pid = await holderPid(path);
  if (pid === null || !isGone(pid)) throw new LockHeldError(path, pid);
  await rm(path, { force: true });
  if (await create(path)) return release;
  throw new LockHeldError(path, await holderPid(path));
}
