import type { RepoFacts } from "../facts/facts.types.js";
import { isAncestor } from "../git/is-ancestor.js";
import { unlessGitFails } from "../git/unless-git-fails.js";
import type { JournalEntry, Store } from "../journal/store.types.js";
import { branchLanded } from "../stacks/branch-landed.js";

/**
 * Keeps the entries whose lost commits are neither back on their branch nor landed on the trunk.
 * A `deleted` entry, or one whose branch is gone, resolves once its lost tip lands;
 * one whose branch still exists also needs the branch's current tip landed.
 * An entry resolved by landing is acked in `store`, so it stays resolved however the trunk moves on.
 */
export async function stillUnresolved(store: Store, repoId: number, facts: RepoFacts, now: number): Promise<JournalEntry[]> {
  const kept: JournalEntry[] = [];
  const trunkRef = facts.trunk.ref;
  for (const entry of store.entries(repoId, { unresolved: true })) {
    const branch = facts.branches.find((candidate) => candidate.name === entry.branch);
    if (branch !== undefined && (await unlessGitFails(isAncestor(facts.root, entry.oldTip, branch.tip), false))) continue;
    const resolved =
      (await branchLanded(facts.root, { name: entry.branch, tip: entry.oldTip }, trunkRef)) &&
      (entry.kind === "deleted" || branch === undefined || (await branchLanded(facts.root, branch, trunkRef)));
    if (!resolved) kept.push(entry);
    else if (entry.id !== undefined) store.ack(repoId, entry.id, now);
  }
  return kept;
}
