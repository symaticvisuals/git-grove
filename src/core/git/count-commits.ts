import { runGit } from "./run-git.js";

/** How many commits `git rev-list --count <args>` finds. Throws GitError when git fails. */
export async function countCommits(cwd: string, args: readonly string[]): Promise<number> {
  return Number((await runGit(["rev-list", "--count", ...args], { cwd })).stdout.trim());
}
