import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { runGit } from "../../git/run-git.js";
import { removalReasons } from "./removal-reasons.js";

/**
 * Removes the linked worktree at `path` only if its full safe-to-remove verdict, re-read now, gives no reason to
 * keep it; the precious ignored files in `rescued` (worktree-relative) count as already in main. Runs
 * `git worktree remove` without `--force`, so git's own checks still apply, and never touches the branch. Resolves
 * to the reasons when it removed nothing; throws GitError when git refuses or fails.
 */
export async function removeWorktreeSafely(
  root: string,
  path: string,
  rescued: ReadonlySet<string>,
): Promise<{ removed: true } | { removed: false; reasons: string[] }> {
  const reasons = await removalReasons(await readRepoFacts(root), path, rescued);
  if (reasons.length > 0) return { removed: false, reasons };
  await runGit(["worktree", "remove", path], { cwd: root, write: true });
  return { removed: true };
}
