import type { Sha } from "../facts/facts.types.js";
import { GitError } from "./git.error.js";
import { runGit } from "./run-git.js";

/**
 * Reports whether `ancestor` is an ancestor of (or the same commit as) `descendant`.
 * Throws GitError when git cannot tell, for example when either is not a commit.
 */
export async function isAncestor(cwd: string, ancestor: Sha, descendant: Sha): Promise<boolean> {
  const args = ["merge-base", "--is-ancestor", ancestor, descendant];
  const result = await runGit(args, { cwd, allowFailure: true });
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new GitError(args, result.code, result.stderr);
}
