import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { describeError } from "../../../src/core/describe-error.js";
import { GitError } from "../../../src/core/git/git.error.js";
import { runGit } from "../../../src/core/git/run-git.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

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

test("a folder that does not exist rejects with a GitError saying so", async () => {
  const missing = join(repo.path, "gone");
  const error = await runGit(["status"], { cwd: missing }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(GitError);
  expect(error instanceof Error ? error.message : "").toContain(`${missing} does not exist`);
  expect(describeError(error)).not.toContain("git not found");
});

/** Runs `work` with GIT_GROVE_MAX_BUFFER set to `bytes`, then removes it. */
async function withMaxBuffer<T>(bytes: number, work: () => Promise<T>): Promise<T> {
  process.env["GIT_GROVE_MAX_BUFFER"] = String(bytes);
  try {
    return await work();
  } finally {
    delete process.env["GIT_GROVE_MAX_BUFFER"];
  }
}

test("output larger than grove reads rejects with a GitError, even with allowFailure", async () => {
  await repo.commit("big.txt", "x".repeat(4096), "big");
  const error = await withMaxBuffer(1024, () => runGit(["show", "HEAD"], { cwd: repo.path, allowFailure: true })).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GitError);
  expect(error instanceof GitError ? error.code : 0).toBe(-1);
});

test("a git killed by a signal rejects with a GitError", async () => {
  const error = await runGit(["-c", "alias.boom=!kill -9 $PPID", "boom"], { cwd: repo.path, allowFailure: true }).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GitError);
  expect(error instanceof Error ? error.message : "").toContain("SIGKILL");
});

test("git runs with GIT_NO_LAZY_FETCH=1, so a partial clone never fetches", async () => {
  const result = await runGit(["-c", "alias.lazy=!printenv GIT_NO_LAZY_FETCH", "lazy"], { cwd: repo.path });
  expect(result.stdout).toBe("1\n");
});
