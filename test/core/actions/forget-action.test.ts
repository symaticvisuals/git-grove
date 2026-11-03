import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ActionContext } from "../../../src/core/actions/action.types.js";
import { InvalidInputError } from "../../../src/core/actions/invalid-input.error.js";
import type { Plan, Receipt, StepEvent } from "../../../src/core/actions/plan.types.js";
import { prepareAction } from "../../../src/core/actions/registry.js";
import { runPrepared } from "../../../src/core/actions/run-prepared.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let root: string;
let store: Store;
let ctx: ActionContext;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

beforeEach(async () => {
  repo = await makeRepo();
  root = await realpath(repo.path);
  store = openStore();
  await repo.commit("base.txt", "base\n", "base");
  ctx = { root, store, now: () => Date.now() };
});
afterEach(async () => {
  store.close();
  await repo.cleanup();
});

async function prepare(raw: unknown): Promise<Plan> {
  return (await prepareAction("forget", ctx, raw)).plan;
}

async function run(raw: unknown, between: () => Promise<void> = async () => undefined): Promise<{ plan: Plan; receipt: Receipt; events: StepEvent[] }> {
  const prepared = await prepareAction("forget", ctx, raw);
  await between();
  const events: StepEvent[] = [];
  const receipt = await runPrepared(ctx, prepared, (event) => events.push(event));
  return { plan: prepared.plan, receipt, events };
}

async function worktreeList(): Promise<string> {
  return repo.git("worktree", "list", "--porcelain");
}

async function hasBranch(name: string): Promise<boolean> {
  return (await repo.git("for-each-ref", "--format=%(refname)", `refs/heads/${name}`)).trim() !== "";
}

async function branchGone(name: string): Promise<string> {
  const path = join(root, ".worktrees", name);
  await repo.worktree(path, name);
  await rm(path, { recursive: true, force: true });
  return path;
}

async function detach(name: string, commits: number): Promise<{ path: string; head: string }> {
  const path = join(root, ".worktrees", name);
  await repo.git("worktree", "add", "--detach", path);
  let head = (await repo.git("-C", path, "rev-parse", "HEAD")).trim();
  for (let i = 0; i < commits; i++) {
    await write(join(path, `e${i}.txt`), "x\n");
    await repo.git("-C", path, "add", `e${i}.txt`);
    await repo.git("-C", path, "commit", "-m", `experiment ${i}`);
    head = (await repo.git("-C", path, "rev-parse", "HEAD")).trim();
  }
  await rm(path, { recursive: true, force: true });
  return { path, head };
}

test("forgetting a gone folder drops git's record and keeps the branch", async () => {
  const path = await branchGone("gone");
  const { plan, receipt } = await run({ worktree: path });
  expect(plan.title).toBe("Forget gone");
  expect(plan.confirm).toBe("Forget");
  expect(plan.blockers).toEqual([]);
  expect(plan.commands).toEqual([expect.stringMatching(/^git worktree remove /)]);
  expect(plan.commands[0]).not.toContain("--force");
  expect(plan.checks.map((check) => check.ok)).toEqual([true, true]);
  expect(receipt).toMatchObject({ ok: true, title: "Forgot gone" });
  expect(await worktreeList()).not.toContain(path);
  expect(await hasBranch("gone")).toBe(true);
});

test("a folder that is still there, the main worktree and a locked one are refused", async () => {
  const live = join(root, ".worktrees", "live");
  await repo.worktree(live, "live");
  const stillThere = await prepare({ worktree: live });
  expect(stillThere.blockers).toEqual(["its folder is still there; clean it up instead"]);
  expect(stillThere.commands).toEqual([]);
  expect(stillThere.title).toBe("Forget live");
  expect((await run({ worktree: live })).receipt.refused).toBe(true);
  expect(existsSync(live)).toBe(true);
  expect(await worktreeList()).toContain(live);

  expect((await prepare({ worktree: root })).blockers).toEqual(["the main worktree is never forgotten"]);

  await repo.git("worktree", "lock", live);
  expect((await prepare({ worktree: live })).blockers).toEqual(["locked; unlock it with git worktree unlock first"]);
  expect(existsSync(live)).toBe(true);
});

test("commits only on a detached HEAD block unless the dashboard confirmed Force forget", async () => {
  const { path, head } = await detach("sandbox", 2);
  const blocked = await prepare({ worktree: path });
  expect(blocked.blockers).toEqual([`2 commits only on its detached HEAD would be lost. To keep them, run git branch rescue/sandbox ${head} first.`]);
  expect(blocked.commands).toEqual([]);
  expect((await run({ worktree: path })).receipt.refused).toBe(true);
  expect(await worktreeList()).toContain(path);

  const plan = await prepare({ worktree: path, force: true });
  expect(plan.confirm).toBe("Force forget");
  expect(plan.blockers).toEqual([]);
  expect(plan.checks[0]).toMatchObject({ ok: false, text: "2 commits only on its detached HEAD", why: "Forgetting makes them unreachable" });
  expect(plan.note).toContain(`git branch rescue/sandbox ${head}`);
  expect(plan.commands[0]).not.toContain("--force");
  const { receipt } = await run({ worktree: path, force: true });
  expect(receipt.ok).toBe(true);
  expect(await worktreeList()).not.toContain(path);
  expect((await repo.git("branch", "--contains", head)).trim()).toBe("");
  expect(await repo.git("rev-list", "--all")).not.toContain(head);
});

test("force on a gone folder that has a branch is an ordinary forget", async () => {
  const path = await branchGone("gone");
  const plan = await prepare({ worktree: path, force: true });
  expect(plan.confirm).toBe("Forget");
  expect(plan.blockers).toEqual([]);
  expect(plan.checks[0]?.ok).toBe(true);
});

test("forgetting every gone worktree skips one whose detached HEAD still holds commits", async () => {
  const safe = await branchGone("gone");
  const { path: stranded } = await detach("sandbox", 1);
  const plan = await prepare({ all: true });
  expect(plan.blockers).toEqual([]);
  expect(plan.context).toBe("Gone worktrees");
  expect(plan.note).toContain("1 gone worktree still holds commits only its detached HEAD has; forget it on its own");
  expect(plan.commands.some((command) => command.includes("--force"))).toBe(false);
  expect(plan.commands.some((command) => command.includes("sandbox"))).toBe(false);
  const { receipt } = await run({ all: true });
  expect(receipt.ok).toBe(true);
  expect(await hasBranch("gone")).toBe(true);
  expect(await worktreeList()).not.toContain(safe);
  expect(await worktreeList()).toContain(stranded);
});

test("forgetting every gone worktree says when there is nothing safe to forget", async () => {
  expect((await prepare({ all: true })).blockers).toEqual(["No gone worktree to forget"]);
  await detach("sandbox", 1);
  expect((await prepare({ all: true })).blockers).toEqual(["1 gone worktree still holds commits only its detached HEAD has; forget it on its own"]);
});

test("a gone worktree whose commits could not be counted is refused, force included", async () => {
  const { path } = await detach("sandbox", 1);
  await writeFile(join(repo.path, ".git", "worktrees", "sandbox", "HEAD"), "1234567890abcdef1234567890abcdef12345678\n");
  expect((await prepare({ worktree: path, force: true })).blockers).toEqual(["could not check the commits only its detached HEAD holds"]);
  expect((await prepare({ all: true })).blockers).toEqual(["1 gone worktree could not be checked"]);
});

test("a worktree forgotten between the plan and the run is already forgotten", async () => {
  const path = await branchGone("gone");
  const { receipt } = await run({ worktree: path }, () => repo.git("worktree", "remove", path).then(() => undefined));
  expect(receipt).toMatchObject({ ok: true, title: "Already forgotten" });
  expect(await readFile(join(root, ".git", "worktrees", "gone", "HEAD"), "utf8").catch(() => "")).toBe("");
});

test("forget rejects input that is not one worktree or every safe gone worktree", async () => {
  await expect(prepareAction("forget", ctx, {})).rejects.toBeInstanceOf(InvalidInputError);
  await expect(prepareAction("forget", ctx, { all: true, worktree: "/w" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(prepareAction("forget", ctx, { worktree: "/w", force: "yes" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(prepareAction("forget", ctx, { all: true, force: true })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(prepareAction("forget", ctx, { all: false })).rejects.toBeInstanceOf(InvalidInputError);
});
