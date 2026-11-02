import { shellWord } from "../actions/shell-word.js";

/** The command Claude Code's hook runs: `node` running `bin` with `guard --claude`, each path one shell word. */
export function guardHookCommand(node: string, bin: string): string {
  return `${shellWord(node)} ${shellWord(bin)} guard --claude`;
}
