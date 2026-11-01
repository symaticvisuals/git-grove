import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { runGit } from "../../git/run-git.js";
import { removalReasons } from "./removal-reasons.js";
import { RescueFailedError } from "./rescue-failed.error.js";
import { verifyCopies, type RescuedFile } from "./verify-copies.js";

/**
 * Removes the linked worktree at `path` only if its full safe-to-remove verdict, re-read now, gives no reason to
 * keep it. A file in `rescued` counts as already in the main worktree `root` only while it still matches its copy
 * byte for byte, checked once more right before `git worktree remove` runs. Runs it without `--force`, so git's own
 * checks still apply, and never touches the branch. Resolves to the reasons when it removed nothing; throws GitError
 * when git refuses or fails.
 */
export async function removeWorktreeSafely(
  root: string,
  path: string,
  rescued: readonly RescuedFile[],
): Promise<{ removed: true } | { removed: false; reasons: string[] }> {
  const reasons = await removalReasons(await readRepoFacts(root), path, new Set(rescued.map((copy) => copy.from)));
  if (reasons.length > 0) return { removed: false, reasons };
  try {
    await verifyCopies(root, path, rescued);
  } catch (error) {
    if (!(error instanceof RescueFailedError)) throw error;
    return { removed: false, reasons: [`${error.path} changed after it was copied, so its copy in main no longer matches`] };
  }
  await runGit(["worktree", "remove", path], { cwd: root, write: true });
  return { removed: true };
}
