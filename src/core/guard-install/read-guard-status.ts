import type { GuardReading } from "./guard-install.types.js";
import { groveHooksOf } from "./grove-hooks-of.js";
import { guardAnnounceCommand } from "./guard-hook-command.js";
import { isJsonObject } from "./is-json-object.js";
import { PLUGIN_ID } from "./plugin-commands.js";
import { listOf } from "./list-of.js";
import { parseClaudeSettings } from "./parse-claude-settings.js";

/**
 * Where grove's hook stands in a settings file's `text`, null for no file, given the `command` grove wants the Bash
 * hook to run: `installed` when that command is the only grove PreToolUse hook and the matching `guard --announce`
 * command is the only grove SessionStart hook, `stale` for any other grove hook (including a PreToolUse hook that
 * has no session notice), `absent` for none, and `unreadable` when the file `problem` says cannot be read or the
 * text does not parse (`parseClaudeSettings`).
 * `pluginEnabled` is `enabledPlugins` naming grove's plugin as true; `hooksDisabled` is the file's own
 * `disableAllHooks: true`.
 */
function commandsEnding(groups: readonly unknown[], suffix: string): string[] {
  return groups.flatMap(groveHooksOf).flatMap((hook) => {
    const command = hook["command"];
    return typeof command === "string" && command.endsWith(suffix) ? [command] : [];
  });
}

export function readGuardStatus(text: string | null, command: string, problem: string | null = null): GuardReading {
  if (problem !== null) return { status: "unreadable", pluginEnabled: false, hooksDisabled: false, problem };
  const parsed = parseClaudeSettings(text);
  if (!parsed.ok) return { status: "unreadable", pluginEnabled: false, hooksDisabled: false, problem: parsed.problem };
  const { settings } = parsed;
  const hooks = settings["hooks"];
  const pre = isJsonObject(hooks) ? (listOf(hooks["PreToolUse"]) ?? []) : [];
  const session = isJsonObject(hooks) ? (listOf(hooks["SessionStart"]) ?? []) : [];
  const bash = commandsEnding(pre, " guard --claude");
  const announce = commandsEnding(session, " guard --announce");
  const wanted = guardAnnounceCommand(command);
  const installed = bash.length === 1 && bash[0] === command && announce.length === 1 && announce[0] === wanted;
  const any = bash.length + announce.length > 0;
  const status = installed ? "installed" : any ? "stale" : "absent";
  const plugins = settings["enabledPlugins"];
  const pluginEnabled = isJsonObject(plugins) && plugins[PLUGIN_ID] === true;
  return { status, pluginEnabled, hooksDisabled: settings["disableAllHooks"] === true, problem: null };
}
