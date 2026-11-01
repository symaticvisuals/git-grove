import type { ServerInfo } from "./server-info.types.js";

const HEALTH_TIMEOUT_MS = 1000;

function pidRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function healthPid(value: unknown): number | null {
  if (typeof value !== "object" || value === null || !("ok" in value) || !("pid" in value)) return null;
  return value.ok === true && typeof value.pid === "number" ? value.pid : null;
}

/** True when `info.pid` runs and `GET /api/health` on `info.port` answers as that same process. */
export async function serverAlive(info: ServerInfo): Promise<boolean> {
  if (!pidRuns(info.pid)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return res.ok && healthPid(await res.json()) === info.pid;
  } catch {
    return false;
  }
}
