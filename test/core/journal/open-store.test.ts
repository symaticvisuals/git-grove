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

test("record of a change the journal already holds updates that entry from the new event", () => {
  const store = openStore();
  try {
    const repoId = store.repoId("/repos/record/.git", "/repos/record");
    const id = store.record(repoId, rewrite);
    expect(id).toEqual(expect.any(Number));
    expect(store.entries(repoId)).toEqual([{ ...rewrite, id }]);
    store.ack(repoId, id, 1500);
    const again = { ...rewrite, at: 2000, pinRef: "refs/grove/pins/feat/20261101T120000Z-2", lost: ["d".repeat(40)] };
    expect(store.record(repoId, again)).toBe(id);
    expect(store.entries(repoId)).toEqual([{ ...again, id }]);
    expect(store.record(repoId, { ...again, at: 3000, acked: true })).toBe(id);
    expect(store.entries(repoId, { unresolved: true })).toEqual([]);
  } finally {
    store.close();
  }
});

test("swapTip acks the entries it names in the same transaction", () => {
  const store = openStore();
  try {
    const repoId = store.repoId("/repos/swap-ack/.git", "/repos/swap-ack");
    const original = store.record(repoId, rewrite);
    const tip = (sha: string) => ({ sha, parentSha: "c".repeat(40) });
    store.swapTip(repoId, { ref: "feat", from: null, to: tip("b".repeat(40)), at: 1, entry: null });
    const undo: JournalEntry = { ...rewrite, oldTip: "b".repeat(40), newTip: "a".repeat(40), at: 2000, acked: true };
    store.swapTip(repoId, { ref: "feat", from: "b".repeat(40), to: tip("a".repeat(40)), at: 2000, entry: undo, acks: [original] });
    expect(store.entries(repoId, { unresolved: true })).toEqual([]);
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

test("swapTip moves a tip only from the expected sha, and records its entry only when it does", () => {
  const store = openStore();
  try {
    const repoId = store.repoId("/repos/swap/.git", "/repos/swap");
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const c = "c".repeat(40);
    const tip = (sha: string) => ({ sha, parentSha: c });
    expect(store.swapTip(repoId, { ref: "feat", from: null, to: tip(a), at: 1, entry: null })).toEqual({
      swapped: true,
      entryId: null,
    });
    expect(store.swapTip(repoId, { ref: "feat", from: null, to: tip(b), at: 2, entry: null }).swapped).toBe(false);
    expect(store.swapTip(repoId, { ref: "feat", from: b, to: tip(c), at: 3, entry: rewrite })).toEqual({
      swapped: false,
      entryId: null,
    });
    expect(store.entries(repoId)).toEqual([]);

    const moved = store.swapTip(repoId, { ref: "feat", from: a, to: tip(b), at: 4, entry: rewrite });
    expect(moved).toEqual({ swapped: true, entryId: expect.any(Number) });
    expect(store.entries(repoId)).toEqual([{ ...rewrite, id: moved.entryId }]);
    expect(store.lastTips(repoId).get("feat")).toEqual(tip(b));

    expect(store.swapTip(repoId, { ref: "feat", from: b, to: null, at: 5, entry: null }).swapped).toBe(true);
    expect(store.lastTips(repoId).has("feat")).toBe(false);
  } finally {
    store.close();
  }
});

test("activity reads newest first, for one repository or all, and repos lists every repository", () => {
  const store = openStore();
  try {
    const one = store.repoId("/repos/activity-one/.git", "/repos/activity-one");
    const two = store.repoId("/repos/activity-two/.git", "/repos/activity-two");
    const item = { kind: "action", branch: "feat", detail: "" } as const;
    const first = store.addActivity(one, { ...item, title: "first", at: 10 });
    store.addActivity(two, { ...item, kind: "scan-error", branch: null, title: "second", at: 20 });
    store.addActivity(one, { ...item, title: "third", at: 30 });

    expect(store.activity(one, 5).map((entry) => entry.title)).toEqual(["third", "first"]);
    expect(store.activity(null, 2).map((entry) => entry.title)).toEqual(["third", "second"]);
    expect(store.activity(one, 5).at(-1)).toEqual({ ...item, title: "first", at: 10, id: first, repoId: one });
    expect(store.activity(two, 1)[0]).toMatchObject({ kind: "scan-error", branch: null });
    expect(store.repos()).toEqual(
      expect.arrayContaining([
        { id: one, commonDir: "/repos/activity-one/.git", root: "/repos/activity-one" },
        { id: two, commonDir: "/repos/activity-two/.git", root: "/repos/activity-two" },
      ]),
    );
  } finally {
    store.close();
  }
});
