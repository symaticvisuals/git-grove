import type { Sha } from "../facts/facts.types.js";
import { GitError } from "../git/git.error.js";
import { runGit } from "../git/run-git.js";
import { listPins } from "./list-pins.js";
import { PINS_PREFIX } from "./pins-prefix.js";

function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** The object `ref` points at, or null when it does not exist. */
async function target(cwd: string, ref: string): Promise<string | null> {
  const result = await runGit(["show-ref", "--verify", "--hash", ref], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

/** The pin's ref; `reused` when the ref already pointed at the sha, so this call created nothing. */
export type Pinned = { ref: string; reused: boolean };

/**
 * Pins `sha` for `branch`. A pin of the branch already at `sha` is reused; otherwise it creates
 * `refs/grove/pins/<branch>/<UTC timestamp>`, appending `-2`, `-3`… when the ref holds another sha,
 * including when another process creates it first.
 */
export async function pin(cwd: string, branch: string, sha: Sha, at: Date): Promise<Pinned> {
  const existing = (await listPins(cwd, branch)).find((entry) => entry.sha === sha);
  if (existing) return { ref: existing.ref, reused: true };
  const base = `${PINS_PREFIX}${branch}/${stamp(at)}`;
  for (let attempt = 1; ; attempt++) {
    const ref = attempt === 1 ? base : `${base}-${attempt}`;
    const before = await target(cwd, ref);
    if (before === sha) return { ref, reused: true };
    if (before !== null) continue;
    const args = ["update-ref", ref, sha, ""];
    const created = await runGit(args, { cwd, write: true, allowFailure: true });
    if (created.code === 0) return { ref, reused: false };
    const after = await target(cwd, ref);
    if (after === sha) return { ref, reused: true };
    if (after === null) throw new GitError(args, created.code, created.stderr);
  }
}
