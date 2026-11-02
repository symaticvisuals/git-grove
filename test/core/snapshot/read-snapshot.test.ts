import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { readSnapshot } from "../../../src/core/snapshot/read-snapshot.js";
import { squashedFixture, type SquashedFixture } from "../../support/squashed-fixture.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let home: string;
let store: Store;
let fixture: SquashedFixture;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-snapshot-"));
  store = openStore(join(home, "grove.db"));
  fixture = await squashedFixture();
});
afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
  await fixture.repo.cleanup();
});

test("readSnapshot returns what this call journaled in added", async () => {
  const first = await readSnapshot(fixture.repo.path, store, Date.now());
  expect(first.added).toEqual([]);
  await fixture.squash();
  const second = await readSnapshot(fixture.repo.path, store, Date.now());
  expect(second.added).toHaveLength(1);
  expect(second.added[0]).toMatchObject({ branch: "feat/coupons-model", kind: "rewritten" });
  expect(second.added[0]?.lost).toHaveLength(3);
  expect(second.findings.map((finding) => finding.rule)).toContain("history-rewritten");
  expect(second.journal).toHaveLength(1);
  const third = await readSnapshot(fixture.repo.path, store, Date.now());
  expect(third.added).toEqual([]);
  expect(third.repoId).toBe(second.repoId);
});
