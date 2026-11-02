import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../../src/core/journal/open-store.js";
import type { Store } from "../../src/core/journal/store.types.js";
import { readSnapshot } from "../../src/core/snapshot/read-snapshot.js";
import { digestOf } from "../../src/server/live/digest-of.js";
import { toProject } from "../../src/server/wire/to-project.js";
import { toRepoView } from "../../src/server/wire/to-repo-view.js";
import type { WireRepoView } from "../../src/server/wire/wire.types.js";
import { squashedFixture, type SquashedFixture } from "../support/squashed-fixture.js";

let fixture: SquashedFixture;
let store: Store;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "git-grove-digest-"));
  store = openStore(join(dir, "grove.db"));
  fixture = await squashedFixture();
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
  await fixture.repo.cleanup();
});

async function view(now: number): Promise<WireRepoView> {
  const snapshot = await readSnapshot(fixture.repo.path, store, now);
  const repo = store.repos()[0];
  if (repo === undefined) throw new Error("no repo");
  return toRepoView(toProject(repo, snapshot, snapshot.facts.pins.length, null), snapshot, snapshot.facts.pins.length);
}

test("digestOf ignores scannedAt and changes when a finding appears", async () => {
  const first = await view(Date.now());
  const second = await view(Date.now() + 60_000);
  expect(first.project.scannedAt).not.toBe(second.project.scannedAt);
  expect(digestOf(first)).toBe(digestOf(second));
  await fixture.squash();
  const third = await view(Date.now() + 120_000);
  expect(third.findings.length).toBeGreaterThan(first.findings.length);
  expect(digestOf(third)).not.toBe(digestOf(first));
});
