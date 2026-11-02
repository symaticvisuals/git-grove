import type { Receipt } from "../../../src/core/actions/plan.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/**
 * A run's footer. While it runs: that it keeps going when closed, and Hide; with `error`, why its progress cannot be
 * read. Once it has a receipt: whether what moved was pinned first, and Done.
 */
export function renderRunFooter(receipt: Receipt | null, error: string | null): SafeHtml {
  if (receipt === null) {
    const note = error === null ? html`<span class="note">${ICONS.shield}<span>You can close this; it keeps going.</span></span>` : html`<span class="note bad">${ICONS.no}<span>${error}</span></span>`;
    return html`${note}<button class="btn" data-dlg="close" data-key="dlg:hide">Hide</button>`;
  }
  const text = receipt.pins.length > 0 ? "Every branch that moved was pinned first." : "Recorded in Activity.";
  return html`<span class="note">${ICONS.shield}<span>${text}</span></span><button class="btn primary" data-dlg="close" data-key="dlg:done">Done <kbd>↵</kbd></button>`;
}
