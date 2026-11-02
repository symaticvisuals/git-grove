import { html, type HtmlValue, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/** The moss box that says what is safe, with an optional mono line under it (a pin ref). */
export function safeBox(title: HtmlValue, text: HtmlValue, mono: string | null = null): SafeHtml {
  return html`<div class="safe">${ICONS.shield}<div><b>${title}</b><p>${text}</p>${mono === null ? "" : html`<p class="mono">${mono}</p>`}</div></div>`;
}
