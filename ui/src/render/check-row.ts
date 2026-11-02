import type { Check } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/** A check that passes or fails, with why it matters underneath. */
export function checkRow(check: Check): SafeHtml {
  return html`<div class="check${check.ok ? "" : " bad"}">${check.ok ? ICONS.ok : ICONS.no}<div>${check.text}${check.why === null || check.why === "" ? "" : html`<div class="why">${check.why}</div>`}</div></div>`;
}
