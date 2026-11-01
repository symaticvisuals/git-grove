import { GitError } from "../git/git.error.js";
import { runGit } from "../git/run-git.js";
import type { Sha } from "../facts/facts.types.js";

/**
 * Reports whether `tip` is already contained in `trunkRef`, either as an ancestor
 * or because merging it would leave the trunk's tree unchanged (a squash or rebase merge).
 * A conflicting merge means not merged; any other merge-tree failure throws GitError.
 */
export async function isMerged(cwd: string, tip: Sha, trunkRef: string): Promise<boolean> {
  const ancestor = await runGit(["merge-base", "--is-ancestor", tip, trunkRef], { cwd, allowFailure: true });
  if (ancestor.code === 0) return true;
  if (ancestor.code !== 1) throw new GitError(["merge-base", "--is-ancestor", tip, trunkRef], ancestor.code, ancestor.stderr);

  const mergeArgs = ["merge-tree", "--write-tree", trunkRef, tip];
  const merge = await runGit(mergeArgs, { cwd, allowFailure: true });
  if (merge.code === 1) return false;
  if (merge.code !== 0) throw new GitError(mergeArgs, merge.code, merge.stderr);

  const trunkTree = (await runGit(["rev-parse", `${trunkRef}^{tree}`], { cwd })).stdout.trim();
  return merge.stdout.split("\n")[0]?.trim() === trunkTree;
}
