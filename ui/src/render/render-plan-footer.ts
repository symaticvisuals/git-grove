import type { Plan } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/** What gates confirm: the id of the plan shown, whether it has been on screen long enough, and what a form still needs. */
export type ConfirmGate = { planId: string | null; armed: boolean; missing: string | null };

const NOTE = "Grove re-checks everything the moment you confirm, and pins every branch it moves.";

function note(plan: Plan | null, planning: boolean, error: string | null, missing: string | null): SafeHtml {
  const problem = missing ?? error ?? plan?.blockers[0];
  if (planning) return html`<span class="note" id="dlg-note"><span class="spin" aria-hidden="true"></span><span>Checking…</span></span>`;
  if (problem !== undefined) return html`<span class="note bad" id="dlg-note">${ICONS.no}<span>${problem}</span></span>`;
  return html`<span class="note" id="dlg-note">${ICONS.shield}<span>${plan?.note ?? NOTE}</span></span>`;
}

/**
 * A review dialog's footer: the safety note, Cancel, and the confirm button named for the outcome, carrying the id
 * of the plan it confirms. While a preview is being checked the note reads "Checking…"; what a form still needs, an
 * error (with Preview again), or else the plan's first blocker takes the note's place. Confirm is enabled only for a
 * plan that is checked, armed, and has nothing missing, failing or blocking it.
 */
export function renderPlanFooter(plan: Plan | null, planning: boolean, error: string | null, gate: ConfirmGate): SafeHtml {
  const ready = plan !== null && gate.planId !== null && gate.armed && !planning && error === null && gate.missing === null && plan.blockers.length === 0;
  const again = error === null || planning ? "" : html`<button class="btn" data-dlg="again" data-key="dlg:again">Preview again</button>`;
  const id = gate.planId === null ? "" : html` data-plan="${gate.planId}"`;
  return html`${note(plan, planning, error, gate.missing)}${again}<button class="btn" data-dlg="close" data-key="dlg:close">Cancel <kbd>Esc</kbd></button><button class="btn primary" data-dlg="confirm" data-key="dlg:confirm"${id} aria-describedby="dlg-note"${ready ? "" : html` disabled`}>${plan?.confirm ?? "Confirm"} <kbd>↵</kbd></button>`;
}
