import { lstatSync } from "node:fs";
import { join } from "node:path";
import { rescueTarget } from "./rescue-target.js";
import type { RescuedFile } from "./verify-copies.js";

function present(path: string): boolean {
  try {
    return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Pairs each of a worktree's `files` with its target in the main worktree, in order: no two share a target, and none
 * is a path main already has, a dangling link included. `folder` is the worktree folder's name.
 */
export function planRescueTargets(main: string, folder: string, files: readonly string[]): RescuedFile[] {
  const taken = new Set<string>();
  return files.map((from) => {
    const to = rescueTarget(from, folder, (rel) => taken.has(rel) || present(join(main, rel)));
    taken.add(to);
    return { from, to };
  });
}
