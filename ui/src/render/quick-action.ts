import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { plural } from "../plural.js";
import { worstFinding } from "../worst-finding.js";
import type { ListRow } from "./groups-of.js";

/**
 * The hover button for a row's worst finding, keyed under the row's `key`: bring back rewritten or deleted work,
 * restack, or copy then remove; none when it is fine. It is out of the Tab order unless `tabbable`.
 */
export function quickAction(row: ListRow, key: string, tabbable: boolean): SafeHtml {
  const skip = tabbable ? html`` : html` tabindex="-1"`;
  if (row.kind === "deleted") {
    const label = `Bring back ${row.orphan.branch}`;
    const pin = row.orphan.pinRef === null ? html`` : html` data-pin="${row.orphan.pinRef}"`;
    return html`<button class="ib hot" data-action="restore" data-branch="${row.orphan.branch}"${pin} data-key="${key}:restore"${skip} title="${label}" aria-label="${label}">${ICONS.back}</button>`;
  }
  if (row.kind !== "level" || row.health === "fine") return html``;
  const { feature, level } = row;
  const rule = worstFinding(level.findings)?.rule;
  const button = (action: string, icon: SafeHtml, label: string, extra: SafeHtml = html``): SafeHtml =>
    html`<button class="ib hot" data-action="${action}" data-feature="${feature.id}" data-branch="${level.branch}"${extra} data-key="${key}:${action}"${skip} title="${label}" aria-label="${label}">${icon}</button>`;
  if (rule === "history-rewritten") return button("restore", ICONS.back, `Bring back ${plural(level.pinnedLost, "commit")}`);
  if (rule === "parent-moved" || rule === "parent-merged") return button("restack", ICONS.restack, "Restack onto its parent");
  if (rule === "unsafe-merged-worktree" && level.worktree !== null) {
    return button("remove", ICONS.broom, "Copy the file, then remove", html` data-path="${level.worktree.path}"`);
  }
  return html``;
}
