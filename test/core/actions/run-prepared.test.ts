import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import type { ActionContext, Prepared } from "../../../src/core/actions/action.types.js";
import type { Plan, StepEvent } from "../../../src/core/actions/plan.types.js";
import { prepareAction } from "../../../src/core/actions/registry.js";
import { runPrepared } from "../../../src/core/actions/run-prepared.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { observe } from "../../../src/core/journal/observe.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { listPins } from "../../../src/core/runner/list-pins.js";
import { withRepoLock } from "../../../src/core/runner/with-repo-lock.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let store: Store;
let worktree: string;
let ctx: ActionContext;
let commonDir: string;
let repoId: number;
let pinRef: string;
let squashed: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

async function commitIn(folder: string, file: string, text: string, message: string): Promise<string> {
  await writeFile(join(folder, file), text);
  await repo.git("-C", folder, "add", file);
  await repo.git("-C", folder, "commit", "-m", message);
  return tip("feat");
}

async function tip(branch: string): Promise<string> {
  return (await repo.git("rev-parse", `refs/heads/${branch}`)).trim();
}

beforeEach(async () => {
  repo = await makeRepo();
  store = openStore();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("base.txt", "base\n", "base");
  worktree = join(repo.path, ".worktrees", "feat");
  await repo.worktree(worktree, "feat");
  await commitIn(worktree, "a.txt", "a\n", "add a");
  await commitIn(worktree, "b.txt", "b\n", "add b");
  await commitIn(worktree, "c.txt", "c\n", "add c");
  await observe(repo.path, store);
  await repo.git("-C", worktree, "reset", "--soft", "main");
  await repo.git("-C", worktree, "commit", "-m", "squashed");
  squashed = await tip("feat");
  await observe(repo.path, store);

  const facts = await readRepoFacts(repo.path);
  commonDir = facts.commonDir;
  repoId = store.repoId(facts.commonDir, facts.root);
  pinRef = store.entries(repoId, { unresolved: true })[0]?.pinRef ?? "";
  ctx = { root: facts.root, store, now: () => Date.now() };
});
afterEach(async () => {
  store.close();
  await repo.cleanup();
});

const restoreFeat = { targets: [{ branch: "feat" }] };

function ignore(): void {}

const CHECK_STEP = "Check nothing moved since you looked";

function stubPlan(steps: string[]): Plan {
  return {
    action: "restore",
    context: "test",
    title: "Stub",
    summary: "",
    confirm: "Go",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [],
    commands: [],
    steps: [CHECK_STEP, ...steps].map((title) => ({ title, detail: "" })),
    blockers: [],
    note: null,
    undoable: false,
    moves: [],
    expects: [],
    readAt: Date.now(),
  };
}

test("restore plan shows the 3 commits coming back and the exact command", async () => {
  const { plan } = await prepareAction("restore", ctx, restoreFeat);
  expect(plan.after?.commits.filter((commit) => !commit.base)).toHaveLength(3);
  expect(plan.commands[0]).toBe(`git grove restore feat ${pinRef}`);
  expect(plan.blockers).toEqual([]);
  expect(plan.moves).toEqual(["feat"]);
  expect(plan.confirm).toBe("Bring back 3 commits");
});

test("running it brings the commits back, pins the squash and offers it as undo", async () => {
  const receipt = await runPrepared(ctx, await prepareAction("restore", ctx, restoreFeat), ignore);
  expect(receipt.ok).toBe(true);
  expect((await repo.git("rev-list", "--count", "main..feat")).trim()).toBe("3");
  expect((await repo.git("rev-parse", receipt.undo?.[0]?.pinRef ?? "missing")).trim()).toBe(squashed);
  expect(store.entries(repoId, { unresolved: true })).toEqual([]);
});

test("a branch that moves after the plan is refused and nothing changes", async () => {
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  const pins = (await listPins(repo.path)).length;
  const late = await commitIn(worktree, "late.txt", "late\n", "late");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked" });
  expect(receipt.lines[0]).toMatch(/^feat moved/);
  expect(await tip("feat")).toBe(late);
  expect(await listPins(repo.path)).toHaveLength(pins);
});

test("a deleted branch is restored at its pin, with nothing to pin and nothing to undo", async () => {
  await repo.git("worktree", "remove", worktree);
  await repo.git("branch", "-D", "feat");
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  expect(prepared.plan.moves).toEqual([]);
  expect(prepared.plan.expects).toContainEqual({ kind: "tip", branch: "feat", sha: null });
  expect(prepared.plan.steps.map((step) => step.title)).not.toContain("Pin the current tip");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: true, undo: null, pins: [] });
  expect(await tip("feat")).toBe((await repo.git("rev-parse", pinRef)).trim());
});

test("a deleted branch that comes back after the plan is refused", async () => {
  await repo.git("worktree", "remove", worktree);
  await repo.git("branch", "-D", "feat");
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  await repo.git("branch", "feat", "main");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ refused: true, title: "Changed since you looked", lines: ["feat now exists"] });
});

test("a file added in the worktree after the plan is refused", async () => {
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  await writeFile(join(worktree, "new.txt"), "new\n");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ refused: true, title: "Changed since you looked" });
  expect(receipt.lines).toContain("new.txt changed in .worktrees/feat");
  expect(await tip("feat")).toBe(squashed);
});

test("a run while the repo lock is held is refused", async () => {
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  const receipt = await withRepoLock(commonDir, () => runPrepared(ctx, prepared, ignore));
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Another grove action is running in this repo" });
  expect(await tip("feat")).toBe(squashed);
});

test("a plan with blockers runs nothing", async () => {
  await writeFile(join(worktree, "a.txt"), "edited\n");
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  expect(prepared.plan.blockers[0]).toContain("uncommitted changes");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Not run", lines: prepared.plan.blockers });
  expect(await tip("feat")).toBe(squashed);
});

test("step events go running then done for each step in order", async () => {
  const events: StepEvent[] = [];
  await runPrepared(ctx, await prepareAction("restore", ctx, restoreFeat), (event) => events.push(event));
  expect(events.map((event) => `${event.index} ${event.state}`)).toEqual([
    "0 running",
    "0 done",
    "1 running",
    "1 done",
    "2 running",
    "2 done",
    "3 running",
    "3 done",
  ]);
});

test("steps a stopped run never reached are reported skipped", async () => {
  const prepared: Prepared = {
    plan: stubPlan(["first", "second", "third"]),
    async execute(run) {
      await run.step(run.firstStep, async () => "did the first");
      return { ok: false, title: "Stopped early", lines: [], undo: null };
    },
  };
  const events: StepEvent[] = [];
  const receipt = await runPrepared(ctx, prepared, (event) => events.push(event));
  expect(receipt).toMatchObject({ ok: false, refused: false, title: "Stopped early" });
  expect(events.map((event) => `${event.index} ${event.state}`)).toEqual([
    "0 running",
    "0 done",
    "1 running",
    "1 done",
    "2 skipped",
    "3 skipped",
  ]);
});

test("a step that throws stops the run under that step's title", async () => {
  const prepared: Prepared = {
    plan: stubPlan(["first", "second"]),
    async execute(run) {
      await run.step(run.firstStep, async () => "did the first");
      await run.step(run.firstStep + 1, async () => {
        throw new Error("disk full");
      });
      return { ok: true, title: "Done", lines: [], undo: null };
    },
  };
  const events: StepEvent[] = [];
  const receipt = await runPrepared(ctx, prepared, (event) => events.push(event));
  expect(receipt).toMatchObject({ ok: false, refused: false, title: "Stopped: second", lines: ["disk full"] });
  expect(events.at(-1)).toMatchObject({ index: 2, state: "failed", detail: "disk full" });
});

test("every receipt is recorded as activity", async () => {
  const receipt = await runPrepared(ctx, await prepareAction("restore", ctx, restoreFeat), ignore);
  expect(store.activity(repoId, 1)[0]).toMatchObject({ kind: "action", title: receipt.title, repoId });
});

test("ack plan clears the branch's alerts and changes nothing in git", async () => {
  const refs = await repo.git("for-each-ref", "--format=%(refname) %(objectname)");
  const prepared = await prepareAction("ack", ctx, { branch: "feat" });
  expect(prepared.plan.undoable).toBe(false);
  expect(prepared.plan.commands).toEqual(["git grove ack feat"]);
  expect(prepared.plan.confirm).toBe("Keep the squash");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt.ok).toBe(true);
  expect(store.entries(repoId, { unresolved: true })).toEqual([]);
  expect(await repo.git("for-each-ref", "--format=%(refname) %(objectname)")).toBe(refs);
});

test("ack of a branch with no open alert is blocked", async () => {
  const { plan } = await prepareAction("ack", ctx, { branch: "main" });
  expect(plan.blockers).toEqual(["Nothing to acknowledge on main"]);
});

test("a malformed input is invalid", async () => {
  await expect(prepareAction("restore", ctx, { targets: [] })).rejects.toThrow("at least one");
  await expect(prepareAction("ack", ctx, { branch: 3 })).rejects.toThrow("branch");
});
