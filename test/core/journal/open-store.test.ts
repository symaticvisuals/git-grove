import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { JournalEntry } from "../../../src/core/journal/store.types.js";

const savedHome = process.env["GIT_GROVE_HOME"];
let parent: string;
let home: string;

beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  home = join(parent, "nested", "home");
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(parent, { recursive: true, force: true });
});

const rewrite: JournalEntry = {
  branch: "feat",
  oldTip: "a".repeat(40),
  newTip: "b".repeat(40),
  kind: "rewritten",
  lost: ["c".repeat(40)],
  matchedByPatch: 1,
  matchedByMeta: 2,
  pinRef: "refs/grove/pins/feat/20261101T120000Z",
  at: 1000,
  foundLater: false,
  acked: false,
};

test("openStore creates GIT_GROVE_HOME and a WAL database in it", () => {
  const store = openStore();
  try {
    store.repoId("/repos/one/.git", "/repos/one");
    expect(existsSync(join(home, "grove.db"))).toBe(true);
    expect(existsSync(join(home, "grove.db-wal"))).toBe(true);
  } finally {
    store.close();
  }
});

test("repoId is stable per common dir", () => {
  const store = openStore();
  try {
    const one = store.repoId("/repos/stable/.git", "/repos/stable");
    expect(store.repoId("/repos/stable/.git", "/repos/stable-moved")).toBe(one);
    expect(store.repoId("/repos/other/.git", "/repos/other")).not.toBe(one);
  } finally {
    store.close();
  }
});

test("record returns null for a change the journal already holds, and entries read it back", () => {
  const store = openStore();
  try {
    const repoId = store.repoId("/repos/record/.git", "/repos/record");
    const id = store.record(repoId, rewrite);
    expect(id).toEqual(expect.any(Number));
    expect(store.record(repoId, { ...rewrite, at: 2000, pinRef: "refs/grove/pins/feat/20261101T120000Z-2" })).toBeNull();
    expect(store.entries(repoId)).toEqual([{ ...rewrite, id }]);
  } finally {
    store.close();
  }
});

test("a deleted entry reads back with no new tip", () => {
  const store = openStore();
  try {
    const repoId = store.repoId("/repos/deleted/.git", "/repos/deleted");
    const deleted: JournalEntry = { ...rewrite, newTip: null, kind: "deleted", matchedByPatch: 0, matchedByMeta: 0 };
    const id = store.record(repoId, deleted);
    expect(store.entries(repoId, { unresolved: true })).toEqual([{ ...deleted, id }]);
  } finally {
    store.close();
  }
});
