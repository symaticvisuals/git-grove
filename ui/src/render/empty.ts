import { html, type SafeHtml } from "../html.js";

/** The empty state of an async surface. */
export function empty(text: string): SafeHtml {
  return html`<div class="async empty">${text}</div>`;
}
