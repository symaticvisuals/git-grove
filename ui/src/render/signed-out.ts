import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";

/** What the page shows with no token, or once git grove refused it. It never asks for the token. */
export function signedOut(): SafeHtml {
  return html`<div class="signin"><div class="signin-card">${ICONS.logo}<h2>Open the dashboard from your terminal: <code>git grove ui</code></h2><p>The dashboard opens from the link that command gives your browser.</p></div></div>`;
}
