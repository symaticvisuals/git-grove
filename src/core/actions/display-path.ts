import { relative } from "node:path";

/** `path` as a person reads it: relative to the main worktree `root`, which itself is "the main checkout". */
export function displayPath(root: string, path: string): string {
  return relative(root, path) || "the main checkout";
}
