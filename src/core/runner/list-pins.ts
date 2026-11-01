import type { Sha } from "../facts/facts.types.js";
import { runGit } from "../git/run-git.js";
import { PINS_PREFIX } from "./pin.js";

export type PinEntry = { ref: string; sha: Sha; branch: string; at: string };

/**
 * Lists grove pins, newest first, optionally only those of `branch`.
 */
export async function listPins(cwd: string, branch?: string): Promise<PinEntry[]> {
  const { stdout } = await runGit(
    ["for-each-ref", "--sort=-refname", "--format=%(refname)%00%(objectname)", PINS_PREFIX],
    { cwd },
  );
  const pins: PinEntry[] = [];
  for (const line of stdout.split("\n")) {
    const [ref = "", sha = ""] = line.split("\0");
    const match = /^(.+)\/(\d{8}T\d{6}Z)(?:-\d+)?$/.exec(ref.slice(PINS_PREFIX.length));
    if (!match || sha === "") continue;
    const [, pinned = "", at = ""] = match;
    if (branch === undefined || pinned === branch) pins.push({ ref, sha, branch: pinned, at });
  }
  return pins;
}
