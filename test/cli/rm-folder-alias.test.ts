import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { run } from "../../src/cli/main.js";
import { readLinkedRoots } from "../../src/core/facts/read-linked-roots.js";
import { resolvesOutside } from "../../src/core/facts/resolves-outside.js";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

const alias = vi.hoisted(() => ({ from: "", to: "" }));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (path: string): Promise<string> => {
      const real = await actual.realpath(path);
      return alias.from !== "" && real.startsWith(alias.from) ? alias.to + real.slice(alias.from.length) : real;
    },
  };
});

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
  old = join(root, ".worktrees", "old");
  await repo.worktree(old, "old");
  await write(join(old, ".local", "seed.sql"), "insert;\n");
  await symlink(join(old, ".local"), join(root, ".local"));
  alias.from = join(root, ".worktrees", "old", ".local");
  alias.to = `${join(root, ".worktrees")}//old/.local`;
});
afterEach(async () => {
  alias.from = "";
  alias.to = "";
  await repo.cleanup();
});

async function grove(argv: string[]): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (s) => out.push(s), err: (s) => err.push(s), cwd: repo.path });
  return { code, out: out.join(""), err: err.join("") };
}

test("a path that resolves to a different string for a worktree's own folder is still inside it", async () => {
  expect(await realpath(join(root, ".local", "seed.sql"))).toBe(`${join(root, ".worktrees")}//old/.local/seed.sql`);
  const roots = await readLinkedRoots(root);
  expect(await resolvesOutside(join(root, ".local", "seed.sql"), roots)).toBe(false);
  expect(await resolvesOutside(join(root, ".gitignore"), roots)).toBe(true);
});

test("check remove, rm and rm --rescue all keep a file that main only reaches through such a path", async () => {
  const check = await grove(["check", "remove", ".worktrees/old"]);
  expect(check.code).toBe(3);
  expect(check.out).toContain(".local/seed.sql");
  expect((await grove(["rm", ".worktrees/old"])).code).toBe(3);

  const rescue = await grove(["rm", ".worktrees/old", "--rescue"]);
  expect(rescue.code).toBe(1);
  expect(rescue.out).toContain("the target folder in main points into a worktree");
  expect(existsSync(old)).toBe(true);
  expect(await readFile(join(old, ".local", "seed.sql"), "utf8")).toBe("insert;\n");
});
