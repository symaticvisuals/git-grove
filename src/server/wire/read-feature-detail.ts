import type { Store } from "../../core/journal/store.types.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { readActivity } from "./read-activity.js";
import { readRewrite } from "./read-rewrite.js";
import { toWireFeature } from "./to-wire-feature.js";
import type { WireFeatureDetail } from "./wire.types.js";

const ACTIVITY_LIMIT = 50;

/**
 * The feature called `name` with its unresolved rewrites and deletions as before and now lanes, and its branches'
 * recent activity; null when the snapshot has no such feature.
 */
export async function readFeatureDetail(snapshot: Snapshot, name: string, store: Store): Promise<WireFeatureDetail | null> {
  const feature = snapshot.features.find((candidate) => candidate.name === name);
  if (feature === undefined || feature.kind === "detached") return null;
  const parents = new Map(feature.levels.map((level) => [level.branch, level.parent]));
  const rewrites = [];
  for (const entry of snapshot.journal) {
    const parent = parents.get(entry.branch);
    if (parent === undefined || (entry.kind !== "rewritten" && entry.kind !== "deleted")) continue;
    rewrites.push(await readRewrite(snapshot, entry, parent));
  }
  return {
    feature: toWireFeature(snapshot, feature),
    rewrites,
    activity: readActivity(store, [snapshot.repoId], { branches: new Set(parents.keys()), limit: ACTIVITY_LIMIT }),
  };
}
