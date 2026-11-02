import type { Plan } from "../../../src/core/actions/plan.types.js";
import type { WireFeature, WireFeatureDetail, WireLevel, WireRepoView } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { plural } from "../plural.js";
import { sentence } from "../sentence.js";
import type { Load } from "../state.js";
import { worstFinding } from "../worst-finding.js";
import { activityList } from "./activity-list.js";
import { banner } from "./banner.js";
import { detailHead } from "./detail-head.js";
import { levelProps } from "./level-props.js";
import { loadView } from "./load-view.js";
import { optionCard } from "./option-card.js";
import { previewChecks } from "./preview-checks.js";
import { rewriteSections } from "./rewrite-sections.js";
import { safeBox } from "./safe-box.js";
import { slashBreaks } from "./slash-breaks.js";

export type LevelDetailInput = {
  view: WireRepoView;
  feature: WireFeature;
  level: WireLevel;
  detail: Load<WireFeatureDetail> | null;
  preview: Load<Plan> | null;
  now: number;
};

function opens(level: WireLevel): SafeHtml {
  const path = level.worktree?.path;
  if (path === undefined) return html``;
  return html`<div class="acts"><button class="btn" data-action="open-editor" data-path="${path}" data-key="detail:open-editor">${ICONS.editor}Open in editor</button><button class="btn" data-action="open-terminal" data-path="${path}" data-key="detail:open-terminal">${ICONS.terminal}Terminal</button></div>`;
}

function findingSections(input: LevelDetailInput): SafeHtml {
  const { view, feature, level, preview, now } = input;
  const worst = worstFinding(level.findings);
  const restackButton = html`<button class="btn primary" data-action="restack" data-feature="${feature.id}" data-key="detail:restack">Restack <kbd>S</kbd></button>`;
  switch (worst?.rule) {
    case "history-rewritten":
      return rewriteSections(level, input.detail, now);
    case "parent-moved":
    case "parent-merged": {
      const moved = worst.rule === "parent-moved";
      const plan = preview?.status === "ready" ? preview.data : null;
      const top = moved
        ? banner("warn", "Built on an old version of its parent", `${level.parent} changed under it, so this level's PR would show the parent's old commits again.`)
        : banner("warn", worst.title, `${sentence(worst.detail)} Restacking moves this level onto ${view.trunk}.`);
      const text = plan !== null && plan.summary !== "" ? plan.summary : "Moves each level onto the latest version of the level below it.";
      return html`<div class="d-sec">${top}<div class="opts">${optionCard("Restack the whole stack", text, restackButton)}</div></div>${previewChecks("Before you restack", preview, now)}`;
    }
    case "unsafe-merged-worktree": {
      const files = level.precious;
      const top =
        files > 0
          ? banner("loses", `Merged, but removing it would delete ${files === 1 ? "a file" : plural(files, "file")}`, `The code is safe in ${view.trunk}. ${files === 1 ? "One ignored file lives" : `${files} ignored files live`} only in this folder.`)
          : banner("loses", worst.title, sentence(worst.detail));
      const path = level.worktree?.path ?? "";
      const button = html`<button class="btn primary" data-action="remove" data-path="${path}" data-key="detail:remove">Clean up <kbd>R</kbd></button>`;
      const option = optionCard(`Copy the ${files === 1 ? "file" : "files"} to main, then remove`, "Nothing in main is overwritten. The branch is kept.", button);
      return html`<div class="d-sec">${top}<div class="opts">${option}</div></div>${previewChecks("Safe to remove?", preview, now)}`;
    }
    case "env-missing": {
      const path = level.worktree?.path ?? "";
      const button = html`<button class="btn primary" data-action="copy-env" data-path="${path}" data-key="detail:copy-env">${ICONS.copy}Copy</button>`;
      return html`<div class="d-sec">${banner("warn", worst.title, sentence(worst.detail))}<div class="opts">${optionCard("Copy env files", "Copies them from the main checkout. Nothing already in this folder is overwritten.", button)}</div></div>`;
    }
    default: {
      if (worst !== null && (worst.severity === "loses-work" || worst.severity === "needs-action")) {
        return html`<div class="d-sec">${banner(worst.severity === "loses-work" ? "loses" : "warn", worst.title, sentence(worst.detail))}${opens(level)}</div>`;
      }
      return html`<div class="d-sec">${safeBox("Nothing needs you here", sentence(level.state))}${opens(level)}</div>`;
    }
  }
}

/**
 * The detail of one level, shaped by its worst finding: a rewrite, a parent that moved or merged, a merged folder
 * that is not safe to remove, missing env files, or the generic panel. It ends with the level's properties and its
 * feature's live activity.
 */
export function levelDetail(input: LevelDetailInput): SafeHtml {
  const { feature, level, now } = input;
  const path = feature.kind === "stack" ? [feature.name, `level ${level.number ?? ""}`] : ["Singles"];
  const activity = loadView(input.detail, "feature", (detail) => activityList(detail.activity, now), "feature-activity");
  return html`${detailHead(path, slashBreaks(level.branch))}${findingSections(input)}<div class="d-sec">${levelProps(feature, level, now)}</div><div class="d-sec"><div class="h3">Activity</div>${activity}</div>`;
}
