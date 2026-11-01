import { runGit } from "../git/run-git.js";
import type { Sha } from "./facts.types.js";

/** Counts the commits reachable from a detached `head` and from no branch, remote or tag. Throws GitError on failure. */
export async function countDetachedOnly(cwd: string, head: Sha): Promise<number> {
  const { stdout } = await runGit(["rev-list", "--count", head, "--not", "--branches", "--remotes", "--tags"], { cwd });
  return Number.parseInt(stdout.trim(), 10);
}
