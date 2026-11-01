import type { Store } from "./store.types.js";

/** Marks every unresolved rewrite and deletion alert of `branch` as intended and returns how many it marked. */
export function ackAlerts(store: Store, repoId: number, branch: string): number {
  const open = store.entries(repoId, { unresolved: true }).filter((entry) => entry.branch === branch);
  const now = Date.now();
  for (const entry of open) if (entry.id !== undefined) store.ack(repoId, entry.id, now);
  return open.length;
}
