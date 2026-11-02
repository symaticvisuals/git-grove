import { DIALOGS } from "../dialogs/dialog-specs.js";
import { html, type SafeHtml } from "../html.js";
import type { State } from "../state.js";
import { banner } from "./banner.js";
import { renderFolders } from "./render-folders.js";
import { renderPlanBody } from "./render-plan-body.js";
import { renderPlanFooter } from "./render-plan-footer.js";
import { renderReceipt } from "./render-receipt.js";
import { renderRunFooter } from "./render-run-footer.js";
import { renderSteps } from "./render-steps.js";

export type DialogParts = { head: SafeHtml; preview: SafeHtml; body: SafeHtml; foot: SafeHtml };

/**
 * The open dialog's header, the folder preview shown inside its form, its body and its footer. Reviewing: the plan's
 * heading (the spec's for a form, or until a plan arrives), why it was checked again, the plan's body and the confirm
 * footer, armed once the plan has been on screen long enough. Running: the steps, then the receipt once it lands, and
 * the run footer. Null when no dialog is open.
 */
export function dialogParts(state: State, now: number): DialogParts | null {
  const { dialog } = state;
  if (dialog === null) return null;
  const spec = DIALOGS[dialog.action];
  const run = dialog.stage === "run" && state.run?.dialog === dialog.id ? state.run : null;
  const plan = run?.plan ?? dialog.plan;
  const fallback = spec.heading(dialog.ctx);
  const shown = spec.fixed === true || plan === null ? fallback : { context: plan.context, title: plan.title, summary: plan.summary };
  const head = html`<div class="k">${shown.context}</div><h3 id="dlg-t">${shown.title}</h3>${shown.summary === "" ? "" : html`<p>${shown.summary}</p>`}`;
  if (dialog.stage === "run") {
    const body = run === null ? html`` : html`${renderSteps(run.plan, run.events)}${run.receipt === null ? "" : renderReceipt(run.receipt)}`;
    return { head, preview: html``, body, foot: renderRunFooter(run?.receipt ?? null, run?.error ?? null) };
  }
  const notice = dialog.notice === null ? "" : html`<section>${banner("warn", "Checked again", dialog.notice)}</section>`;
  const waiting = dialog.plan === null && dialog.planning ? html`<section><div class="async"><span class="spin" aria-hidden="true"></span>Checking…</div></section>` : "";
  const gate = { planId: dialog.planId, armed: dialog.planId !== null && dialog.armed === dialog.planId, missing: dialog.missing };
  return {
    head,
    preview: renderFolders(dialog.plan, dialog.ctx),
    body: html`${notice}${waiting}${renderPlanBody(dialog.plan, dialog.values, spec, dialog.ctx, now, dialog.plan?.choices ?? dialog.choices)}`,
    foot: renderPlanFooter(dialog.plan, dialog.planning, dialog.error, gate),
  };
}
