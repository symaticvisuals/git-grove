import type { Store } from "../../core/journal/store.types.js";
import { toActivityItem } from "./to-activity-item.js";
import type { ActivityItem } from "./wire.types.js";

const FILTERED_FETCH = 1000;

/**
 * Journal entries and stored activity of `repoIds`, newest first, at most `limit`. With `branches`, only items on those branches.
 */
export function readActivity(
  store: Store,
  repoIds: number[],
  options: { branches?: ReadonlySet<string>; limit: number },
): ActivityItem[] {
  const { branches, limit } = options;
  const items: ActivityItem[] = [];
  for (const repoId of repoIds) {
    for (const entry of store.entries(repoId)) items.push(toActivityItem(entry, repoId));
    for (const row of store.activity(repoId, branches === undefined ? limit : FILTERED_FETCH)) items.push(toActivityItem(row, repoId));
  }
  return items
    .filter((item) => branches === undefined || (item.branch !== null && branches.has(item.branch)))
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, limit);
}
