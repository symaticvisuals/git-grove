import type { Sha } from "../facts/facts.types.js";
import { GitError } from "../git/git.error.js";
import { isAncestor } from "../git/is-ancestor.js";
import { runGit } from "../git/run-git.js";

const PROBE_IDENTITY = {
  GIT_AUTHOR_NAME: "git-grove",
  GIT_AUTHOR_EMAIL: "git-grove@localhost",
  GIT_AUTHOR_DATE: "@0 +0000",
  GIT_COMMITTER_NAME: "git-grove",
  GIT_COMMITTER_EMAIL: "git-grove@localhost",
  GIT_COMMITTER_DATE: "@0 +0000",
};

/**
 * Squashes `tip`'s changes since `base` into one dangling commit and asks `git cherry` whether the trunk
 * already holds an equivalent patch. The commit is the same object on every call.
 */
async function squashLanded(cwd: string, tip: Sha, base: Sha, trunkRef: string): Promise<boolean> {
  const squash = await runGit(["commit-tree", "--no-gpg-sign", "-p", base, "-m", "git-grove squash probe", `${tip}^{tree}`], {
    cwd,
    env: PROBE_IDENTITY,
  });
  const cherry = await runGit(["cherry", trunkRef, squash.stdout.trim()], { cwd });
  return cherry.stdout.startsWith("-");
}

/**
 * Reports whether `tip` is already contained in `trunkRef`: as an ancestor, because merging it would leave
 * the trunk's tree unchanged (a squash or rebase merge), or because the trunk holds a commit with the same patch
 * as all of `tip`'s changes since the merge base (a squash merge the trunk has since built on, even over the same lines).
 * A tip with no history in common with the trunk is not merged; any other git failure throws GitError.
 */
export async function isMerged(cwd: string, tip: Sha, trunkRef: string): Promise<boolean> {
  if (await isAncestor(cwd, tip, trunkRef)) return true;
  const baseArgs = ["merge-base", tip, trunkRef];
  const base = await runGit(baseArgs, { cwd, allowFailure: true });
  if (base.code === 1) return false;
  if (base.code !== 0) throw new GitError(baseArgs, base.code, base.stderr);

  const mergeArgs = ["merge-tree", "--write-tree", trunkRef, tip];
  const merge = await runGit(mergeArgs, { cwd, allowFailure: true });
  if (merge.code > 1) throw new GitError(mergeArgs, merge.code, merge.stderr);
  if (merge.code === 0) {
    const trunkTree = (await runGit(["rev-parse", `${trunkRef}^{tree}`], { cwd })).stdout.trim();
    if (merge.stdout.split("\n")[0]?.trim() === trunkTree) return true;
  }
  return squashLanded(cwd, tip, base.stdout.trim(), trunkRef);
}
