import { realpath } from "node:fs/promises";
import { groveHome } from "../../core/grove-home.js";
import { openStore } from "../../core/journal/open-store.js";
import { readSnapshot } from "../../core/snapshot/read-snapshot.js";
import type { CliIo } from "../cli-io.types.js";
import { findServer } from "../find-server.js";
import { renderStatus } from "../render-status.js";

/**
 * Runs `git grove status`: journals tip changes since the last run, reads the repository, stacks,
 * removal verdicts of merged worktrees and missing env files, evaluates the rules and prints the result.
 * Without `json` it ends with the dashboard's address when its server answers.
 * With `json` it prints one JSON document `{ repo, trunk, features, findings, journal }` and nothing else.
 */
export async function statusCommand(io: CliIo, options: { json: boolean }): Promise<number> {
  const now = Date.now();
  const store = openStore();
  try {
    const { facts, features, findings, journal, removals, elapsedMs } = await readSnapshot(io.cwd, store, now);
    if (options.json) {
      const doc = { repo: { root: facts.root, commonDir: facts.commonDir }, trunk: facts.trunk, features, findings, journal };
      io.out(`${JSON.stringify(doc, null, 2)}\n`);
    } else {
      const cwd = await realpath(io.cwd).catch(() => io.cwd);
      io.out(renderStatus({ facts, features, findings, removals, cwd, now, elapsedMs }));
      const server = await findServer(groveHome(), { waitMs: 0 });
      if (server !== null) io.out(`\nDashboard: http://127.0.0.1:${server.port}/\n`);
    }
    return 0;
  } finally {
    store.close();
  }
}
