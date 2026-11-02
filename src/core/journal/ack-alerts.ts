import type { Store } from "./store.types.js";

/** Marks the alerts `ids` of the repository as intended, and only those, and returns how many it marked. */
export function ackAlerts(store: Store, repoId: number, ids: Iterable<number>): number {
  const now = Date.now();
  let acked = 0;
  for (const id of ids) {
    store.ack(repoId, id, now);
    acked += 1;
  }
  return acked;
}
