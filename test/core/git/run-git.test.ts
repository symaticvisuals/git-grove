import { afterEach, beforeEach, expect, test } from "vitest";
import { GitError } from "../../../src/core/git/git.error.js";
import { runGit } from "../../../src/core/git/run-git.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
beforeEach(async () => {
  repo = await makeRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

test("runGit returns stdout on success", async () => {
  await repo.commit("a.txt", "a", "add a");
  const result = await runGit(["log", "-1", "--format=%s"], { cwd: repo.path });
  expect(result).toEqual({ stdout: "add a\n", stderr: "", code: 0 });
});

test("runGit rejects with GitError carrying args, code and stderr", async () => {
  const error = await runGit(["rev-parse", "--verify", "nope"], { cwd: repo.path }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(GitError);
  if (!(error instanceof GitError)) return;
  expect(error.stderr).not.toBe("");
  expect(error.code).not.toBe(0);
  expect(error.args).toEqual(["rev-parse", "--verify", "nope"]);
});

test("allowFailure resolves with a non-zero code", async () => {
  const result = await runGit(["rev-parse", "--verify", "nope"], { cwd: repo.path, allowFailure: true });
  expect(result.code).not.toBe(0);
});

test("input is written to stdin", async () => {
  const result = await runGit(["hash-object", "--stdin"], { cwd: repo.path, input: "hello\n" });
  expect(result.stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
});

test("write mode runs without --no-optional-locks", async () => {
  const result = await runGit(["config", "user.name", "x"], { cwd: repo.path, write: true });
  expect(result.code).toBe(0);
});

test("makeRepo builds branches and worktrees with deterministic commits", async () => {
  const first = await repo.commit("a.txt", "a", "one");
  const second = await repo.commit("b.txt", "b", "two");
  expect(first).not.toBe(second);
  await repo.branch("feat/coupons-ui");
  const dir = `${repo.path}-wt`;
  await repo.worktree(dir, "feat/coupons-ui-wt", "feat/coupons-ui");
  const list = await repo.git("worktree", "list", "--porcelain");
  expect(list).toContain("refs/heads/feat/coupons-ui-wt");
  const dates = (await repo.git("log", "--format=%at", "--reverse")).trim().split("\n");
  expect(dates).toEqual(["1793527200", "1793527260"]);
  await repo.git("worktree", "remove", "--force", dir);
});
