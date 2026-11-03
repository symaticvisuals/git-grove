import type { GuardState } from "../../../src/core/guard-install/guard-install.types.js";
import type { WireProject } from "../../../src/server/wire/wire.types.js";
import { html, type SafeHtml } from "../html.js";
import { ICONS } from "../icons.js";
import { PLUGIN_COMMANDS } from "../plugin-commands.js";
import type { Load } from "../state.js";
import { commandRow } from "./command-row.js";
import { removeHook } from "./remove-hook.js";

function step(done: boolean, title: string, body: SafeHtml, extra: SafeHtml): SafeHtml {
  const mark = done ? ICONS.tick : ICONS.dot;
  return html`<li class="step${done ? " done" : ""}">${mark}<div class="st-text"><b>${title}</b>${body}${extra}</div></li>`;
}

function watching(projects: Load<WireProject[]>): boolean {
  return projects.status !== "loading" && (projects.data ?? []).length > 0;
}

function guardCommands(guard: GuardState | null): SafeHtml {
  const old = guard?.phase === "hook" || guard?.phase === "plugin-and-hook";
  const commands = guard?.installCommands ?? PLUGIN_COMMANDS;
  return html`${commands.map((command, index) => commandRow(command, `setup:copy:${index}`))}${old ? removeHook("Remove the old hook…") : ""}`;
}

/**
 * The Getting started page: watch a repo, install the Claude Code plugin, keep grove running. A step ticks when the
 * projects list has a repo (step 1) or the agent guard is on (step 2); the last has no check. Step 2 shows the two
 * install commands even while the guard's state is unknown. The footer link goes on to `next`, the address that was
 * opened before this page.
 */
export function setupView(projects: Load<WireProject[]>, guard: Load<GuardState> | null, next: string): SafeHtml {
  const state = guard !== null && guard.status !== "loading" ? guard.data : null;
  return html`<section class="setup" aria-label="Getting started"><h1>Getting started</h1>
<ol>${step(watching(projects), "Watch a repo", html`<p>Run it inside a repository you work in.</p>`, commandRow("git grove ui", "setup:copy:ui"))}${step(
    state?.done === true,
    "Protect worktrees from Claude Code",
    html`<p>Run these two commands in a terminal.</p>`,
    guardCommands(state),
  )}${step(
    false,
    "Keep grove running",
    html`<p>git grove ui installs a login service so grove watches after you close this tab. If it could not, run git grove service status to see why.</p>`,
    commandRow("git grove service status", "setup:copy:service"),
  )}</ol>
<a class="btn setup-go" href="${next}" data-key="setup:go">Go to the dashboard</a></section>`;
}
