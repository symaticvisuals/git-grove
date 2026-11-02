import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Prepared } from "../../src/core/actions/action.types.js";
import type { Plan } from "../../src/core/actions/plan.types.js";
import { openStore } from "../../src/core/journal/open-store.js";
import { listPins } from "../../src/core/runner/list-pins.js";
import { withRepoLock } from "../../src/core/runner/with-repo-lock.js";
import { readSnapshot } from "../../src/core/snapshot/read-snapshot.js";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { serverRequest } from "../support/server-request.js";
import { squashedFixture, type SquashedFixture } from "../support/squashed-fixture.js";
import { type UiFixture, uiFixture } from "../support/ui-fixture.js";
import { lockBlocksScan } from "../../src/server/live/lock-blocks-scan.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const LEVEL1 = "feat/coupons-model";
const RESTORE = { targets: [{ branch: LEVEL1 }] };
const LOCKED = "Another grove action is running in this repo";
const WAIT = { timeout: 20_000, interval: 50 };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let ui: UiFixture;
let server: RunningServer;
let fixture: SquashedFixture;
let repoId: number;
let pinned: string;
const aborts: AbortController[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-actions-api-"));
  process.env["GIT_GROVE_HOME"] = home;
  ui = await uiFixture();
  fixture = await squashedFixture();
  server = await startServer({ port: 0, home, uiDir: ui.dir, version: "9.9.9", watch: { debounceMs: 30, pollMs: 60_000 } });
  repoId = (await readSnapshot(fixture.repo.path, server.context.store, Date.now())).repoId;
  await fixture.squash();
  await server.context.snapshots.refresh(repoId, { force: true });
  pinned = (await listPins(fixture.repo.path, LEVEL1))[0]?.sha ?? "";
});
afterEach(async () => {
  for (const abort of aborts.splice(0)) abort.abort();
  await server.close();
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
  await ui.cleanup();
  await fixture.repo.cleanup();
});

type Json = Record<string, unknown>;
type Reply = { status: number; body: unknown };

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Json {
  if (!isRecord(value)) throw new Error("expected an object");
  return value;
}

function list(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value.filter(isRecord);
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected a string");
  return value;
}

async function get(path: string): Promise<Reply> {
  const reply = await serverRequest(server.port, { path, headers: { "x-grove-token": server.token } });
  return { status: reply.status, body: JSON.parse(reply.body) };
}

async function post(path: string, body: unknown): Promise<Reply> {
  const reply = await serverRequest(server.port, {
    method: "POST",
    path,
    body: JSON.stringify(body),
    headers: { "x-grove-token": server.token, "content-type": "application/json", origin: `http://127.0.0.1:${server.port}` },
  });
  return { status: reply.status, body: JSON.parse(reply.body) };
}

async function preview(input: unknown = RESTORE): Promise<{ planId: string; plan: Json }> {
  const reply = await post("/api/plans", { repo: repoId, action: "restore", input });
  expect(reply.status).toBe(200);
  const body = record(reply.body);
  return { planId: text(body["planId"]), plan: record(body["plan"]) };
}

async function run(planId: string): Promise<string> {
  const reply = await post("/api/actions", { planId });
  expect(reply.status).toBe(202);
  return text(record(reply.body)["runId"]);
}

function receiptOf(runId: string): Promise<Json> {
  return vi.waitFor(async () => {
    const receipt = record((await get(`/api/runs/${runId}`)).body)["receipt"];
    if (!isRecord(receipt)) throw new Error("still running");
    return receipt;
  }, WAIT);
}

async function tip(branch: string): Promise<string> {
  return (await fixture.repo.git("rev-parse", `refs/heads/${branch}`)).trim();
}

async function allRefs(): Promise<string> {
  return fixture.repo.git("for-each-ref", "--format=%(refname) %(objectname)");
}

async function level1Path(): Promise<string> {
  const view = record((await get(`/api/repos/${repoId}/features`)).body);
  const levels = list(view["features"]).flatMap((feature) => list(feature["levels"]));
  return text(record(levels.find((level) => level["branch"] === LEVEL1)?.["worktree"])["path"]);
}

async function openStream(): Promise<{ until: (done: (text: string) => boolean) => Promise<string> }> {
  const abort = new AbortController();
  aborts.push(abort);
  const response = await fetch(`http://127.0.0.1:${server.port}/events`, { headers: { "x-grove-token": server.token }, signal: abort.signal });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let seen = "";
  return {
    async until(done) {
      while (!done(seen)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        seen += decoder.decode(chunk.value, { stream: true });
      }
      return seen;
    },
  };
}

function frames(stream: string): Json[] {
  return stream.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((line) => line.startsWith("data: "));
    if (data === undefined) return [];
    const parsed: unknown = JSON.parse(data.slice("data: ".length));
    return isRecord(parsed) ? [parsed] : [];
  });
}

function hasReceipt(runId: string): (stream: string) => boolean {
  const marker = `"type":"receipt","runId":"${runId}"`;
  return (stream) => stream.includes(marker) && stream.indexOf("\n\n", stream.indexOf(marker)) !== -1;
}

test("preview then run restores the squash; step events and the receipt arrive on /events", async () => {
  const stream = await openStream();
  await stream.until((seen) => seen.includes("event: hello"));
  const { planId, plan } = await preview();
  expect(planId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(plan).toMatchObject({ action: "restore", title: `Bring back 3 commits on ${LEVEL1}`, blockers: [] });

  const runId = await run(planId);
  const mine = frames(await stream.until(hasReceipt(runId))).filter((frame) => frame["runId"] === runId);
  const steps = mine.filter((frame) => frame["type"] === "step").map((frame) => record(frame["event"]));
  expect(steps.map((step) => [step["index"], step["state"]])).toEqual([
    [0, "running"],
    [0, "done"],
    [1, "running"],
    [1, "done"],
    [2, "running"],
    [2, "done"],
    [3, "running"],
    [3, "done"],
  ]);
  const last = mine.at(-1);
  expect(last?.["type"]).toBe("receipt");
  const receipt = record(last?.["receipt"]);
  expect(receipt).toMatchObject({ action: "restore", ok: true, refused: false, title: `Restored 3 commits on ${LEVEL1}` });
  expect(await tip(LEVEL1)).toBe(pinned);

  const state = record((await get(`/api/runs/${runId}`)).body);
  expect(record(state["plan"])["title"]).toBe(plan["title"]);
  expect(list(state["events"])).toEqual(steps);
  expect(state["receipt"]).toEqual(receipt);
});

test("a run's stored activity row is published live as an a: activity event before the receipt", async () => {
  const stream = await openStream();
  await stream.until((seen) => seen.includes("event: hello"));
  const runId = await run((await preview()).planId);
  const all = frames(await stream.until(hasReceipt(runId)));
  const receipt = record(all.find((frame) => frame["type"] === "receipt" && frame["runId"] === runId)?.["receipt"]);
  const published = all.filter((frame) => frame["type"] === "activity").map((frame) => record(frame["item"]));
  const action = published.filter((item) => item["kind"] === "action");
  expect(action).toHaveLength(1);
  expect(action[0]).toMatchObject({ repoId, kind: "action", branch: LEVEL1, title: receipt["title"], severity: "info", at: receipt["at"] });
  expect(text(action[0]?.["id"])).toMatch(/^a:\d+$/);
  const stored = list((await get(`/api/activity?repo=${repoId}`)).body).find((item) => item["kind"] === "action");
  expect(stored).toEqual(action[0]);
  const order = all.map((frame) => frame["type"]);
  expect(order.lastIndexOf("activity")).toBeLessThan(order.lastIndexOf("receipt"));
});

test("the same plan cannot run twice; an unknown plan is expired", async () => {
  const { planId } = await preview();
  const runId = await run(planId);
  expect(await post("/api/actions", { planId })).toEqual({ status: 409, body: { error: "This plan already ran" } });
  await receiptOf(runId);
  expect(await post("/api/actions", { planId })).toEqual({ status: 409, body: { error: "This plan already ran" } });
  expect(await post("/api/actions", { planId: "never-previewed" })).toEqual({
    status: 410,
    body: { error: "This preview expired; preview it again" },
  });
});

test("a branch moved after the preview refuses the run and git is unchanged", async () => {
  const { planId } = await preview();
  const before = await tip(LEVEL1);
  await writeFile(join(fixture.level1, "late.ts"), "late\n");
  await fixture.repo.git("-C", fixture.level1, "add", "late.ts");
  await fixture.repo.git("-C", fixture.level1, "commit", "-m", "late");
  const moved = await tip(LEVEL1);
  await server.context.snapshots.refresh(repoId, { force: true });
  const refs = await allRefs();

  const receipt = await receiptOf(await run(planId));
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked", pins: [] });
  expect(receipt["lines"]).toContain(`${LEVEL1} moved: was ${before.slice(0, 7)}, now ${moved.slice(0, 7)}`);
  expect(await allRefs()).toBe(refs);
});

test("with the CLI holding the repo lock, the dashboard run is refused", async () => {
  const { planId } = await preview();
  const refs = await allRefs();
  const receipt = await withRepoLock(join(fixture.repo.path, ".git"), async () => receiptOf(await run(planId)));
  expect(receipt).toMatchObject({ ok: false, refused: true, title: LOCKED });
  expect(await allRefs()).toBe(refs);
});

test("two tabs running the same preview at once move the branch once", async () => {
  const pinsBefore = (await listPins(fixture.repo.path, LEVEL1)).length;
  const [one, two] = await Promise.all([preview(), preview()]);
  const runIds = await Promise.all([run(one.planId), run(two.planId)]);
  const receipts = await Promise.all(runIds.map(receiptOf));
  expect(receipts.filter((receipt) => receipt["ok"] === true)).toHaveLength(1);
  const refused = receipts.find((receipt) => receipt["ok"] !== true);
  expect(refused?.["refused"]).toBe(true);
  expect([LOCKED, "Changed since you looked"]).toContain(refused?.["title"]);
  expect(await tip(LEVEL1)).toBe(pinned);
  expect(await listPins(fixture.repo.path, LEVEL1)).toHaveLength(pinsBefore + 1);
});

test("a lock left by a dead process is taken over", async () => {
  const lock = join(fixture.repo.path, ".git", "grove.lock");
  await writeFile(lock, "2147483646\n");
  const receipt = await receiptOf(await run((await preview()).planId));
  expect(receipt).toMatchObject({ ok: true, refused: false });
  expect(await tip(LEVEL1)).toBe(pinned);
  expect(existsSync(lock)).toBe(false);
});

test("invalid input is 400 with the reason; an unknown repo is 404; an unknown action is 400", async () => {
  const cases: [string, unknown, number, string][] = [
    ["/api/plans", { repo: repoId, action: "restore", input: { targets: [] } }, 400, "restore needs at least one target"],
    ["/api/plans", { repo: 999, action: "restore", input: RESTORE }, 404, "unknown repository"],
    ["/api/plans", { repo: repoId, action: "explode", input: {} }, 400, "unknown action"],
    ["/api/plans", { repo: repoId, action: "toString", input: {} }, 400, "unknown action"],
    ["/api/plans", { action: "restore", input: RESTORE }, 400, "a preview takes { repo, action, input }"],
    ["/api/plans", { repo: "1", action: "restore", input: RESTORE }, 400, "a preview takes { repo, action, input }"],
    ["/api/plans", [], 400, "a preview takes { repo, action, input }"],
    ["/api/plans", { repo: repoId, action: "remove", input: { worktree: "/no/such/worktree" } }, 400, "/no/such/worktree is not a worktree of this repository"],
    ["/api/actions", { planId: 7 }, 400, "a run takes { planId }"],
    ["/api/actions", null, 400, "a run takes { planId }"],
    ["/api/scan", { repo: "1" }, 400, "a scan takes { repo? }"],
    ["/api/scan", { repo: 999 }, 404, "unknown repository"],
    ["/api/open", { repo: repoId, path: fixture.level1, app: "browser" }, 400, 'open takes { repo, path, app: "editor" | "terminal" }'],
    ["/api/open", { repo: 999, path: fixture.level1, app: "editor" }, 404, "unknown repository"],
  ];
  for (const [path, body, status, error] of cases) {
    expect(await post(path, body), `${path} ${JSON.stringify(body)}`).toEqual({ status, body: { error } });
  }
  expect(await get("/api/runs/nope")).toEqual({ status: 404, body: { error: "unknown run" } });
});

test("an error a person can act on while preparing is 409 with its one line, not a bare 500", async () => {
  const outside = await mkdtemp(join(tmpdir(), "git-grove-not-a-repo-"));
  const snapshot = await server.context.snapshots.get(repoId);
  const get = vi.spyOn(server.context.snapshots, "get").mockResolvedValue({ ...snapshot, facts: { ...snapshot.facts, root: outside } });
  try {
    expect(await post("/api/plans", { repo: repoId, action: "restore", input: RESTORE })).toEqual({
      status: 409,
      body: { error: `not inside a git repository (${outside})` },
    });
  } finally {
    get.mockRestore();
    await rm(outside, { recursive: true, force: true });
  }
});

test("the action routes need the token, a same-origin request and a JSON body", async () => {
  const body = JSON.stringify({ repo: repoId, action: "restore", input: RESTORE });
  const send = (headers: Record<string, string>): Promise<number> =>
    serverRequest(server.port, { method: "POST", path: "/api/plans", body, headers }).then((reply) => reply.status);
  const json = { "content-type": "application/json" };
  expect(await send(json)).toBe(401);
  expect(await send({ ...json, "x-grove-token": server.token, origin: "http://localhost:1" })).toBe(403);
  expect(await send({ ...json, "x-grove-token": server.token, "sec-fetch-site": "same-site" })).toBe(403);
  expect(await send({ "content-type": "text/plain", "x-grove-token": server.token })).toBe(415);
  expect(await send({ ...json, "x-grove-token": server.token })).toBe(200);
});

test("a run's receipt is in /api/activity and a scan follows it", async () => {
  const receipt = await receiptOf(await run((await preview()).planId));
  const activity = list((await get(`/api/activity?repo=${repoId}`)).body);
  expect(activity.find((item) => item["kind"] === "action")).toMatchObject({ title: receipt["title"], branch: LEVEL1 });

  const snapshot = server.context.snapshots.cached(repoId);
  expect(snapshot?.readAt).toBeGreaterThanOrEqual(Number(receipt["at"]));
  expect(snapshot?.facts.branches.find((branch) => branch.name === LEVEL1)?.tip).toBe(pinned);
  const view = record((await get(`/api/repos/${repoId}/features`)).body);
  const level = list(view["features"])
    .flatMap((feature) => list(feature["levels"]))
    .find((candidate) => candidate["branch"] === LEVEL1);
  expect(level?.["state"]).not.toBe("History rewritten");
  expect(level?.["health"]).not.toBe("loses");
});

test("POST /api/scan is 202 and scans the named repository, or every one", async () => {
  const scan = vi.spyOn(server.context.hub, "scan");
  expect(await post("/api/scan", { repo: repoId })).toEqual({ status: 202, body: { ok: true } });
  expect(scan).toHaveBeenLastCalledWith(repoId);
  expect(await post("/api/scan", {})).toEqual({ status: 202, body: { ok: true } });
  expect(scan).toHaveBeenLastCalledWith(undefined);
});

test("open refuses a path that is not one of the repo's worktrees", async () => {
  const worktree = await level1Path();
  for (const path of [tmpdir(), join(worktree, ".."), join(worktree, "model.ts"), `${worktree}/`, ".worktrees/single", ""]) {
    const reply = await post("/api/open", { repo: repoId, path, app: "editor" });
    expect(reply.status, path).toBe(400);
  }
});

test("open starts the configured command with the worktree as its last argument; a launch error is 500 with its message", async () => {
  const worktree = await level1Path();
  const marker = join(home, "opened.txt");
  const script = "require('node:fs').writeFileSync(process.argv[1], process.argv[2])";
  await writeFile(join(home, "config.json"), JSON.stringify({ editor: [process.execPath, "-e", script, marker], terminal: "git-grove-no-such-terminal" }));
  expect(await post("/api/open", { repo: repoId, path: worktree, app: "editor" })).toEqual({ status: 200, body: { ok: true } });
  await vi.waitFor(async () => expect(await readFile(marker, "utf8")).toBe(worktree), WAIT);
  expect(await post("/api/open", { repo: repoId, path: worktree, app: "terminal" })).toEqual({
    status: 500,
    body: { error: "git-grove-no-such-terminal not found; set it in ~/.git-grove/config.json" },
  });
});

/** A prepared plan whose own step waits until `finish` is called. */
function gatedPlan(): { prepared: Prepared; finish: () => void } {
  let finish = (): void => undefined;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const plan: Plan = {
    action: "ack",
    context: "test",
    title: "Wait",
    summary: "",
    confirm: "Go",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [],
    commands: [],
    steps: [
      { title: "Check nothing moved since you looked", detail: "" },
      { title: "Wait for the gate", detail: "" },
    ],
    blockers: [],
    note: null,
    undoable: false,
    moves: [],
    expects: [],
    readAt: Date.now(),
  };
  const prepared: Prepared = {
    plan,
    async execute(runContext) {
      await runContext.step(runContext.firstStep, async () => {
        await gate;
        return "opened";
      });
      return { ok: true, title: "Waited for the gate", lines: [], undo: null };
    },
  };
  return { prepared, finish };
}

async function startGated(): Promise<{ root: string; prepared: Prepared; finish: () => void }> {
  const { prepared, finish } = gatedPlan();
  const root = server.context.snapshots.cached(repoId)?.facts.root ?? fixture.repo.path;
  const runId = server.context.runs.start(repoId, root, prepared);
  await vi.waitFor(() => expect(server.context.runs.get(runId)?.events).toContainEqual(expect.objectContaining({ index: 1, state: "running" })), WAIT);
  return { root, prepared, finish };
}

test("closing the server waits for the run in progress, which still records its receipt", async () => {
  const { root, prepared, finish } = await startGated();
  let closed = false;
  const closing = server.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(closed).toBe(false);
  expect(() => server.context.runs.start(repoId, root, prepared)).toThrow("git grove is stopping");
  finish();
  await closing;

  const store = openStore(join(home, "grove.db"));
  try {
    expect(store.activity(repoId, 5).map((row) => row.title)).toContain("Waited for the gate");
  } finally {
    store.close();
  }
});

test("a run asked for while the server stops is 503 and does not use up its plan", async () => {
  const { planId } = await preview();
  const { finish } = await startGated();
  const closing = server.close();
  await vi.waitFor(() => expect(server.context.runs.stopping).toBe(true), WAIT);
  const stopping = { status: 503, body: { error: "git grove is stopping" } };
  expect(await post("/api/actions", { planId })).toEqual(stopping);
  expect(await post("/api/actions", { planId })).toEqual(stopping);
  expect(server.context.plans.peek(planId)).not.toBe("taken");
  finish();
  await closing;
});

test("close stops waiting after its timeout when a git hook holds a run, and says so", async () => {
  const marker = join(home, "hook-may-finish");
  const hook = join(fixture.repo.path, ".git", "hooks", "reference-transaction");
  await mkdir(join(hook, ".."), { recursive: true });
  await writeFile(hook, `#!/bin/sh\ni=0\nwhile [ ! -e '${marker}' ] && [ $i -lt 400 ]; do sleep 0.05; i=$((i + 1)); done\n`);
  await chmod(hook, 0o755);
  const stderr = vi.spyOn(process.stderr, "write");
  try {
    const runId = await run((await preview()).planId);
    await vi.waitFor(() => expect(server.context.runs.get(runId)?.events).toContainEqual(expect.objectContaining({ index: 1, state: "running" })), WAIT);
    const started = Date.now();
    await server.context.runs.close({ timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(stderr.mock.calls.map(([chunk]) => String(chunk))).toContain("git-grove: stopping with 1 run(s) still in progress\n");
    await writeFile(marker, "");
    expect(await receiptOf(runId)).toMatchObject({ ok: true });
  } finally {
    await writeFile(marker, "");
    stderr.mockRestore();
    await rm(hook, { force: true });
  }
});

test("a run still going when close stops waiting keeps the store open and records its receipt", async () => {
  await server.close();
  server = await startServer({ port: 0, home, uiDir: ui.dir, version: "9.9.9", watch: { debounceMs: 30, pollMs: 60_000 }, closeWaitMs: 300 });
  await server.context.snapshots.refresh(repoId, { force: true });
  const marker = join(home, "hook-may-finish");
  const hook = join(fixture.repo.path, ".git", "hooks", "reference-transaction");
  await mkdir(join(hook, ".."), { recursive: true });
  await writeFile(hook, `#!/bin/sh\ni=0\nwhile [ ! -e '${marker}' ] && [ $i -lt 400 ]; do sleep 0.05; i=$((i + 1)); done\n`);
  await chmod(hook, 0o755);
  const stderr = vi.spyOn(process.stderr, "write");
  const { store, runs } = server.context;
  try {
    const runId = await run((await preview()).planId);
    await vi.waitFor(() => expect(runs.get(runId)?.events).toContainEqual(expect.objectContaining({ index: 1, state: "running" })), WAIT);
    await server.close();
    expect(() => store.repos()).not.toThrow();
    await writeFile(marker, "");
    const receipt = await vi.waitFor(() => {
      const done = runs.get(runId)?.receipt;
      if (done === null || done === undefined) throw new Error("still running");
      return done;
    }, WAIT);
    expect(receipt).toMatchObject({ ok: true });
    expect(receipt.lines).not.toContain("This action was not recorded in Activity");
    expect(store.activity(repoId, 1)[0]).toMatchObject({ kind: "action", title: receipt.title });
  } finally {
    await writeFile(marker, "");
    stderr.mockRestore();
    await rm(hook, { force: true });
    store.close();
  }
});

test("a lock from before the last boot naming pid 1 neither holds back scans nor refuses a run", async () => {
  const lock = join(fixture.repo.path, ".git", "grove.lock");
  await writeFile(lock, "1\n");
  const old = new Date("2025-01-01T00:00:00Z");
  await utimes(lock, old, old);
  expect(await lockBlocksScan(lock)).toBe(false);
  const before = server.context.snapshots.cached(repoId)?.readAt ?? 0;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await server.context.hub.scan(repoId);
  expect(server.context.snapshots.cached(repoId)?.readAt).toBeGreaterThan(before);

  const receipt = await receiptOf(await run((await preview()).planId));
  expect(receipt).toMatchObject({ ok: true, refused: false });
  expect(await tip(LEVEL1)).toBe(pinned);
  expect(existsSync(lock)).toBe(false);
});

test("new with open reads the editor from the server's home, not the default one", async () => {
  const elsewhere = await mkdtemp(join(tmpdir(), "git-grove-other-home-"));
  const script = "require('node:fs').writeFileSync(process.argv[1], process.argv[2])";
  const right = join(home, "opened.txt");
  const wrong = join(elsewhere, "opened.txt");
  await writeFile(join(home, "config.json"), JSON.stringify({ editor: [process.execPath, "-e", script, right] }));
  await writeFile(join(elsewhere, "config.json"), JSON.stringify({ editor: [process.execPath, "-e", script, wrong] }));
  process.env["GIT_GROVE_HOME"] = elsewhere;
  try {
    const reply = await post("/api/plans", { repo: repoId, action: "new", input: { feature: "gift cards", env: false, open: true } });
    expect(reply.status).toBe(200);
    const receipt = await receiptOf(await run(text(record(reply.body)["planId"])));
    expect(receipt).toMatchObject({ ok: true });
    await vi.waitFor(async () => expect(await readFile(right, "utf8")).toContain(join(".worktrees", "gift-cards")), WAIT);
    expect(existsSync(wrong)).toBe(false);
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});
