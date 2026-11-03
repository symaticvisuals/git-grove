import type { GuardPlan } from "../../../src/core/guard-install/guard-install.types.js";
import type { GuardDialogState } from "../guard/reduce-guard.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { banner } from "./banner.js";
import { checkRow } from "./check-row.js";
import { renderReceipt } from "./render-receipt.js";
import { timeAgo } from "./time-ago.js";

export type GuardDialogParts = { head: SafeHtml; body: SafeHtml; foot: SafeHtml };

const HEADING = "Remove the old hook";
const CHECKING = html`<section><div class="async"><span class="spin" aria-hidden="true"></span>Reading the settings file…</div></section>`;

function file(plan: GuardPlan): SafeHtml {
  const backup = plan.backupPath === null ? "" : html`<li>${ICONS.tick}<span>Keeps the file as it is now in <code>${plan.backupPath}</code></span></li>`;
  return html`<section><div class="h3">Settings file</div><ul><li>${ICONS.tick}<span>Writes <code>${plan.settingsPath}</code></span></li>${backup}</ul></section>`;
}

function json(plan: GuardPlan): SafeHtml {
  const adds = plan.adds === null ? "" : html`<div class="h3">Adds</div><pre>${plan.adds}</pre>`;
  const removes = plan.removes.length === 0 ? "" : html`<div class="h3">Removes</div>${plan.removes.map((removed) => html`<pre>${removed}</pre>`)}`;
  return adds === "" && removes === "" ? html`` : html`<section>${adds}${removes}</section>`;
}

function review(dialog: GuardDialogState, now: number): SafeHtml {
  const notice = dialog.notice === null ? "" : html`<section>${banner("warn", "Checked again", dialog.notice)}</section>`;
  const { plan } = dialog;
  if (plan === null) return html`${notice}${dialog.planning ? CHECKING : ""}`;
  const blockers = plan.blockers.length === 0 ? "" : html`<section><div class="h3">Checks <span class="t">read ${timeAgo(plan.readAt, now, "long")}</span></div><div class="checks">${plan.blockers.map((text) => checkRow({ ok: false, text, why: null }))}</div></section>`;
  const warnings = plan.warnings.map((text) => html`<section>${banner("warn", "Before you confirm", text)}</section>`);
  if (plan.blockers.length > 0) return html`${notice}${blockers}${warnings}`;
  const lines = html`<section><ul>${plan.lines.map((line) => html`<li>${ICONS.tick}<span>${line}</span></li>`)}</ul></section>`;
  return html`${notice}${warnings}${file(plan)}${json(plan)}${lines}`;
}

function reviewFoot(dialog: GuardDialogState): SafeHtml {
  const { plan } = dialog;
  const problem = dialog.error ?? plan?.blockers[0];
  const ready = plan !== null && dialog.planId !== null && dialog.armed === dialog.planId && !dialog.planning && dialog.error === null && plan.blockers.length === 0;
  const safety = plan?.backupPath === null ? "grove reads the file again the moment you confirm." : "grove reads the file again the moment you confirm, and keeps a backup.";
  const note = dialog.planning
    ? html`<span class="note" id="dlg-note"><span class="spin" aria-hidden="true"></span><span>Checking…</span></span>`
    : problem !== undefined
      ? html`<span class="note bad" id="dlg-note">${ICONS.no}<span>${problem}</span></span>`
      : html`<span class="note" id="dlg-note">${ICONS.shield}<span>${safety}</span></span>`;
  const again = dialog.error === null || dialog.planning ? "" : html`<button class="btn" data-guard="again" data-key="guard:again">Preview again</button>`;
  const id = dialog.planId === null ? "" : html` data-plan="${dialog.planId}"`;
  return html`${note}${again}<button class="btn" data-guard="close" data-key="guard:close">Cancel <kbd>Esc</kbd></button><button class="btn primary" data-guard="confirm" data-key="guard:confirm"${id} aria-describedby="dlg-note"${ready ? "" : html` disabled`}>${plan?.confirm ?? "Remove"} <kbd>↵</kbd></button>`;
}

function doneFoot(dialog: GuardDialogState): SafeHtml {
  const { receipt } = dialog;
  const again = receipt?.ok === false ? html`<button class="btn" data-guard="again" data-key="guard:again">Preview again</button>` : "";
  const text = receipt?.ok !== true ? "Nothing was written." : "Your other settings and hooks were kept.";
  return html`<span class="note">${ICONS.shield}<span>${text}</span></span>${again}<button class="btn primary" data-guard="close" data-key="guard:done">Done <kbd>↵</kbd></button>`;
}

/**
 * The agent guard dialog's header, body and footer. Reviewing: the plan's heading, why it was read again, then what
 * blocks it, or the file it writes and its backup, the JSON it adds or removes, and what else is true; the footer
 * confirms only a plan that is checked, armed and unblocked. Running: a spinner. Done: the receipt, with Preview again
 * when it was not made.
 */
export function guardDialogParts(dialog: GuardDialogState, now: number): GuardDialogParts {
  const plan = dialog.plan;
  const title = plan?.title ?? HEADING;
  const summary = plan?.summary ?? "";
  const head = html`<div class="k">Claude Code settings</div><h3 id="dlg-t">${title}</h3>${summary === "" ? "" : html`<p>${summary}</p>`}`;
  if (dialog.stage === "run") return { head, body: html`<section><div class="async"><span class="spin" aria-hidden="true"></span>Writing the settings file…</div></section>`, foot: html`<span class="note"><span class="spin" aria-hidden="true"></span><span>Writing…</span></span>` };
  if (dialog.stage === "done" && dialog.receipt !== null) return { head, body: renderReceipt(dialog.receipt), foot: doneFoot(dialog) };
  return { head, body: review(dialog, now), foot: reviewFoot(dialog) };
}
