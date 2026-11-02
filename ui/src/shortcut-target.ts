import type { ActionName } from "../../src/core/actions/plan.types.js";
import type { WireFeature, WireRepoView } from "../../src/server/wire/wire.types.js";
import type { ActionData } from "./dialogs/dialog-context.js";
import { findLevel } from "./find-level.js";
import type { RowRef } from "./parse-route.js";
import { worstFinding } from "./worst-finding.js";

export type ShortcutKey = "quick" | "restack" | "ack";

function needsRestack(feature: WireFeature): boolean {
  return (
    feature.kind === "stack" &&
    feature.levels.some((level) => {
      const rule = worstFinding(level.findings)?.rule;
      return rule === "parent-moved" || rule === "parent-merged";
    })
  );
}

/**
 * The action a shortcut takes on the selected row, with the data its button would carry, or null. R (`quick`) is
 * the row's own fix: bring back a rewritten or deleted branch, restack a level whose parent moved or merged, or copy
 * then remove a merged folder that holds files. S restacks the row's stack when any level needs it; A keeps a rewrite
 * or a deletion.
 */
export function shortcutTarget(repo: WireRepoView, pick: RowRef | null, key: ShortcutKey): { action: ActionName; data: ActionData } | null {
  if (pick?.kind === "deleted") {
    const orphan = repo.orphans.find((candidate) => candidate.branch === pick.branch);
    if (orphan === undefined || key === "restack") return null;
    return key === "ack" ? { action: "ack", data: { branch: orphan.branch } } : { action: "restore", data: orphan.pinRef === null ? { branch: orphan.branch } : { branch: orphan.branch, pin: orphan.pinRef } };
  }
  if (pick?.kind !== "feature" || pick.branch === null) return null;
  const found = findLevel(repo, pick.feature, pick.branch);
  if (found === null) return null;
  const { feature, level } = found;
  const rule = worstFinding(level.findings)?.rule;
  if (key === "restack") return needsRestack(feature) ? { action: "restack", data: { feature: feature.id } } : null;
  if (rule === "history-rewritten") return { action: key === "ack" ? "ack" : "restore", data: { feature: feature.id, branch: level.branch } };
  if (key === "ack") return null;
  if ((rule === "parent-moved" || rule === "parent-merged") && feature.kind === "stack") return { action: "restack", data: { feature: feature.id } };
  if (rule === "unsafe-merged-worktree" && level.worktree !== null) return { action: "remove", data: { feature: feature.id, branch: level.branch, path: level.worktree.path } };
  return null;
}
