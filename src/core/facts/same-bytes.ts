import { lstat } from "node:fs/promises";
import { fileDigest } from "./file-digest.js";

/**
 * Reports whether both paths are regular files with identical bytes: sizes are compared, then SHA-256 digests read in
 * chunks. A missing, unreadable or non-regular file is not the same.
 */
export async function sameBytes(left: string, right: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([lstat(left), lstat(right)]);
    if (!a.isFile() || !b.isFile() || a.size !== b.size) return false;
    const digest = await fileDigest(left);
    return digest !== null && digest === (await fileDigest(right));
  } catch {
    return false;
  }
}
