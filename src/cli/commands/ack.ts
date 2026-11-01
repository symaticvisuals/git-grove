import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { ackAlerts } from "../../core/journal/ack-alerts.js";
import { openStore } from "../../core/journal/open-store.js";
import { plural } from "../../core/rules/plural.js";
import type { CliIo } from "../cli-io.types.js";

/**
 * Runs `git grove ack <branch>`: marks every unresolved rewrite and deletion alert of the branch as intended,
 * so status stops showing them. A branch with no such alert, or no such branch, has nothing to acknowledge (exit 0).
 */
export async function ackCommand(io: CliIo, branch: string): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  const store = openStore();
  try {
    const repoId = store.findRepoId(facts.commonDir);
    const acked = repoId === null ? 0 : ackAlerts(store, repoId, branch);
    io.out(acked === 0 ? `nothing to acknowledge on ${branch}\n` : `acknowledged ${plural(acked, "alert")} on ${branch}\n`);
  } finally {
    store.close();
  }
  return 0;
}
