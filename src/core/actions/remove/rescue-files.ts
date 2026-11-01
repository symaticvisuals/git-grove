import { lstat, mkdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileDigest } from "../../facts/file-digest.js";
import { readLinkedRoots } from "../../facts/read-linked-roots.js";
import { resolvesOutside } from "../../facts/resolves-outside.js";
import { copyFiles } from "../create/copy-files.js";
import { errorLine } from "../error-line.js";
import { planRescueTargets } from "./plan-rescue-targets.js";
import { RescueFailedError } from "./rescue-failed.error.js";
import type { CopiedFile } from "./verify-copies.js";

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

async function nearestExisting(folder: string): Promise<string> {
  let at = folder;
  while ((await stat(at).catch(() => null)) === null && dirname(at) !== at) at = dirname(at);
  return at;
}

/**
 * Copies a worktree's precious ignored `files` (worktree-relative) into the `main` worktree, never overwriting: each
 * goes to the path its `rescueTarget` names, folders created as needed, and is compared byte for byte (SHA-256) with
 * its source. Resolves to each copy with that digest, in order. Throws RescueFailedError for the first file that is
 * gone or not a regular file, whose target folder in main reaches into a linked worktree (checked on the nearest
 * existing folder before any is made, and again after), or that fails to copy or differs from its copy; files copied
 * before it stay in main. `copy` is the copier, a test seam.
 */
export async function rescueFiles(
  main: string,
  worktree: string,
  files: string[],
  copy: (from: string, to: string) => Promise<void> = copyNew,
): Promise<CopiedFile[]> {
  if (files.length === 0) return [];
  const roots = await attempt(files[0] ?? "", () => readLinkedRoots(main));
  const intoWorktree = (from: string): RescueFailedError => new RescueFailedError(from, "the target folder in main points into a worktree");
  const copies: CopiedFile[] = [];
  for (const { from, to } of planRescueTargets(main, basename(worktree), files)) {
    const problem = await sourceProblem(join(worktree, from));
    if (problem !== null) throw new RescueFailedError(from, problem);
    const source = join(worktree, from);
    const target = join(main, to);
    await attempt(from, async () => {
      if (!(await resolvesOutside(await nearestExisting(dirname(target)), roots))) throw intoWorktree(from);
      await mkdir(dirname(target), { recursive: true });
      if (!(await resolvesOutside(dirname(target), roots))) throw intoWorktree(from);
      await copy(source, target);
    });
    const digest = await fileDigest(source);
    if (digest === null) throw new RescueFailedError(from, "it is gone");
    const kept = (await resolvesOutside(target, roots)) ? await fileDigest(target) : null;
    if (kept !== digest) throw new RescueFailedError(from);
    copies.push({ from, to, digest });
  }
  return copies;
}
