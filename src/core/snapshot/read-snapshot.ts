import { readEnvMissing } from "../facts/read-env-missing.js";
import { readMergedRemovals } from "../facts/read-merged-removals.js";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import type { RepoFacts } from "../facts/facts.types.js";
import { observe } from "../journal/observe.js";
import type { JournalEntry, Store } from "../journal/store.types.js";
import { evaluate } from "../rules/evaluate.js";
import type { Finding } from "../rules/rule.types.js";
import type { Verdict } from "../rules/verdict.types.js";
import { readStackFacts } from "../stacks/read-stack-facts.js";
import type { Feature } from "../stacks/stacks.types.js";
import { stillUnresolved } from "./still-unresolved.js";
import { strandedCommits } from "./stranded-commits.js";

/** `journal` is the unresolved entries; `added` is what `observe` journaled on this read; `removals` is keyed by worktree path. */
export type Snapshot = {
  repoId: number;
  facts: RepoFacts;
  features: Feature[];
  findings: Finding[];
  journal: JournalEntry[];
  added: JournalEntry[];
  removals: Map<string, Verdict>;
  detachedOnly: Map<string, number | null>;
  readAt: number;
  elapsedMs: number;
};

/**
 * Journals tip changes since the last read, then reads the repository around `cwd`, its stacks, the removal verdicts
 * of merged worktrees and missing env files, and evaluates the rules. `now` is the read's clock; `elapsedMs` is the
 * wall time since it.
 */
export async function readSnapshot(cwd: string, store: Store, now: number): Promise<Snapshot> {
  const added = await observe(cwd, store, now);
  const facts = await readRepoFacts(cwd);
  const features = await readStackFacts(facts.root, facts);
  const removals = await readMergedRemovals(facts);
  const envMissing = await readEnvMissing(facts.root, facts).catch(() => new Map<string, string[]>());
  const detachedOnly = await strandedCommits(facts);
  const repoId = store.repoId(facts.commonDir, facts.root);
  const journal = await stillUnresolved(store, repoId, facts, now);
  const findings = evaluate({ facts, features, unresolved: journal, removals, envMissing, detachedOnly, now });
  return { repoId, facts, features, findings, journal, added, removals, detachedOnly, readAt: now, elapsedMs: Date.now() - now };
}
