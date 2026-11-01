import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import type { Finding } from "../../core/rules/rule.types.js";
import type { Feature, Level } from "../../core/stacks/stacks.types.js";

/** Findings of a level: those on its branch, on its `<feature>/<branch>` id, or on its worktree's path. */
export function findingsOfLevel(snapshot: Snapshot, feature: Feature, level: Level): Finding[] {
  const path = level.worktree?.path;
  return snapshot.findings.filter(({ subject }) => {
    if (subject.kind === "branch") return subject.id === level.branch;
    if (subject.kind === "level") return subject.id === `${feature.name}/${level.branch}`;
    return subject.id === path;
  });
}
