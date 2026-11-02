import { html, type SafeHtml } from "../html.js";

const LONG = 32;

/** A ref or path that wraps only after a `/`, never inside a part like `coupons-model`; a part too long to fit may still wrap anywhere. */
export function slashBreaks(text: string): SafeHtml {
  const parts = text.split("/").map((part) => html`<span class="seg${part.length > LONG ? " long" : ""}">${part}</span>`);
  return html`${parts.flatMap((part, index) => (index === 0 ? [part] : [html`/<wbr>`, part]))}`;
}
