import type { RepoFacts } from "../facts/facts.types.js";
import type { Store } from "./store.types.js";

/** The pin of the branch's newest unresolved rewrite or deletion, which is the alert status shows last. */
export function alertPin(store: Store, facts: RepoFacts, branch: string): string | undefined {
  const repoId = store.findRepoId(facts.commonDir);
  if (repoId === null) return undefined;
  const entries = store.entries(repoId, { unresolved: true });
  return entries.filter((entry) => entry.branch === branch && entry.pinRef !== null).at(-1)?.pinRef ?? undefined;
}
