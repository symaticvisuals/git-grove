import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { openStore } from "../../src/core/journal/open-store.js";
import type { Store } from "../../src/core/journal/store.types.js";
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

test("every refresh calls the listeners with the entries it journaled, however it was triggered", async () => {
  const repoId = (await readSnapshot(fixture.repo.path, store, clock)).repoId;
  const snapshots = createSnapshots(store, () => clock);
  const seen: Snapshot[] = [];
  const stop = snapshots.onRefresh((snapshot) => seen.push(snapshot));
  await fixture.squash();
  clock += 5000;
  const viaGet = await snapshots.get(repoId);
  expect(viaGet.added).toHaveLength(1);
  expect(seen.map((snapshot) => snapshot.added.length)).toEqual([1]);
  clock += 5000;
  await snapshots.refresh(repoId);
  expect(seen.map((snapshot) => snapshot.added.length)).toEqual([1, 0]);
  stop();
  clock += 5000;
  await snapshots.refresh(repoId);
  expect(seen).toHaveLength(2);
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
