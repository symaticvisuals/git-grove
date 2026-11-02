import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/** The bar at the top of a view: its crumb, optional tabs, and Scan now (of `repo`, or of every repo). */
export function viewBar(crumb: SafeHtml, options: { tabs?: SafeHtml; repo?: number } = {}): SafeHtml {
  const scan = html`<button class="ghost" data-action="scan"${options.repo === undefined ? "" : html` data-repo="${options.repo}"`}>${ICONS.scan}Scan now</button>`;
  return html`<div class="bar"><div class="crumb">${crumb}</div>${options.tabs ?? ""}<div class="right">${scan}</div></div>`;
}
