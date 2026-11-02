import type { GuardState } from "../../../src/core/guard-install/guard-install.types.js";
import { html, type SafeHtml } from "../html.js";
import type { Load } from "../state.js";

function label(state: GuardState): string {
  switch (state.status) {
    case "installed":
      return state.hooksDisabled ? "Agent guard on, hooks off" : "Agent guard on";
    case "stale":
      return "Agent guard out of date";
    case "absent":
      return "Agent guard off";
    case "unreadable":
      return "Agent guard unknown";
  }
}

/** The agent guard's state in a few quiet words, as a button that opens its dialog; nothing until the state is known. */
export function guardStatus(guard: Load<GuardState> | null): SafeHtml {
  const state = guard === null || guard.status === "loading" ? null : guard.data;
  if (state === null) return html``;
  const on = state.status === "installed" && !state.hooksDisabled;
  return html`<button class="guard-state${on ? " on" : ""}" data-ui="guard" data-key="side:guard" title="${state.settingsPath}"><span class="gdot" aria-hidden="true"></span>${label(state)}</button>`;
}
