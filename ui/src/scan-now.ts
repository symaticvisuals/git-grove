import type { WireProject } from "../../src/server/wire/wire.types.js";
import type { Api } from "./api.js";
import { plural } from "./plural.js";

export type ScanDeps = { api: Pick<Api, "scan" | "projects">; repo: number | undefined; now(): number; sleep(ms: number): Promise<void> };

export type ScanResult = { text: string; ok: boolean };

const POLL_MS = 300;
const GIVE_UP_MS = 30_000;

/**
 * Starts a scan (of `repo`, or of every repo) and waits until each scanned repo reports a scan that began after the
 * click, or an error once it has had a moment to run. All scanned: `Scanned 6 worktrees in 0.4 s`. Any error fails
 * it, naming the repo: `Scanned 4 worktrees; api: <error>`, or only the errors when none scanned. A failed request
 * throws its `ApiError`; a scan still running after 30 s is reported as started.
 */
export async function scanNow(deps: ScanDeps): Promise<ScanResult> {
  const started = deps.now();
  await deps.api.scan(deps.repo);
  const scanned = (project: WireProject): boolean => project.error === null && project.scannedAt !== null && project.scannedAt >= started;
  for (let polls = 0; ; polls++) {
    const projects = (await deps.api.projects()).filter((project) => deps.repo === undefined || project.id === deps.repo);
    const failed = projects.filter((project) => project.error !== null);
    const elapsed = deps.now() - started;
    if (projects.every(scanned) || (polls > 0 && projects.every((project) => scanned(project) || project.error !== null))) {
      const worktrees = projects.filter(scanned).reduce((total, project) => total + project.worktrees, 0);
      if (failed.length === 0) return { text: `Scanned ${plural(worktrees, "worktree")} in ${(elapsed / 1000).toFixed(1)} s`, ok: true };
      const errors = failed.map((project) => `${project.name}: ${project.error ?? ""}`).join("; ");
      return { text: failed.length === projects.length ? errors : `Scanned ${plural(worktrees, "worktree")}; ${errors}`, ok: false };
    }
    if (elapsed >= GIVE_UP_MS) return { text: "The scan is still running", ok: true };
    await deps.sleep(POLL_MS);
  }
}
