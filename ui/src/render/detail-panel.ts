import type { Plan } from "../../../src/core/actions/plan.types.js";
import type { WireFeatureDetail, WireRepoView } from "../../../src/server/wire/wire.types.js";
import { findLevel } from "../find-level.js";
import { html, type SafeHtml } from "../html.js";
import type { RowRef } from "../parse-route.js";
import type { Load } from "../state.js";
import { deletedDetail } from "./deleted-detail.js";
import { detachedDetail } from "./detached-detail.js";
import { detailHead } from "./detail-head.js";
import { levelDetail } from "./level-detail.js";
import { loadView } from "./load-view.js";
import { safeBox } from "./safe-box.js";

export type DetailPanelInput = {
  repo: Load<WireRepoView> | null;
  pick: RowRef | null;
  feature: Load<WireFeatureDetail> | null;
  preview: Load<Plan> | null;
  now: number;
};

function nothing(view: WireRepoView, title: string, text: string): SafeHtml {
  return html`${detailHead([view.project.name], title)}<div class="d-sec">${safeBox("Nothing needs you here", text)}</div>`;
}

/** The detail panel for what is selected in a repository: a level, a deleted branch, the detached sandboxes, or a prompt to pick one. */
export function detailPanel(input: DetailPanelInput): SafeHtml {
  return loadView(input.repo, "repo", (view) => {
    const { pick, now } = input;
    if (pick === null) return nothing(view, "Nothing selected", "Pick a branch to see what grove knows about it.");
    if (pick.kind === "detached") return view.detached.length === 0 ? nothing(view, "No detached sandboxes", "They are gone.") : detachedDetail(view, now);
    if (pick.kind === "deleted") {
      const orphan = view.orphans.find((candidate) => candidate.branch === pick.branch);
      return orphan === undefined ? nothing(view, pick.branch, "This branch has nothing left to bring back.") : deletedDetail(orphan, now);
    }
    const found = pick.branch === null ? null : findLevel(view, pick.feature, pick.branch);
    if (found === null) return nothing(view, pick.branch ?? "Not found", "This branch is no longer in this repo's worktrees.");
    return levelDetail({ view, feature: found.feature, level: found.level, detail: input.feature, preview: input.preview, now });
  });
}
