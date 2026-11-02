import { html, type HtmlValue, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/** An alert at the top of a detail: ember for work that could be lost, resin (`warn`) for one that needs an action. */
export function banner(kind: "loses" | "warn", title: HtmlValue, text: HtmlValue): SafeHtml {
  const icon = kind === "loses" ? ICONS.health("loses") : ICONS.health("action");
  return html`<div class="banner${kind === "warn" ? " warn" : ""}">${icon}<div><b>${title}</b><p>${text}</p></div></div>`;
}
