import { clockTime } from "../clock-time.js";
import { html, type SafeHtml } from "../html.js";

/** The 24-hour local time of `at` in a `<time>` element; `—` for a time that is not a real date. */
export function clockAt(at: number, now: number): SafeHtml {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return html`<span>—</span>`;
  return html`<time datetime="${date.toISOString()}">${clockTime(at, now)}</time>`;
}
