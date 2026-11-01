import { realpath } from "node:fs/promises";
import { sep } from "node:path";

/**
 * Reports whether `path`, with every symlink on the way resolved, lies outside each of `roots` (real paths). A path
 * that does not resolve is not outside.
 */
export async function resolvesOutside(path: string, roots: readonly string[]): Promise<boolean> {
  const real = await realpath(path).catch(() => null);
  return real !== null && !roots.some((root) => real === root || real.startsWith(root + sep));
}
