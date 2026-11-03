import type { GuardState, GuardStatus } from "../../../src/core/guard-install/guard-install.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { Load } from "../state.js";

const TITLE = "Protect worktrees from Claude Code";
const BODY = "Claude Code checks with grove before it runs git worktree remove, rm -r or reset --hard, and stops when work would be lost. A new session is told this agent is bounded by the guard.";
const STALE = "The agent guard is missing the notice a new session gets, or it points at an old Node or grove path.";

function notes(state: GuardState): string[] {
  const lines: string[] = [];
  if (state.status === "stale") lines.push(STALE);
  if (state.hooksDisabled) lines.push(`Hooks are turned off in ${state.settingsPath}: it sets disableAllHooks to true, so the guard will not run unless a project turns hooks back on.`);
  if (state.refusal !== null) lines.push(state.refusal);
  return lines;
}

/**
 * The onboarding card that offers the agent guard, while it is absent, stale or in a settings file grove cannot read,
 * unless "Not now" put it off for that same status, so a guard that later goes stale shows it once more. It says what
 * the guard does and, when they apply, that it points at an old path, that the file turns hooks off, and why grove
 * will not install it, in which case Install is left out.
 */
export function guardCard(guard: Load<GuardState> | null, dismissed: GuardStatus | null): SafeHtml {
  if (guard === null || guard.status !== "ready" || guard.data.status === "installed" || guard.data.status === dismissed) return html``;
  const state = guard.data;
  const install =
    state.refusal === null
      ? html`<button class="btn primary" data-ui="guard-open" data-change="install" data-key="guard:install">${state.status === "stale" ? "Update…" : "Install…"}</button>`
      : "";
  return html`<section class="guard-card" aria-label="Agent guard">${ICONS.shield}<div class="gc-text"><b>${TITLE}</b><p>${BODY}</p>${notes(state).map((line) => html`<p class="gc-note">${line}</p>`)}</div><div class="gc-acts"><button class="btn" data-ui="guard-dismiss" data-status="${state.status}" data-key="guard:dismiss">Not now</button>${install}</div></section>`;
}
