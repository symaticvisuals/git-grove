import type { Feature } from "./stacks.types.js";

/** The feature named `nameOrBranch`, else the feature with a level on that branch, else null. */
export function findFeature(features: Feature[], nameOrBranch: string): Feature | null {
  return (
    features.find((feature) => feature.name === nameOrBranch) ??
    features.find((feature) => feature.levels.some((level) => level.branch === nameOrBranch)) ??
    null
  );
}
