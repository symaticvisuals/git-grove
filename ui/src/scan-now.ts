import type { Api } from "./api.js";
import { plural } from "./plural.js";

export type ScanDeps = { api: Pick<Api, "scan" | "projects">; repo: number | undefined; now(): number; sleep(ms: number): Promise<void> };

const POLL_MS = 300;
const GIVE_UP_MS = 30_000;

/**
 * Starts a scan (of `repo`, or of every repo) and waits until each scanned repo reports a scan that began after
 * the click, then says what it did: `Scanned 6 worktrees in 0.4 s`. A failed request throws its `ApiError`; a scan
 * still running after 30 s is reported as started.
 */
export async function scanNow(deps: ScanDeps): Promise<string> {
  const started = deps.now();
  await deps.api.scan(deps.repo);
  for (;;) {
    const projects = (await deps.api.projects()).filter((project) => deps.repo === undefined || project.id === deps.repo);
    const done = projects.every((project) => project.error !== null || (project.scannedAt !== null && project.scannedAt >= started));
    const elapsed = deps.now() - started;
    if (done) {
      const worktrees = projects.reduce((total, project) => total + project.worktrees, 0);
      return `Scanned ${plural(worktrees, "worktree")} in ${(elapsed / 1000).toFixed(1)} s`;
    }
    if (elapsed >= GIVE_UP_MS) return "The scan is still running";
    await deps.sleep(POLL_MS);
  }
}
