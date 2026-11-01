import type { Store } from "../../core/journal/store.types.js";
import { toActivityItem } from "./to-activity-item.js";
import type { ActivityItem } from "./wire.types.js";

/**
 * Journal entries and stored activity of `repoIds`, newest first, at most `limit`. With `branches`, only items on those
 * branches. The store applies the limit and the branch filter.
 */
export function readActivity(
  store: Store,
  repoIds: number[],
  options: { branches?: ReadonlySet<string>; limit: number },
): ActivityItem[] {
  const { limit } = options;
  const branches = options.branches === undefined ? undefined : [...options.branches];
  if (branches?.length === 0) return [];
  const items: ActivityItem[] = [];
  for (const repoId of repoIds) {
    for (const entry of store.entries(repoId, { limit, ...(branches === undefined ? {} : { branches }) })) {
      items.push(toActivityItem(entry, repoId));
    }
    for (const row of store.activity(repoId, limit, branches)) items.push(toActivityItem(row, repoId));
  }
  return items.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, limit);
}
