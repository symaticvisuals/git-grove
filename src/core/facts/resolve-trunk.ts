import { runGit } from "../git/run-git.js";
import type { RepoFacts } from "./facts.types.js";

const ORIGIN_PREFIX = "refs/remotes/origin/";

async function succeeds(args: string[], cwd: string): Promise<boolean> {
  return (await runGit(args, { cwd, allowFailure: true })).code === 0;
}

/**
 * Finds the trunk branch: `stack.trunk` config, else the branch `origin/HEAD` points at, else `main`.
 * The ref is the remote-tracking branch when it exists, otherwise the local one.
 */
export async function resolveTrunk(cwd: string): Promise<RepoFacts["trunk"]> {
  const configured = (await runGit(["config", "--get", "stack.trunk"], { cwd, allowFailure: true })).stdout.trim();
  let name = configured;
  if (name === "") {
    const head = (await runGit(["symbolic-ref", "--quiet", `${ORIGIN_PREFIX}HEAD`], { cwd, allowFailure: true })).stdout.trim();
    name = head.startsWith(ORIGIN_PREFIX) ? head.slice(ORIGIN_PREFIX.length) : "main";
  }
  const remoteRef = `${ORIGIN_PREFIX}${name}`;
  const ref = (await succeeds(["show-ref", "--verify", "--quiet", remoteRef], cwd)) ? remoteRef : `refs/heads/${name}`;
  const sha = (await runGit(["rev-parse", "--verify", `${ref}^{commit}`], { cwd })).stdout.trim();
  return { name, ref, sha };
}
