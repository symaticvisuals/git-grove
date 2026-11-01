import { runGit } from "../git/run-git.js";

const CREATION = "branch: Created from ";

/**
 * Reports whether the reflog of `branch` records anything beyond the branch's creation, such as a commit made on it.
 * A branch with no reflog, or one git cannot read, reports false.
 */
export async function branchWasCommittedTo(cwd: string, branch: string): Promise<boolean> {
  const result = await runGit(["reflog", "show", "--format=%gs", `refs/heads/${branch}`, "--"], {
    cwd,
    allowFailure: true,
  }).catch(() => null);
  if (result === null || result.code !== 0) return false;
  return result.stdout.split("\n").some((subject) => subject !== "" && !subject.startsWith(CREATION));
}
