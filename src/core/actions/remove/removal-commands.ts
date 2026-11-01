import { dirname } from "node:path";
import { shellWord } from "../shell-word.js";
import type { Removal } from "./read-removal.js";

/**
 * The commands a removal amounts to, run from the main worktree: make each target folder, copy each rescued file
 * without overwriting, check, then remove. Every line but the last ends in `&&`, so pasted as shown they are one
 * command that stops at the first failure.
 */
export function removalCommands(removal: Removal, rescue: boolean): string[] {
  const folder = shellWord(removal.shown);
  const lines: string[] = [];
  const made = new Set<string>();
  for (const copy of rescue ? removal.copies : []) {
    const target = dirname(copy.to);
    if (target !== "." && !made.has(target)) {
      made.add(target);
      lines.push(`mkdir -p ${shellWord(target)}`);
    }
    lines.push(`cp -n ${shellWord(`${removal.shown}/${copy.from}`)} ${shellWord(copy.to)}`);
  }
  lines.push(`git grove check remove ${folder}`, `git worktree remove ${folder}`);
  return lines.map((line, index) => (index < lines.length - 1 ? `${line} &&` : line));
}
