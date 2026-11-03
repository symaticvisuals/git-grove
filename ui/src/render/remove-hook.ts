import { html, type SafeHtml } from "../html.js";

/** The button that opens the review for taking the old hook out of Claude Code's settings. */
export function removeHook(label: string): SafeHtml {
  return html`<button class="btn" data-ui="guard-open" data-change="uninstall" data-key="guard:uninstall">${label}</button>`;
}
