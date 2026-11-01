import type { ChangeKind } from "../../core/journal/classify-tip-change.js";
import type { ActivityKind, JournalEntry, StoredActivity } from "../../core/journal/store.types.js";
import { plural } from "../../core/rules/plural.js";
import type { ActivityItem } from "./wire.types.js";

type Severity = ActivityItem["severity"];

const CHANGE_SEVERITY: Record<ChangeKind, Severity> = {
  rewritten: "loses-work",
  deleted: "loses-work",
  amended: "info",
  rebased: "info",
  advanced: "info",
};

const STORED_SEVERITY: Record<ActivityKind, Severity> = {
  action: "info",
  "worktree-added": "info",
  "worktree-removed": "info",
  "scan-error": "needs-action",
};

function journalTitle(entry: JournalEntry): { title: string; detail: string } {
  const { branch, kind, lost } = entry;
  switch (kind) {
    case "rewritten":
      return { title: `History rewritten on ${branch}`, detail: `${plural(lost.length, "commit")} no longer on ${branch}` };
    case "deleted":
      return {
        title: `Branch ${branch} deleted with ${plural(lost.length, "unique commit")}`,
        detail: entry.pinRef === null ? "" : `kept at ${entry.pinRef}`,
      };
    case "rebased":
      return { title: `${branch} rebased`, detail: "Every commit was replayed onto a new base" };
    case "amended":
      return { title: `${branch} amended`, detail: "The tip commit was replaced" };
    case "advanced":
      return { title: `${branch}: new commits`, detail: "" };
  }
}

/** One feed line from a journal entry (`j:<id>`) or a stored activity row (`a:<id>`) of repository `repoId`. */
export function toActivityItem(source: JournalEntry | StoredActivity, repoId: number): ActivityItem {
  if ("title" in source) {
    return {
      id: `a:${source.id}`,
      repoId,
      at: source.at,
      kind: source.kind,
      branch: source.branch,
      title: source.title,
      detail: source.detail,
      severity: STORED_SEVERITY[source.kind],
    };
  }
  return {
    id: `j:${source.id ?? source.oldTip}`,
    repoId,
    at: source.at,
    kind: source.kind,
    branch: source.branch,
    ...journalTitle(source),
    severity: CHANGE_SEVERITY[source.kind],
  };
}
