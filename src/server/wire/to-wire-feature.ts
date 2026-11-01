import { worst } from "../../core/rules/needs-you.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import type { Feature } from "../../core/stacks/stacks.types.js";
import { featureId } from "./feature-id.js";
import { findingsOfLevel } from "./findings-of-level.js";
import { healthOf } from "./health-of.js";
import { toWireLevel } from "./to-wire-level.js";
import type { WireFeature } from "./wire.types.js";

/** A feature with its levels; its health is its worst level's. */
export function toWireFeature(snapshot: Snapshot, feature: Feature): WireFeature {
  const findings = feature.levels.flatMap((level) => findingsOfLevel(snapshot, feature, level));
  return {
    id: featureId(snapshot.repoId, feature.name),
    repoId: snapshot.repoId,
    name: feature.name,
    kind: feature.kind,
    health: healthOf(worst(findings)),
    levels: feature.levels.map((level) => toWireLevel(snapshot, feature, level)),
  };
}
