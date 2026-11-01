import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";

const CHUNK = 1 << 20;

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(CHUNK);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/**
 * Reports whether both paths are regular files with identical bytes: sizes are compared, then SHA-256 digests read in
 * chunks. A missing, unreadable or non-regular file is not the same.
 */
export async function sameBytes(left: string, right: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([lstat(left), lstat(right)]);
    if (!a.isFile() || !b.isFile() || a.size !== b.size) return false;
    return (await sha256(left)) === (await sha256(right));
  } catch {
    return false;
  }
}
