import { html, type SafeHtml } from "../html.js";
import { MESSAGES } from "../messages.js";
import type { State } from "../state.js";

/**
 * The notices above every view: git grove is not answering, or serves too many dashboards already, while the live
 * stream is down; or a newer version is running. The page announces each once; the notices carry no live role.
 */
export function notices(state: Pick<State, "liveDropped" | "live" | "liveProblem" | "updateAvailable">): SafeHtml {
  const busy = state.liveProblem === "busy";
  const down =
    state.liveDropped && state.live !== "up"
      ? html`<div class="notice"><b>${busy ? MESSAGES.tooMany : MESSAGES.notRunning}</b>${busy ? "" : html`<span>Retrying. What you see is from before it stopped.</span>`}</div>`
      : "";
  const update = state.updateAvailable
    ? html`<div class="notice update"><b>git grove was updated.</b><span>Reload to use the new dashboard.</span><button class="btn primary" data-ui="reload" data-key="notice:reload">Reload</button></div>`
    : "";
  return down === "" && update === "" ? html`` : html`<div class="notices">${down}${update}</div>`;
}
