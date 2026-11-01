import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { describeError } from "../../../src/cli/describe-error.js";
import { findWorktree } from "../../../src/core/facts/find-worktree.js";
import { NotAWorktreeError } from "../../../src/core/facts/not-a-worktree.error.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

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
