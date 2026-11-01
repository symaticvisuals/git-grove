import { join } from "node:path";
import { slugOf } from "./slug-of.js";

/**
 * Where a level's worktree lives: `<root>/.worktrees/<feature slug>/<NN>-<branch with each / as ->`, where `NN` is
 * `depth` padded to two digits.
 */
export function levelFolder(root: string, feature: string, depth: number, branch: string): string {
  return join(root, ".worktrees", slugOf(feature), `${String(depth).padStart(2, "0")}-${branch.replaceAll("/", "-")}`);
}
