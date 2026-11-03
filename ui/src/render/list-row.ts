import type { WireSandbox } from "../../../src/server/wire/wire.types.js";
import { HEALTH_LABEL } from "../health-label.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { RowRef } from "../parse-route.js";
import { plural } from "../plural.js";
import type { ListRow } from "./groups-of.js";
import { levelRow } from "./level-row.js";
import { quickAction } from "./quick-action.js";
import { rowHref } from "./row-href.js";
import { timeAgo } from "./time-ago.js";
import { treeGutter } from "./tree-gutter.js";

/** `stop` is the href of the row that holds the list's one Tab stop. */
export type ListRowContext = { repoId: number; pick: RowRef | null; now: number; stop: string | null };

function sameRef(a: RowRef, b: RowRef | null): boolean {
  if (b === null || a.kind !== b.kind) return false;
  if (a.kind === "feature" && b.kind === "feature") return a.feature === b.feature && a.branch === b.branch;
  if (a.kind === "deleted" && b.kind === "deleted") return a.branch === b.branch;
  return true;
}

function newest(sandboxes: readonly WireSandbox[]): number | null {
  const times = sandboxes.flatMap((sandbox) => (sandbox.touchedAt === null ? [] : [sandbox.touchedAt]));
  return times.length === 0 ? null : Math.max(...times);
}

function cells(row: ListRow, now: number): { name: SafeHtml; state: string; pills: SafeHtml; num: string; when: SafeHtml; path: string | null } {
  const pill = (text: string, pin: boolean): SafeHtml => html`<span class="pill${pin ? " pin" : ""}">${pin ? ICONS.ring(10) : ""}${text}</span>`;
  if (row.kind === "level") {
    const { level } = row;
    const shown = levelRow(level, now);
    const touched = level.worktree?.touchedAt ?? null;
    return {
      name: html`${level.number === null ? "" : html`<span class="lv">${level.number}</span>`}${level.branch}`,
      state: level.state,
      pills: html`${shown.pills.map((entry) => pill(entry.text, entry.pin))}`,
      num: shown.num,
      when: touched === null ? html`` : timeAgo(touched, now),
      path: level.findings.some((finding) => finding.rule === "prunable") ? null : (level.worktree?.path ?? null),
    };
  }
  if (row.kind === "deleted") {
    const { orphan } = row;
    return {
      name: html`${orphan.branch}`,
      state: "Branch deleted",
      pills: orphan.pinRef === null ? html`` : pill(`${plural(orphan.lost.length, "commit")} pinned`, true),
      num: "",
      when: timeAgo(orphan.at, now),
      path: null,
    };
  }
  const touched = newest(row.sandboxes);
  const worst = row.sandboxes.find((sandbox) => sandbox.health === row.health);
  return {
    name: html`<span class="plain">${plural(row.sandboxes.length, "sandbox", "sandboxes")}, detached</span>`,
    state: row.health === "fine" ? "Nothing to keep" : (worst?.state ?? "Nothing to keep"),
    pills: html``,
    num: "",
    when: touched === null ? html`` : timeAgo(touched, now),
    path: null,
  };
}

/**
 * One row of the list: its tree cell and health icon, name, state (in its health's colour, by class), pills,
 * number and age, and its actions: the fix for its worst finding, the editor, a terminal and the palette. Clicking
 * it routes to its detail. Only the `stop` row and its actions are in the Tab order; the rest are reached by j and k.
 */
export function listRow(rows: readonly ListRow[], index: number, context: ListRowContext): SafeHtml {
  const row = rows[index];
  if (row === undefined) return html``;
  const { ref, href } = rowHref(context.repoId, row);
  const shown = cells(row, context.now);
  const selected = sameRef(ref, context.pick);
  const tabbable = href === context.stop;
  const skip = tabbable ? html`` : html` tabindex="-1"`;
  const key = `row:${href}`;
  const opens =
    shown.path === null
      ? html``
      : html`<button class="ib" data-action="open-editor" data-path="${shown.path}" data-key="${key}:open-editor"${skip} title="Open in editor" aria-label="Open in editor">${ICONS.editor}</button><button class="ib" data-action="open-terminal" data-path="${shown.path}" data-key="${key}:open-terminal"${skip} title="Open a terminal here" aria-label="Open a terminal here">${ICONS.terminal}</button>`;
  const more = html`<button class="ib" data-action="palette" data-key="${key}:palette"${skip} title="More actions" aria-label="More actions">${ICONS.more}</button>`;
  return html`<div class="row h-${row.health}${selected ? " sel" : ""}" role="button" tabindex="${tabbable ? "0" : "-1"}" data-href="${href}" data-key="${key}"${selected ? html` aria-current="true"` : ""}>
${treeGutter(rows.map((entry) => ({ depth: entry.kind === "level" ? entry.depth : 0 })), index, ICONS.health(row.health))}<span class="br">${shown.name}</span><span class="state">${shown.state}<span class="sr">, ${HEALTH_LABEL[row.health]}</span></span><span class="pills">${shown.pills}</span><span class="num">${shown.num}</span><span class="when">${shown.when}</span><span class="racts">${quickAction(row, key, tabbable)}${opens}${more}</span></div>`;
}
