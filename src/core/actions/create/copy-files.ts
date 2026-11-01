import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** `copied` and `kept` list destination paths: those written, and those that already existed and were left alone. */
export type CopyResult = { copied: string[]; kept: string[] };

/**
 * Copies each `from` to its `to`, creating the destination's folders. A destination that already exists is never
 * overwritten and is reported in `kept`. Throws on any other failure, such as a missing source; files copied before
 * it stay copied.
 */
export async function copyFiles(pairs: { from: string; to: string }[], _opts: { overwrite: false }): Promise<CopyResult> {
  const result: CopyResult = { copied: [], kept: [] };
  for (const { from, to } of pairs) {
    await mkdir(dirname(to), { recursive: true });
    try {
      await copyFile(from, to, constants.COPYFILE_EXCL);
      result.copied.push(to);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      result.kept.push(to);
    }
  }
  return result;
}
