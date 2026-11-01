import { execFileSync } from "node:child_process";
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
  return (await repo.git("-C", folder, "rev-parse", "HEAD")).trim();
}

/** Points `refs/heads/<branch>` at `sha` synchronously, for stores and clocks that move a branch mid-run. */
function moveBranch(branch: string, sha: string): void {
  const env = { ...process.env, GIT_COMMITTER_NAME: "Racer", GIT_COMMITTER_EMAIL: "racer@example.com" };
  execFileSync("git", ["update-ref", `refs/heads/${branch}`, sha], { cwd: repo.path, env });
}

/** Adds `side` in its own worktree with 2 commits, squashed and observed, and returns its alert's pin and its tip. */
async function squashedSide(): Promise<{ pin: string; tip: string }> {
  const side = join(repo.path, ".worktrees", "side");
  await repo.worktree(side, "side", "main");
  await commitIn(side, "d.txt", "d\n", "add d");
  await commitIn(side, "e.txt", "e\n", "add e");
  await observe(repo.path, store);
  await repo.git("-C", side, "reset", "--soft", "main");
  const tipNow = await commitIn(side, "side.txt", "side\n", "side squashed");
  await observe(repo.path, store);
  const pin = store.entries(repoId, { unresolved: true }).find((entry) => entry.branch === "side")?.pinRef ?? "";
  return { pin, tip: tipNow };
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

test("a run while the repo lock is held is refused, naming the lock and how to clear it", async () => {
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  const receipt = await withRepoLock(commonDir, () => runPrepared(ctx, prepared, ignore));
  const lock = join(commonDir, "grove.lock");
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Another grove action is running in this repo" });
  expect(receipt.lines).toEqual([
    `${lock} is held. Wait for that action to finish, then try again.`,
    `If no grove action is running, remove ${lock} and try again.`,
  ]);
  expect(await tip("feat")).toBe(squashed);
});

test("a pin that moves after a two-branch plan refuses the restore before either branch moves", async () => {
  const side = await squashedSide();
  const prepared = await prepareAction("restore", ctx, { targets: [{ branch: "feat" }, { branch: "side" }] });
  expect(prepared.plan.blockers).toEqual([]);
  const pinned = (await repo.git("rev-parse", side.pin)).trim();
  await repo.git("update-ref", "-d", side.pin);

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked", undo: null });
  expect(receipt.lines).toEqual([`${side.pin} no longer points at ${pinned.slice(0, 7)}`]);
  expect(await tip("feat")).toBe(squashed);
  expect(await tip("side")).toBe(side.tip);
});

test("a target that fails after an earlier one moved stops, names what moved and offers it as undo", async () => {
  const side = await squashedSide();
  const main = await tip("main");
  const racing: Store = {
    ...store,
    saveTip(id, ref, sha, parentSha, at) {
      store.saveTip(id, ref, sha, parentSha, at);
      if (ref === "feat") moveBranch("side", main);
    },
  };
  const racingCtx = { ...ctx, store: racing };
  const prepared = await prepareAction("restore", racingCtx, { targets: [{ branch: "feat" }, { branch: "side" }] });

  const receipt = await runPrepared(racingCtx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: false, title: "Stopped: Move the branch back" });
  expect(receipt.lines[0]).toMatch(/^Moved feat from [0-9a-f]{7} to [0-9a-f]{7}$/);
  expect(receipt.lines.at(-1)).toBe(`side was not restored: side moved: was ${side.tip.slice(0, 7)}, now ${main.slice(0, 7)}`);
  expect(receipt.undo).toHaveLength(1);
  expect(receipt.undo?.[0]?.branch).toBe("feat");
  expect((await repo.git("rev-parse", receipt.undo?.[0]?.pinRef ?? "missing")).trim()).toBe(squashed);
  expect((await repo.git("rev-list", "--count", "main..feat")).trim()).toBe("3");
  expect(await tip("side")).toBe(main);
});

test("the check step stops when a branch is not at its pin after the move, still offering undo", async () => {
  const main = await tip("main");
  const racing: Store = {
    ...store,
    saveTip(id, ref, sha, parentSha, at) {
      store.saveTip(id, ref, sha, parentSha, at);
      if (ref === "feat") moveBranch("feat", main);
    },
  };
  const racingCtx = { ...ctx, store: racing };
  const prepared = await prepareAction("restore", racingCtx, restoreFeat);
  const original = (await repo.git("rev-parse", pinRef)).trim();

  const receipt = await runPrepared(racingCtx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: false, title: "Stopped: Check all 3 commits are back" });
  expect(receipt.lines.at(-1)).toBe(`feat is at ${main.slice(0, 7)}, not ${original.slice(0, 7)}`);
  expect(receipt.undo?.[0]?.branch).toBe("feat");
});

test("a branch that moves between the check and the move is refused and left where it is", async () => {
  const main = await tip("main");
  let calls = 0;
  const racingCtx: ActionContext = {
    ...ctx,
    now: () => {
      if (calls++ === 0) moveBranch("feat", main);
      return Date.now();
    },
  };
  const prepared = await prepareAction("restore", racingCtx, restoreFeat);

  const receipt = await runPrepared(racingCtx, prepared, ignore);
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked" });
  expect(receipt.lines).toEqual([`feat moved: was ${squashed.slice(0, 7)}, now ${main.slice(0, 7)}`]);
  expect(await tip("feat")).toBe(main);
});

test("a worktree that switches away from the branch at the same commit is refused", async () => {
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  await repo.git("-C", worktree, "switch", "-c", "other");

  const receipt = await runPrepared(ctx, prepared, ignore);
  expect(receipt).toMatchObject({ refused: true, title: "Changed since you looked" });
  expect(receipt.lines).toEqual([".worktrees/feat no longer has feat checked out"]);
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

test("every receipt is recorded as activity, including refused and blocked ones", async () => {
  const prepared = await prepareAction("restore", ctx, restoreFeat);
  const locked = await withRepoLock(commonDir, () => runPrepared(ctx, prepared, ignore));
  const done = await runPrepared(ctx, prepared, ignore);
  await writeFile(join(worktree, "a.txt"), "edited\n");
  const blocked = await runPrepared(ctx, await prepareAction("restore", ctx, restoreFeat), ignore);
  expect(blocked.title).toBe("Not run");
  expect(store.activity(repoId, 3)).toMatchObject([
    { kind: "action", branch: "feat", title: blocked.title, detail: blocked.lines.join("; "), repoId },
    { kind: "action", branch: "feat", title: done.title, repoId },
    { kind: "action", branch: "feat", title: locked.title, repoId },
  ]);
});

test("a receipt that cannot be recorded still comes back, saying so", async () => {
  const failing: Store = {
    ...store,
    addActivity() {
      throw new Error("database is locked");
    },
  };
  const failingCtx = { ...ctx, store: failing };
  const receipt = await runPrepared(failingCtx, await prepareAction("restore", failingCtx, restoreFeat), ignore);
  expect(receipt.ok).toBe(true);
  expect(receipt.lines.at(-1)).toBe("This action was not recorded in Activity");
});

test("a blocked plan gives Not run without touching git, even outside a repository", async () => {
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    const plan = { ...stubPlan(["first"]), blockers: ["Nothing to do"] };
    const receipt = await runPrepared({ ...ctx, root: outside }, { plan, execute: () => Promise.reject(new Error("ran")) }, ignore);
    expect(receipt).toMatchObject({ ok: false, refused: true, title: "Not run" });
    expect(receipt.lines).toEqual(["Nothing to do", "This action was not recorded in Activity"]);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
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

test("ack refuses when the branch has an alert the plan never showed, every time it is run", async () => {
  await commitIn(worktree, "d.txt", "d\n", "add d");
  await commitIn(worktree, "e.txt", "e\n", "add e");
  await observe(repo.path, store);
  await repo.git("-C", worktree, "reset", "--soft", "main");
  await repo.git("-C", worktree, "commit", "-m", "squashed again");
  const prepared = await prepareAction("ack", ctx, { branch: "feat" });
  await observe(repo.path, store);
  expect(store.entries(repoId, { unresolved: true })).toHaveLength(2);

  for (let attempt = 0; attempt < 2; attempt++) {
    const receipt = await runPrepared(ctx, prepared, ignore);
    expect(receipt).toMatchObject({ ok: false, refused: true, title: "Changed since you looked" });
    expect(receipt.lines).toEqual(["feat has a new alert since you looked"]);
  }
  expect(store.entries(repoId, { unresolved: true })).toHaveLength(2);
});

test("ack of a branch with no open alert is blocked", async () => {
  const { plan } = await prepareAction("ack", ctx, { branch: "main" });
  expect(plan.blockers).toEqual(["Nothing to acknowledge on main"]);
});

test("a malformed input is invalid", async () => {
  await expect(prepareAction("restore", ctx, { targets: [] })).rejects.toThrow("at least one");
  await expect(prepareAction("ack", ctx, { branch: 3 })).rejects.toThrow("branch");
});
