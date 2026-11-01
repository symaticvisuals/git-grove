import { lstat, mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { readLinkedRoots } from "../../facts/read-linked-roots.js";
import { resolvesOutside } from "../../facts/resolves-outside.js";
import { copyFiles } from "../create/copy-files.js";
import { errorLine } from "../error-line.js";
import { planRescueTargets } from "./plan-rescue-targets.js";
import { RescueFailedError } from "./rescue-failed.error.js";
import { verifyCopies, type RescuedFile } from "./verify-copies.js";

async function copyNew(from: string, to: string): Promise<void> {
  const { kept } = await copyFiles([{ from, to }], { overwrite: false });
  if (kept.length > 0) throw new Error(`${to} appeared in main first`);
}

async function sourceProblem(path: string): Promise<string | null> {
  try {
    return (await lstat(path)).isFile() ? null : "it is not a regular file";
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT" ? "it is gone" : errorLine(error);
  }
}

async function attempt<T>(from: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof RescueFailedError) throw error;
    throw new RescueFailedError(from, errorLine(error));
  }
}

/**
 * Copies a worktree's precious ignored `files` (worktree-relative) into the `main` worktree, never overwriting: each
 * goes to the path its `rescueTarget` names, folders created as needed, and is compared byte for byte (SHA-256) with
 * its source. Resolves to each copy, in order. Throws RescueFailedError for the first file that is gone or not a
 * regular file, whose target folder in main resolves into a linked worktree, or that fails to copy or differs from its
 * copy; files copied before it stay in main. `copy` is the copier, a test seam.
 */
export async function rescueFiles(
  main: string,
  worktree: string,
  files: string[],
  copy: (from: string, to: string) => Promise<void> = copyNew,
): Promise<RescuedFile[]> {
  const copies: RescuedFile[] = [];
  for (const { from, to } of planRescueTargets(main, basename(worktree), files)) {
    const problem = await sourceProblem(join(worktree, from));
    if (problem !== null) throw new RescueFailedError(from, problem);
    const folder = dirname(join(main, to));
    await attempt(from, async () => {
      await mkdir(folder, { recursive: true });
      if (!(await resolvesOutside(folder, await readLinkedRoots(main)))) {
        throw new RescueFailedError(from, "the target folder in main points into a worktree");
      }
      await copy(join(worktree, from), join(main, to));
    });
    await verifyCopies(main, worktree, [{ from, to }]);
    copies.push({ from, to });
  }
  return copies;
}
