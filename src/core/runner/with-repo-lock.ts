import { join } from "node:path";
import { LockHeldError } from "./lock-held.error.js";
import { acquirePidLock } from "./pid-lock.js";
import { RepoLockedError } from "./repo-locked.error.js";

/**
 * Runs `fn` while holding `<commonDir>/grove.lock`, removed afterwards. A lock left by a process that no longer runs
 * is taken over. Throws RepoLockedError when another running process, or an empty lock file, holds it.
 */
export async function withRepoLock<T>(commonDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(commonDir, "grove.lock");
  const release = await acquirePidLock(lockPath).catch((error: unknown) => {
    if (error instanceof LockHeldError) throw new RepoLockedError(lockPath);
    throw error;
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
