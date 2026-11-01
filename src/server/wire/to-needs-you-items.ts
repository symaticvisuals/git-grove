import type { StoredRepo } from "../../core/journal/store.types.js";
import { needsYou } from "../../core/rules/needs-you.js";
import type { Finding } from "../../core/rules/rule.types.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { basename } from "node:path";
import { featureId } from "./feature-id.js";
import type { NeedsYouItem } from "./wire.types.js";

function owner(snapshot: Snapshot, finding: Finding): string | null {
  const { kind, id } = finding.subject;
  for (const feature of snapshot.features) {
    const owns = feature.levels.some(
      (level) =>
        (kind === "branch" && level.branch === id) ||
        (kind === "level" && id === `${feature.name}/${level.branch}`) ||
        (kind === "worktree" && level.worktree?.path === id),
    );
    if (owns) return featureId(snapshot.repoId, feature.name);
  }
  return null;
}

/** The findings of `repo` that need the user, worst first, each with the feature it belongs to. */
export function toNeedsYouItems(repo: StoredRepo, snapshot: Snapshot): NeedsYouItem[] {
  return needsYou(snapshot.findings).map((finding) => ({
    repoId: repo.id,
    repoName: basename(repo.root),
    featureId: owner(snapshot, finding),
    finding,
  }));
}
