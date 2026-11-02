import type { GuardReading } from "./guard-install.types.js";
import { groveHooksOf } from "./grove-hooks-of.js";
import { isJsonObject } from "./is-json-object.js";
import { listOf } from "./list-of.js";
import { parseClaudeSettings } from "./parse-claude-settings.js";

/**
 * Where grove's hook stands in a settings file's `text`, null for no file, given the `command` grove wants it to run:
 * `installed` for exactly one grove hook running that command, `stale` for any other grove hooks, `absent` for none,
 * and `unreadable` when the file `problem` says cannot be read or the text does not parse (`parseClaudeSettings`).
 * `hooksDisabled` is the file's own `disableAllHooks: true`.
 */
export function readGuardStatus(text: string | null, command: string, problem: string | null = null): GuardReading {
  if (problem !== null) return { status: "unreadable", hooksDisabled: false, problem };
  const parsed = parseClaudeSettings(text);
  if (!parsed.ok) return { status: "unreadable", hooksDisabled: false, problem: parsed.problem };
  const { settings } = parsed;
  const hooks = settings["hooks"];
  const groups = isJsonObject(hooks) ? (listOf(hooks["PreToolUse"]) ?? []) : [];
  const commands = groups.flatMap(groveHooksOf).map((hook) => hook["command"]);
  const status = commands.length === 0 ? "absent" : commands.length === 1 && commands[0] === command ? "installed" : "stale";
  return { status, hooksDisabled: settings["disableAllHooks"] === true, problem: null };
}
