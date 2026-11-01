import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { run } from "../../src/cli/main.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

type Result = { code: number; out: string; err: string };

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;
let repo: TestRepo;
let root: string;
let old: string;

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
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  await repo.commit("base.txt", "base\n", "base");
  old = join(root, ".worktrees", "old");
  await repo.worktree(old, "old");
  await write(join(old, "feature.txt"), "feature\n");
  await repo.git("-C", old, "add", "feature.txt");
  await repo.git("-C", old, "commit", "-m", "add feature");
  await repo.git("merge", "--squash", "old");
  await repo.git("commit", "-m", "land old");
  await write(join(old, ".local", "seed.sql"), "insert;\n");
});
afterEach(() => repo.cleanup());

async function grove(argv: string[], cwd: string = repo.path): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd });
  return { code, out: out.join(""), err: err.join("") };
}

test("rm --rescue exits 0", async () => {
  const result = await grove(["rm", ".worktrees/old", "--rescue"]);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(result.out).toContain("Cleaned up .worktrees/old");
  expect(existsSync(old)).toBe(false);
  expect(await readFile(join(root, ".local", "seed.sql"), "utf8")).toBe("insert;\n");
});

test("rm on precious files exits 3 and names --rescue", async () => {
  const result = await grove(["rm", ".worktrees/old"]);
  expect(result.code).toBe(3);
  expect(result.out).toContain("git grove rm --rescue .worktrees/old");
  expect(existsSync(old)).toBe(true);
});

test("rm of a worktree holding a nested git repository exits 3, with or without --rescue", async () => {
  await rm(join(old, ".local", "seed.sql"));
  const clone = join(old, ".local", "clone");
  await write(join(clone, "a.txt"), "same\n");
  await repo.git("init", "-q", clone);
  await write(join(root, ".local", "clone", "a.txt"), "same\n");
  for (const argv of [["rm", ".worktrees/old"], ["rm", ".worktrees/old", "--rescue"]]) {
    const result = await grove(argv);
    expect(result.code).toBe(3);
    expect(result.out).toContain("a git repository of its own inside this folder: .local/clone");
  }
  expect(existsSync(join(clone, ".git"))).toBe(true);
});

test("E1: a folder in main that is a symlink into the worktree never makes its files safe", async () => {
  await repo.commit(".gitignore", ".worktrees/\nshared/\n", "ignore shared");
  const e1 = join(root, ".worktrees", "e1");
  await repo.git("worktree", "add", "--detach", e1);
  await write(join(e1, "shared", "notes.md"), "only here\n");
  await symlink(join(e1, "shared"), join(root, "shared"));

  const check = await grove(["check", "remove", ".worktrees/e1"]);
  expect(check.code).toBe(3);
  expect(check.out).toContain("shared/notes.md");
  expect((await grove(["rm", ".worktrees/e1"])).code).toBe(3);
  expect(await readFile(join(e1, "shared", "notes.md"), "utf8")).toBe("only here\n");
});

test("E6: a rescue whose target folder in main points into the worktree stops and removes nothing", async () => {
  await symlink(join(old, ".local"), join(root, ".local"));
  expect((await grove(["check", "remove", ".worktrees/old"])).code).toBe(3);
  expect((await grove(["rm", ".worktrees/old"])).code).toBe(3);

  const result = await grove(["rm", ".worktrees/old", "--rescue"]);
  expect(result.code).toBe(1);
  expect(result.out).toContain("Stopped before removing .worktrees/old");
  expect(result.out).toContain("the target folder in main points into a worktree");
  expect(existsSync(old)).toBe(true);
  expect(await readFile(join(old, ".local", "seed.sql"), "utf8")).toBe("insert;\n");
});

test("rm of the main worktree exits 3", async () => {
  const result = await grove(["rm", "."]);
  expect(result.code).toBe(3);
  expect(result.out).toContain("the main worktree is never removed");
});

test("rm resolves the path from the folder it runs in", async () => {
  const result = await grove(["rm", "old", "--rescue"], join(root, ".worktrees"));
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  expect(existsSync(old)).toBe(false);
});

test("rm --dry-run --json prints the plan and changes nothing", async () => {
  const result = await grove(["rm", ".worktrees/old", "--rescue", "--dry-run", "--json"]);
  expect(result.code).toBe(0);
  const plan: unknown = JSON.parse(result.out);
  expect(plan).toMatchObject({ action: "remove", blockers: [] });
  expect(existsSync(old)).toBe(true);
});

test("--rescue is refused on other commands, and rm takes one worktree", async () => {
  expect((await grove(["status", "--rescue"])).code).toBe(1);
  expect((await grove(["rm", ".worktrees/old", "extra"])).code).toBe(1);
  expect((await grove(["rm"])).code).toBe(1);
});
