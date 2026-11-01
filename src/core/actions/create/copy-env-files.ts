import { join, relative } from "node:path";
import { copyFiles } from "./copy-files.js";

/**
 * Copies the relative `files` from the `main` worktree into `target`, never overwriting. `copied` and `kept` list the
 * relative names written and the ones `target` already had.
 */
export async function copyEnvFiles(
  main: string,
  target: string,
  files: string[],
): Promise<{ copied: string[]; kept: string[] }> {
  const result = await copyFiles(
    files.map((file) => ({ from: join(main, file), to: join(target, file) })),
    { overwrite: false },
  );
  return { copied: result.copied.map((to) => relative(target, to)), kept: result.kept.map((to) => relative(target, to)) };
}
