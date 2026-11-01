import type { Lane } from "../../core/actions/plan.types.js";
import { readLane } from "../../core/actions/read-lane.js";
import { runGit } from "../../core/git/run-git.js";
import { unlessGitFails } from "../../core/git/unless-git-fails.js";
import type { JournalEntry } from "../../core/journal/store.types.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import type { WireRewrite } from "./wire.types.js";

const LANE_LIMIT = 50;

async function mergeBase(cwd: string, one: string, other: string): Promise<string | null> {
  const result = await runGit(["merge-base", one, other], { cwd, allowFailure: true });
  return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * A rewrite as two lanes from the merge base of the old and new tips (of the old tip and the trunk, for a deleted
 * branch): `before` marks the lost commits and the pinned old tip; `now` is null for a deleted branch.
 * When git cannot read the history, `before` has no commits.
 */
export async function readRewrite(snapshot: Snapshot, entry: JournalEntry, parent: string): Promise<WireRewrite> {
  const { root, trunk } = snapshot.facts;
  const base = await unlessGitFails(mergeBase(root, entry.oldTip, entry.newTip ?? trunk.sha), null);
  const lanes = async (): Promise<{ before: Lane; now: Lane | null }> => {
    if (base === null) return { before: { caption: "Before", commits: [] }, now: null };
    const options = { baseLabel: parent, limit: LANE_LIMIT };
    return {
      before: await readLane(root, base, entry.oldTip, { ...options, caption: "Before", lost: new Set(entry.lost), pinned: entry.oldTip }),
      now: entry.newTip === null ? null : await readLane(root, base, entry.newTip, { ...options, caption: "Now" }),
    };
  };
  return {
    branch: entry.branch,
    pinRef: entry.pinRef,
    at: entry.at,
    lost: entry.lost.length,
    matchedByPatch: entry.matchedByPatch,
    matchedByMeta: entry.matchedByMeta,
    ...(await unlessGitFails(lanes(), { before: { caption: "Before", commits: [] }, now: null })),
  };
}
