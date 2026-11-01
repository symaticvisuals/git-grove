import { randomUUID } from "node:crypto";
import { link, rename, rm } from "node:fs/promises";
import { LockHeldError } from "../core/runner/lock-held.error.js";
import { acquirePidLock } from "../core/runner/pid-lock.js";
import { readLockPid } from "./read-lock-pid.js";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function acquireUnlessHeld(path: string): Promise<(() => Promise<void>) | null> {
  try {
    return await acquirePidLock(path);
  } catch (error) {
    if (error instanceof LockHeldError) return null;
    throw error;
  }
}

/**
 * Replaces the lock at `path` with one naming this process, but only while it still names `stale` (null: empty or
 * not a pid). The lock is moved aside and checked there; one that changed hands is put back. Resolves to the new
 * lock's release, or null when the lock was put back or another process took it first.
 */
export async function takeOverServerLock(path: string, stale: number | null): Promise<(() => Promise<void>) | null> {
  const aside = `${path}.${process.pid}.${randomUUID()}`;
  try {
    await rename(path, aside);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return acquireUnlessHeld(path);
    throw error;
  }
  if (readLockPid(aside) !== stale) {
    try {
      await link(aside, path);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) {
        await rename(aside, path);
        return null;
      }
    }
    await rm(aside, { force: true });
    return null;
  }
  await rm(aside, { force: true });
  return acquireUnlessHeld(path);
}
