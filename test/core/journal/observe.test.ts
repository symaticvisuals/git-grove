import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { observe } from "../../../src/core/journal/observe.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const MISSING_SHA = "1234567890abcdef1234567890abcdef12345678";

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
