import { ephemeralRefusal } from "../../core/guard-install/ephemeral-refusal.js";
import { guardHookCommand } from "../../core/guard-install/guard-hook-command.js";
import { guardHookGroup } from "../../core/guard-install/guard-hook-group.js";
import type { CliIo } from "../cli-io.types.js";

/** Where the hook runs from, this Node and this CLI's `bin.js`, and the Claude Code settings file it belongs in. */
export type GuardInstallation = { node: string; bin: string; settingsPath: string };

/**
 * Runs `git grove install-guard`: prints the Claude Code `PreToolUse` hook that runs the guard, for the user to add to
 * their settings file themselves, and how to check it works. It writes no file; the dashboard installs it after a
 * review instead. It refuses with exit 1 from a package runner's cache, which may be cleared under the hook.
 */
export function installGuardCommand(io: CliIo, where: GuardInstallation): number {
  const refusal = ephemeralRefusal(where.bin);
  if (refusal !== null) {
    io.err(`git-grove: ${refusal.charAt(0).toLowerCase()}${refusal.slice(1)}\n`);
    return 1;
  }
  const hooks = { hooks: { PreToolUse: [guardHookGroup(guardHookCommand(where.node, where.bin))] } };
  io.out(
    [
      `Add this to ${where.settingsPath}. If the file already has a "PreToolUse" list, add the entry inside it to that list:`,
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
