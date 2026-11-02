import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { PaletteItem } from "../palette/palette-items.js";

/** The palette's listbox options, headed Actions then Go to, with the item at `index` selected; "Nothing matches" for none. */
export function paletteOptions(items: readonly PaletteItem[], index: number): SafeHtml {
  if (items.length === 0) return html`<li class="sec" role="presentation">Nothing matches</li>`;
  return html`${items.map((item, at) => {
    const head = at === 0 || items[at - 1]?.kind !== item.kind ? html`<li class="sec" role="presentation">${item.kind}</li>` : "";
    const on = at === index;
    return html`${head}<li class="pal-item${on ? " on" : ""}" role="option" id="pal-${at}" aria-selected="${on ? "true" : "false"}" data-pal="${at}">${item.kind === "Actions" ? ICONS.plus : ICONS.restack}<span class="txt">${item.text}</span>${item.hint === null ? "" : html`<span class="hint">${item.hint}</span>`}</li>`;
  })}`;
}
