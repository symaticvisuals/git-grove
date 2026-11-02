import type { Receipt } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { checkRow } from "./check-row.js";

/**
 * What a run did: its title and lines, passing when it worked and failing when it stopped or was refused. Undo
 * shows when the receipt can be undone, and Preview again when it was refused, so the plan can be read afresh.
 */
export function renderReceipt(receipt: Receipt): SafeHtml {
  const lines = receipt.lines.map((text) => checkRow({ ok: receipt.ok, text, why: null }));
  const undo = receipt.undo !== null && receipt.undo.length > 0 ? html`<button class="btn" data-dlg="undo" data-key="dlg:undo">${ICONS.back}Undo</button>` : "";
  const again = receipt.refused ? html`<button class="btn" data-dlg="again" data-key="dlg:again">Preview again</button>` : "";
  const acts = undo === "" && again === "" ? "" : html`<div class="acts">${undo}${again}</div>`;
  return html`<section><div class="receipt${receipt.ok ? "" : " bad"}"><b>${receipt.title}</b>${lines.length === 0 ? "" : html`<div class="checks">${lines}</div>`}${acts}</div></section>`;
}
