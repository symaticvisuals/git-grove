import { randomUUID } from "node:crypto";
import { link, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { LockHeldError } from "../core/runner/lock-held.error.js";
import { acquirePidLock } from "../core/runner/pid-lock.js";
import { readServerFile } from "./read-server-file.js";
import { serverAlive } from "./server-alive.js";
import { ServerRunningError } from "./server-running.error.js";

type Release = () => Promise<void>;

const STARTUP_GRACE_MS = 2000;
const POLL_MS = 50;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function heldBy(home: string, pid: number | null): ServerRunningError {
  const info = readServerFile(home);
  return new ServerRunningError(pid !== null && info?.pid === pid ? info.port : null, pid);
}

async function servingPort(home: string, holder: number): Promise<number | null> {
  const deadline = Date.now() + STARTUP_GRACE_MS;
  let info = readServerFile(home);
  while (info?.pid !== holder && Date.now() < deadline) {
    await sleep(POLL_MS);
    info = readServerFile(home);
  }
  return info?.pid === holder && (await serverAlive(info)) ? info.port : null;
}

async function takeOver(path: string, home: string, holder: number): Promise<Release> {
  const aside = `${path}.${process.pid}.${randomUUID()}`;
  const moved = await rename(path, aside).then(
    () => true,
    (error: unknown) => {
      if (hasCode(error, "ENOENT")) return false;
      throw error;
    },
  );
  if (moved) {
    const named = (await readFile(aside, "utf8").catch(() => "")).trim();
    if (named !== String(holder)) {
      try {
        await link(aside, path);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) await rename(aside, path);
      }
      await rm(aside, { force: true });
      throw heldBy(home, /^\d+$/.test(named) ? Number(named) : null);
    }
    await rm(aside, { force: true });
  }
  try {
    return await acquirePidLock(path);
  } catch (error) {
    if (error instanceof LockHeldError) throw heldBy(home, error.pid);
    throw error;
  }
}

/**
 * Takes `<home>/server.lock`. A lock naming a live process stands only while that process's server answers
 * `/api/health` on the port in server.json, given up to 2 s to write server.json if it is still starting;
 * otherwise the lock is stale (its pid was reused) and is taken over: moved aside and replaced only while it still
 * names that pid, or put back. Throws ServerRunningError while the lock stands.
 */
export async function lockServer(home: string): Promise<Release> {
  const path = join(home, "server.lock");
  try {
    return await acquirePidLock(path);
  } catch (error) {
    if (!(error instanceof LockHeldError)) throw error;
    if (error.pid === null) throw heldBy(home, null);
    const port = await servingPort(home, error.pid);
    if (port !== null) throw new ServerRunningError(port, error.pid);
    return takeOver(path, home, error.pid);
  }
}
