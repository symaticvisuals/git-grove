import type { GuardPlan, PreparedGuardChange, SettingsFile } from "./guard-install.types.js";
import { planGuardUninstall } from "./plan-guard-uninstall.js";
import { readGuardStatus } from "./read-guard-status.js";
import { settingsBackupPath } from "./settings-backup-path.js";
import type { SettingsPlan } from "./settings-plan.types.js";
import { willNotEdit } from "./will-not-edit.js";

export type GuardChangeInput = { file: SettingsFile; now: number };

const KEPT = "Your other settings and hooks are kept.";
const PICKUP = "Claude Code reloads this file when it changes, so running sessions normally drop the hook; new sessions always do.";
const REFORMAT = "This file is not written as 2-space JSON, so grove rewrites it with 2-space indentation. No setting changes.";
const ADVICE = "To take grove's hook out, edit the file yourself.";
const NO_PLUGIN = "The Claude Code plugin isn't enabled, so removing this hook leaves no agent guard until you install it.";

function blockersOf(file: SettingsFile, planned: SettingsPlan): string[] {
  if (file.problem !== null) return [`${willNotEdit(file.path, file.problem)} ${ADVICE}`];
  if (file.readOnly) return [`${willNotEdit(file.path, "is read-only")} ${ADVICE}`];
  if (planned.kind === "refused") return [`${willNotEdit(file.path, planned.problem)} ${ADVICE}`];
  if (planned.kind === "unchanged") return ["There is no old hook in this file."];
  return [];
}

/**
 * Plans taking grove's old hook out of the settings file as read: the review a person confirms, and the edit it
 * makes. The plan names the file and its backup, shows the JSON removed, and says the other settings are kept, when
 * Claude Code drops the hook, and that the file is rewritten with 2-space indentation when it is. It warns when the
 * plugin is not enabled in that file, since no agent guard would be left. It is blocked, with no edit, for a file
 * grove cannot read or that is read-only, and when the file holds no grove hook.
 */
export function prepareGuardChange(input: GuardChangeInput): PreparedGuardChange {
  const { file } = input;
  const planned: SettingsPlan = file.problem === null ? planGuardUninstall(file.text) : { kind: "refused", problem: file.problem };
  const blockers = blockersOf(file, planned);
  const changing = planned.kind === "change" && blockers.length === 0 ? planned : null;
  const lines = [KEPT, PICKUP];
  if (changing?.reformats === true) lines.push(REFORMAT);
  const warnings = changing !== null && !readGuardStatus(file.text, "").pluginEnabled ? [NO_PLUGIN] : [];
  const plan: GuardPlan = {
    change: "uninstall",
    title: "Remove the old hook",
    summary: "Takes grove's hook out of Claude Code's settings.",
    confirm: "Remove",
    settingsPath: file.path,
    backupPath: file.text === null ? null : settingsBackupPath(file.path),
    adds: null,
    removes: changing === null ? [] : changing.removes.map((removed) => JSON.stringify(removed, null, 2)),
    lines,
    warnings,
    blockers,
    readAt: input.now,
  };
  return { plan, edit: changing === null ? null : { path: file.path, saw: file.hash, text: changing.text }, done: "Removed the old hook" };
}
