import { lstat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Whether a folder between `root` and its relative `path` is a symlink, so a file written at `path` would land where the
 * link points. A folder that does not exist yet is no link; `path` itself is not looked at.
 */
export async function crossesSymlink(root: string, path: string): Promise<boolean> {
  const folders = path.split(/[\\/]/).slice(0, -1).filter((part) => part !== "" && part !== ".");
  let at = root;
  for (const folder of folders) {
    at = join(at, folder);
    const stats = await lstat(at).catch(() => null);
    if (stats === null) return false;
    if (stats.isSymbolicLink()) return true;
  }
  return false;
}
