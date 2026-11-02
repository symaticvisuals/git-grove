import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { run } from "../../src/cli/main.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type Result = { code: number; out: string; err: string };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;

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
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("base.txt", "base\n", "base");
});
afterEach(() => repo.cleanup());

async function grove(argv: string[]): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd: repo.path });
  return { code, out: out.join(""), err: err.join("") };
}

test('new "gift cards" --branch feat/gift-cards-model exits 0 and prints Ready', async () => {
  const result = await grove(["new", "gift cards", "--branch", "feat/gift-cards-model"]);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).toContain("Ready");
  expect(existsSync(join(repo.path, ".worktrees/gift-cards/01-feat-gift-cards-model"))).toBe(true);
});

test("new --dry-run changes nothing", async () => {
  const result = await grove(["new", "gift cards", "--dry-run"]);
  expect(result.code).toBe(0);
  expect(result.out).toContain("01-gift-cards");
  expect(existsSync(join(repo.path, ".worktrees"))).toBe(false);
});

test('add-level "gift cards" feat/gift-cards-ui exits 0', async () => {
  await grove(["new", "gift cards", "--branch", "feat/gift-cards-model"]);
  const result = await grove(["add-level", "gift cards", "feat/gift-cards-ui"]);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(existsSync(join(repo.path, ".worktrees/gift-cards/02-feat-gift-cards-ui"))).toBe(true);
});

test("new with an existing branch exits 3", async () => {
  await repo.branch("feat/taken");
  const result = await grove(["new", "gift cards", "--branch", "feat/taken"]);
  expect(result.code).toBe(3);
  expect(result.out).toContain("already exists");
});

test("the creating flags are refused on other commands", async () => {
  expect((await grove(["status", "--install"])).code).toBe(1);
  expect((await grove(["new", "x", "--on", "y"])).code).toBe(1);
  expect((await grove(["add-level", "x", "y", "--from", "main"])).code).toBe(1);
});
