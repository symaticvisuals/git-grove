import { shellWord } from "../actions/shell-word.js";

const CLAUDE_SUFFIX = " guard --claude";

/** The command Claude Code's hook runs: `node` running `bin` with `guard --claude`, each path one shell word. */
export function guardHookCommand(node: string, bin: string): string {
  return `${shellWord(node)} ${shellWord(bin)} guard --claude`;
}

/** The SessionStart command for the same grove binary as a `guard --claude` command. */
export function guardAnnounceCommand(command: string): string {
  return command.endsWith(CLAUDE_SUFFIX) ? `${command.slice(0, -CLAUDE_SUFFIX.length)} guard --announce` : command;
}
