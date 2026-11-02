import { html, type HtmlValue, type SafeHtml } from "../html.js";

/** One way out of a finding: what it does, and the button that starts it. */
export function optionCard(title: HtmlValue, text: HtmlValue, button: SafeHtml): SafeHtml {
  return html`<div class="opt"><b>${title}</b><p>${text}</p>${button}</div>`;
}
