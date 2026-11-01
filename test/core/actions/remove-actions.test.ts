import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ActionContext } from "../../../src/core/actions/action.types.js";
import { InvalidInputError } from "../../../src/core/actions/invalid-input.error.js";
import type { ActionName, Plan, Receipt, StepEvent } from "../../../src/core/actions/plan.types.js";
import { prepareAction } from "../../../src/core/actions/registry.js";
import { runPrepared } from "../../../src/core/actions/run-prepared.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

type Copy = (from: string, to: string) => Promise<void>;

const seam = vi.hoisted((): { copy: Copy | null } => ({ copy: null }));

vi.mock("../../../src/core/actions/remove/rescue-files.js", async (importActual) => {
  const actual = await importActual<typeof import("../../../src/core/actions/remove/rescue-files.js")>();
  return {
    ...actual,
    rescueFiles: (main: string, worktree: string, files: string[], copy?: Copy) =>
      actual.rescueFiles(main, worktree, files, seam.copy ?? copy),
  };
});

const SEED = "insert into gift_cards values (1);\n";
const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let root: string;
let old: string;
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

async function commitIn(path: string, file: string, text: string): Promise<void> {
  await write(join(path, file), text);
  await repo.git("-C", path, "add", "--", file);
  await repo.git("-C", path, "commit", "-m", `add ${file}`);
}

beforeEach(async () => {
  repo = await makeRepo();
  root = await realpath(repo.path);
  store = openStore();
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  await repo.commit("base.txt", "base\n", "base");
  old = join(root, ".worktrees", "old");
  await repo.worktree(old, "old");
  await commitIn(old, "feature.txt", "feature\n");
  await repo.git("merge", "--squash", "old");
  await repo.git("commit", "-m", "land old");
  await write(join(old, ".local", "seed.sql"), SEED);
  ctx = { root: repo.path, store, now: () => Date.now() };
});
afterEach(async () => {
  seam.copy = null;
  store.close();
  await repo.cleanup();
});

async function prepare(name: ActionName, raw: unknown): Promise<Plan> {
  return (await prepareAction(name, ctx, raw)).plan;
}

async function run(
  name: ActionName,
  raw: unknown,
  between: () => Promise<void> = async () => undefined,
): Promise<{ plan: Plan; receipt: Receipt; events: StepEvent[] }> {
  const prepared = await prepareAction(name, ctx, raw);
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

async function sandbox(name: string): Promise<string> {
  const path = join(root, ".worktrees", name);
  await repo.git("worktree", "add", "--detach", path);
  return path;
}

test("rm --rescue copies .local/seed.sql into main, checks it, removes the folder and keeps the branch", async () => {
  const { plan, receipt } = await run("remove", { worktree: old, rescue: true });
  expect(plan.blockers).toEqual([]);
  expect(plan.steps.map((step) => step.title)).toEqual([
    "Check nothing moved since you looked",
    "Copy .local/seed.sql to main",
    "Check the copy matches",
    "Check it's safe to remove",
    "Remove the worktree folder",
  ]);
  expect(plan.commands).toEqual([
    "cp -n .worktrees/old/.local/seed.sql .local/seed.sql",
    "git grove check remove .worktrees/old",
    "git worktree remove .worktrees/old",
  ]);
  expect(plan.moves).toEqual([]);
  expect(plan.undoable).toBe(false);
  expect(receipt.ok).toBe(true);
  expect(receipt.title).toBe("Cleaned up .worktrees/old");
  expect(await readFile(join(root, ".local", "seed.sql"), "utf8")).toBe(SEED);
  expect(existsSync(old)).toBe(false);
  expect(await worktreeList()).not.toContain(old);
  expect(await repo.git("rev-parse", "--verify", "old")).not.toBe("");
});

test("the plan lists the mockup's safe-to-remove checks, with the file's size", async () => {
  const plan = await prepare("remove", { worktree: old, rescue: true });
  expect(plan.checks.map((check) => [check.ok, check.text])).toEqual([
    [true, "Merged into main"],
    [true, "No uncommitted, untracked, stashed or unpushed work"],
    [true, "No worktree inside this folder"],
    [true, "1 ignored file exists only here"],
  ]);
  expect(plan.checks[3]?.why).toBe(`.local/seed.sql, ${SEED.length} B, copied to main first`);
  expect(plan.expects).toEqual([
    expect.objectContaining({ kind: "worktree", path: old, dirty: [] }),
    { kind: "tip", branch: "old", sha: (await repo.git("rev-parse", "old")).trim() },
  ]);
});

test("a different seed.sql already in main stays, and the copy lands at .local/seed.sql.from-old", async () => {
  await write(join(root, ".local", "seed.sql"), "main's own\n");
  const { plan, receipt } = await run("remove", { worktree: old, rescue: true });
  expect(plan.commands[0]).toBe("cp -n .worktrees/old/.local/seed.sql .local/seed.sql.from-old");
  expect(receipt.ok).toBe(true);
  expect(await readFile(join(root, ".local", "seed.sql"), "utf8")).toBe("main's own\n");
  expect(await readFile(join(root, ".local", "seed.sql.from-old"), "utf8")).toBe(SEED);
  expect(receipt.lines).toContain("Copied .local/seed.sql to main as .local/seed.sql.from-old");
  expect(existsSync(old)).toBe(false);
});

test("without rescue, precious files block, and the blocker names the command", async () => {
  const plan = await prepare("remove", { worktree: old });
  expect(plan.blockers[0]).toContain("git grove rm --rescue .worktrees/old");
  expect(plan.blockers[0]).toContain(".local/seed.sql");
  expect(plan.checks.find((check) => check.text.includes("ignored file"))?.ok).toBe(false);
  const receipt = await runPrepared(ctx, await prepareAction("remove", ctx, { worktree: old }), () => undefined);
  expect(receipt.refused).toBe(true);
  expect(existsSync(old)).toBe(true);
});

test("uncommitted work blocks even with rescue", async () => {
  await write(join(old, "feature.txt"), "edited\n");
  const plan = await prepare("remove", { worktree: old, rescue: true });
  expect(plan.blockers).toEqual(["1 uncommitted change"]);
  expect(plan.checks[1]).toMatchObject({ ok: false });
});

test("the main, a locked and a prunable worktree are blocked with their reason", async () => {
  expect((await prepare("remove", { worktree: root, rescue: true })).blockers).toEqual(["the main worktree is never removed"]);

  await repo.git("worktree", "lock", old);
  expect((await prepare("remove", { worktree: old, rescue: true })).blockers).toContain(
    "locked; unlock it with git worktree unlock first",
  );

  const gone = join(root, ".worktrees", "gone");
  await repo.worktree(gone, "gone");
  await rm(gone, { recursive: true, force: true });
  expect((await prepare("remove", { worktree: ".worktrees/gone" })).blockers).toContain(
    "its folder is gone; run git worktree prune",
  );
});

test("a worktree with a rebase in progress is blocked", async () => {
  await commitIn(old, "clash.txt", "old side\n");
  await repo.commit("clash.txt", "main side\n", "clash on main");
  await repo.git("-C", old, "rebase", "main").catch(() => "");
  const plan = await prepare("remove", { worktree: old, rescue: true });
  expect(plan.blockers).toContain("a rebase is in progress; finish or abort it first");
  await repo.git("-C", old, "rebase", "--abort");
});

test("an ignored file added after the plan is caught by the re-check and nothing is removed", async () => {
  const { receipt, events } = await run("remove", { worktree: old, rescue: true }, () =>
    write(join(old, ".local", "notes.md"), "mine\n"),
  );
  expect(receipt.ok).toBe(false);
  expect(receipt.title).toBe("Stopped before removing .worktrees/old");
  expect(receipt.lines).toContain("Copied .local/seed.sql to main");
  expect(receipt.lines.join("\n")).toContain(".local/notes.md");
  expect(existsSync(join(old, ".local", "notes.md"))).toBe(true);
  expect(await worktreeList()).toContain(old);
  expect(await readFile(join(root, ".local", "seed.sql"), "utf8")).toBe(SEED);
  expect(events.filter((event) => event.state !== "running").map((event) => event.state)).toEqual([
    "done",
    "done",
    "done",
    "failed",
    "skipped",
  ]);
});

test("a copy that does not match stops before removing", async () => {
  seam.copy = async (_from, to) => {
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, "other bytes\n");
  };
  const { receipt } = await run("remove", { worktree: old, rescue: true });
  expect(receipt.ok).toBe(false);
  expect(receipt.title).toBe("Stopped before removing .worktrees/old");
  expect(receipt.lines.join("\n")).toContain("does not match");
  expect(await readFile(join(old, ".local", "seed.sql"), "utf8")).toBe(SEED);
  expect(await worktreeList()).toContain(old);
});

test("a precious file inside a git repository nested in the worktree is never rescued", async () => {
  await write(join(old, ".local", "clone", "notes.md"), "mine\n");
  await repo.git("init", "-q", join(old, ".local", "clone"));
  const plan = await prepare("remove", { worktree: old, rescue: true });
  expect(plan.blockers).toContain("a git repository of its own inside this folder: .local/clone");
  expect(plan.checks).toContainEqual(expect.objectContaining({ ok: false, text: "A git repository of its own inside this folder" }));
});

test("a plain rm of a worktree whose nested repository's files all match main is blocked", async () => {
  await rm(join(old, ".local", "seed.sql"));
  const clone = join(old, ".local", "clone");
  await repo.git("init", "-q", clone);
  await commitIn(clone, "a.txt", "same\n");
  await write(join(root, ".local", "clone", "a.txt"), "same\n");
  const plan = await prepare("remove", { worktree: old });
  expect(plan.blockers).toEqual(["a git repository of its own inside this folder: .local/clone"]);
  const receipt = await runPrepared(ctx, await prepareAction("remove", ctx, { worktree: old }), () => undefined);
  expect(receipt.refused).toBe(true);
  expect(existsSync(join(clone, ".git"))).toBe(true);
});

test("rm of a clean detached sandbox removes it", async () => {
  const path = await sandbox("agent-1");
  const { plan, receipt } = await run("remove", { worktree: path });
  expect(plan.steps.map((step) => step.title)).toEqual([
    "Check nothing moved since you looked",
    "Check it's safe to remove",
    "Remove the worktree folder",
  ]);
  expect(receipt.ok).toBe(true);
  expect(existsSync(path)).toBe(false);
});

test("a worktree edited after the plan is refused before anything is copied", async () => {
  const { receipt } = await run("remove", { worktree: old, rescue: true }, () => write(join(old, "feature.txt"), "edited\n"));
  expect(receipt.refused).toBe(true);
  expect(existsSync(join(root, ".local", "seed.sql"))).toBe(false);
  expect(existsSync(old)).toBe(true);
});

test("remove refuses input that is not { worktree, rescue? }", async () => {
  await expect(prepare("remove", { worktree: old, rescue: "yes" })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(prepare("remove", {})).rejects.toBeInstanceOf(InvalidInputError);
});

test("cleanup offers merged and detached worktrees and removes the picked ones", async () => {
  const wip = join(root, ".worktrees", "wip");
  await repo.worktree(wip, "wip");
  await commitIn(wip, "wip.txt", "wip\n");
  const box = await sandbox("agent-1");

  const { plan, receipt } = await run("cleanup", {});
  expect(plan.choices?.map(({ id, label, detail, selectable, selected }) => ({ id, label, detail, selectable, selected }))).toEqual([
    { id: old, label: "old", detail: "copies 1 file to main first", selectable: true, selected: true },
    { id: box, label: ".worktrees/agent-1", detail: "nothing to keep", selectable: true, selected: true },
  ]);
  expect(plan.steps.map((step) => step.title)).toEqual([
    "Check nothing moved since you looked",
    "old: copy .local/seed.sql to main",
    "old: remove folder",
    ".worktrees/agent-1: remove folder",
  ]);
  expect(receipt.ok).toBe(true);
  expect(receipt.title).toBe("Cleaned up 2 worktrees");
  expect(existsSync(old)).toBe(false);
  expect(existsSync(box)).toBe(false);
  expect(existsSync(wip)).toBe(true);
  expect(await readFile(join(root, ".local", "seed.sql"), "utf8")).toBe(SEED);
  for (const branch of ["main", "old", "wip"]) expect(await hasBranch(branch)).toBe(true);
});

test("cleanup skips one that gained a precious file after the plan and removes the rest", async () => {
  const box = await sandbox("agent-1");
  const { plan, receipt, events } = await run("cleanup", {}, () => write(join(box, ".local", "scratch.md"), "mine\n"));
  const index = plan.steps.findIndex((step) => step.title === ".worktrees/agent-1: remove folder");
  expect(events.find((event) => event.index === index)?.state).toBe("skipped");
  expect(receipt.ok).toBe(false);
  expect(receipt.title).toBe("Cleaned up 1 of 2 worktrees");
  expect(receipt.lines.join("\n")).toContain("Skipped .worktrees/agent-1: ");
  expect(receipt.lines.join("\n")).toContain(".local/scratch.md");
  expect(existsSync(box)).toBe(true);
  expect(existsSync(old)).toBe(false);
});

test("cleanup keeps a worktree whose copy does not match, says what it copied, and removes the rest", async () => {
  const box = await sandbox("agent-1");
  seam.copy = async (_from, to) => {
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, "other bytes\n");
  };
  const { plan, receipt, events } = await run("cleanup", {});
  const remove = plan.steps.findIndex((step) => step.title === "old: remove folder");
  expect(events.find((event) => event.index === remove)?.state).toBe("skipped");
  expect(receipt.ok).toBe(false);
  expect(receipt.lines.join("\n")).toContain(".worktrees/old was not removed: could not rescue .local/seed.sql");
  expect(receipt.lines).toContain("Removed .worktrees/agent-1");
  expect(existsSync(old)).toBe(true);
  expect(existsSync(box)).toBe(false);
});

test("cleanup skips only the picked worktree that was edited after the plan, and removes the rest", async () => {
  const box = await sandbox("agent-1");
  const { plan, receipt, events } = await run("cleanup", {}, () => write(join(box, "base.txt"), "edited\n"));
  expect(plan.expects).toEqual([]);
  const index = plan.steps.findIndex((step) => step.title === ".worktrees/agent-1: remove folder");
  expect(events.find((event) => event.index === index)).toMatchObject({ state: "skipped", detail: "base.txt changed in .worktrees/agent-1" });
  expect(receipt.refused).toBe(false);
  expect(receipt.ok).toBe(false);
  expect(receipt.lines).toContain("Skipped .worktrees/agent-1: base.txt changed in .worktrees/agent-1");
  expect(await readFile(join(box, "base.txt"), "utf8")).toBe("edited\n");
  expect(existsSync(old)).toBe(false);
  expect(await readFile(join(root, ".local", "seed.sql"), "utf8")).toBe(SEED);
});

test("cleanup skips a merged worktree whose branch moved after the plan", async () => {
  const box = await sandbox("agent-1");
  const { receipt } = await run("cleanup", {}, () => commitIn(old, "late.txt", "late\n"));
  expect(receipt.lines.join("\n")).toMatch(/^Skipped \.worktrees\/old: old moved: was [0-9a-f]{7}, now [0-9a-f]{7}$/m);
  expect(existsSync(old)).toBe(true);
  expect(existsSync(join(root, ".local", "seed.sql"))).toBe(false);
  expect(existsSync(box)).toBe(false);
});

test("cleanup with nothing picked is blocked with \"Pick at least one worktree.\"", async () => {
  expect((await prepare("cleanup", { paths: [] })).blockers).toEqual(["Pick at least one worktree."]);
});

test("cleanup picks only the paths it is given, and refuses one that is not a choice", async () => {
  const box = await sandbox("agent-1");
  const plan = await prepare("cleanup", { paths: [box] });
  expect(plan.choices?.map((choice) => [choice.label, choice.selected])).toEqual([
    ["old", false],
    [".worktrees/agent-1", true],
  ]);
  await expect(prepare("cleanup", { paths: [root] })).rejects.toBeInstanceOf(InvalidInputError);
  await expect(prepare("cleanup", { paths: "all" })).rejects.toBeInstanceOf(InvalidInputError);
});

test("cleanup does not offer a merged worktree with uncommitted work, and blocks it when picked", async () => {
  await write(join(old, "feature.txt"), "edited\n");
  const plan = await prepare("cleanup", { paths: [old] });
  expect(plan.choices?.[0]).toMatchObject({ selectable: false, detail: "1 uncommitted change" });
  expect(plan.blockers).toEqual(["old: 1 uncommitted change"]);
});
