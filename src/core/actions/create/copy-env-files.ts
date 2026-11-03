import { join, relative } from "node:path";
import { crossesSymlink } from "../../facts/crosses-symlink.js";
import { copyFiles } from "./copy-files.js";

/**
 * Copies the relative `files` from the `main` worktree into `target`, never overwriting. `copied` and `kept` list the
 * relative names written and the ones `target` already had; `skipped` the ones a symlinked folder of `target` would
 * send elsewhere, which are not copied.
 */
export async function copyEnvFiles(
  main: string,
  target: string,
  files: string[],
): Promise<{ copied: string[]; kept: string[]; skipped: string[] }> {
  const skipped: string[] = [];
  const safe: string[] = [];
  for (const file of files) (await crossesSymlink(target, file) ? skipped : safe).push(file);
  const result = await copyFiles(
    safe.map((file) => ({ from: join(main, file), to: join(target, file) })),
    { overwrite: false },
  );
  return { copied: result.copied.map((to) => relative(target, to)), kept: result.kept.map((to) => relative(target, to)), skipped };
}
