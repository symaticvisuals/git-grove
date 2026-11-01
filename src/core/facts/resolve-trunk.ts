import { NotARepoError } from "./not-a-repo.error.js";
import { runGit } from "../git/run-git.js";
import type { RepoFacts } from "./facts.types.js";

const ORIGIN_PREFIX = "refs/remotes/origin/";

async function output(args: string[], cwd: string): Promise<string> {
  const result = await runGit(args, { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : "";
}

async function exists(ref: string, cwd: string): Promise<boolean> {
  return (await runGit(["show-ref", "--verify", "--quiet", ref], { cwd, allowFailure: true })).code === 0;
}

/**
 * Finds the trunk branch. Candidates, first existing wins: `stack.trunk`, the branch `origin/HEAD` points at,
 * `init.defaultBranch`, the main worktree's current branch, `main`, `master`.
 * The ref is the remote-tracking branch when it exists, otherwise the local one.
 * Throws NotARepoError when no candidate exists.
 */
export async function resolveTrunk(cwd: string): Promise<RepoFacts["trunk"]> {
  const originHead = await output(["symbolic-ref", "--quiet", `${ORIGIN_PREFIX}HEAD`], cwd);
  const candidates = [
    await output(["config", "--get", "stack.trunk"], cwd),
    originHead.startsWith(ORIGIN_PREFIX) ? originHead.slice(ORIGIN_PREFIX.length) : "",
    await output(["config", "--get", "init.defaultBranch"], cwd),
    await output(["symbolic-ref", "--short", "--quiet", "HEAD"], cwd),
    "main",
    "master",
  ].filter((name) => name !== "");

  for (const name of candidates) {
    const remoteRef = `${ORIGIN_PREFIX}${name}`;
    const localRef = `refs/heads/${name}`;
    const ref = (await exists(remoteRef, cwd)) ? remoteRef : (await exists(localRef, cwd)) ? localRef : null;
    if (ref === null) continue;
    const sha = await output(["rev-parse", "--verify", `${ref}^{commit}`], cwd);
    if (sha !== "") return { name, ref, sha };
  }
  throw new NotARepoError("git-grove: cannot find the trunk branch; set it with git config stack.trunk <branch>");
}
