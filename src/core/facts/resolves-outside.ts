import { realpath, stat } from "node:fs/promises";
import { dirname, sep } from "node:path";
import type { LinkedRoot } from "./read-linked-roots.js";

/**
 * Reports whether `path`, with every symlink on the way resolved, lies outside each of `roots`. It is inside one when
 * its real path starts with the root's, or when it or any folder above it has the root folder's `(dev, ino)`, which
 * catches a different path to the same folder (a macOS firmlink, a bind mount, a case alias). A path that does not
 * resolve, or a folder above it that cannot be read, is not outside.
 */
export async function resolvesOutside(path: string, roots: readonly LinkedRoot[]): Promise<boolean> {
  const real = await realpath(path).catch(() => null);
  if (real === null || roots.some((root) => real === root.path || real.startsWith(root.path + sep))) return false;
  const ids = roots.flatMap((root) => (root.id === null ? [] : [root.id]));
  for (let at = real; ; at = dirname(at)) {
    const stats = await stat(at, { bigint: true }).catch(() => null);
    if (stats === null || ids.some((id) => id.dev === stats.dev && id.ino === stats.ino)) return false;
    if (dirname(at) === at) return true;
  }
}
