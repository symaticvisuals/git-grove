import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { openStore } from "../../src/core/journal/open-store.js";
import type { Store } from "../../src/core/journal/store.types.js";
import { readSnapshot } from "../../src/core/snapshot/read-snapshot.js";
import { createHub, type Hub } from "../../src/server/live/hub.js";
import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import { createSnapshots } from "../../src/server/live/snapshots.js";
import { squashedFixture, type SquashedFixture } from "../support/squashed-fixture.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const WAIT = { timeout: 8000 };

let dir: string;
let store: Store;
let fixture: SquashedFixture;
let repoId: number;
let hub: Hub;
let events: ServerEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "git-grove-hub-"));
  store = openStore(join(dir, "grove.db"));
  fixture = await squashedFixture();
  repoId = (await readSnapshot(fixture.repo.path, store, Date.now())).repoId;
  events = [];
});
afterEach(async () => {
  hub?.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
  await fixture.repo.cleanup();
});

function start(): void {
  hub = createHub({ snapshots: createSnapshots(store), store, debounceMs: 30, pollMs: 60_000 });
  hub.subscribe((event) => events.push(event));
}

function activityTitles(): string[] {
  return events.flatMap((event) => (event.type === "activity" ? [event.item.title] : []));
}

test("a squash publishes a digest and a \"History rewritten on feat/coupons-model\" activity", async () => {
  start();
  await hub.scan(repoId);
  const before = events.filter((event) => event.type === "digest").length;
  expect(before).toBe(1);
  await fixture.squash();
  await vi.waitFor(() => expect(activityTitles()).toContain("History rewritten on feat/coupons-model"), WAIT);
  expect(events.filter((event) => event.type === "digest").length).toBe(before + 1);
});

test("a scan waits while grove.lock exists and runs once it is removed", async () => {
  const lock = join(fixture.repo.path, ".git", "grove.lock");
  await writeFile(lock, `${process.pid}\n`);
  start();
  await hub.scan(repoId);
  expect(events).toEqual([]);
  await rm(lock);
  await vi.waitFor(() => expect(events.some((event) => event.type === "digest")).toBe(true), WAIT);
});

test("a worktree added outside grove becomes worktree-added activity", async () => {
  start();
  await hub.scan(repoId);
  await fixture.repo.worktree(join(fixture.repo.path, ".worktrees", "extra"), "fix/extra");
  await hub.scan(repoId);
  expect(activityTitles()).toContain("Worktree added at .worktrees/extra");
  expect(store.activity(repoId, 10).map((row) => row.kind)).toContain("worktree-added");
  await fixture.repo.git("worktree", "remove", join(fixture.repo.path, ".worktrees", "extra"));
  await hub.scan(repoId);
  expect(store.activity(repoId, 10).map((row) => row.kind)).toContain("worktree-removed");
});

test("a lock holding a dead pid does not block scans", async () => {
  const lock = join(fixture.repo.path, ".git", "grove.lock");
  await writeFile(lock, "2147483646\n");
  start();
  await vi.waitFor(() => expect(events.some((event) => event.type === "digest")).toBe(true), WAIT);
  expect(await readFile(lock, "utf8")).toBe("2147483646\n");
});

test("after startup, a worktree added outside grove is reported without any client reading first", async () => {
  start();
  await vi.waitFor(() => expect(events.some((event) => event.type === "digest")).toBe(true), WAIT);
  await fixture.repo.worktree(join(fixture.repo.path, ".worktrees", "late"), "fix/late");
  await vi.waitFor(() => expect(activityTitles()).toContain("Worktree added at .worktrees/late"), WAIT);
});

test("a deleted repo folder publishes one scan-error and keeps the project listed", async () => {
  await rm(fixture.repo.path, { recursive: true, force: true });
  start();
  await hub.scan(repoId);
  await hub.scan(repoId);
  const errors = events.flatMap((event) => (event.type === "activity" && event.item.kind === "scan-error" ? [event.item] : []));
  expect(errors).toHaveLength(1);
  expect(errors[0]?.severity).toBe("needs-action");
  expect(store.activity(repoId, 10).filter((row) => row.kind === "scan-error")).toHaveLength(1);
  expect(store.repos().map((repo) => repo.id)).toContain(repoId);
});

test("a store that throws during a background scan is not an unhandled rejection", async () => {
  const real = createSnapshots(store);
  let calls = 0;
  const snapshots = {
    ...real,
    repos() {
      calls += 1;
      if (calls > 1) throw new Error("store unavailable");
      return real.repos();
    },
  };
  const unhandled: unknown[] = [];
  const note = (reason: unknown): void => void unhandled.push(reason);
  process.on("unhandledRejection", note);
  try {
    hub = createHub({ snapshots, store, debounceMs: 30, pollMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toBeGreaterThan(1);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", note);
  }
});

test("close ends every subscriber's stream and stops publishing", async () => {
  start();
  let ended = 0;
  hub.subscribe(() => undefined, () => void (ended += 1));
  hub.close();
  expect(ended).toBe(1);
  expect(hub.subscribers()).toBe(0);
  await hub.scan(repoId);
  expect(events).toEqual([]);
});
