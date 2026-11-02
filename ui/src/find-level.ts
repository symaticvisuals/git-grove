import type { WireFeature, WireLevel, WireRepoView } from "../../src/server/wire/wire.types.js";

/** The level on `branch` of the feature with id `featureId`, with that feature; null when the view has neither. */
export function findLevel(repo: WireRepoView, featureId: string, branch: string): { feature: WireFeature; level: WireLevel } | null {
  const feature = repo.features.find((candidate) => candidate.id === featureId);
  const level = feature?.levels.find((candidate) => candidate.branch === branch);
  return feature === undefined || level === undefined ? null : { feature, level };
}
