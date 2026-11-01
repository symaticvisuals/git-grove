import type { Store } from "../../journal/store.types.js";

/** The branches among `branches`, in that order, with a rewrite that is neither restored nor acknowledged. */
export function rewrittenLevels(store: Store, commonDir: string, branches: string[]): string[] {
  const repoId = store.findRepoId(commonDir);
  if (repoId === null) return [];
  const open = new Set(
    store
      .entries(repoId, { unresolved: true })
      .filter((entry) => entry.kind === "rewritten")
      .map((entry) => entry.branch),
  );
  return branches.filter((branch) => open.has(branch));
}
