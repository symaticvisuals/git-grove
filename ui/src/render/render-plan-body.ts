import type { Choice, Plan } from "../../../src/core/actions/plan.types.js";
import type { DialogContext, DialogSpec, Field, FieldValues } from "../dialogs/dialog-specs.js";
import { pickGroups } from "../dialogs/pick-groups.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { checkRow } from "./check-row.js";
import { laneView } from "./lane-view.js";
import { nameChips } from "./name-chips.js";
import { timeAgo } from "./time-ago.js";

function namesOf(plan: Plan | null, ctx: DialogContext): string[] {
  const { repo } = ctx;
  const levels = repo.features.flatMap((feature) => feature.levels);
  return [
    repo.trunk,
    ...levels.map((level) => level.branch),
    ...levels.flatMap((level) => (level.worktree === null ? [] : [level.worktree.rel])),
    ...repo.orphans.map((orphan) => orphan.branch),
    ...repo.detached.map((sandbox) => sandbox.rel),
    ...(plan?.moves ?? []),
  ];
}

function lanes(plan: Plan): SafeHtml {
  if (plan.before === null && plan.after === null) return html``;
  return html`<section><div class="compare">${plan.before === null ? "" : laneView(plan.before)}${plan.after === null ? "" : laneView(plan.after)}</div></section>`;
}

function picks(choices: readonly Choice[], field: Field, values: FieldValues, ctx: DialogContext): SafeHtml {
  if (choices.length === 0) return html``;
  const value = values[field.name];
  const chosen = new Set(Array.isArray(value) ? value : choices.filter((choice) => choice.selected).map((choice) => choice.id));
  const rows = pickGroups(choices, ctx).map((group) => {
    const on = group.selectable && group.ids.every((id) => chosen.has(id));
    return html`<label class="pick${group.selectable ? "" : " off"}"><input type="checkbox" data-pick="${field.name}" data-ids="${JSON.stringify(group.ids)}" data-key="dlg:pick:${group.key}"${on ? html` checked` : ""}${group.selectable ? "" : html` disabled`}>${ICONS.health(group.health)}<span class="mono">${group.label}</span><span class="why">${group.detail}</span></label>`;
  });
  return html`<section class="tight" role="group" aria-label="${field.label}">${rows}</section>`;
}

function checks(plan: Plan, now: number, names: readonly string[]): SafeHtml {
  if (plan.blockers.length === 0 && plan.checks.length === 0) return html``;
  const blockers = plan.blockers.map((text) => checkRow({ ok: false, text, why: null }, names));
  return html`<section><div class="h3">Checks <span class="t">checked ${timeAgo(plan.readAt, now, "long")}</span></div><div class="checks">${blockers}${plan.checks.map((check) => checkRow(check, names))}</div></section>`;
}

function toggles(fields: readonly Field[], values: FieldValues): SafeHtml {
  const shown = fields.filter((field) => field.kind === "toggle");
  if (shown.length === 0) return html``;
  return html`<section class="tight">${shown.map(
    (field) =>
      html`<label class="toggle"><input type="checkbox" data-field="${field.name}" data-key="dlg:field:${field.name}"${values[field.name] === true ? html` checked` : ""}><span>${field.label}${field.why === undefined ? "" : html`<span class="why">${field.why}</span>`}</span></label>`,
  )}</section>`;
}

function effects(plan: Plan, names: readonly string[]): SafeHtml {
  if (plan.effects.length === 0) return html``;
  const items = plan.effects.map((effect) => html`<li>${effect.startsWith("Offer ") ? ICONS.dot : ICONS.tick}<span>${nameChips(effect, names)}</span></li>`);
  return html`<section><div class="h3">Grove will also</div><ul>${items}</ul></section>`;
}

function commands(plan: Plan): SafeHtml {
  if (plan.commands.length === 0) return html``;
  return html`<details class="cmds" data-key="dlg:commands"><summary>Show the git commands</summary><pre>${plan.commands.join("\n")}</pre></details>`;
}

/**
 * A dialog's body under its form: the plan's before and after lanes, the cleanup checklist, the checks (what blocks
 * it first) with how long ago they were read, the toggles, what grove will also do (a tick for what it does, a dot
 * for what it only offers) and, folded away, the git commands. A form shows its toggles before the checks. Branch and
 * folder names show as code chips. Without a plan only the toggles show, and the cleanup checklist from `choices`,
 * the last ones known, so a folder that vanished can still be unpicked.
 */
export function renderPlanBody(plan: Plan | null, values: FieldValues, spec: DialogSpec, ctx: DialogContext, now: number, choices: readonly Choice[] | null = plan?.choices ?? null): SafeHtml {
  const pickField = spec.fields.find((field) => field.kind === "picks");
  const checklist = pickField === undefined ? "" : picks(choices ?? [], pickField, values, ctx);
  const switches = toggles(spec.fields, values);
  if (plan === null) return html`${checklist}${switches}`;
  const names = namesOf(plan, ctx);
  const checked = checks(plan, now, names);
  const middle = spec.fixed === true ? html`${switches}${checked}` : html`${checked}${switches}`;
  return html`${lanes(plan)}${checklist}${middle}${effects(plan, names)}${commands(plan)}`;
}
