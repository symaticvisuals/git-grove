import { isJsonObject } from "./is-json-object.js";
import { listOf } from "./list-of.js";
import { parseClaudeSettings } from "./parse-claude-settings.js";
import { reformats } from "./reformats.js";
import { removeGroveHooks } from "./remove-grove-hooks.js";
import type { SettingsPlan } from "./settings-plan.types.js";
import { settingsText } from "./settings-text.js";

/**
 * How uninstalling grove's hook changes a settings file's `text`: only grove's hooks go (`removeGroveHooks`), and a
 * `hooks.PreToolUse` or `hooks` left empty by that is dropped. Every other key, group and hook is kept in order. A
 * file with no grove hook is `unchanged`.
 */
export function planGuardUninstall(text: string | null): SettingsPlan {
  const parsed = parseClaudeSettings(text);
  if (!parsed.ok) return { kind: "refused", problem: parsed.problem };
  const { settings } = parsed;
  const hooks = settings["hooks"];
  if (!isJsonObject(hooks)) return { kind: "unchanged" };
  const { kept, removed } = removeGroveHooks(listOf(hooks["PreToolUse"]) ?? []);
  if (removed.length === 0) return { kind: "unchanged" };
  const nextHooks: Record<string, unknown> = { ...hooks, PreToolUse: kept };
  if (kept.length === 0) delete nextHooks["PreToolUse"];
  const next: Record<string, unknown> = { ...settings, hooks: nextHooks };
  if (Object.keys(nextHooks).length === 0) delete next["hooks"];
  return { kind: "change", text: settingsText(next), adds: null, removes: removed, reformats: reformats(text, settings) };
}
