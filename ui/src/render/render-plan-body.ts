import type { FolderLine, Plan } from "../../../src/core/actions/plan.types.js";
import type { DialogContext, DialogSpec, Field, FieldValues } from "../dialogs/dialog-specs.js";
import { pickGroups } from "../dialogs/pick-groups.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { checkRow } from "./check-row.js";
import { laneView } from "./lane-view.js";
import { timeAgo } from "./time-ago.js";

function parentFolder(plan: Plan, root: string): string {
  const created = plan.expects.find((expect) => expect.kind === "absent" && expect.path.startsWith(`${root}/`));
  if (created === undefined || created.kind !== "absent") return ".worktrees/";
  const relative = created.path.slice(root.length + 1);
  const cut = relative.lastIndexOf("/");
  return cut < 0 ? "./" : `${relative.slice(0, cut)}/`;
}

function folderLine(line: FolderLine): SafeHtml {
  const note = line.isNew ? html`<span class="new">${line.note === "" ? "new" : `new, ${line.note}`}</span>` : line.note === "" ? "" : html`<span class="on">${line.note}</span>`;
  return html`<div class="leaf">└ <b>${line.path}</b> ${note}</div>`;
}

function folders(plan: Plan, ctx: DialogContext): SafeHtml {
  const lines = plan.folders ?? [];
  if (lines.length === 0) return html``;
  const fresh = lines.every((line) => line.isNew);
  return html`<section class="tight"><div class="preview" role="group" aria-label="Folders"><div>${parentFolder(plan, ctx.repo.project.root)}${fresh ? html` <span class="new">new</span>` : ""}</div>${lines.map(folderLine)}</div></section>`;
}

function lanes(plan: Plan): SafeHtml {
  if (plan.before === null && plan.after === null) return html``;
  return html`<section><div class="compare">${plan.before === null ? "" : laneView(plan.before)}${plan.after === null ? "" : laneView(plan.after)}</div></section>`;
}

function picks(plan: Plan, field: Field, values: FieldValues, ctx: DialogContext): SafeHtml {
  const choices = plan.choices ?? [];
  if (choices.length === 0) return html``;
  const value = values[field.name];
  const chosen = new Set(Array.isArray(value) ? value : choices.filter((choice) => choice.selected).map((choice) => choice.id));
  const rows = pickGroups(choices, ctx).map((group) => {
    const on = group.selectable && group.ids.every((id) => chosen.has(id));
    return html`<label class="pick${group.selectable ? "" : " off"}"><input type="checkbox" data-pick="${field.name}" data-ids="${JSON.stringify(group.ids)}" data-key="dlg:pick:${group.key}"${on ? html` checked` : ""}${group.selectable ? "" : html` disabled`}>${ICONS.health(group.health)}<span class="mono">${group.label}</span><span class="why">${group.detail}</span></label>`;
  });
  return html`<section class="tight" role="group" aria-label="${field.label}">${rows}</section>`;
}

function checks(plan: Plan, now: number): SafeHtml {
  if (plan.blockers.length === 0 && plan.checks.length === 0) return html``;
  const blockers = plan.blockers.map((text) => checkRow({ ok: false, text, why: null }));
  return html`<section><div class="h3">Checks <span class="t">checked ${timeAgo(plan.readAt, now, "long")}</span></div><div class="checks">${blockers}${plan.checks.map(checkRow)}</div></section>`;
}

function toggles(fields: readonly Field[], values: FieldValues): SafeHtml {
  const shown = fields.filter((field) => field.kind === "toggle");
  if (shown.length === 0) return html``;
  return html`<section class="tight">${shown.map(
    (field) =>
      html`<label class="toggle"><input type="checkbox" data-field="${field.name}" data-key="dlg:field:${field.name}"${values[field.name] === true ? html` checked` : ""}><span>${field.label}${field.why === undefined ? "" : html`<span class="why">${field.why}</span>`}</span></label>`,
  )}</section>`;
}

function effects(plan: Plan): SafeHtml {
  if (plan.effects.length === 0) return html``;
  return html`<section><div class="h3">What else changes</div><ul>${plan.effects.map((effect) => html`<li>${ICONS.dot}<span>${effect}</span></li>`)}</ul></section>`;
}

function commands(plan: Plan): SafeHtml {
  if (plan.commands.length === 0) return html``;
  return html`<details class="cmds" data-key="dlg:commands"><summary>Show the git commands</summary><pre>${plan.commands.join("\n")}</pre></details>`;
}

/**
 * A dialog's body under its text fields: the folders a plan creates, its before and after lanes, the cleanup
 * checklist, the checks (what blocks it first) with how long ago they were read, the toggles, what else changes and,
 * folded away, the git commands. Without a plan yet only the toggles show.
 */
export function renderPlanBody(plan: Plan | null, values: FieldValues, spec: DialogSpec, ctx: DialogContext, now: number): SafeHtml {
  const pickField = spec.fields.find((field) => field.kind === "picks");
  if (plan === null) return toggles(spec.fields, values);
  return html`${folders(plan, ctx)}${lanes(plan)}${pickField === undefined ? "" : picks(plan, pickField, values, ctx)}${checks(plan, now)}${toggles(spec.fields, values)}${effects(plan)}${commands(plan)}`;
}
