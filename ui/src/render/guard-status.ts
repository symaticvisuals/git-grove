import type { GuardState } from "../../../src/core/guard-install/guard-install.types.js";
import { html, type SafeHtml } from "../html.js";
import type { Load } from "../state.js";

function label(state: GuardState): string {
  if (state.done) return "Agents bounded";
  switch (state.phase) {
    case "plugin-and-hook":
      return "Agent guard runs twice";
    case "hook":
      return "Agent guard: old hook";
    case "plugin":
      return "Agent guard not running";
    case "absent":
      return "Agent guard off";
  }
}

/** The agent guard's state in a few quiet words, as a button that opens its dialog; nothing until the state is known. */
export function guardStatus(guard: Load<GuardState> | null): SafeHtml {
  const state = guard === null || guard.status === "loading" ? null : guard.data;
  if (state === null) return html``;
  return html`<button class="guard-state${state.done ? " on" : ""}" data-ui="guard" data-key="side:guard" title="${state.settingsPath}"><span class="gdot" aria-hidden="true"></span>${label(state)}</button>`;
}
