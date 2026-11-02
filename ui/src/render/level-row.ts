import type { WireLevel } from "../../../src/server/wire/wire.types.js";
import { ago } from "../ago.js";
import { plural } from "../plural.js";

export type LevelRow = { pills: { text: string; pin: boolean }[]; num: string; when: string };

/**
 * What a level's list row shows besides its name and state. Pills: commits kept in a pin, merged, ignored files
 * only in its folder, uncommitted changes, then where it stands with its upstream (left out once merged). `num` is
 * how far its parent moved on for a level stacked on another, else how far behind the trunk it is. `when` is how
 * long ago its worktree was touched.
 */
export function levelRow(level: WireLevel, now: number): LevelRow {
  const pills: LevelRow["pills"] = [];
  const add = (text: string, pin = false): void => void pills.push({ text, pin });
  if (level.pinnedLost > 0) add(`${plural(level.pinnedLost, "commit")} pinned`, true);
  if (level.merged) add("merged");
  if (level.precious > 0) add(plural(level.precious, "ignored file"));
  if (level.worktree !== null && level.worktree.dirty > 0) add(plural(level.worktree.dirty, "change"));
  const { upstream } = level;
  if (upstream !== null && !level.merged) {
    if (upstream.gone) add("upstream gone");
    else if (upstream.ahead > 0) add(`${upstream.ahead} to push`);
    else add("pushed");
  }
  const stacked = level.depth > 1;
  const num = stacked ? (level.parentCommitsSinceFork > 0 ? `+${level.parentCommitsSinceFork} parent` : "") : level.behindTrunk > 0 ? `↓${level.behindTrunk}` : "";
  const touched = level.worktree?.touchedAt ?? null;
  return { pills, num, when: touched === null ? "" : ago(touched, now) };
}
