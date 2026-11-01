import type { Sha } from "../facts/facts.types.js";
import { runGit } from "../git/run-git.js";

export const PINS_PREFIX = "refs/grove/pins/";

function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Creates `refs/grove/pins/<branch>/<UTC timestamp>` at `sha`, appending `-2`, `-3`… when the ref exists.
 * Returns the ref.
 */
export async function pin(cwd: string, branch: string, sha: Sha, at: Date): Promise<string> {
  const base = `${PINS_PREFIX}${branch}/${stamp(at)}`;
  for (let attempt = 1; ; attempt++) {
    const ref = attempt === 1 ? base : `${base}-${attempt}`;
    const exists = await runGit(["show-ref", "--verify", "--quiet", ref], { cwd, allowFailure: true });
    if (exists.code === 0) continue;
    await runGit(["update-ref", ref, sha, ""], { cwd, write: true });
    return ref;
  }
}
