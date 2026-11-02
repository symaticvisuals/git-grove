import { clockTime } from "../clock-time.js";
import { html, type SafeHtml } from "../html.js";

/**
 * The 24-hour local time of `at` in a `<time>` element the page's clock keeps current, so `14:02` becomes
 * `1 Nov 14:02` once the day turns; `—` for a time that is not a real date.
 */
export function clockAt(at: number, now: number): SafeHtml {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return html`<span>—</span>`;
  return html`<time data-at="${at}" data-clock="" datetime="${date.toISOString()}">${clockTime(at, now)}</time>`;
}
