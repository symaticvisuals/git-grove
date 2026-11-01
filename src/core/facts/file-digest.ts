import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";

const CHUNK = 1 << 20;

/** The SHA-256 of a regular file's bytes, read in chunks; null when it is missing, unreadable or not a regular file. */
export async function fileDigest(path: string): Promise<string | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
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
  } catch {
    return null;
  }
}
