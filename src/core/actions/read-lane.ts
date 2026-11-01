import type { Sha } from "../facts/facts.types.js";
import { runGit } from "../git/run-git.js";
import type { Lane } from "./plan.types.js";

export type LaneOptions = {
  caption: string;
  /** The subject shown on the base row, such as the parent branch's name. */
  baseLabel: string;
  lost?: ReadonlySet<Sha>;
  pinned?: Sha | null;
  /** The most commits of `base..tip` shown, newest kept; 12 by default. */
  limit?: number;
};

/** Reads `base..tip` as a lane: the base row, then the commits oldest first. */
export async function readLane(cwd: string, base: Sha, tip: Sha, options: LaneOptions): Promise<Lane> {
  const { stdout } = await runGit(
    ["rev-list", `--max-count=${options.limit ?? 12}`, "--no-commit-header", "--format=%H%x00%s", `${base}..${tip}`],
    { cwd },
  );
  const own = stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const separator = line.indexOf("\0");
      return { sha: line.slice(0, separator), subject: line.slice(separator + 1) };
    })
    .reverse();
  const row = (sha: Sha, subject: string, isBase: boolean): Lane["commits"][number] => ({
    sha,
    subject,
    tip: sha === tip,
    base: isBase,
    lost: options.lost?.has(sha) ?? false,
    pinned: options.pinned === sha,
  });
  return { caption: options.caption, commits: [row(base, options.baseLabel, true), ...own.map((c) => row(c.sha, c.subject, false))] };
}
