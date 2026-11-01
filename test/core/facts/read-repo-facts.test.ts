import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { NotARepoError } from "../../../src/core/facts/not-a-repo.error.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { runGit } from "../../../src/core/git/run-git.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
};

let repo: TestRepo;
let featA: string;
let rebasing: string;

const inDir = (cwd: string, ...args: string[]) => runGit(args, { cwd, write: true, env: IDENTITY, allowFailure: true });

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore worktrees");
  await repo.commit("f.txt", "base\n", "base");
  featA = join(repo.path, ".worktrees", "feat-a");
  await repo.worktree(featA, "feat/a");
  await repo.branch("feat/b", "feat/a");
  await repo.git("config", "branch.feat/b.stackparent", "feat/a");
  await repo.git("config", "branch.feat/b.stackforkpoint", (await repo.git("rev-parse", "feat/a")).trim());

  await writeFile(join(featA, "f.txt"), "stashed\n");
  await inDir(featA, "stash");
  await writeFile(join(featA, "new.txt"), "new\n");

  rebasing = join(repo.path, ".worktrees", "rebasing");
  await repo.worktree(rebasing, "feat/r");
  await writeFile(join(rebasing, "f.txt"), "from r\n");
  await inDir(rebasing, "commit", "-am", "r change");
  await writeFile(join(repo.path, "f.txt"), "from main\n");
  await inDir(repo.path, "commit", "-am", "main change");
  await inDir(rebasing, "rebase", "main");
});
afterEach(async () => {
  await repo.cleanup();
});

test("reads trunk, worktrees, edges, stashes and operations", async () => {
  const facts = await readRepoFacts(featA);
  expect(facts.root).toBe(await realpath(repo.path));
  expect(facts.trunk).toMatchObject({ name: "main", ref: "refs/heads/main" });
  expect(facts.trunk.sha).toBe((await repo.git("rev-parse", "main")).trim());

  const a = facts.worktrees.find((w) => w.branch === "feat/a");
  expect(a?.changes?.untracked).toBe(1);
  expect(a?.isMain).toBe(false);
  expect(a?.operation).toBeNull();
  expect(a?.touchedAt).toBeGreaterThan(0);
  expect(facts.worktrees.find((w) => w.isMain)?.branch).toBe("main");

  expect(facts.edges).toContainEqual(expect.objectContaining({ branch: "feat/b", parent: "feat/a" }));
  expect(facts.stashes[0]?.branch).toBe("feat/a");
  expect(facts.branches.map((b) => b.name)).toEqual(expect.arrayContaining(["main", "feat/a", "feat/b", "feat/r"]));

  expect(facts.worktrees.find((w) => w.path.endsWith("rebasing"))?.operation).toBe("rebase");
});

test("reading from a linked worktree gives the main worktree as root", async () => {
  const facts = await readRepoFacts(rebasing);
  expect(facts.root).toBe(await realpath(repo.path));
});

test("rejects outside a repository", async () => {
  const dir = await mkdtemp(join(tmpdir(), "git-grove-plain-"));
  try {
    await expect(readRepoFacts(dir)).rejects.toBeInstanceOf(NotARepoError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a repository with no commits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "git-grove-empty-"));
  try {
    await runGit(["init", "-b", "main"], { cwd: dir, write: true });
    await expect(readRepoFacts(dir)).rejects.toBeInstanceOf(NotARepoError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
