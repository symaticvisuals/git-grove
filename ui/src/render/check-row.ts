import type { Check } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { nameChips } from "./name-chips.js";

/** A check that passes or fails, with why it matters underneath; `names` in its text show as code chips. */
export function checkRow(check: Check, names: readonly string[] = []): SafeHtml {
  return html`<div class="check${check.ok ? "" : " bad"}">${check.ok ? ICONS.ok : ICONS.no}<div>${nameChips(check.text, names)}${check.why === null || check.why === "" ? "" : html`<div class="why">${check.why}</div>`}</div></div>`;
}
