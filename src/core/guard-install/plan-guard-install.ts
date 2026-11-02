import { guardHookGroup } from "./guard-hook-group.js";
import { isJsonObject } from "./is-json-object.js";
import { listOf } from "./list-of.js";
import { parseClaudeSettings } from "./parse-claude-settings.js";
import { readGuardStatus } from "./read-guard-status.js";
import { reformats } from "./reformats.js";
import { removeGroveHooks } from "./remove-grove-hooks.js";
import type { SettingsPlan } from "./settings-plan.types.js";
import { settingsText } from "./settings-text.js";

/**
 * How installing grove's hook changes a settings file's `text` (null for no file, which starts from `{}`). Every other
 * key, group and hook is kept in order; any grove hook already there is removed, so a stale one is replaced and two
 * become one; and one group of grove's own (`guardHookGroup`) is appended to `hooks.PreToolUse`, never merged into
 * another. A file that already runs `command`, once, is `unchanged`.
 */
export function planGuardInstall(text: string | null, command: string): SettingsPlan {
  const parsed = parseClaudeSettings(text);
  if (!parsed.ok) return { kind: "refused", problem: parsed.problem };
  if (readGuardStatus(text, command).status === "installed") return { kind: "unchanged" };
  const { settings } = parsed;
  const hooks = isJsonObject(settings["hooks"]) ? settings["hooks"] : {};
  const { kept, removed } = removeGroveHooks(listOf(hooks["PreToolUse"]) ?? []);
  const group = guardHookGroup(command);
  const next = { ...settings, hooks: { ...hooks, PreToolUse: [...kept, group] } };
  return { kind: "change", text: settingsText(next), adds: group, removes: removed, reformats: reformats(text, settings) };
}
