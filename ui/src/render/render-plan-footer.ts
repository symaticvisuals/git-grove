import type { Plan } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

const NOTE = "Grove re-checks everything the moment you confirm, and pins every branch it moves.";

function note(plan: Plan | null, planning: boolean, error: string | null): SafeHtml {
  const blocker = plan?.blockers[0];
  if (planning) return html`<span class="note" id="dlg-note"><span class="spin" aria-hidden="true"></span><span>Checking…</span></span>`;
  if (error !== null || blocker !== undefined) return html`<span class="note bad" id="dlg-note">${ICONS.no}<span>${error ?? blocker}</span></span>`;
  return html`<span class="note" id="dlg-note">${ICONS.shield}<span>${plan?.note ?? NOTE}</span></span>`;
}

/**
 * A review dialog's footer: the safety note, Cancel, and the confirm button named for the outcome. While a preview
 * is being checked the note reads "Checking…"; an error, or else the plan's first blocker, takes the note's place.
 * Confirm is enabled only for a plan that is checked, has no error and nothing blocking it.
 */
export function renderPlanFooter(plan: Plan | null, planning: boolean, error: string | null): SafeHtml {
  const ready = plan !== null && !planning && error === null && plan.blockers.length === 0;
  return html`${note(plan, planning, error)}<button class="btn" data-dlg="close" data-key="dlg:close">Cancel <kbd>Esc</kbd></button><button class="btn primary" data-dlg="confirm" data-key="dlg:confirm" aria-describedby="dlg-note"${ready ? "" : html` disabled`}>${plan?.confirm ?? "Confirm"} <kbd>↵</kbd></button>`;
}
