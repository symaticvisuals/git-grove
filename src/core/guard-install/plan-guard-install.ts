import { guardAnnounceCommand } from "./guard-hook-command.js";
import { guardAnnounceGroup, guardHookGroup } from "./guard-hook-group.js";
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
 * become one; grove's own Bash group (`guardHookGroup`) is appended to `hooks.PreToolUse` and its session notice
 * (`guardAnnounceGroup`) to `hooks.SessionStart`, never merged into another group. A file that already runs `command`
 * once, and the matching announce command once, is `unchanged`. A PreToolUse-only install is rewritten so the notice
 * is added.
 */
export function planGuardInstall(text: string | null, command: string): SettingsPlan {
  const parsed = parseClaudeSettings(text);
  if (!parsed.ok) return { kind: "refused", problem: parsed.problem };
  if (readGuardStatus(text, command).status === "installed") return { kind: "unchanged" };
  const { settings } = parsed;
  const hooks = isJsonObject(settings["hooks"]) ? settings["hooks"] : {};
  const pre = removeGroveHooks(listOf(hooks["PreToolUse"]) ?? []);
  const session = removeGroveHooks(listOf(hooks["SessionStart"]) ?? []);
  const group = guardHookGroup(command);
  const announce = guardAnnounceGroup(guardAnnounceCommand(command));
  const next = { ...settings, hooks: { ...hooks, PreToolUse: [...pre.kept, group], SessionStart: [...session.kept, announce] } };
  return {
    kind: "change",
    text: settingsText(next),
    adds: { PreToolUse: group, SessionStart: announce },
    removes: [...pre.removed, ...session.removed],
    reformats: reformats(text, settings),
  };
}
