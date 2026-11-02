import { ago } from "../ago.js";
import { html, type SafeHtml } from "../html.js";

/** How long ago `at` was, in an element the page's clock keeps current. */
export function timeAgo(at: number, now: number, form: "short" | "long" = "short"): SafeHtml {
  return html`<time data-at="${at}" data-ago="${form}" datetime="${new Date(at).toISOString()}">${ago(at, now, form)}</time>`;
}
