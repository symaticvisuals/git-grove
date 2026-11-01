import type { Sha } from "../facts/facts.types.js";
import { GitError } from "../git/git.error.js";
import { runGit } from "../git/run-git.js";

export const PINS_PREFIX = "refs/grove/pins/";

function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await runGit(["show-ref", "--verify", "--quiet", ref], { cwd, allowFailure: true })).code === 0;
}

/**
 * Creates `refs/grove/pins/<branch>/<UTC timestamp>` at `sha`, appending `-2`, `-3`… when the ref exists,
 * including when another process creates it first. Returns the ref.
 */
export async function pin(cwd: string, branch: string, sha: Sha, at: Date): Promise<string> {
  const base = `${PINS_PREFIX}${branch}/${stamp(at)}`;
  for (let attempt = 1; ; attempt++) {
    const ref = attempt === 1 ? base : `${base}-${attempt}`;
    if (await refExists(cwd, ref)) continue;
    const args = ["update-ref", ref, sha, ""];
    const created = await runGit(args, { cwd, write: true, allowFailure: true });
    if (created.code === 0) return ref;
    if (!(await refExists(cwd, ref))) throw new GitError(args, created.code, created.stderr);
  }
}
