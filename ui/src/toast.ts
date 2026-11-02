import { html } from "./html.js";
import { ICONS } from "./icons.js";

const SHOWN_MS = 3_600;
let hide = 0;

/** Shows `text` in the page's toast for a few seconds, with a pass or fail mark. */
export function toast(text: string, ok = true): void {
  const element = document.getElementById("toast");
  if (element === null) return;
  element.innerHTML = html`${ok ? ICONS.ok : ICONS.no}<span>${text}</span>`.text;
  element.classList.add("on");
  window.clearTimeout(hide);
  hide = window.setTimeout(() => element.classList.remove("on"), SHOWN_MS);
}
