import type { GuardState } from "../../../src/core/guard-install/guard-install.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { Load } from "../state.js";

const TITLE = "Protect worktrees from Claude Code";
const BODY = "Claude Code checks with grove before it runs git worktree remove, rm -r or reset --hard, and stops when work would be lost.";
const STALE = "The agent guard points at an old Node or grove path.";
const BY_HAND = "To add the guard yourself, run git grove install-guard.";

function notes(state: GuardState): string[] {
  const lines: string[] = [];
  if (state.status === "stale") lines.push(STALE);
  if (state.hooksDisabled) lines.push(`Hooks are turned off in ${state.settingsPath}: it sets disableAllHooks to true, so the guard would not run.`);
  if (state.refusal !== null) lines.push(state.status === "unreadable" ? `${state.refusal} ${BY_HAND}` : state.refusal);
  return lines;
}

/**
 * The onboarding card that offers the agent guard, while it is absent, stale or in a settings file grove cannot read,
 * and until it is put off with "Not now". It says what the guard does and, when they apply, that it points at an old
 * path, that the file turns hooks off, and why grove will not install it, in which case Install is left out.
 */
export function guardCard(guard: Load<GuardState> | null, dismissed: boolean): SafeHtml {
  if (dismissed || guard === null || guard.status !== "ready" || guard.data.status === "installed") return html``;
  const state = guard.data;
  const install =
    state.refusal === null
      ? html`<button class="btn primary" data-ui="guard-open" data-change="install" data-key="guard:install">${state.status === "stale" ? "Update…" : "Install…"}</button>`
      : "";
  return html`<section class="guard-card" aria-label="Agent guard">${ICONS.shield}<div class="gc-text"><b>${TITLE}</b><p>${BODY}</p>${notes(state).map((line) => html`<p class="gc-note">${line}</p>`)}</div><div class="gc-acts"><button class="btn" data-ui="guard-dismiss" data-key="guard:dismiss">Not now</button>${install}</div></section>`;
}
