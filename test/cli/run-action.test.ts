import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { runActionCommand } from "../../src/cli/run-action.js";
import type { ActionName } from "../../src/core/actions/plan.types.js";
import { readRepoFacts } from "../../src/core/facts/read-repo-facts.js";
import { observe } from "../../src/core/journal/observe.js";
import { openStore } from "../../src/core/journal/open-store.js";
import { withRepoLock } from "../../src/core/runner/with-repo-lock.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

type Result = { code: number; out: string; err: string };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let worktree: string;
let squashed: string;
let pinRef: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

async function tip(): Promise<string> {
  return (await repo.git("rev-parse", "refs/heads/feat")).trim();
}

async function unresolved(): Promise<number> {
  const store = openStore();
  try {
    const repoId = store.findRepoId((await readRepoFacts(repo.path)).commonDir);
    return repoId === null ? 0 : store.entries(repoId, { unresolved: true }).length;
  } finally {
    store.close();
  }
}

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("base.txt", "base\n", "base");
  worktree = join(repo.path, ".worktrees", "feat");
  await repo.worktree(worktree, "feat");
  for (const name of ["a", "b", "c"]) {
    await writeFile(join(worktree, `${name}.txt`), `${name}\n`);
    await repo.git("-C", worktree, "add", `${name}.txt`);
    await repo.git("-C", worktree, "commit", "-m", `add ${name}`);
  }
  const store = openStore();
  try {
    await observe(repo.path, store);
    await repo.git("-C", worktree, "reset", "--soft", "main");
    await repo.git("-C", worktree, "commit", "-m", "squashed");
    squashed = await tip();
    const [entry] = await observe(repo.path, store);
    pinRef = entry?.pinRef ?? "";
  } finally {
    store.close();
  }
});
afterEach(() => repo.cleanup());

async function grove(name: ActionName, raw: unknown, options: { dryRun?: boolean; json?: boolean } = {}): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s), cwd: worktree };
  const code = await runActionCommand(io, name, raw, { dryRun: options.dryRun ?? false, json: options.json ?? false });
  return { code, out: out.join(""), err: err.join("") };
}

const restoreFeat = { targets: [{ branch: "feat" }] };

test("restore prints the plan, each step and the receipt, and exits 0", async () => {
  const result = await grove("restore", restoreFeat);
  expect(result.code).toBe(0);
  expect(result.out).toContain("Bring back 3 commits on feat\n");
  expect(result.out).toContain("  ✓ Check all 3 commits are back  3 of 3 found");
  expect(result.out).toMatch(/\n✓ Restored 3 commits on feat\n/);
  expect(result.out).toMatch(/ {2}undo: git grove restore feat refs\/grove\/pins\/feat\/\S+\n$/);
  expect((await repo.git("rev-list", "--count", "main..feat")).trim()).toBe("3");
});

test("a dry run prints the plan with its command and changes nothing", async () => {
  const result = await grove("restore", restoreFeat, { dryRun: true });
  expect(result.code).toBe(0);
  expect(result.out).toContain(`\nCommands\n  git grove restore feat ${pinRef}\n`);
  expect(result.out).not.toContain("Restored");
  expect(await tip()).toBe(squashed);
});

test("a JSON dry run prints only the plan as one document", async () => {
  const result = await grove("restore", restoreFeat, { dryRun: true, json: true });
  const doc: unknown = JSON.parse(result.out);
  expect(result.code).toBe(0);
  expect(doc).toMatchObject({ action: "restore", confirm: "Bring back 3 commits", commands: [`git grove restore feat ${pinRef}`] });
});

test("a JSON run prints only the receipt", async () => {
  const result = await grove("restore", restoreFeat, { json: true });
  const doc: unknown = JSON.parse(result.out);
  expect(result.code).toBe(0);
  expect(doc).toMatchObject({ action: "restore", ok: true, refused: false, title: "Restored 3 commits on feat" });
});

test("a blocked plan exits 3 and changes nothing", async () => {
  await writeFile(join(worktree, "a.txt"), "edited\n");
  const restore = await grove("restore", restoreFeat);
  expect(restore.code).toBe(3);
  expect(restore.out).toContain("\nBlocked\n  ✖ .worktrees/feat has uncommitted changes.");
  expect(await tip()).toBe(squashed);

  expect((await grove("ack", { branch: "main" })).code).toBe(3);
});

test("a run refused because the repo lock is held exits 1", async () => {
  const { commonDir } = await readRepoFacts(repo.path);
  const result = await withRepoLock(commonDir, () => grove("restore", restoreFeat));
  expect(result.code).toBe(1);
  expect(result.out).toContain("\n✖ Another grove action is running in this repo\n");
  expect(await tip()).toBe(squashed);
});

test("ack exits 0, clears the alert and leaves the branch where it is", async () => {
  expect(await unresolved()).toBe(1);
  const result = await grove("ack", { branch: "feat" });
  expect(result.code).toBe(0);
  expect(result.out).toContain("✓ Kept the squash on feat\n  1 alert cleared\n");
  expect(await unresolved()).toBe(0);
  expect(await tip()).toBe(squashed);
});
