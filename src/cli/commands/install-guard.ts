import { ephemeralRefusal } from "../../core/guard-install/ephemeral-refusal.js";
import { guardAnnounceCommand, guardHookCommand } from "../../core/guard-install/guard-hook-command.js";
import { guardAnnounceGroup, guardHookGroup } from "../../core/guard-install/guard-hook-group.js";
import type { CliIo } from "../cli-io.types.js";

/** Where the hook runs from, this Node and this CLI's `bin.js`, and the Claude Code settings file it belongs in. */
export type GuardInstallation = { node: string; bin: string; settingsPath: string };

/**
 * Runs `git grove install-guard`: prints the Claude Code `PreToolUse` hook that runs the guard and the `SessionStart`
 * hook that tells a new session this agent is bounded by it, for the user to add to their settings file themselves,
 * and how to check it works. It writes no file; the dashboard installs it after a review instead. It refuses with
 * exit 1 from a package runner's cache, which may be cleared under the hook.
 */
export function installGuardCommand(io: CliIo, where: GuardInstallation): number {
  const refusal = ephemeralRefusal(where.bin);
  if (refusal !== null) {
    io.err(`git-grove: ${refusal.charAt(0).toLowerCase()}${refusal.slice(1)}\n`);
    return 1;
  }
  const command = guardHookCommand(where.node, where.bin);
  const hooks = { hooks: { PreToolUse: [guardHookGroup(command)], SessionStart: [guardAnnounceGroup(guardAnnounceCommand(command))] } };
  io.out(
    [
      `Add this to ${where.settingsPath}. If the file already has a "PreToolUse" or "SessionStart" list, add each entry to that list:`,
      "",
      JSON.stringify(hooks, null, 2),
      "",
      "git grove changed no file. Claude Code reloads the file when it changes, so running sessions normally pick the hook up.",
      "Or install it from the dashboard: git grove ui",
      "Run install-guard again after you change Node versions.",
      "To check it works: in a new Claude Code session, ask Claude to run git worktree remove on a worktree that holds a file only it has, such as an ignored .local/seed.sql. The guard refuses and names the file.",
      "",
    ].join("\n"),
  );
  return 0;
}
