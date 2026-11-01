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

function matchOwnCommits(oldOwn: readonly OwnCommit[], newOwn: readonly OwnCommit[]): MatchedCommit[] {
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
  return byPatch.map(({ commit, by }) => ({
    commit,
    by: by ?? (take((candidate) => candidate.meta === commit.meta) ? "meta" : null),
  }));
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
  const matched = matchOwnCommits(oldOwn, newOwn);
  const matchedByPatch = matched.filter((entry) => entry.by === "patch").length;
  const matchedByMeta = matched.filter((entry) => entry.by === "meta").length;
  const lost = matched.filter((entry) => entry.by === null).map((entry) => entry.commit.sha);

  // An unmatched tip is an amend only if some new commit is left over to stand in for it; otherwise it was dropped.
  const changed = matched.filter((entry) => entry.by !== "patch");
  const onlyTipChanged = changed.length === 1 && changed[0]?.commit === oldOwn.at(-1);
  const tipReplaced = changed[0]?.by === "meta" || newOwn.length > matchedByPatch + matchedByMeta;
  const amended = oldBase === newBase && onlyTipChanged && tipReplaced;
  const kind: ChangeKind = amended ? "amended" : lost.length === 0 ? "rebased" : "rewritten";

  return { ...tips, kind, lost: kind === "rewritten" ? lost : [], matchedByPatch, matchedByMeta };
}
