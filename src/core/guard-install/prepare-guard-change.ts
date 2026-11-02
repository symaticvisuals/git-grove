import type { GuardChange, GuardPlan, PreparedGuardChange, SettingsFile } from "./guard-install.types.js";
import { planGuardInstall } from "./plan-guard-install.js";
import { planGuardUninstall } from "./plan-guard-uninstall.js";
import { readGuardStatus } from "./read-guard-status.js";
import { settingsBackupPath } from "./settings-backup-path.js";
import type { SettingsPlan } from "./settings-plan.types.js";
import { willNotEdit } from "./will-not-edit.js";

export type GuardChangeInput = {
  change: GuardChange;
  file: SettingsFile;
  /** The command the hook should run (`guardHookCommand`). */
  command: string;
  /** Why grove will not install from where it runs (`ephemeralRefusal`), or null. */
  refusal: string | null;
  now: number;
};

const KEPT = "Your other settings and hooks are kept.";
const PICKUP: Record<GuardChange, string> = {
  install: "Claude Code reloads this file when it changes, so running sessions normally pick the hook up; new sessions always do.",
  uninstall: "Claude Code reloads this file when it changes, so running sessions normally drop the hook; new sessions always do.",
};
const REFORMAT = "This file is not written as 2-space JSON, so grove rewrites it with 2-space indentation. No setting changes.";
const DISABLED = "This file sets disableAllHooks to true, so the hook will not run unless a project turns hooks back on.";
const ADVICE: Record<GuardChange, string> = {
  install: "To add the hook yourself, run git grove install-guard.",
  uninstall: "To take grove's hook out, edit the file yourself.",
};

function headings(change: GuardChange, stale: boolean): Pick<GuardPlan, "title" | "summary" | "confirm"> {
  if (change === "uninstall") return { title: "Uninstall the agent guard", summary: "Takes grove's hook out of Claude Code's settings.", confirm: "Uninstall" };
  const summary = "Claude Code checks each Bash command with grove before it runs, and stops one that would lose work.";
  return { title: stale ? "Update the agent guard" : "Install the agent guard", summary, confirm: "Install" };
}

function blockersOf(input: GuardChangeInput, planned: SettingsPlan): string[] {
  if (input.refusal !== null && input.change === "install") return [input.refusal];
  if (input.file.problem !== null) return [`${willNotEdit(input.file.path, input.file.problem)} ${ADVICE[input.change]}`];
  if (input.file.readOnly) return [`${willNotEdit(input.file.path, "is read-only")} ${ADVICE[input.change]}`];
  if (planned.kind === "refused") return [`${willNotEdit(input.file.path, planned.problem)} ${ADVICE[input.change]}`];
  if (planned.kind === "unchanged") return [input.change === "install" ? "The agent guard is already installed." : "The agent guard is not installed."];
  return [];
}

function plannedOf(input: GuardChangeInput): SettingsPlan {
  if (input.file.problem !== null) return { kind: "refused", problem: input.file.problem };
  return input.change === "install" ? planGuardInstall(input.file.text, input.command) : planGuardUninstall(input.file.text);
}

/**
 * Plans `input.change` to the settings file as read: the review a person confirms, and the edit it makes. The plan
 * names the file and its backup, shows the JSON added or removed, and says the other settings are kept, when Claude
 * Code picks the change up, and that the file is rewritten with 2-space indentation when it is; an install warns when
 * the file turns every hook off. It is blocked, with no edit, from a package runner's cache (install only), for a file
 * grove cannot read or that is read-only, and when there is nothing to change.
 */
export function prepareGuardChange(input: GuardChangeInput): PreparedGuardChange {
  const { change, file } = input;
  const planned = plannedOf(input);
  const reading = readGuardStatus(file.text, input.command, file.problem);
  const blockers = blockersOf(input, planned);
  const changing = planned.kind === "change" && blockers.length === 0 ? planned : null;
  const lines = [KEPT, PICKUP[change]];
  if (changing?.reformats === true) lines.push(REFORMAT);
  const plan: GuardPlan = {
    change,
    ...headings(change, reading.status === "stale"),
    settingsPath: file.path,
    backupPath: file.text === null ? null : settingsBackupPath(file.path),
    adds: changing === null || changing.adds === null ? null : JSON.stringify(changing.adds, null, 2),
    removes: changing === null ? [] : changing.removes.map((removed) => JSON.stringify(removed, null, 2)),
    lines,
    warnings: change === "install" && reading.hooksDisabled ? [DISABLED] : [],
    blockers,
    readAt: input.now,
  };
  const updated = change === "install" && reading.status === "stale";
  const done = change === "uninstall" ? "Uninstalled the agent guard" : updated ? "Updated the agent guard" : "Installed the agent guard";
  return { plan, edit: changing === null ? null : { path: file.path, saw: file.hash, text: changing.text }, done, updated };
}
