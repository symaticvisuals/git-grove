import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { copyFiles } from "../create/copy-files.js";
import { errorLine } from "../error-line.js";
import { nestedRepoOf } from "./nested-repo-of.js";
import { planRescueTargets } from "./plan-rescue-targets.js";
import { RescueFailedError } from "./rescue-failed.error.js";
import { verifyCopies, type RescuedFile } from "./verify-copies.js";

async function copyNew(from: string, to: string): Promise<void> {
  const { kept } = await copyFiles([{ from, to }], { overwrite: false });
  if (kept.length > 0) throw new Error(`${to} appeared in main first`);
}

async function isRegularFile(path: string): Promise<boolean> {
  return lstat(path).then(
    (stats) => stats.isFile(),
    () => false,
  );
}

/**
 * Copies a worktree's precious ignored `files` (worktree-relative) into the `main` worktree, never overwriting: each
 * goes to the path its `rescueTarget` names, folders created as needed, and is compared byte for byte (SHA-256) with
 * its source. Resolves to each copy, in order. Throws RescueFailedError, before copying anything, when a file lies in
 * a git repository nested in the worktree; and for the first file that is not a regular file, fails to copy or
 * differs from its copy. Files copied before it stay in main. `copy` is the copier, a test seam.
 */
export async function rescueFiles(
  main: string,
  worktree: string,
  files: string[],
  copy: (from: string, to: string) => Promise<void> = copyNew,
): Promise<RescuedFile[]> {
  const nested = nestedRepoOf(worktree, files);
  if (nested !== null) throw new RescueFailedError(nested, "it is a git repository of its own; move it out by hand");
  const copies: RescuedFile[] = [];
  for (const { from, to } of planRescueTargets(main, basename(worktree), files)) {
    if (!(await isRegularFile(join(worktree, from)))) throw new RescueFailedError(from, "it is not a regular file");
    try {
      await copy(join(worktree, from), join(main, to));
    } catch (error) {
      throw new RescueFailedError(from, errorLine(error));
    }
    await verifyCopies(main, worktree, [{ from, to }]);
    copies.push({ from, to });
  }
  return copies;
}
