import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { describeError } from "../../../src/core/describe-error.js";
import { findWorktree } from "../../../src/core/facts/find-worktree.js";
import { NotAWorktreeError } from "../../../src/core/facts/not-a-worktree.error.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: TestRepo;
let links: string;
beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit(".gitignore", ".worktrees/\n", "ignore");
  links = await mkdtemp(join(tmpdir(), "git-grove-links-"));
});
afterEach(async () => {
  await rm(links, { recursive: true, force: true });
  await repo.cleanup();
});

test("findWorktree finds a worktree by a relative or symlinked path and names anything else in a NotAWorktreeError", async () => {
  const path = join(repo.path, ".worktrees", "a");
  await repo.worktree(path, "a");
  await symlink(path, join(links, "a"));
  const facts = await readRepoFacts(repo.path);

  expect((await findWorktree(facts, repo.path, ".worktrees/a")).path).toBe(await realpath(path));
  expect((await findWorktree(facts, links, "a")).branch).toBe("a");
  const error = await findWorktree(facts, repo.path, "nowhere").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NotAWorktreeError);
  expect(describeError(error)).toBe("git-grove: nowhere is not a worktree of this repository");
});

test("findWorktree takes a worktree's unique trailing folder names first, as git does, from any folder", async () => {
  const root = await realpath(repo.path);
  await repo.worktree(join(root, ".worktrees", "old-onboarding"), "old-onboarding");
  await repo.worktree(join(root, ".worktrees", "feat", "level-1"), "level-1");
  const facts = await readRepoFacts(root);

  expect((await findWorktree(facts, root, "old-onboarding")).branch).toBe("old-onboarding");
  expect((await findWorktree(facts, join(root, ".worktrees", "feat", "level-1"), "old-onboarding")).branch).toBe("old-onboarding");
  expect((await findWorktree(facts, root, "feat/level-1")).branch).toBe("level-1");
  expect((await findWorktree(facts, links, "old-onboarding")).branch).toBe("old-onboarding");
  await expect(findWorktree(facts, root, "onboarding")).rejects.toBeInstanceOf(NotAWorktreeError);
});

test("an ambiguous trailing name falls through to the path rule", async () => {
  const root = await realpath(repo.path);
  await repo.worktree(join(root, "x"), "top-x");
  await repo.worktree(join(root, ".worktrees", "x"), "inner-x");
  const facts = await readRepoFacts(root);

  expect((await findWorktree(facts, root, "x")).branch).toBe("top-x");
  expect((await findWorktree(facts, join(root, ".worktrees"), "x")).branch).toBe("inner-x");
  await expect(findWorktree(facts, links, "x")).rejects.toBeInstanceOf(NotAWorktreeError);
});

test("trailing names match case-insensitively only when core.ignorecase is true", async () => {
  const root = await realpath(repo.path);
  await repo.worktree(join(root, ".worktrees", "Seeded"), "seeded");
  await repo.git("config", "core.ignorecase", "true");
  expect((await findWorktree(await readRepoFacts(root), links, "seeded")).branch).toBe("seeded");
  await repo.git("config", "core.ignorecase", "false");
  await expect(findWorktree(await readRepoFacts(root), links, "seeded")).rejects.toBeInstanceOf(NotAWorktreeError);
});

test("findWorktree finds a worktree whose folder is gone through a symlinked path to its parent", async () => {
  const path = join(await realpath(repo.path), ".worktrees", "gone");
  await repo.worktree(path, "gone");
  await rm(path, { recursive: true, force: true });
  await symlink(await realpath(repo.path), join(links, "repo"));
  const facts = await readRepoFacts(repo.path);

  expect((await findWorktree(facts, join(links, "repo"), ".worktrees/gone")).branch).toBe("gone");
});
