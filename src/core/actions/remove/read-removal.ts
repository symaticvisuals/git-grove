import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RepoFacts, WorktreeFacts } from "../../facts/facts.types.js";
import type { Verdict } from "../../rules/verdict.types.js";
import { displayPath } from "../display-path.js";
import { readDirtyPaths } from "../read-dirty-paths.js";
import { describeReason } from "./describe-reason.js";
import { nestedRepoOf } from "./nested-repo-of.js";
import { planRescueTargets } from "./plan-rescue-targets.js";
import { removalBlocker } from "./removal-blocker.js";
import type { RescuedFile } from "./verify-copies.js";

/** A precious ignored file and where a rescue would put it in main; `size` is null when it could not be read. */
export type PlannedCopy = RescuedFile & { size: number | null };

/**
 * One worktree as a removal plan reads it. `label` is its branch, or its folder when detached. `blockers` keep it
 * whatever is rescued; `precious` is the precious-files reason as one line, null when there are none; `copies` are
 * those files with their planned targets in main; `nestedRepo` is a git repository holding one of them, if any.
 */
export type Removal = {
  worktree: WorktreeFacts;
  shown: string;
  label: string;
  verdict: Verdict | null;
  blockers: string[];
  precious: string | null;
  copies: PlannedCopy[];
  nestedRepo: string | null;
  dirty: string[];
};

async function sizeOf(path: string): Promise<number | null> {
  return lstat(path).then(
    (stats) => stats.size,
    () => null,
  );
}

/**
 * Reads what removing `worktree` would involve from its `verdict`, which is null for the main worktree: the reasons
 * that keep it, the precious files a rescue copies and where, and its uncommitted paths for the plan's expectations.
 * A rescue of files inside a git repository nested in the worktree is a blocker, since that repository's history
 * would go with the folder.
 */
export async function readRemoval(facts: RepoFacts, worktree: WorktreeFacts, verdict: Verdict | null): Promise<Removal> {
  const shown = displayPath(facts.root, worktree.path);
  const reasons = verdict?.reasons ?? [];
  const precious = reasons.find((reason) => reason.code === "precious-ignored");
  const files = precious?.paths ?? [];
  const copies: PlannedCopy[] = [];
  for (const copy of planRescueTargets(facts.root, basename(worktree.path), files)) {
    copies.push({ ...copy, size: await sizeOf(join(worktree.path, copy.from)) });
  }
  const nested = nestedRepoOf(worktree.path, files);
  const blocker = removalBlocker(worktree);
  const onDisk = !worktree.prunable && existsSync(worktree.path);
  return {
    worktree,
    shown,
    label: worktree.branch ?? shown,
    verdict,
    blockers: [
      ...(blocker === null ? [] : [blocker]),
      ...reasons.filter((reason) => reason !== precious).map((reason) => describeReason(facts.root, reason)),
      ...(nested === null ? [] : [`${nested} is a git repository of its own; its history would be lost, so move it out by hand`]),
    ],
    precious: precious === undefined ? null : describeReason(facts.root, precious),
    copies,
    nestedRepo: nested,
    dirty: onDisk ? await readDirtyPaths(worktree.path).catch(() => []) : [],
  };
}
