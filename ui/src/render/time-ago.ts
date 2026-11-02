import { ago } from "../ago.js";
import { html, type SafeHtml } from "../html.js";

/** How long ago `at` was, in an element the page's clock keeps current; `—` for a time that is not a real date. */
export function timeAgo(at: number, now: number, form: "short" | "long" = "short"): SafeHtml {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return html`<span>—</span>`;
  return html`<time data-at="${at}" data-ago="${form}" datetime="${date.toISOString()}">${ago(at, now, form)}</time>`;
}
