import type { BranchFacts, RepoFacts, Sha } from "../facts/facts.types.js";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { GitError } from "../git/git.error.js";
import { runGit, type RunGitResult } from "../git/run-git.js";
import { pin } from "../runner/pin.js";
import { classifyTipChange, type TipChange } from "./classify-tip-change.js";
import type { JournalEntry, LastTip, Store, TipSwap } from "./store.types.js";

type Move = {
  root: string;
  branch: BranchFacts;
  last: LastTip;
  parentTip: Sha;
  isTrunk: boolean;
  now: number;
  /** The ids of the rewrites journaled for this branch that moving it from `oldTip` to `newTip` exactly reverses. */
  undoesRewrite: (oldTip: Sha, newTip: Sha) => number[];
};

function entryOf(change: TipChange, pinRef: string | null, at: number): JournalEntry {
  return { ...change, pinRef, at, foundLater: false, acked: false };
}

async function commitExists(cwd: string, sha: Sha): Promise<boolean> {
  return (await runGit(["cat-file", "-e", `${sha}^{commit}`], { cwd, allowFailure: true })).code === 0;
}

/** Resolves when one of `shas` is no longer a commit; otherwise throws the failed call as a GitError. */
async function throwUnlessGone(cwd: string, args: string[], result: RunGitResult, shas: Sha[]): Promise<void> {
  for (const sha of shas) if (!(await commitExists(cwd, sha))) return;
  throw new GitError(args, result.code, result.stderr);
}

async function isAncestor(cwd: string, ancestor: Sha, descendant: Sha): Promise<boolean> {
  const args = ["merge-base", "--is-ancestor", ancestor, descendant];
  const result = await runGit(args, { cwd, allowFailure: true });
  if (result.code > 1) throw new GitError(args, result.code, result.stderr);
  return result.code === 0;
}

/** Resolves to the merge base, to `parentTip` when the two share no history, or null when either is not a commit. */
async function mergeBase(cwd: string, tip: Sha, parentTip: Sha): Promise<Sha | null> {
  const args = ["merge-base", tip, parentTip];
  const result = await runGit(args, { cwd, allowFailure: true });
  if (result.code === 0) return result.stdout.trim();
  if (result.code === 1) return parentTip;
  await throwUnlessGone(cwd, args, result, [tip, parentTip]);
  return null;
}

async function unlessGitFails(work: Promise<TipSwap>): Promise<TipSwap | null> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

async function savedTips(cwd: string, store: Store): Promise<Map<string, LastTip>> {
  const probe = await runGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    allowFailure: true,
  }).catch(() => null);
  const repoId = probe?.code === 0 ? store.findRepoId(probe.stdout.trim()) : null;
  return repoId === null ? new Map() : store.lastTips(repoId);
}

function stackParentTips(facts: RepoFacts): Map<string, Sha> {
  const tips = new Map(facts.branches.map((branch) => [branch.name, branch.tip]));
  const parentTips = new Map<string, Sha>();
  for (const edge of facts.edges) {
    const tip = tips.get(edge.parent);
    if (tip !== undefined) parentTips.set(edge.branch, tip);
  }
  return parentTips;
}

async function basesOf({ root, branch, last, parentTip, isTrunk }: Move): Promise<{ oldBase: Sha; newBase: Sha }> {
  // The trunk is its own parent, so its own commits are the ones the old and new tips do not share.
  if (isTrunk) {
    const fork = (await mergeBase(root, last.sha, branch.tip)) ?? branch.tip;
    return { oldBase: fork, newBase: fork };
  }
  const oldBase =
    (await mergeBase(root, last.sha, last.parentSha)) ?? (await mergeBase(root, last.sha, parentTip)) ?? parentTip;
  const newBase = (await mergeBase(root, branch.tip, parentTip)) ?? parentTip;
  return { oldBase, newBase };
}

async function journalMove(move: Move): Promise<TipSwap> {
  const { root, branch, last, parentTip, now } = move;
  // A parent tip outside the branch's history would put the next old base below the parent's own commits.
  const parentSha = (await isAncestor(root, parentTip, branch.tip)) ? parentTip : last.parentSha;
  const swap = (entry: JournalEntry | null, acks: number[] = []): TipSwap => ({
    ref: branch.name,
    from: last.sha,
    to: { sha: branch.tip, parentSha },
    at: now,
    entry,
    acks,
  });
  const tips = { branch: branch.name, oldTip: last.sha, newTip: branch.tip };
  const args = ["merge-base", "--is-ancestor", last.sha, branch.tip];
  const ancestry = await runGit(args, { cwd: root, allowFailure: true });
  if (ancestry.code === 0) {
    return swap(entryOf({ ...tips, kind: "advanced", lost: [], matchedByPatch: 0, matchedByMeta: 0 }, null, now));
  }
  if (ancestry.code > 1) {
    await throwUnlessGone(root, args, ancestry, [last.sha]);
    return swap(null);
  }
  const pinRef = await pin(root, branch.name, last.sha, new Date(now));
  const change = await classifyTipChange({ cwd: root, ...tips, ...(await basesOf(move)) });
  const undone = move.undoesRewrite(last.sha, branch.tip);
  return swap({ ...entryOf(change, pinRef, now), acked: undone.length > 0 }, undone);
}

async function journalDeletion(root: string, branch: string, oldTip: Sha, now: number): Promise<TipSwap> {
  const swap = (entry: JournalEntry | null): TipSwap => ({ ref: branch, from: oldTip, to: null, at: now, entry });
  const args = ["rev-list", "--reverse", oldTip, "--not", "--branches", "--remotes", "--tags", "--glob=refs/grove"];
  const unique = await runGit(args, { cwd: root, allowFailure: true });
  if (unique.code !== 0) {
    await throwUnlessGone(root, args, unique, [oldTip]);
    return swap(null);
  }
  const lost = unique.stdout.split("\n").filter((line) => line !== "");
  if (lost.length === 0) return swap(null);
  const pinRef = await pin(root, branch, oldTip, new Date(now));
  return swap(
    entryOf({ branch, oldTip, newTip: null, kind: "deleted", lost, matchedByPatch: 0, matchedByMeta: 0 }, pinRef, now),
  );
}

/**
 * Journals every local branch whose tip moved or vanished since the last call and resolves to the entries it added.
 * A branch seen for the first time only records its tip. A non-fast-forward move pins the old tip before classifying,
 * and is journaled already acked, acking that entry too, when it exactly reverses a `rewritten` entry of the same
 * branch (new tip back to that entry's old tip, from its new tip) that was journaled before this move. A change the journal already holds is recorded
 * again from this sighting, so an acked rewrite that happens again alerts again. A vanished branch whose tip nothing
 * else reaches is pinned and journaled as `deleted`.
 * An old tip git no longer has is replaced without an entry; a branch git fails on keeps its tip until the next call.
 * Each tip is saved by compare-and-swap with its entry, so concurrent calls journal a change once and never roll back.
 */
export async function observe(cwd: string, store: Store, now: number = Date.now()): Promise<JournalEntry[]> {
  // Saved tips are read before git's, so a tip saved meanwhile by another call fails the swap instead of being undone.
  const lastTips = await savedTips(cwd, store);
  const facts = await readRepoFacts(cwd);
  const { root } = facts;
  const repoId = store.repoId(facts.commonDir, root);
  const present = new Set(facts.branches.map((branch) => branch.name));
  const parentTips = stackParentTips(facts);
  let journal: JournalEntry[] | null = null;
  // A move the journal already holds is that change happening again, never an undo of the entry that undid it.
  const undoesRewrite = (branch: string, oldTip: Sha, newTip: Sha): number[] => {
    journal ??= store.entries(repoId);
    const ofBranch = journal.filter((entry) => entry.branch === branch && entry.id !== undefined);
    const again = ofBranch.find((entry) => entry.oldTip === oldTip && entry.newTip === newTip)?.id;
    return ofBranch
      .filter((entry) => entry.kind === "rewritten" && entry.newTip === oldTip && entry.oldTip === newTip)
      .flatMap((entry) => (entry.id === undefined || (again !== undefined && again < entry.id) ? [] : [entry.id]));
  };
  const added: JournalEntry[] = [];
  const commit = (swap: TipSwap | null): void => {
    if (swap === null) return;
    const { entryId } = store.swapTip(repoId, swap);
    if (swap.entry !== null && entryId !== null) added.push({ ...swap.entry, id: entryId });
  };

  // Vanished branches go first, so pins taken for moved branches in this call never hide their commits.
  for (const [branch, last] of lastTips) {
    if (!present.has(branch)) commit(await unlessGitFails(journalDeletion(root, branch, last.sha, now)));
  }

  for (const branch of facts.branches) {
    const last = lastTips.get(branch.name);
    if (last?.sha === branch.tip) continue;
    const parentTip = parentTips.get(branch.name) ?? facts.trunk.sha;
    if (last === undefined) {
      commit({ ref: branch.name, from: null, to: { sha: branch.tip, parentSha: parentTip }, at: now, entry: null });
    } else {
      const isTrunk = facts.trunk.ref === `refs/heads/${branch.name}`;
      const undoes = (oldTip: Sha, newTip: Sha): number[] => undoesRewrite(branch.name, oldTip, newTip);
      commit(await unlessGitFails(journalMove({ root, branch, last, parentTip, isTrunk, now, undoesRewrite: undoes })));
    }
  }

  return added;
}
