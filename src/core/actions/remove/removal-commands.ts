import { shellWord } from "../shell-word.js";
import type { Removal } from "./read-removal.js";

/** The commands a removal amounts to, from the main worktree: copy each rescued file, check, then remove. */
export function removalCommands(removal: Removal, rescue: boolean): string[] {
  const folder = shellWord(removal.shown);
  return [
    ...(rescue ? removal.copies : []).map((copy) => `cp -n ${shellWord(`${removal.shown}/${copy.from}`)} ${shellWord(copy.to)}`),
    `git grove check remove ${folder}`,
    `git worktree remove ${folder}`,
  ];
}
