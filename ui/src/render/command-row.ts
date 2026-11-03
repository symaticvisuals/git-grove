import { html, type SafeHtml } from "../html.js";

/** A shell command in a row of its own with a Copy button; `key` is the button's focus key. */
export function commandRow(command: string, key: string): SafeHtml {
  return html`<div class="cmd"><code>${command}</code><button class="btn" data-ui="copy" data-copy="${command}" data-key="${key}">Copy</button></div>`;
}
