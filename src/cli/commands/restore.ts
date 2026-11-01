import type { RepoFacts, Sha } from "../../core/facts/facts.types.js";
import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { runGit } from "../../core/git/run-git.js";
import { openStore } from "../../core/journal/open-store.js";
import type { Store } from "../../core/journal/store.types.js";
import { restore } from "../../core/runner/restore.js";
import type { CliIo } from "../cli-io.types.js";

function parentTipOf(facts: RepoFacts, branch: string): Sha {
  const parent = facts.edges.find((edge) => edge.branch === branch)?.parent;
  return facts.branches.find((candidate) => candidate.name === parent)?.tip ?? facts.trunk.sha;
}

async function isAncestor(cwd: string, ancestor: Sha, descendant: Sha): Promise<boolean> {
  return (await runGit(["merge-base", "--is-ancestor", ancestor, descendant], { cwd, allowFailure: true })).code === 0;
}

/** Saves the restored tip the way `observe` would and acks the branch's open alerts, so the restore is not journaled. */
async function settleJournal(store: Store, facts: RepoFacts, branch: string, tip: Sha): Promise<void> {
  const now = Date.now();
  const repoId = store.repoId(facts.commonDir, facts.root);
  const parentTip = parentTipOf(facts, branch);
  const kept = store.lastTips(repoId).get(branch)?.parentSha ?? parentTip;
  const parentSha = (await isAncestor(facts.root, parentTip, tip)) ? parentTip : kept;
  store.saveTip(repoId, branch, tip, parentSha, now);
  for (const entry of store.entries(repoId, { unresolved: true })) {
    if (entry.branch === branch && entry.id !== undefined) store.ack(repoId, entry.id, now);
  }
}

/**
 * Runs `git grove restore <branch> [<pin-ref>]`: moves the branch back to the pin (default: its newest),
 * after pinning its current tip, and records the move in the journal as seen.
 */
export async function restoreCommand(io: CliIo, branch: string, pinRef: string | undefined): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  const { from, to, pinnedCurrent } = await restore(facts.root, branch, pinRef);
  io.out(`restored ${branch}: ${from.slice(0, 7)} → ${to.slice(0, 7)} (old tip pinned at ${pinnedCurrent})\n`);
  const store = openStore();
  try {
    await settleJournal(store, facts, branch, to);
  } finally {
    store.close();
  }
  return 0;
}
