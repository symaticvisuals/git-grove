import type { Sha } from "../../facts/facts.types.js";
import { GitError } from "../../git/git.error.js";
import { runGit } from "../../git/run-git.js";

const USAGE_ERROR = 129;

/**
 * The paths that would conflict when `fork..tip` is replayed onto `onto`, from a merge git computes without writing to
 * any worktree or ref: an empty list when it merges cleanly, or null when this git cannot do it (`--merge-base` needs
 * git 2.40). Throws GitError when git fails otherwise.
 */
export async function predictConflicts(cwd: string, fork: Sha, onto: Sha, tip: Sha): Promise<string[] | null> {
  const args = ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", "--merge-base", fork, onto, tip];
  const result = await runGit(args, { cwd, allowFailure: true });
  if (result.code === 0) return [];
  if (result.code === USAGE_ERROR) return null;
  if (result.code !== 1) throw new GitError(args, result.code, result.stderr);
  return [...new Set(result.stdout.split("\0").slice(1).filter((path) => path !== ""))];
}
