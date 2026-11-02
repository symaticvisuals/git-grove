import type { RepoFacts } from "../facts/facts.types.js";
import { stillUnresolved } from "../snapshot/still-unresolved.js";
import type { Store } from "./store.types.js";

/**
 * The pin of the branch's newest alert that status still shows, a rewrite or deletion whose commits are neither back
 * on the branch nor landed (`stillUnresolved`). Undefined when the branch has none.
 */
export async function alertPin(store: Store, facts: RepoFacts, branch: string): Promise<string | undefined> {
  const repoId = store.findRepoId(facts.commonDir);
  if (repoId === null) return undefined;
  const shown = await stillUnresolved(store, repoId, facts, Date.now());
  return shown.filter((entry) => entry.branch === branch && entry.pinRef !== null).at(-1)?.pinRef ?? undefined;
}
