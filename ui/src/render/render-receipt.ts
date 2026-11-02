import type { Receipt } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { sentence } from "../sentence.js";
import { checkRow } from "./check-row.js";

/**
 * What a run did, compactly: Done (or Not run, or Stopped) and one sentence, with its lines folded under Details,
 * passing when it worked and failing when it did not. Details start open when it did not work, since they say why.
 */
export function renderReceipt(receipt: Pick<Receipt, "ok" | "refused" | "title" | "lines">): SafeHtml {
  const head = receipt.ok ? "Done" : receipt.refused ? "Not run" : "Stopped";
  const text = sentence(receipt.title.replace(/^(?:Stopped|Refused): /, ""));
  const lines = receipt.lines.map((line) => checkRow({ ok: receipt.ok, text: line, why: null }));
  const details = lines.length === 0 ? "" : html`<details class="more" data-key="dlg:details"${receipt.ok ? "" : html` open`}><summary>Details</summary><div class="checks">${lines}</div></details>`;
  return html`<section><div class="receipt${receipt.ok ? "" : " bad"}"><b>${head}</b><span>${text}</span>${details}</div></section>`;
}
