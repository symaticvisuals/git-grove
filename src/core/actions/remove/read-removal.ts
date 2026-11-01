import { existsSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { RepoFacts, WorktreeFacts } from "../../facts/facts.types.js";
import type { Verdict } from "../../rules/verdict.types.js";
import { displayPath } from "../display-path.js";
import type { Expectation } from "../plan.types.js";
import { readDirtyPaths } from "../read-dirty-paths.js";
import { describeReason } from "./describe-reason.js";
import { planRescueTargets } from "./plan-rescue-targets.js";
import { removalBlocker } from "./removal-blocker.js";
import type { RescuedFile } from "./verify-copies.js";

/** A precious ignored file and where a rescue would put it in main; `size` is null when it could not be read. */
export type PlannedCopy = RescuedFile & { size: number | null };

/**
 * One worktree as a removal plan reads it. `label` is its branch, or its folder when detached. `blockers` keep it
 * whatever is rescued; `precious` is the precious-files reason as one line, null when there are none; `copies` are
 * those files with their planned targets in main; `expects` is the worktree as read, uncommitted paths included, and
 * its branch's tip.
 */
export type Removal = {
  worktree: WorktreeFacts;
  shown: string;
  label: string;
  verdict: Verdict | null;
  blockers: string[];
  precious: string | null;
  copies: PlannedCopy[];
  expects: Expectation[];
};

async function expectsOf(facts: RepoFacts, worktree: WorktreeFacts): Promise<Expectation[]> {
  const { path, head, operation, branch } = worktree;
  const onDisk = !worktree.prunable && existsSync(path);
  const dirty = onDisk ? await readDirtyPaths(path).catch(() => []) : [];
  const expects: Expectation[] = [{ kind: "worktree", path, head, dirty, operation }];
  const tip = facts.branches.find((candidate) => candidate.name === branch)?.tip;
  if (branch !== null && tip !== undefined) expects.push({ kind: "tip", branch, sha: tip });
  return expects;
}

async function sizeOf(path: string): Promise<number | null> {
  return lstat(path).then(
    (stats) => stats.size,
    () => null,
  );
}

/**
 * Reads what removing `worktree` would involve from its `verdict`, which is null for the main worktree: the reasons
 * that keep it, the precious files a rescue copies and where, and what it relies on for the plan's expectations.
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
  const blocker = removalBlocker(worktree);
  return {
    worktree,
    shown,
    label: worktree.branch ?? shown,
    verdict,
    blockers: [
      ...(blocker === null ? [] : [blocker]),
      ...reasons.filter((reason) => reason !== precious).map((reason) => describeReason(facts.root, reason)),
    ],
    precious: precious === undefined ? null : describeReason(facts.root, precious),
    copies,
    expects: await expectsOf(facts, worktree),
  };
}
