import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { LockHeldError } from "../core/runner/lock-held.error.js";
import { acquirePidLock } from "../core/runner/pid-lock.js";
import { predatesBoot } from "../core/runner/predates-boot.js";
import { probeHealth } from "./probe-health.js";
import { readLockPid } from "./read-lock-pid.js";
import { readServerFile } from "./read-server-file.js";
import type { ServerInfo } from "./server-info.types.js";
import { ServerRunningError } from "./server-running.error.js";
import { ServerUnresponsiveError } from "./server-unresponsive.error.js";
import { takeOverServerLock } from "./take-over-server-lock.js";

type Release = () => Promise<void>;
type Attempt = { release: Release } | { holder: number | null };

const STARTUP_GRACE_MS = 2000;
const POLL_MS = 50;

async function attempt(path: string): Promise<Attempt> {
  try {
    return { release: await acquirePidLock(path) };
  } catch (error) {
    if (error instanceof LockHeldError) return { holder: error.pid };
    throw error;
  }
}

async function within<T>(deadline: number, read: () => T | null): Promise<T | null> {
  let value = read();
  while (value === null && Date.now() < deadline) {
    await sleep(POLL_MS);
    value = read();
  }
  return value;
}

function granted(release: Release | null, home: string, path: string): Release {
  if (release !== null) return release;
  const holder = readLockPid(path);
  const info = readServerFile(home);
  throw new ServerRunningError(holder !== null && info?.pid === holder ? info.port : null, holder);
}

/**
 * Takes `<home>/server.lock`, taking over a lock a live process holds only on clear evidence that its server is gone:
 * the port in server.json refuses or answers as another process, or the lock predates the last boot and its holder,
 * probed once when server.json names it, does not answer as itself. It waits up to 2 s for a starting server to write
 * a pid into the lock and server.json, then takes over a lock still empty or not a pid. Throws ServerRunningError
 * while the holder's server answers, and ServerUnresponsiveError when it is silent or has written no server.json, so
 * a login service retries.
 */
export async function lockServer(home: string): Promise<Release> {
  const path = join(home, "server.lock");
  const deadline = Date.now() + STARTUP_GRACE_MS;
  let tried = await attempt(path);
  if ("release" in tried) return tried.release;
  if (tried.holder === null) {
    await within(deadline, () => readLockPid(path));
    tried = await attempt(path);
    if ("release" in tried) return tried.release;
    if (tried.holder === null) return granted(await takeOverServerLock(path, null), home, path);
  }
  const holder = tried.holder;
  if (await predatesBoot(path)) {
    const named = readServerFile(home);
    if (named?.pid === holder) {
      const probe = await probeHealth(named.port);
      if (probe.kind === "answered" && probe.pid === holder) throw new ServerRunningError(named.port, holder);
    }
    return granted(await takeOverServerLock(path, holder), home, path);
  }
  const info = await within<ServerInfo>(deadline, () => {
    const read = readServerFile(home);
    return read?.pid === holder ? read : null;
  });
  if (info === null) throw new ServerUnresponsiveError(holder, path, "it has written no server.json");
  const probe = await probeHealth(info.port);
  if (probe.kind === "answered" && probe.pid === holder) throw new ServerRunningError(info.port, holder);
  if (probe.kind === "silent") throw new ServerUnresponsiveError(holder, path, `its server on port ${info.port} does not answer`);
  return granted(await takeOverServerLock(path, holder), home, path);
}
