import { randomUUID } from "node:crypto";
import { link, open, readFile, rename, rm } from "node:fs/promises";
import { LockHeldError } from "./lock-held.error.js";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

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

async function readPid(path: string): Promise<number | null> {
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

async function takeOver(path: string, dead: number): Promise<boolean> {
  const aside = `${path}.${process.pid}.${randomUUID()}`;
  const moved = await rename(path, aside).then(
    () => true,
    (error: unknown) => {
      if (hasCode(error, "ENOENT")) return false;
      throw error;
    },
  );
  if (!moved) return create(path);
  if ((await readPid(aside)) === dead) {
    await rm(aside, { force: true });
    return create(path);
  }
  try {
    await link(aside, path);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) {
      await rename(aside, path);
      return false;
    }
  }
  await rm(aside, { force: true });
  return false;
}

/**
 * Takes the lock file at `path` by creating it exclusively with this process's pid, and resolves to its release,
 * which removes the file only while it still names this process. A lock whose pid no longer runs is moved aside,
 * checked and replaced, so two processes taking over the same stale lock cannot both win. Throws LockHeldError when
 * the file names a running process, or none (an empty file counts as held).
 */
export async function acquirePidLock(path: string): Promise<() => Promise<void>> {
  const release = async (): Promise<void> => {
    if ((await readPid(path)) === process.pid) await rm(path, { force: true });
  };
  if (await create(path)) return release;
  const pid = await readPid(path);
  if (pid === null || !isGone(pid)) throw new LockHeldError(path, pid);
  if (await takeOver(path, pid)) return release;
  throw new LockHeldError(path, await readPid(path));
}
