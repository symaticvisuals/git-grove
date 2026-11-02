import { countCommits } from "../git/count-commits.js";
import type { Sha } from "./facts.types.js";

/** Counts the commits reachable from a detached `head` and from no branch, remote or tag. Throws GitError on failure. */
export async function countDetachedOnly(cwd: string, head: Sha): Promise<number> {
  return countCommits(cwd, [head, "--not", "--branches", "--remotes", "--tags"]);
}
