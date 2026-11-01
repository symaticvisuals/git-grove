import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { RepoLockedError } from "./repo-locked.error.js";

/**
 * Runs `fn` while holding `<commonDir>/grove.lock`, created exclusively and removed afterwards.
 * Throws RepoLockedError when the lock already exists.
 */
export async function withRepoLock<T>(commonDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(commonDir, "grove.lock");
  const handle = await open(lockPath, "wx").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new RepoLockedError(lockPath);
    throw error;
  });
  try {
    await handle.writeFile(String(process.pid));
    await handle.close();
    return await fn();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true });
  }
}
