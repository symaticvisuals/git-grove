import { pidRuns } from "../core/runner/pid-runs.js";
import { probeHealth } from "./probe-health.js";
import type { ServerInfo } from "./server-info.types.js";

/** True when `info.pid` runs and `GET /api/health` on `info.port` answers as that same process within 1 s. */
export async function serverAlive(info: ServerInfo): Promise<boolean> {
  if (!pidRuns(info.pid)) return false;
  const probe = await probeHealth(info.port);
  return probe.kind === "answered" && probe.pid === info.pid;
}
