import type { BranchFacts, Sha, StackEdge } from "../facts/facts.types.js";
import { isAncestor } from "../git/is-ancestor.js";
import { runGit } from "../git/run-git.js";
import { unlessGitFails } from "../git/unless-git-fails.js";

/**
 * Where `branch` forked from `parent`: the configured `stackforkpoint`, else `hint` (such as the parent's tip when grove
 * last saw the branch), else their merge base. A candidate counts only while it is in the branch's history.
 * Throws GitError when the two share no history.
 */
export async function forkOf(
  cwd: string,
  edge: StackEdge | undefined,
  branch: BranchFacts,
  parent: BranchFacts,
  hint?: Sha | null,
): Promise<Sha> {
  for (const candidate of [edge?.forkPoint, hint]) {
    if (candidate && (await unlessGitFails(isAncestor(cwd, candidate, branch.tip), false))) return candidate;
  }
  return (await runGit(["merge-base", branch.tip, parent.tip], { cwd })).stdout.trim();
}
