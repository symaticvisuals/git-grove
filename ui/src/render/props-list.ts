import { html, type HtmlValue, type SafeHtml } from "../html.js";

/** The name and value pairs at the foot of a detail. */
export function propsList(rows: readonly (readonly [string, HtmlValue])[]): SafeHtml {
  return html`<dl class="props">${rows.map(([name, value]) => html`<dt>${name}</dt><dd>${value}</dd>`)}</dl>`;
}
