import { html, type HtmlValue, type SafeHtml } from "../html.js";

/** The head of a detail: where it sits (`path`, its parts joined by ›) and its name. */
export function detailHead(path: readonly string[], title: HtmlValue): SafeHtml {
  const crumbs = path.map((part, index) => html`${index === 0 ? "" : html` <span>›</span> `}${part}`);
  return html`<div class="d-head"><div class="d-path">${crumbs}</div><h2>${title}</h2></div>`;
}
