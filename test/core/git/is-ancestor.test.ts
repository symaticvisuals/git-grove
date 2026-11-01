import { afterEach, beforeEach, expect, test } from "vitest";
import { GitError } from "../../../src/core/git/git.error.js";
import { isAncestor } from "../../../src/core/git/is-ancestor.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
beforeEach(async () => {
  repo = await makeRepo();
});
afterEach(() => repo.cleanup());

test("isAncestor is true for an ancestor, false otherwise, and throws GitError when git cannot tell", async () => {
  const first = await repo.commit("a.txt", "a\n", "one");
  const second = await repo.commit("b.txt", "b\n", "two");
  expect(await isAncestor(repo.path, first, second)).toBe(true);
  expect(await isAncestor(repo.path, second, first)).toBe(false);
  await expect(isAncestor(repo.path, "1234567890abcdef1234567890abcdef12345678", second)).rejects.toBeInstanceOf(GitError);
});
