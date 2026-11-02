import { html, type SafeHtml } from "../html.js";

/** The loading state of an async surface. */
export function loading(): SafeHtml {
  return html`<div class="async" role="status"><span class="spin" aria-hidden="true"></span>Loading…</div>`;
}
