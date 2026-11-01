import { branchWasCommittedTo } from "../facts/branch-was-committed-to.js";
import type { Sha } from "../facts/facts.types.js";
import { unlessGitFails } from "../git/unless-git-fails.js";
import { isMerged } from "./is-merged.js";

/**
 * Reports whether a branch's work has landed on the trunk: `tip` is merged into `trunkRef` (6.4's merged test)
 * and the branch has had a commit made on it, so a branch only created or fast-forwarded on the trunk has not.
 * A git failure counts as not landed.
 */
export async function branchLanded(cwd: string, branch: { name: string; tip: Sha }, trunkRef: string): Promise<boolean> {
  if (!(await branchWasCommittedTo(cwd, branch.name))) return false;
  return unlessGitFails(isMerged(cwd, branch.tip, trunkRef), false);
}
