import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Prepared } from "../../src/core/actions/action.types.js";
import type { Plan } from "../../src/core/actions/plan.types.js";
import { openStore } from "../../src/core/journal/open-store.js";
import type { Store } from "../../src/core/journal/store.types.js";
import { readSnapshot } from "../../src/core/snapshot/read-snapshot.js";
import { createRuns } from "../../src/server/actions/runs.js";
import type { Hub } from "../../src/server/live/hub.js";
import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import { createSnapshots } from "../../src/server/live/snapshots.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let home: string;
let store: Store;
let repo: TestRepo;
let repoId: number;
let events: ServerEvent[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-runs-"));
  store = openStore(join(home, "grove.db"));
  repo = await makeRepo();
  await repo.commit("base.txt", "base\n", "base");
  repoId = (await readSnapshot(repo.path, store, Date.now())).repoId;
  events = [];
});
afterEach(async () => {
  store.close();
  await rm(home, { recursive: true, force: true });
  await repo.cleanup();
});

function fakeHub(): Hub {
  return {
    scan: async () => undefined,
    publish: (event) => void events.push(event),
    subscribe: () => () => undefined,
    subscribers: () => 0,
    close: () => undefined,
  };
}

function checkOnly(): Prepared {
  const plan: Plan = {
    action: "ack",
    context: "test",
    title: "Check",
    summary: "",
    confirm: "Go",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [],
    commands: [],
    steps: [{ title: "Check nothing moved since you looked", detail: "" }],
    blockers: [],
    note: null,
    undoable: false,
    moves: [],
    expects: [],
    readAt: Date.now(),
  };
  return { plan, execute: async () => ({ ok: true, title: "Checked", lines: [], undo: null }) };
}

test("a run waits for the repository's refresh in flight before it starts", async () => {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const snapshots = createSnapshots(store, Date.now, async (cwd, st, at) => {
    await gate;
    return readSnapshot(cwd, st, at);
  });
  const reading = snapshots.refresh(repoId);
  const runs = createRuns({ hub: fakeHub(), store, snapshots, home });
  const runId = runs.start(repoId, repo.path, checkOnly());

  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(runs.get(runId)?.events).toEqual([]);
  open();
  await reading;
  await vi.waitFor(() => expect(runs.get(runId)?.receipt).toMatchObject({ ok: true, title: "Checked" }), { timeout: 10_000 });
  expect(events.map((event) => event.type)).toEqual(["step", "step", "activity", "receipt"]);
  await runs.close();
});

test("close waits for runs, and stopping turns true at once", async () => {
  const runs = createRuns({ hub: fakeHub(), store, snapshots: createSnapshots(store), home });
  const runId = runs.start(repoId, repo.path, checkOnly());
  expect(runs.stopping).toBe(false);
  const closing = runs.close();
  expect(runs.stopping).toBe(true);
  await closing;
  expect(runs.get(runId)?.receipt).toMatchObject({ ok: true });
});

test("close resolves true once the runs drained, and false when one is still going after the wait", async () => {
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const held: Prepared = { ...checkOnly(), execute: async () => (await gate, { ok: true, title: "Checked", lines: [], undo: null }) };
  const runs = createRuns({ hub: fakeHub(), store, snapshots: createSnapshots(store), home });
  const runId = runs.start(repoId, repo.path, held);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    expect(await runs.close({ timeoutMs: 200 })).toBe(false);
  } finally {
    stderr.mockRestore();
  }
  finish();
  await vi.waitFor(() => expect(runs.get(runId)?.receipt).toMatchObject({ ok: true }), { timeout: 10_000 });
  expect(await runs.close({ timeoutMs: 200 })).toBe(true);
});
