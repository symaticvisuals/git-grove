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

test("reads carry --no-optional-locks and writes do not", async () => {
  const trace = { GIT_TRACE2_PERF: "1" };
  const read = await runGit(["status"], { cwd: repo.path, env: trace });
  const write = await runGit(["status"], { cwd: repo.path, write: true, env: trace });
  expect(read.stderr).toContain("--no-optional-locks");
  expect(write.stderr).not.toContain("--no-optional-locks");
});

test("makeRepo applies identity to merges and annotated tags, and does not touch process.env", async () => {
  const before = process.env["GIT_AUTHOR_NAME"];
  await repo.commit("a.txt", "a", "one");
  await repo.branch("side");
  await repo.switch("side");
  await repo.commit("b.txt", "b", "two");
  await repo.switch("main");
  await repo.commit("c.txt", "c", "three");
  await repo.git("merge", "--no-ff", "-m", "merge side", "side");
  await repo.git("tag", "-a", "v1", "-m", "release");
  expect(process.env["GIT_AUTHOR_NAME"]).toBe(before);
});

test("concurrent commits in two repos keep their own clocks", async () => {
  const other = await makeRepo();
  try {
    await Promise.all([repo.commit("a.txt", "a", "one"), other.commit("a.txt", "a", "one")]);
    expect((await repo.git("log", "-1", "--format=%at")).trim()).toBe("1793527200");
    expect((await other.git("log", "-1", "--format=%at")).trim()).toBe("1793527200");
  } finally {
    await other.cleanup();
  }
});
