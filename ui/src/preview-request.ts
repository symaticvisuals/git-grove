import type { WireFeature, WireLevel } from "../../src/server/wire/wire.types.js";
import type { PlanRequest } from "./api.js";
import { worstFinding } from "./worst-finding.js";

/**
 * The plan the detail panel previews for `level`, by its worst finding: a restack of the stack for a parent that
 * moved or merged, a rescue-remove for a merged worktree that is not safe to remove; null for anything else.
 */
export function previewRequest(repoId: number, feature: WireFeature, level: WireLevel): PlanRequest | null {
  const rule = worstFinding(level.findings)?.rule;
  if ((rule === "parent-moved" || rule === "parent-merged") && feature.kind === "stack") {
    return { repo: repoId, action: "restack", input: { feature: feature.name, stash: true } };
  }
  if (rule === "unsafe-merged-worktree" && level.worktree !== null) {
    return { repo: repoId, action: "remove", input: { worktree: level.worktree.path, rescue: true } };
  }
  return null;
}
