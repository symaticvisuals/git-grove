import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { observe } from "../../src/core/journal/observe.js";
import { openStore } from "../../src/core/journal/open-store.js";
import type { JournalEntry, Store } from "../../src/core/journal/store.types.js";
import { readSnapshot, type Snapshot } from "../../src/core/snapshot/read-snapshot.js";
import { createSnapshots } from "../../src/server/live/snapshots.js";
import { squashedFixture, type SquashedFixture } from "../support/squashed-fixture.js";

let home: string;
let store: Store;
let fixture: SquashedFixture;
let clock: number;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-snapshots-"));
  store = openStore(join(home, "grove.db"));
  fixture = await squashedFixture();
  clock = 1_000_000;
});
afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
  await fixture.repo.cleanup();
});

test("every refresh calls the listeners with the entries newer than the cursor, however it was triggered", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  const snapshots = createSnapshots(store, () => clock);
  const seen: number[] = [];
  const stop = snapshots.onRefresh((_snapshot, delivered) => seen.push(delivered.length));
  await fixture.squash();
  clock += 5000;
  expect((await snapshots.get(repoId)).added).toHaveLength(1);
  expect(seen).toEqual([1]);
  clock += 5000;
  await snapshots.refresh(repoId);
  expect(seen).toEqual([1, 0]);
  stop();
  clock += 5000;
  await snapshots.refresh(repoId);
  expect(seen).toHaveLength(2);
});

test("a scan that fails after observe does not lose its entries: the next good refresh delivers them", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  let failNext = false;
  const snapshots = createSnapshots(store, () => clock, async (cwd, st, at) => {
    if (!failNext) return readSnapshot(cwd, st, at);
    failNext = false;
    await observe(cwd, st, at);
    throw new Error("later step failed");
  });
  await snapshots.refresh(repoId);
  const delivered: JournalEntry[][] = [];
  snapshots.onRefresh((_snapshot, entries) => delivered.push(entries));
  await fixture.squash();
  failNext = true;
  await expect(snapshots.refresh(repoId)).rejects.toThrow("later step failed");
  expect(delivered).toEqual([]);
  const good = await snapshots.refresh(repoId);
  expect(good.added).toEqual([]);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toHaveLength(1);
  expect(delivered[0]?.[0]).toMatchObject({ branch: "feat/coupons-model", kind: "rewritten" });
});

test("an entry journaled by a separate status run is delivered once", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  const snapshots = createSnapshots(store, () => clock);
  await snapshots.refresh(repoId);
  const delivered: JournalEntry[][] = [];
  snapshots.onRefresh((_snapshot, entries) => delivered.push(entries));
  await fixture.squash();
  await readSnapshot(fixture.repo.path, store, clock);
  await snapshots.refresh(repoId);
  await snapshots.refresh(repoId);
  expect(delivered.map((entries) => entries.length)).toEqual([1, 0]);
});

test("a forced refresh waits for the read in progress and runs one more", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  let release: () => void = () => undefined;
  let reads = 0;
  let blocked = false;
  const snapshots = createSnapshots(store, () => clock, async (cwd, st, at) => {
    reads += 1;
    const snapshot = await readSnapshot(cwd, st, at);
    if (reads === 1) {
      blocked = true;
      await new Promise<void>((resolve) => (release = resolve));
    }
    return snapshot;
  });
  const running = snapshots.refresh(repoId);
  while (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
  await fixture.squash();
  const forced = snapshots.refresh(repoId, { force: true });
  const again = snapshots.refresh(repoId, { force: true });
  release();
  const first = await running;
  const last = await forced;
  expect(await again).toBe(last);
  expect(reads).toBe(2);
  expect(first.added).toEqual([]);
  expect(last.added).toHaveLength(1);
});

test("quick gets reuse the cache, and a stale cache starts one background refresh", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  let reads = 0;
  const snapshots = createSnapshots(store, () => clock, (cwd, st, at) => {
    reads += 1;
    return readSnapshot(cwd, st, at);
  });
  const first = await snapshots.get(repoId);
  await Promise.all(Array.from({ length: 10 }, () => snapshots.get(repoId)));
  expect(reads).toBe(1);
  clock += 3000;
  const stale = await Promise.all(Array.from({ length: 10 }, () => snapshots.get(repoId)));
  expect(stale.every((snapshot) => snapshot === first)).toBe(true);
  await snapshots.refresh(repoId);
  expect(reads).toBe(2);
});

test("a failed scan is remembered for 5 s", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  let reads = 0;
  const snapshots = createSnapshots(store, () => clock, (cwd, st, at) => {
    reads += 1;
    return readSnapshot(cwd, st, at);
  });
  await fixture.repo.cleanup();
  await expect(snapshots.get(repoId)).rejects.toThrow();
  await expect(snapshots.get(repoId)).rejects.toThrow();
  expect(reads).toBe(1);
  clock += 6000;
  await expect(snapshots.get(repoId)).rejects.toThrow();
  expect(reads).toBe(2);
});

test("get reuses a snapshot under 2 s old, and overlapping refreshes share one read", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  const snapshots = createSnapshots(store, () => clock);
  const first = await snapshots.get(repoId);
  clock += 1500;
  expect(await snapshots.get(repoId)).toBe(first);
  clock += 1000;
  const [one, two] = await Promise.all([snapshots.refresh(repoId), snapshots.refresh(repoId)]);
  expect(one).toBe(two);
  expect(one).not.toBe(first);
  expect(snapshots.cached(repoId)).toBe(one);
});

test("a failed refresh records the error and rethrows; an unknown repository throws", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  const snapshots = createSnapshots(store, () => clock);
  await fixture.repo.cleanup();
  await expect(snapshots.refresh(repoId)).rejects.toThrow();
  expect(snapshots.error(repoId)).toEqual(expect.any(String));
  await expect(snapshots.get(999)).rejects.toThrow("unknown repository");
});
