import type { BranchFacts, RepoFacts, Sha } from "../facts/facts.types.js";
import { readRepoFacts } from "../facts/read-repo-facts.js";
import { runGit } from "../git/run-git.js";
import { pin } from "../runner/pin.js";
import { classifyTipChange, type TipChange } from "./classify-tip-change.js";
import type { JournalEntry, LastTip, Store } from "./store.types.js";

type Move = { root: string; branch: BranchFacts; last: LastTip; parentTip: Sha; isTrunk: boolean; now: number };

function entryOf(change: TipChange, pinRef: string | null, at: number): JournalEntry {
  return { ...change, pinRef, at, foundLater: false, acked: false };
}

/** Resolves to the merge base, to `parentTip` when the two share no history, or null when either is not a commit. */
async function mergeBase(cwd: string, tip: Sha, parentTip: Sha): Promise<Sha | null> {
  const result = await runGit(["merge-base", tip, parentTip], { cwd, allowFailure: true });
  if (result.code === 0) return result.stdout.trim();
  return result.code === 1 ? parentTip : null;
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

async function journalMove(move: Move): Promise<JournalEntry | null> {
  const { root, branch, last, now } = move;
  const tips = { branch: branch.name, oldTip: last.sha, newTip: branch.tip };
  const ancestry = await runGit(["merge-base", "--is-ancestor", last.sha, branch.tip], { cwd: root, allowFailure: true });
  if (ancestry.code === 0) {
    return entryOf({ ...tips, kind: "advanced", lost: [], matchedByPatch: 0, matchedByMeta: 0 }, null, now);
  }
  if (ancestry.code !== 1) return null;
  const pinRef = await pin(root, branch.name, last.sha, new Date(now));
  const change = await classifyTipChange({ cwd: root, ...tips, ...(await basesOf(move)) });
  return entryOf(change, pinRef, now);
}

async function journalDeletion(root: string, branch: string, oldTip: Sha, now: number): Promise<JournalEntry | null> {
  const unique = await runGit(
    ["rev-list", "--reverse", oldTip, "--not", "--branches", "--remotes", "--tags", "--glob=refs/grove"],
    { cwd: root, allowFailure: true },
  );
  const lost = unique.code === 0 ? unique.stdout.split("\n").filter((line) => line !== "") : [];
  if (lost.length === 0) return null;
  const pinRef = await pin(root, branch, oldTip, new Date(now));
  return entryOf(
    { branch, oldTip, newTip: null, kind: "deleted", lost, matchedByPatch: 0, matchedByMeta: 0 },
    pinRef,
    now,
  );
}

/**
 * Journals every local branch whose tip moved or vanished since the last call and resolves to the entries it added.
 * A branch seen for the first time only records its tip. A non-fast-forward move pins the old tip before classifying;
 * a vanished branch whose tip nothing else reaches is pinned and journaled as `deleted`.
 * An old tip git no longer has is replaced without an entry.
 * Concurrent calls on separate connections journal each change once.
 */
export async function observe(cwd: string, store: Store, now: number = Date.now()): Promise<JournalEntry[]> {
  const facts = await readRepoFacts(cwd);
  const { root } = facts;
  const repoId = store.repoId(facts.commonDir, root);
  const lastTips = store.lastTips(repoId);
  const present = new Set(facts.branches.map((branch) => branch.name));
  const parentTips = stackParentTips(facts);
  const added: JournalEntry[] = [];
  const keep = (entry: JournalEntry | null): void => {
    if (entry === null) return;
    const id = store.record(repoId, entry);
    if (id !== null) added.push({ ...entry, id });
  };

  // Vanished branches go first, so pins taken for moved branches in this call never hide their commits.
  for (const [branch, last] of lastTips) {
    if (present.has(branch)) continue;
    keep(await journalDeletion(root, branch, last.sha, now));
    store.dropTip(repoId, branch);
  }

  for (const branch of facts.branches) {
    const last = lastTips.get(branch.name);
    if (last?.sha === branch.tip) continue;
    const parentTip = parentTips.get(branch.name) ?? facts.trunk.sha;
    if (last !== undefined) {
      const isTrunk = facts.trunk.ref === `refs/heads/${branch.name}`;
      keep(await journalMove({ root, branch, last, parentTip, isTrunk, now }));
    }
    store.saveTip(repoId, branch.name, branch.tip, parentTip, now);
  }

  return added;
}
