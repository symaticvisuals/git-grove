import { join } from "node:path";
import { shellWord } from "../../core/actions/shell-word.js";
import type { CliIo } from "../cli-io.types.js";
import { isEphemeralBin } from "../is-ephemeral-bin.js";

/** Where the hook runs from: this Node, this CLI's `bin.js`, and the home folder holding `.claude/settings.json`. */
export type GuardInstallation = { node: string; bin: string; home: string };

const HOOK_TIMEOUT_S = 10;

/**
 * Runs `git grove install-guard`: prints the Claude Code `PreToolUse` hook that runs the guard, for the user to add to
 * `~/.claude/settings.json` themselves, and how to check it works. It writes no file. It refuses with exit 1 from an
 * npx or `pnpm dlx` cache, which may be cleared under the hook.
 */
export function installGuardCommand(io: CliIo, where: GuardInstallation): number {
  if (isEphemeralBin(where.bin)) {
    io.err("git-grove: this git grove runs from an npx cache, which npm may clear under the hook; install it first: npm i -g @deepanshugoel/git-grove\n");
    return 1;
  }
  const command = `${shellWord(where.node)} ${shellWord(where.bin)} guard --claude`;
  const hooks = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_S }] }] } };
  io.out(
    [
      `Add this to ${join(where.home, ".claude", "settings.json")}. If the file already has a "PreToolUse" list, add the entry inside it to that list:`,
      "",
      JSON.stringify(hooks, null, 2),
      "",
      "git grove changed no file. Claude Code reads hooks when a session starts.",
      "Run install-guard again after you change Node versions.",
      "To check it works: in a new Claude Code session, ask Claude to run git worktree remove on a worktree that holds a file only it has, such as an ignored .local/seed.sql. The guard refuses and names the file.",
      "",
    ].join("\n"),
  );
  return 0;
}
