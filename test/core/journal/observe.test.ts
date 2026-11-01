import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { observe } from "../../../src/core/journal/observe.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { JournalEntry, Store } from "../../../src/core/journal/store.types.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const MISSING_SHA = "1234567890abcdef1234567890abcdef12345678";
const IDENTITY = { GIT_COMMITTER_NAME: "Test Author", GIT_COMMITTER_EMAIL: "author@example.com" };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let store: Store;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});
beforeEach(async () => {
  repo = await makeRepo();
  await repo.git("config", "stack.trunk", "main");
  store = openStore();
});
afterEach(async () => {
  store.close();
  await repo.cleanup();
});

const sha = async (ref: string): Promise<string> => (await repo.git("rev-parse", ref)).trim();

const repoIdOf = async (): Promise<number> => {
  const facts = await readRepoFacts(repo.path);
  return store.repoId(facts.commonDir, facts.root);
};

const groveRefs = async (): Promise<string> => (await repo.git("for-each-ref", "--format=%(refname)", "refs/grove")).trim();

/** Commits a base on main and forks `feat` with three commits, leaving `feat` checked out. */
async function forkFeature(): Promise<{ fork: string; commits: [string, string, string] }> {
  const fork = await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat");
  await repo.switch("feat");
  const a = await repo.commit("a.txt", "a\n", "add a");
  const b = await repo.commit("b.txt", "b\n", "add b");
  const c = await repo.commit("c.txt", "c\n", "add c");
  return { fork, commits: [a, b, c] };
}

/** Commits a base on main, `parent` with p1 and p2, and `child` on it with k1 and k2, recorded as a stack; ends on main. */
async function forkStack(): Promise<{ p1: string; p2: string }> {
  await repo.commit("base.txt", "base\n", "base");
  await repo.branch("parent");
  await repo.switch("parent");
  const p1 = await repo.commit("p1.txt", "p1\n", "add p1");
  const p2 = await repo.commit("p2.txt", "p2\n", "add p2");
  await repo.branch("child");
  await repo.switch("child");
  await repo.commit("k1.txt", "k1\n", "add k1");
  await repo.commit("k2.txt", "k2\n", "add k2");
  await repo.git("config", "branch.parent.stackparent", "main");
  await repo.git("config", "branch.child.stackparent", "parent");
  await repo.switch("main");
  return { p1, p2 };
}

async function squash(fork: string): Promise<void> {
  await repo.git("reset", "--soft", fork);
  await repo.git("commit", "-m", "squashed");
}

test("a squash after the baseline is one rewritten entry with three commits lost and a pin at the old tip", async () => {
  const { fork, commits } = await forkFeature();
  expect(await observe(repo.path, store, NOW)).toEqual([]);
  await squash(fork);

  const found = await observe(repo.path, store, NOW + 1000);
  expect(found).toHaveLength(1);
  const [entry] = found;
  expect(entry).toMatchObject({
    branch: "feat",
    oldTip: commits[2],
    newTip: await sha("feat"),
    kind: "rewritten",
    lost: commits,
    at: NOW + 1000,
    foundLater: false,
    acked: false,
  });
  expect(entry?.lost).toHaveLength(3);
  expect(entry?.pinRef).toMatch(/^refs\/grove\/pins\/feat\//);
  expect(await sha(entry?.pinRef ?? "")).toBe(commits[2]);
  expect(store.entries(await repoIdOf())).toEqual(found);
});

test("resetting a squashed branch back to its old tip is journaled acked and pinned", async () => {
  const { fork, commits } = await forkFeature();
  await observe(repo.path, store, NOW);
  await squash(fork);
  const squashed = await sha("feat");
  await observe(repo.path, store, NOW + 1000);
  await repo.git("reset", "--hard", commits[2]);

  const found = await observe(repo.path, store, NOW + 2000);
  expect(found).toMatchObject([{ branch: "feat", oldTip: squashed, newTip: commits[2], acked: true }]);
  expect(await sha(found[0]?.pinRef ?? "")).toBe(squashed);
  expect(store.entries(await repoIdOf(), { unresolved: true })).toEqual([]);
  expect(store.entries(await repoIdOf()).find((entry) => entry.newTip === squashed)).toMatchObject({ acked: true });
});

test("the same rewrite seen again after it was acked opens its entry again", async () => {
  const { fork, commits } = await forkFeature();
  await observe(repo.path, store, NOW);
  await squash(fork);
  const squashed = await sha("feat");
  const [entry] = await observe(repo.path, store, NOW + 1000);
  const repoId = await repoIdOf();
  store.ack(repoId, entry?.id ?? -1, NOW + 1500);
  await repo.git("reset", "--hard", commits[2]);
  await observe(repo.path, store, NOW + 2000);
  await repo.git("reset", "--hard", squashed);

  const found = await observe(repo.path, store, NOW + 3000);
  expect(found).toMatchObject([{ id: entry?.id, oldTip: commits[2], newTip: squashed, kind: "rewritten", at: NOW + 3000, acked: false }]);
  expect(store.entries(repoId, { unresolved: true })).toMatchObject([{ id: entry?.id }]);
});

test("resetting back after a commit on top of the squash is an unacked rewrite", async () => {
  const { fork, commits } = await forkFeature();
  await observe(repo.path, store, NOW);
  await squash(fork);
  await observe(repo.path, store, NOW + 1000);
  const extra = await repo.commit("d.txt", "d\n", "add d");
  await observe(repo.path, store, NOW + 2000);
  await repo.git("reset", "--hard", commits[2]);

  const found = await observe(repo.path, store, NOW + 3000);
  expect(found).toMatchObject([{ branch: "feat", oldTip: extra, newTip: commits[2], kind: "rewritten", acked: false }]);
  expect(found[0]?.lost).toContain(extra);
});

test("an amend is amended and not unresolved", async () => {
  const { commits } = await forkFeature();
  await observe(repo.path, store, NOW);
  await writeFile(join(repo.path, "c.txt"), "c, amended\n");
  await repo.git("add", "c.txt");
  await repo.git("commit", "--amend", "--no-edit");

  const found = await observe(repo.path, store, NOW + 1000);
  expect(found).toMatchObject([{ branch: "feat", oldTip: commits[2], kind: "amended", lost: [] }]);
  expect(found[0]?.pinRef).not.toBeNull();
  expect(store.entries(await repoIdOf(), { unresolved: true })).toEqual([]);
});

test("two observers on separate connections journal one squash once", async () => {
  const { fork } = await forkFeature();
  await observe(repo.path, store, NOW);
  await squash(fork);

  const other = openStore();
  try {
    const [first, second] = await Promise.all([observe(repo.path, store, NOW + 1000), observe(repo.path, other, NOW + 1000)]);
    expect([...first, ...second]).toHaveLength(1);
    const repoId = await repoIdOf();
    expect(store.entries(repoId)).toHaveLength(1);
    expect(other.entries(repoId)).toHaveLength(1);
  } finally {
    other.close();
  }
});

test("a deleted branch with two unique commits is a deleted entry with a pin", async () => {
  await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat");
  await repo.switch("feat");
  const a = await repo.commit("a.txt", "a\n", "add a");
  const b = await repo.commit("b.txt", "b\n", "add b");
  await repo.switch("main");
  await observe(repo.path, store, NOW);
  await repo.git("branch", "-D", "feat");

  const found = await observe(repo.path, store, NOW + 1000);
  expect(found).toMatchObject([{ branch: "feat", oldTip: b, newTip: null, kind: "deleted", lost: [a, b] }]);
  expect(await sha(found[0]?.pinRef ?? "")).toBe(b);
  const repoId = await repoIdOf();
  expect(store.entries(repoId, { unresolved: true })).toEqual(found);
  expect(store.lastTips(repoId).has("feat")).toBe(false);
});

test("ack removes an entry from the unresolved list", async () => {
  const { fork } = await forkFeature();
  await observe(repo.path, store, NOW);
  await squash(fork);
  const [entry] = await observe(repo.path, store, NOW + 1000);
  const repoId = await repoIdOf();
  expect(store.entries(repoId, { unresolved: true })).toHaveLength(1);

  store.ack(repoId, entry?.id ?? -1, NOW + 2000);
  expect(store.entries(repoId, { unresolved: true })).toEqual([]);
  expect(store.entries(repoId)).toMatchObject([{ id: entry?.id, kind: "rewritten", acked: true }]);
});

test("a fast-forward is an advanced entry with no pin", async () => {
  const { commits } = await forkFeature();
  await observe(repo.path, store, NOW);
  const tip = await repo.commit("d.txt", "d\n", "add d");

  expect(await observe(repo.path, store, NOW + 1000)).toMatchObject([
    { branch: "feat", oldTip: commits[2], newTip: tip, kind: "advanced", lost: [], pinRef: null },
  ]);
  expect(await groveRefs()).toBe("");
});

test("a deleted branch with nothing unique records nothing and forgets its tip", async () => {
  await forkFeature();
  await repo.switch("main");
  await repo.git("merge", "--ff-only", "feat");
  await observe(repo.path, store, NOW);
  await repo.git("branch", "-d", "feat");

  expect(await observe(repo.path, store, NOW + 1000)).toEqual([]);
  expect(store.lastTips(await repoIdOf()).has("feat")).toBe(false);
  expect(await groveRefs()).toBe("");
});

test("a child restacked onto trunk after its parent was squash-merged and deleted is rebased", async () => {
  const { p1, p2 } = await forkStack();
  await observe(repo.path, store, NOW);

  await repo.git("merge", "--squash", "parent");
  await repo.git("commit", "-m", "parent, squashed");
  await repo.git("branch", "-D", "parent");
  await repo.git("rebase", "--onto", "main", p2, "child");

  const found = await observe(repo.path, store, NOW + 1000);
  expect(found.find((entry) => entry.branch === "child")).toMatchObject({ kind: "rebased", lost: [] });
  expect(found.find((entry) => entry.branch === "parent")).toMatchObject({ kind: "deleted", lost: [p1, p2] });
});

test("dropping commits from a local trunk is rewritten", async () => {
  const base = await repo.commit("base.txt", "base\n", "base");
  const m1 = await repo.commit("m1.txt", "m1\n", "add m1");
  const m2 = await repo.commit("m2.txt", "m2\n", "add m2");
  await observe(repo.path, store, NOW);
  await repo.git("reset", "--hard", base);

  expect(await observe(repo.path, store, NOW + 1000)).toMatchObject([
    { branch: "main", oldTip: m2, newTip: base, kind: "rewritten", lost: [m1, m2] },
  ]);
});

test("a last tip git no longer has is replaced without an entry", async () => {
  const { fork, commits } = await forkFeature();
  await observe(repo.path, store, NOW);
  const repoId = await repoIdOf();
  store.saveTip(repoId, "feat", MISSING_SHA, fork, NOW);

  expect(await observe(repo.path, store, NOW + 1000)).toEqual([]);
  expect(store.lastTips(repoId).get("feat")?.sha).toBe(commits[2]);
  expect(await groveRefs()).toBe("");
});

test("a last parent tip git no longer has falls back to the current parent", async () => {
  const { fork, commits } = await forkFeature();
  await observe(repo.path, store, NOW);
  store.saveTip(await repoIdOf(), "feat", commits[2], MISSING_SHA, NOW);
  await squash(fork);

  expect(await observe(repo.path, store, NOW + 1000)).toMatchObject([{ branch: "feat", kind: "rewritten", lost: commits }]);
});

test("a child that gained a commit while its parent was amended, then was restacked onto it, is rebased", async () => {
  const { p2 } = await forkStack();
  await observe(repo.path, store, NOW);
  await repo.switch("parent");
  await writeFile(join(repo.path, "p2.txt"), "p2, review fix\n");
  await repo.git("add", "p2.txt");
  await repo.git("commit", "--amend", "--no-edit");
  await observe(repo.path, store, NOW + 1000);
  await repo.switch("child");
  await repo.commit("k3.txt", "k3\n", "add k3");
  await observe(repo.path, store, NOW + 2000);
  await repo.git("rebase", "--onto", "parent", p2, "child");

  expect(await observe(repo.path, store, NOW + 3000)).toMatchObject([{ branch: "child", kind: "rebased", lost: [] }]);
  expect(store.entries(await repoIdOf(), { unresolved: true })).toEqual([]);
});

/**
 * Moves `feat` on from the baseline, then observes while another connection moves it further and saves that tip,
 * just before or just after the observer reads its saved tips.
 */
async function observeRacingSave(saveBeforeRead: boolean): Promise<{ found: JournalEntry[]; newer: string; repoId: number }> {
  const { fork } = await forkFeature();
  await observe(repo.path, store, NOW);
  const moved = await repo.commit("d.txt", "d\n", "add d");
  const newer = await repo.commit("e.txt", "e\n", "add e");
  await repo.git("reset", "--hard", moved);
  const repoId = await repoIdOf();
  const other = openStore();
  const saveNewer = (id: number): void => {
    execFileSync("git", ["update-ref", "refs/heads/feat", newer], { cwd: repo.path, env: { ...process.env, ...IDENTITY } });
    other.saveTip(id, "feat", newer, fork, NOW + 500);
  };
  const racing: Store = {
    ...store,
    lastTips(id) {
      if (saveBeforeRead) saveNewer(id);
      const tips = store.lastTips(id);
      if (!saveBeforeRead) saveNewer(id);
      return tips;
    },
  };
  try {
    return { found: await observe(repo.path, racing, NOW + 1000), newer, repoId };
  } finally {
    other.close();
  }
}

test.each([
  { when: "after", saveBeforeRead: false },
  { when: "before", saveBeforeRead: true },
])("a tip another connection saves $when the observer reads its tips is neither journaled again nor rolled back", async ({
  saveBeforeRead,
}) => {
  const { found, newer, repoId } = await observeRacingSave(saveBeforeRead);
  expect(found).toEqual([]);
  expect(store.entries(repoId)).toEqual([]);
  expect(store.lastTips(repoId).get("feat")?.sha).toBe(newer);
});

test("a deletion check git cannot run keeps the tip, and the deletion is journaled once it can", async () => {
  await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat");
  await repo.switch("feat");
  const a = await repo.commit("a.txt", "a\n", "add a");
  const b = await repo.commit("b.txt", "b\n", "add b");
  await repo.switch("main");
  await observe(repo.path, store, NOW);
  const stale = join(repo.path, ".git", "refs", "remotes", "origin", "stale");
  await mkdir(dirname(stale), { recursive: true });
  await writeFile(stale, `${MISSING_SHA}\n`);
  await repo.git("branch", "-D", "feat");
  await repo.commit("m.txt", "m\n", "add m");

  expect(await observe(repo.path, store, NOW + 1000)).toMatchObject([{ branch: "main", kind: "advanced" }]);
  const repoId = await repoIdOf();
  expect(store.lastTips(repoId).get("feat")?.sha).toBe(b);

  await rm(stale);
  const found = await observe(repo.path, store, NOW + 2000);
  expect(found).toMatchObject([{ branch: "feat", oldTip: b, newTip: null, kind: "deleted", lost: [a, b] }]);
  expect(await sha(found[0]?.pinRef ?? "")).toBe(b);
});
