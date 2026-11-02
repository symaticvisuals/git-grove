import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { SliceName } from "../slice-names.js";

/**
 * The error state of an async surface, with a Try again button that reloads `retry`; `place` keeps the button's
 * key unique when one slice fails in two places. It carries no live role: the page announces a new failure once.
 */
export function failed(message: string, retry: SliceName, place: string = retry): SafeHtml {
  return html`<div class="async failed">${ICONS.no}<span>${message}</span><button class="btn" data-ui="retry" data-slice="${retry}" data-key="retry:${place}">Try again</button></div>`;
}
