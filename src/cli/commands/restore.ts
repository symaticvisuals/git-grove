import type { RepoFacts, Sha } from "../../core/facts/facts.types.js";
import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { isAncestor } from "../../core/git/is-ancestor.js";
import { unlessGitFails } from "../../core/git/unless-git-fails.js";
import { openStore } from "../../core/journal/open-store.js";
import type { Store } from "../../core/journal/store.types.js";
import { restore, type RestoreResult } from "../../core/runner/restore.js";
import type { CliIo } from "../cli-io.types.js";

function parentTipOf(facts: RepoFacts, branch: string): Sha {
  const parent = facts.edges.find((edge) => edge.branch === branch)?.parent;
  return facts.branches.find((candidate) => candidate.name === parent)?.tip ?? facts.trunk.sha;
}

/** The pin of the branch's newest unresolved rewrite or deletion, which is the alert status shows last. */
function alertPin(store: Store, facts: RepoFacts, branch: string): string | undefined {
  const repoId = store.findRepoId(facts.commonDir);
  if (repoId === null) return undefined;
  const entries = store.entries(repoId, { unresolved: true });
  return entries.filter((entry) => entry.branch === branch && entry.pinRef !== null).at(-1)?.pinRef ?? undefined;
}

/**
 * Saves the restored tip the way `observe` would, so the restore is not journaled, and acks the branch's open alerts
 * whose old tip the restored tip contains. Alerts whose commits are still missing stay open.
 */
async function settleJournal(store: Store, facts: RepoFacts, branch: string, tip: Sha): Promise<void> {
  const now = Date.now();
  const repoId = store.repoId(facts.commonDir, facts.root);
  const parentTip = parentTipOf(facts, branch);
  const kept = store.lastTips(repoId).get(branch)?.parentSha ?? parentTip;
  const parentSha = (await unlessGitFails(isAncestor(facts.root, parentTip, tip), false)) ? parentTip : kept;
  store.saveTip(repoId, branch, tip, parentSha, now);
  for (const entry of store.entries(repoId, { unresolved: true })) {
    if (entry.branch !== branch || entry.id === undefined) continue;
    if (entry.oldTip === tip || (await unlessGitFails(isAncestor(facts.root, entry.oldTip, tip), false))) {
      store.ack(repoId, entry.id, now);
    }
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function describe(branch: string, result: RestoreResult): string {
  const restored = `restored ${branch} at ${result.to.slice(0, 7)} from ${result.pinRef} (${plural(result.commitsBack, "commit")} back)`;
  if (result.kind === "created") return restored;
  return `${restored}\nprevious tip ${result.from.slice(0, 7)} pinned at ${result.pinnedCurrent}`;
}

/**
 * Runs `git grove restore <branch> [<pin-ref>]`: moves the branch back to the pin after pinning its current tip,
 * or recreates a deleted branch there, and records the result in the journal as seen. Without a pin ref it takes
 * the pin of the branch's newest unresolved alert, else the branch's newest pin.
 * The store is opened first, so a store that cannot be opened leaves the branch untouched.
 */
export async function restoreCommand(io: CliIo, branch: string, pinRef: string | undefined): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  const store = openStore();
  try {
    const result = await restore(facts.root, branch, pinRef ?? alertPin(store, facts, branch));
    io.out(`${describe(branch, result)}\n`);
    await settleJournal(store, facts, branch, result.to);
  } finally {
    store.close();
  }
  return 0;
}
