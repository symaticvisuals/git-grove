import type { Sha } from "../facts/facts.types.js";
import { isAncestor } from "../git/is-ancestor.js";
import { ownCommits, type OwnCommit } from "./own-commits.js";

export type ChangeKind = "advanced" | "rebased" | "amended" | "rewritten" | "deleted";

export type TipChange = {
  branch: string;
  oldTip: Sha;
  newTip: Sha | null;
  kind: ChangeKind;
  lost: Sha[];
  matchedByPatch: number;
  matchedByMeta: number;
};

export type TipChangeInput = { cwd: string; branch: string; oldTip: Sha; newTip: Sha; oldBase: Sha; newBase: Sha };

type MatchedCommit = { commit: OwnCommit; by: "patch" | "meta" | null };

function matchOwnCommits(
  oldOwn: readonly OwnCommit[],
  newOwn: readonly OwnCommit[],
): { matched: MatchedCommit[]; unused: OwnCommit[] } {
  const unused = [...newOwn];
  const take = (found: (commit: OwnCommit) => boolean): boolean => {
    const index = unused.findIndex(found);
    if (index === -1) return false;
    unused.splice(index, 1);
    return true;
  };
  // Every patch match is taken before any metadata match, so metadata never claims a commit a later patch would match.
  const byPatch = oldOwn.map(
    (commit): MatchedCommit => ({
      commit,
      by: commit.patchId !== null && take((candidate) => candidate.patchId === commit.patchId) ? "patch" : null,
    }),
  );
  const matched = byPatch.map(({ commit, by }) => ({
    commit,
    by: by ?? (take((candidate) => candidate.meta === commit.meta) ? "meta" : null),
  }));
  return { matched, unused };
}

const AUTOSQUASH_PREFIX = /^(?:fixup|squash|amend)! /;

function subjectOf(commit: OwnCommit): string {
  return commit.meta.split("\0").slice(2).join("\0");
}

/**
 * Whether `commit` is a `fixup!`, `squash!` or `amend!` commit whose target is one of `changedSubjects`:
 * an old commit matched only by metadata, so its content changed when the fixup was folded in.
 */
function foldedByAutosquash(commit: OwnCommit, changedSubjects: ReadonlySet<string>): boolean {
  let target = subjectOf(commit);
  if (!AUTOSQUASH_PREFIX.test(target)) return false;
  while (AUTOSQUASH_PREFIX.test(target)) target = target.replace(AUTOSQUASH_PREFIX, "");
  return changedSubjects.has(target);
}

/** Patch IDs of the commits the base gained between `oldBase` and `newBase`, such as a hotfix cherry-picked to the trunk. */
async function patchIdsBetween(cwd: string, oldBase: Sha, newBase: Sha): Promise<Set<string>> {
  const gained = await ownCommits(cwd, oldBase, newBase);
  return new Set(gained.flatMap((commit) => (commit.patchId === null ? [] : [commit.patchId])));
}

function standsInFor(tip: OwnCommit, candidate: OwnCommit): boolean {
  const [email, time, subject] = tip.meta.split("\0");
  const [candidateEmail, candidateTime, candidateSubject] = candidate.meta.split("\0");
  return candidateEmail === email && (candidateTime === time || candidateSubject === subject);
}

/**
 * Classifies a branch tip move by comparing the branch's own commits before and after.
 * `oldBase..oldTip` and `newBase..newTip` are the own ranges, so commits that belonged to a parent are never counted.
 * An old commit is not lost when the base gained a commit with its patch ID (it reached the trunk another way),
 * or when it is an autosquash commit (`fixup! <subject>` ...) whose target matched a new commit by metadata only.
 * Never returns `deleted`; that kind is for a branch that no longer has a tip.
 */
export async function classifyTipChange(input: TipChangeInput): Promise<TipChange> {
  const { cwd, branch, oldTip, newTip, oldBase, newBase } = input;
  const tips = { branch, oldTip, newTip };
  if (await isAncestor(cwd, oldTip, newTip)) {
    return { ...tips, kind: "advanced", lost: [], matchedByPatch: 0, matchedByMeta: 0 };
  }

  const [oldOwn, newOwn] = await Promise.all([ownCommits(cwd, oldBase, oldTip), ownCommits(cwd, newBase, newTip)]);
  const { matched, unused } = matchOwnCommits(oldOwn, newOwn);
  const matchedByPatch = matched.filter((entry) => entry.by === "patch").length;
  const matchedByMeta = matched.filter((entry) => entry.by === "meta").length;
  // A commit without a patch ID (a merge, or an empty commit) has no diff of its own, so it is never lost or changed.
  const withPatch = matched.filter((entry) => entry.commit.patchId !== null);
  const unmatched = withPatch.filter((entry) => entry.by === null).map((entry) => entry.commit);
  const upstream = unmatched.length > 0 && oldBase !== newBase ? await patchIdsBetween(cwd, oldBase, newBase) : new Set<string>();
  const changedSubjects = new Set(matched.filter((entry) => entry.by === "meta").map((entry) => subjectOf(entry.commit)));
  const lost = unmatched
    .filter((commit) => !(commit.patchId !== null && upstream.has(commit.patchId)) && !foldedByAutosquash(commit, changedSubjects))
    .map((commit) => commit.sha);

  // An unmatched tip is amended only when a new commit stands in for it: same author email, and same author time or subject.
  const [onlyChange, ...moreChanges] = withPatch.filter((entry) => entry.by !== "patch");
  const amended =
    oldBase === newBase &&
    onlyChange !== undefined &&
    moreChanges.length === 0 &&
    onlyChange.commit === oldOwn.at(-1) &&
    (onlyChange.by === "meta" || unused.some((candidate) => standsInFor(onlyChange.commit, candidate)));
  const kind: ChangeKind = amended ? "amended" : lost.length === 0 ? "rebased" : "rewritten";

  return { ...tips, kind, lost: kind === "rewritten" ? lost : [], matchedByPatch, matchedByMeta };
}
