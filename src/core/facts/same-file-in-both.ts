import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/**
 * Reports whether `relative` exists under both roots as a regular file with identical bytes.
 * Sizes are compared before hashing; a missing or non-regular file is not the same.
 */
export async function sameFileInBoth(left: string, right: string, relative: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([lstat(join(left, relative)), lstat(join(right, relative))]);
    if (!a.isFile() || !b.isFile() || a.size !== b.size) return false;
    return (await sha256(join(left, relative))) === (await sha256(join(right, relative)));
  } catch {
    return false;
  }
}
