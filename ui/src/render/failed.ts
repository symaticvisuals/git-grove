import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { SliceName } from "../slice-names.js";

/** The error state of an async surface, with a Try again button that reloads `retry`. */
export function failed(message: string, retry: SliceName): SafeHtml {
  return html`<div class="async failed" role="alert">${ICONS.no}<span>${message}</span><button class="btn" data-ui="retry" data-slice="${retry}">Try again</button></div>`;
}
