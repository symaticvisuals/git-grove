import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ActionContext } from "../../../src/core/actions/action.types.js";
import { copyEnvFiles } from "../../../src/core/actions/create/copy-env-files.js";
import { levelFolder } from "../../../src/core/actions/create/level-folder.js";
import { InvalidInputError } from "../../../src/core/actions/invalid-input.error.js";
import type { ActionName, Plan, Receipt } from "../../../src/core/actions/plan.types.js";
import { prepareAction } from "../../../src/core/actions/registry.js";
import { runPrepared } from "../../../src/core/actions/run-prepared.js";
import { readEnvMissing } from "../../../src/core/facts/read-env-missing.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { Store } from "../../../src/core/journal/store.types.js";
import { readStackFacts } from "../../../src/core/stacks/read-stack-facts.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const savedHome = process.env["GIT_GROVE_HOME"];
const savedPath = process.env["PATH"];
let home: string;
let repo: TestRepo;
let store: Store;
let ctx: ActionContext;
const bins: string[] = [];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

beforeEach(async () => {
  repo = await makeRepo();
  store = openStore();
  await repo.commit(".gitignore", ".worktrees/\n.env*\n", "ignore worktrees and env");
  await repo.commit("base.txt", "base\n", "base");
  await writeFile(join(repo.path, ".env"), "SECRET=1\n");
  await mkdir(join(repo.path, "apps/web"), { recursive: true });
  await writeFile(join(repo.path, "apps/web/.env.local"), "WEB=1\n");
  ctx = { root: repo.path, store, now: () => Date.now() };
});
afterEach(async () => {
  process.env["PATH"] = savedPath;
  store.close();
  await repo.cleanup();
  await Promise.all(bins.splice(0).map((bin) => rm(bin, { recursive: true, force: true })));
});

async function prepare(name: ActionName, raw: unknown): Promise<Plan> {
  return (await prepareAction(name, ctx, raw)).plan;
}

async function run(name: ActionName, raw: unknown): Promise<{ plan: Plan; receipt: Receipt }> {
  const prepared = await prepareAction(name, ctx, raw);
  return { plan: prepared.plan, receipt: await runPrepared(ctx, prepared, () => undefined) };
}

async function config(branch: string, key: string): Promise<string> {
  return (await repo.git("config", "--get", `branch.${branch}.${key}`)).trim();
}

const GIFT = { feature: "gift cards", branch: "feat/gift-cards-model" };

test("new creates the first level on main and records the stack keys", async () => {
  const { plan, receipt } = await run("new", GIFT);
  const folder = levelFolder(repo.path, "gift cards", 1, "feat/gift-cards-model");
  expect(receipt.ok).toBe(true);
  expect(receipt.title).toContain("Ready");
  expect((await repo.git("-C", folder, "branch", "--show-current")).trim()).toBe("feat/gift-cards-model");
  expect(await config(GIFT.branch, "stackparent")).toBe("main");
  expect(await config(GIFT.branch, "grovefeature")).toBe("gift cards");
  expect(await config(GIFT.branch, "stackforkpoint")).toBe((await repo.git("rev-parse", "main")).trim());
  const facts = await readRepoFacts(repo.path);
  const feature = (await readStackFacts(facts.root, facts)).find((candidate) => candidate.name === "gift cards");
  expect(feature?.levels).toHaveLength(1);
  expect(plan.folders?.at(-1)).toEqual({ path: "01-feat-gift-cards-model", isNew: true, note: "on main" });
  expect(plan.moves).toEqual([]);
  expect(plan.note).toBe("Nothing that exists today is changed.");
  expect(plan.steps.map((step) => step.title).slice(0, 3)).toEqual([
    "Check nothing moved since you looked",
    "Create branch feat/gift-cards-model and its folder",
    "Record it as level 01 of gift cards",
  ]);
});

test("new defaults the branch to the feature's slug", async () => {
  const { receipt } = await run("new", { feature: "Gift Cards!" });
  expect(receipt.ok).toBe(true);
  expect(existsSync(join(repo.path, ".worktrees/gift-cards/01-gift-cards"))).toBe(true);
});

test("new copies main's ignored .env files and prints the install command without running it", async () => {
  await writeFile(join(repo.path, "pnpm-lock.yaml"), "");
  const { plan, receipt } = await run("new", GIFT);
  const folder = levelFolder(repo.path, "gift cards", 1, "feat/gift-cards-model");
  expect(await readFile(join(folder, ".env"), "utf8")).toBe("SECRET=1\n");
  expect(await readFile(join(folder, "apps/web/.env.local"), "utf8")).toBe("WEB=1\n");
  expect(plan.effects).toContain("Run `pnpm install` in the new folder when you need it");
  expect(receipt.lines.join("\n")).toContain("2 env files copied");
});

test("new with skipped env copies nothing", async () => {
  await run("new", { ...GIFT, env: false });
  expect(existsSync(join(levelFolder(repo.path, "gift cards", 1, GIFT.branch), ".env"))).toBe(false);
});

test("new with install runs the package manager in the new folder", async () => {
  const bin = await mkdtemp(join(tmpdir(), "git-grove-bin-"));
  bins.push(bin);
  await writeFile(join(bin, "pnpm"), "#!/bin/sh\ntouch installed\n");
  await chmod(join(bin, "pnpm"), 0o755);
  process.env["PATH"] = `${bin}:${savedPath ?? ""}`;
  await writeFile(join(repo.path, "pnpm-lock.yaml"), "");
  const { receipt } = await run("new", { ...GIFT, install: true });
  expect(receipt.ok).toBe(true);
  expect(existsSync(join(levelFolder(repo.path, "gift cards", 1, GIFT.branch), "installed"))).toBe(true);
});

test("a failing install does not fail the action", async () => {
  const bin = await mkdtemp(join(tmpdir(), "git-grove-bin-"));
  bins.push(bin);
  await writeFile(join(bin, "pnpm"), "#!/bin/sh\necho boom >&2\nexit 1\n");
  await chmod(join(bin, "pnpm"), 0o755);
  process.env["PATH"] = `${bin}:${savedPath ?? ""}`;
  await writeFile(join(repo.path, "pnpm-lock.yaml"), "");
  const { receipt } = await run("new", { ...GIFT, install: true });
  expect(receipt.ok).toBe(true);
  expect(receipt.lines).toContain("install failed: boom; run pnpm install there yourself");
});

test("new refuses an existing branch, an existing folder or an existing feature name, and changes nothing", async () => {
  await repo.branch("feat/taken");
  const branchPlan = await prepare("new", { feature: "other", branch: "feat/taken" });
  expect(branchPlan.blockers).toEqual(["Branch feat/taken already exists"]);

  const folder = levelFolder(repo.path, "gift cards", 1, GIFT.branch);
  await mkdir(folder, { recursive: true });
  expect((await prepare("new", GIFT)).blockers).toEqual([".worktrees/gift-cards/01-feat-gift-cards-model already exists"]);
  await rm(folder, { recursive: true });

  await run("new", GIFT);
  const before = (await repo.git("branch", "--list")).trim();
  const again = await run("new", { feature: "Gift Cards", branch: "feat/other" });
  expect(again.plan.blockers.join(" ")).toContain("A feature named gift cards already exists");
  expect(again.receipt.refused).toBe(true);
  expect((await repo.git("branch", "--list")).trim()).toBe(before);
  expect(existsSync(levelFolder(repo.path, "Gift Cards", 1, "feat/other"))).toBe(false);
});

test("new from a branch that is not the trunk is invalid", async () => {
  await repo.branch("feat/other");
  await expect(prepare("new", { feature: "x", from: "feat/other" })).rejects.toThrow(InvalidInputError);
  await expect(prepare("new", { feature: "x", from: "feat/other" })).rejects.toThrow(/add-level/);
  expect((await prepare("new", { feature: "x", from: "main" })).blockers).toEqual([]);
});

test("new ignores .worktrees/ in this clone when the repo does not", async () => {
  await repo.commit(".gitignore", ".env*\n", "stop ignoring worktrees");
  const plan = await prepare("new", GIFT);
  expect(plan.steps.map((step) => step.title)).toContain("Ignore .worktrees/ in this clone");
  await run("new", GIFT);
  const commonDir = (await repo.git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
  expect(await readFile(join(commonDir, "info", "exclude"), "utf8")).toContain(".worktrees/");
  expect((await repo.git("status", "--porcelain")).includes(".worktrees")).toBe(false);
});

test("new refuses when main moved since the plan", async () => {
  const prepared = await prepareAction("new", ctx, GIFT);
  await repo.commit("late.txt", "late\n", "late");
  const receipt = await runPrepared(ctx, prepared, () => undefined);
  expect(receipt.refused).toBe(true);
  expect(receipt.lines.join(" ")).toContain("main moved");
  expect(existsSync(levelFolder(repo.path, "gift cards", 1, GIFT.branch))).toBe(false);
});

test("add-level builds on the deepest level by default, and --on level 1 makes a sibling 02-", async () => {
  await run("new", GIFT);
  const ui = await run("add-level", { feature: "gift cards", branch: "feat/gift-cards-ui" });
  expect(ui.receipt.ok).toBe(true);
  expect(ui.plan.folders).toEqual([
    { path: "01-feat-gift-cards-model", isNew: false, note: "on main" },
    { path: "02-feat-gift-cards-ui", isNew: true, note: "on feat/gift-cards-model" },
  ]);
  const email = await run("add-level", { feature: "gift cards", branch: "feat/gift-cards-email" });
  expect(email.receipt.ok).toBe(true);
  expect(existsSync(join(repo.path, ".worktrees/gift-cards/03-feat-gift-cards-email"))).toBe(true);
  expect(await config("feat/gift-cards-email", "stackparent")).toBe("feat/gift-cards-ui");

  const sibling = await run("add-level", { feature: "gift cards", branch: "feat/gift-cards-admin", on: GIFT.branch });
  expect(sibling.receipt.ok).toBe(true);
  expect(existsSync(join(repo.path, ".worktrees/gift-cards/02-feat-gift-cards-admin"))).toBe(true);
  expect(await config("feat/gift-cards-admin", "stackparent")).toBe(GIFT.branch);
  const parentTip = (await repo.git("rev-parse", GIFT.branch)).trim();
  expect(await config("feat/gift-cards-admin", "stackforkpoint")).toBe(parentTip);
  const noFeature = await repo.git("config", "--get", "branch.feat/gift-cards-admin.grovefeature").catch(() => "");
  expect(noFeature.trim()).toBe("");
});

test("add-level on an unknown feature is invalid", async () => {
  await expect(prepare("add-level", { feature: "nope", branch: "feat/x" })).rejects.toThrow(InvalidInputError);
  await run("new", GIFT);
  await expect(prepare("add-level", { feature: "gift cards", branch: "feat/x", on: "feat/nope" })).rejects.toThrow(InvalidInputError);
});

test("copy-env copies apps/web/.env.local into a worktree that lacks it and never overwrites", async () => {
  await run("new", { ...GIFT, env: false });
  const folder = levelFolder(repo.path, "gift cards", 1, GIFT.branch);
  await writeFile(join(folder, ".env"), "DIFFERENT=1\n");
  const { plan, receipt } = await run("copy-env", { worktree: folder });
  expect(plan.expects).toEqual([{ kind: "absent", path: expect.stringMatching(/\/01-feat-gift-cards-model\/apps\/web\/\.env\.local$/) }]);
  expect(receipt.ok).toBe(true);
  expect(await readFile(join(folder, "apps/web/.env.local"), "utf8")).toBe("WEB=1\n");
  expect(await readFile(join(folder, ".env"), "utf8")).toBe("DIFFERENT=1\n");
  expect((await prepare("copy-env", { worktree: folder })).blockers.join(" ")).toContain("already has every env file");
});

test("copy-env shows each copy as a quoted cp -n that never overwrites", async () => {
  const folder = join(repo.path, ".worktrees", "my copy");
  await repo.worktree(folder, "feat/copy");
  const plan = await prepare("copy-env", { worktree: folder });
  expect(plan.commands).toEqual(["cp -n .env '.worktrees/my copy/.env'", "cp -n apps/web/.env.local '.worktrees/my copy/apps/web/.env.local'"]);
});

/** A worktree on a branch whose tracked `apps` is a symlink to a tracked, unignored `leak` folder. */
async function worktreeWithSymlinkedApps(): Promise<string> {
  const folder = join(repo.path, ".worktrees", "evil");
  await repo.worktree(folder, "feat/evil");
  await mkdir(join(folder, "leak"), { recursive: true });
  await writeFile(join(folder, "leak", "keep.txt"), "tracked\n");
  await symlink("leak", join(folder, "apps"));
  await repo.git("-C", folder, "add", "leak", "apps");
  await repo.git("-C", folder, "commit", "-m", "apps is a symlink");
  return folder;
}

test("copy-env never copies through a symlinked folder of the worktree", async () => {
  const folder = await worktreeWithSymlinkedApps();
  const { plan, receipt } = await run("copy-env", { worktree: folder });
  expect(plan.commands).toEqual(["cp -n .env .worktrees/evil/.env"]);
  expect(plan.checks).toContainEqual({ ok: false, text: "1 file not copied", why: "apps/web/.env.local: a folder on the way is a symlink, so it would land outside where it belongs" });
  expect(receipt.ok).toBe(true);
  expect(await readFile(join(folder, ".env"), "utf8")).toBe("SECRET=1\n");
  expect(existsSync(join(folder, "leak", "web", ".env.local"))).toBe(false);
});

test("a worktree whose env file would go through a symlinked folder is not missing it", async () => {
  const folder = await worktreeWithSymlinkedApps();
  await writeFile(join(folder, ".env"), "SECRET=1\n");
  const facts = await readRepoFacts(repo.path);
  const missing = await readEnvMissing(repo.path, facts);
  expect([...missing.entries()].find(([path]) => path.endsWith("/.worktrees/evil"))?.[1]).toEqual([]);
  expect((await prepare("copy-env", { worktree: folder })).blockers.join(" ")).toContain("already has every env file it can take");
});

test("copyEnvFiles skips a file whose folder on the way is a symlink", async () => {
  const main = await mkdtemp(join(tmpdir(), "git-grove-main-"));
  const target = await mkdtemp(join(tmpdir(), "git-grove-target-"));
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    await mkdir(join(main, "apps", "web"), { recursive: true });
    await writeFile(join(main, "apps", "web", ".env.local"), "WEB=1\n");
    await writeFile(join(main, ".env"), "SECRET=1\n");
    await symlink(outside, join(target, "apps"));
    expect(await copyEnvFiles(main, target, [".env", "apps/web/.env.local"])).toEqual({ copied: [".env"], kept: [], skipped: ["apps/web/.env.local"] });
    expect(existsSync(join(outside, "web", ".env.local"))).toBe(false);
  } finally {
    await Promise.all([main, target, outside].map((path) => rm(path, { recursive: true, force: true })));
  }
});

test("copy-env refuses the main checkout", async () => {
  await expect(prepare("copy-env", { worktree: repo.path })).rejects.toThrow(InvalidInputError);
});

test("a record step that fails reports what exists and how to remove it", async () => {
  const prepared = await prepareAction("new", ctx, GIFT);
  const commonDir = (await repo.git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
  await writeFile(join(commonDir, "config.lock"), "");
  const receipt = await runPrepared(ctx, prepared, () => undefined);
  await rm(join(commonDir, "config.lock"));
  expect(receipt.ok).toBe(false);
  expect(receipt.refused).toBe(false);
  expect(receipt.title).toBe("Stopped: Record it as level 01 of gift cards");
  const text = receipt.lines.join("\n");
  expect(text).toContain("folder .worktrees/gift-cards/01-feat-gift-cards-model, a worktree on feat/gift-cards-model");
  expect(text).toContain("branch feat/gift-cards-model");
  expect(text).toContain("git worktree remove --force .worktrees/gift-cards/01-feat-gift-cards-model");
  expect(text).toContain("git branch -D feat/gift-cards-model");
});

test("a create step that fails says what it left", async () => {
  const prepared = await prepareAction("new", ctx, GIFT);
  const commonDir = (await repo.git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
  await writeFile(join(commonDir, "worktrees"), "not a folder");
  const receipt = await runPrepared(ctx, prepared, () => undefined);
  await rm(join(commonDir, "worktrees"));
  expect(receipt.ok).toBe(false);
  expect(receipt.title).toBe("Stopped: Create branch feat/gift-cards-model and its folder");
  expect(receipt.lines).toContain("Left behind by this run:");
});

test("a failing env copy is a line, not a failure", async () => {
  await chmod(join(repo.path, ".env"), 0o000);
  try {
    const { receipt } = await run("new", GIFT);
    expect(receipt.ok).toBe(true);
    expect(receipt.lines.some((line) => line.startsWith("Couldn't copy the env files:") && line.endsWith("Copy them yourself."))).toBe(true);
  } finally {
    await chmod(join(repo.path, ".env"), 0o644);
  }
});

test("a feature name with no letter or digit is invalid", async () => {
  const message = "Give the feature a name with at least one letter or digit";
  await expect(prepare("new", { feature: "日本" })).rejects.toThrow(message);
  await expect(prepare("new", { feature: "!!!" })).rejects.toThrow(InvalidInputError);
  await expect(prepare("add-level", { feature: "!!!", branch: "feat/x" })).rejects.toThrow(message);
});

test("open launches the configured editor", async () => {
  await writeFile(join(home, "config.json"), JSON.stringify({ editor: "true" }));
  try {
    const events: string[] = [];
    const prepared = await prepareAction("new", ctx, { ...GIFT, open: true });
    const receipt = await runPrepared(ctx, prepared, (event) => events.push(`${event.state}:${event.detail}`));
    expect(receipt.ok).toBe(true);
    expect(receipt.lines.join(" ")).not.toContain("could not open");
    expect(events).toContain("done:Opened");
  } finally {
    await rm(join(home, "config.json"), { force: true });
  }
});
