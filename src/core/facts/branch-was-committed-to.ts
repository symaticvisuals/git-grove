import { runGit } from "../git/run-git.js";

const COMMIT_SUBJECTS = ["commit", "cherry-pick", "revert"];
const MERGE_COMMIT = "Merge made by";

function madeACommit(subject: string): boolean {
  return COMMIT_SUBJECTS.some((prefix) => subject.startsWith(prefix)) || subject.includes(MERGE_COMMIT);
}

/**
 * Reports whether the reflog of `branch` records a commit made on it: a commit (amend, merge and initial included),
 * a cherry-pick, a revert or a merge that made a merge commit. Creating, fast-forwarding, rebasing or resetting
 * the branch does not count. An empty, missing or unreadable reflog counts as committed to.
 */
export async function branchWasCommittedTo(cwd: string, branch: string): Promise<boolean> {
  const result = await runGit(["reflog", "show", "--format=%gs", `refs/heads/${branch}`, "--"], {
    cwd,
    allowFailure: true,
  }).catch(() => null);
  if (result === null || result.code !== 0) return true;
  const subjects = result.stdout.split("\n").filter((subject) => subject !== "");
  return subjects.length === 0 || subjects.some(madeACommit);
}
