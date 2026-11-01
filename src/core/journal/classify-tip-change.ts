import type { Sha } from "../facts/facts.types.js";
import { GitError } from "../git/git.error.js";
import { runGit } from "../git/run-git.js";
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

async function isAncestor(cwd: string, ancestor: Sha, descendant: Sha): Promise<boolean> {
  const args = ["merge-base", "--is-ancestor", ancestor, descendant];
  const result = await runGit(args, { cwd, allowFailure: true });
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new GitError(args, result.code, result.stderr);
}

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

function standsInFor(tip: OwnCommit, candidate: OwnCommit): boolean {
  const [email, time, subject] = tip.meta.split("\0");
  const [candidateEmail, candidateTime, candidateSubject] = candidate.meta.split("\0");
  return candidateEmail === email && (candidateTime === time || candidateSubject === subject);
}

/**
 * Classifies a branch tip move by comparing the branch's own commits before and after.
 * `oldBase..oldTip` and `newBase..newTip` are the own ranges, so commits that belonged to a parent are never counted.
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
  const lost = withPatch.filter((entry) => entry.by === null).map((entry) => entry.commit.sha);

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
