import { html, type SafeHtml } from "../html.js";
import { MESSAGES } from "../messages.js";
import type { State } from "../state.js";

/** The notices above every view: git grove is not answering (while the live stream is down), or a newer version is running. */
export function notices(state: Pick<State, "liveDropped" | "live" | "updateAvailable">): SafeHtml {
  const down = state.liveDropped && state.live !== "up" ? html`<div class="notice" role="status"><b>${MESSAGES.notRunning}</b><span>Retrying. What you see is from before it stopped.</span></div>` : "";
  const update = state.updateAvailable
    ? html`<div class="notice update" role="status"><b>git grove was updated.</b><span>Reload to use the new dashboard.</span><button class="btn primary" data-ui="reload">Reload</button></div>`
    : "";
  return down === "" && update === "" ? html`` : html`<div class="notices">${down}${update}</div>`;
}
