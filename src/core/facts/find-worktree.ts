import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { runGit } from "../git/run-git.js";
import type { RepoFacts, WorktreeFacts } from "./facts.types.js";
import { NotAWorktreeError } from "./not-a-worktree.error.js";

async function realpathOrSelf(path: string): Promise<string> {
  const real = await realpath(path).catch(() => null);
  if (real !== null) return real;
  const parent = dirname(path);
  return parent === path ? path : join(await realpathOrSelf(parent), basename(path));
}

async function ignoresCase(root: string): Promise<boolean> {
  const result = await runGit(["config", "--type=bool", "--get", "core.ignorecase"], { cwd: root, allowFailure: true });
  return result.code === 0 && result.stdout.trim() === "true";
}

async function bySuffix(facts: RepoFacts, target: string): Promise<WorktreeFacts | null> {
  if (target === "") return null;
  const fold = (await ignoresCase(facts.root)) ? (text: string): string => text.toLowerCase() : (text: string): string => text;
  const wanted = fold(target);
  const found = facts.worktrees.filter(({ path }) => {
    const start = path.length - target.length;
    return (start === 0 || (start > 0 && path[start - 1] === "/")) && fold(path.slice(start)) === wanted;
  });
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Finds the worktree `target` names the way git's own `worktree` commands do: first a unique worktree whose path ends
 * in `target` at a folder boundary (compared without case when `core.ignorecase` is true), then `target` as a path
 * from `cwd`, compared with symlinks resolved on both sides. A folder that no longer exists is resolved through its
 * nearest existing parent, so it still matches git's own path for it. Throws NotAWorktreeError otherwise.
 */
export async function findWorktree(facts: RepoFacts, cwd: string, target: string): Promise<WorktreeFacts> {
  const named = await bySuffix(facts, target);
  if (named !== null) return named;
  const wanted = await realpathOrSelf(resolve(cwd, target));
  for (const worktree of facts.worktrees) {
    if (worktree.path === wanted || (await realpathOrSelf(worktree.path)) === wanted) return worktree;
  }
  throw new NotAWorktreeError(target);
}
