import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { RepoFacts, WorktreeFacts } from "./facts.types.js";
import { NotAWorktreeError } from "./not-a-worktree.error.js";

async function realpathOrSelf(path: string): Promise<string> {
  const real = await realpath(path).catch(() => null);
  if (real !== null) return real;
  const parent = dirname(path);
  return parent === path ? path : join(await realpathOrSelf(parent), basename(path));
}

/**
 * Finds the worktree `target` names, resolved from `cwd` and compared with symlinks resolved on both sides; a folder
 * that no longer exists is resolved through its nearest existing parent, so it still matches git's own path for it.
 * Throws NotAWorktreeError otherwise.
 */
export async function findWorktree(facts: RepoFacts, cwd: string, target: string): Promise<WorktreeFacts> {
  const wanted = await realpathOrSelf(resolve(cwd, target));
  for (const worktree of facts.worktrees) {
    if (worktree.path === wanted || (await realpathOrSelf(worktree.path)) === wanted) return worktree;
  }
  throw new NotAWorktreeError(target);
}
