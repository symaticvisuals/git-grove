import type { RepoFacts, Sha } from "../../core/facts/facts.types.js";
import { readRepoFacts } from "../../core/facts/read-repo-facts.js";
import { runGit } from "../../core/git/run-git.js";
import { openStore } from "../../core/journal/open-store.js";
import type { Store } from "../../core/journal/store.types.js";
import { restore, type RestoreResult } from "../../core/runner/restore.js";
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

function describe(branch: string, result: RestoreResult): string {
  if (result.kind === "created") return `restored ${branch} at ${result.to.slice(0, 7)} from ${result.pinRef}`;
  return `restored ${branch}: ${result.from.slice(0, 7)} → ${result.to.slice(0, 7)} (old tip pinned at ${result.pinnedCurrent})`;
}

/**
 * Runs `git grove restore <branch> [<pin-ref>]`: moves the branch back to the pin (default: its newest)
 * after pinning its current tip, or recreates a deleted branch there, and records the result in the journal as seen.
 * The store is opened first, so a store that cannot be opened leaves the branch untouched.
 */
export async function restoreCommand(io: CliIo, branch: string, pinRef: string | undefined): Promise<number> {
  const facts = await readRepoFacts(io.cwd);
  const store = openStore();
  try {
    const result = await restore(facts.root, branch, pinRef);
    io.out(`${describe(branch, result)}\n`);
    await settleJournal(store, facts, branch, result.to);
  } finally {
    store.close();
  }
  return 0;
}
