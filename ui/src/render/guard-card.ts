import type { GuardPhase, GuardState } from "../../../src/core/guard-install/guard-install.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import type { Load } from "../state.js";
import { commandRow } from "./command-row.js";
import { removeHook } from "./remove-hook.js";

const BODY = "Claude Code checks with grove before it runs git worktree remove, rm -r or reset --hard, and stops when work would be lost. A new session is told this agent is bounded by the guard.";

function commands(state: GuardState): SafeHtml {
  return html`${state.installCommands.map((command, index) => commandRow(command, `guard:copy:${index}`))}`;
}

function notDoneReason(state: GuardState): string {
  if (state.hooksDisabled) return `Hooks are turned off in ${state.settingsPath}: it sets disableAllHooks to true, so the guard will not run unless a project turns hooks back on.`;
  if (state.ephemeral) return "Install git grove for the plugin to run it: npm i -g @deepanshugoel/git-grove";
  return "The plugin's hook can't find git grove yet. Run git grove ui once.";
}

function notNow(state: GuardState): SafeHtml {
  return html`<button class="btn" data-ui="guard-dismiss" data-phase="${state.phase}" data-key="guard:dismiss">Not now</button>`;
}

type Card = { title: string; body: SafeHtml; acts: SafeHtml };

function cardOf(state: GuardState): Card {
  switch (state.phase) {
    case "absent":
      return { title: "Protect worktrees from Claude Code", body: html`<p>${BODY}</p>${commands(state)}`, acts: notNow(state) };
    case "hook":
      return { title: "Switch the agent guard to the Claude Code plugin", body: commands(state), acts: html`${removeHook("Then remove the old hook…")}${notNow(state)}` };
    case "plugin-and-hook":
      return { title: "The agent guard runs twice", body: html`<p>The plugin and an old hook in settings.json both run it.</p>`, acts: removeHook("Remove the old hook…") };
    case "plugin":
      return { title: "Finish the agent guard", body: html`<p>${notDoneReason(state)}</p>`, acts: html`` };
  }
}

/**
 * The onboarding card about the agent guard, by phase: install the plugin (absent), switch to it (old hook alone),
 * remove the old hook (both run), or why the plugin's guard is not running yet. Nothing while the guard is done, still
 * loading, or put off with "Not now" for that same phase, so a guard that later changes phase shows it once more. Any
 * refusal the server gave for the settings file is kept as a note.
 */
export function guardCard(guard: Load<GuardState> | null, dismissed: GuardPhase | null): SafeHtml {
  if (guard === null || guard.status !== "ready" || guard.data.done || guard.data.phase === dismissed) return html``;
  const state = guard.data;
  const { title, body, acts } = cardOf(state);
  const refusal = state.refusal === null ? "" : html`<p class="gc-note">${state.refusal}</p>`;
  return html`<section class="guard-card" aria-label="Agent guard">${ICONS.shield}<div class="gc-text"><b>${title}</b>${body}${refusal}</div><div class="gc-acts">${acts}</div></section>`;
}
