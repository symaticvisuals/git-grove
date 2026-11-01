import { join } from "node:path";
import type { LinkedRoot } from "./read-linked-roots.js";
import { resolvesOutside } from "./resolves-outside.js";
import { sameBytes } from "./same-bytes.js";

/**
 * Reports whether `relative` exists under both roots as a regular file with identical bytes, the one under `right`
 * really kept outside every linked worktree in `linkedRoots`. A path in `right` that does not resolve, or reaches into a
 * linked worktree through a symlink or another path to the same folder, is the same file seen twice, not a copy. A
 * hard-linked file is a copy.
 */
export async function sameFileInBoth(left: string, right: string, relative: string, linkedRoots: readonly LinkedRoot[]): Promise<boolean> {
  if (!(await resolvesOutside(join(right, relative), linkedRoots))) return false;
  return sameBytes(join(left, relative), join(right, relative));
}
