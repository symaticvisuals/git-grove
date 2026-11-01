import type { RepoFacts, Sha } from "../facts/facts.types.js";
import { isAncestor } from "../git/is-ancestor.js";
import { unlessGitFails } from "../git/unless-git-fails.js";
import type { Store } from "./store.types.js";

function parentTipOf(facts: RepoFacts, branch: string): Sha {
  const parent = facts.edges.find((edge) => edge.branch === branch)?.parent;
  return facts.branches.find((candidate) => candidate.name === parent)?.tip ?? facts.trunk.sha;
}

/**
 * Saves the restored tip the way `observe` would, so the restore is not journaled, and acks the branch's open alerts
 * whose old tip the restored tip contains. Alerts whose commits are still missing stay open.
 */
export async function settleRestoredTip(store: Store, facts: RepoFacts, branch: string, tip: Sha): Promise<void> {
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
