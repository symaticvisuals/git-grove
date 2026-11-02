import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { branchWasCommittedTo } from "../../../src/core/facts/branch-was-committed-to.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: TestRepo;

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit("base.txt", "base\n", "base");
});
afterEach(() => repo.cleanup());

test("a branch that was only created has not been committed to", async () => {
  await repo.branch("fresh");
  expect(await branchWasCommittedTo(repo.path, "fresh")).toBe(false);
});

test("a branch with a commit made on it has been committed to", async () => {
  await repo.branch("used");
  await repo.switch("used");
  await repo.commit("u.txt", "u\n", "add u");
  expect(await branchWasCommittedTo(repo.path, "used")).toBe(true);
});

test("fast-forwards, rebases and resets do not count as commits made on a branch", async () => {
  await repo.commit("more.txt", "more\n", "more");
  for (const [name, args] of [
    ["ff", ["merge", "--ff-only", "main"]],
    ["rebased", ["rebase", "main"]],
    ["reset", ["reset", "--hard", "main"]],
  ] satisfies [string, string[]][]) {
    await repo.branch(name, "main~1");
    await repo.switch(name);
    await repo.git(...args);
    expect(await branchWasCommittedTo(repo.path, name), name).toBe(false);
  }
});

test("a merge commit, a cherry-pick and a revert count as commits made on a branch", async () => {
  const more = await repo.commit("more.txt", "more\n", "more");
  await repo.branch("merged", "main~1");
  await repo.switch("merged");
  await repo.git("merge", "--no-ff", "--no-edit", "main");
  expect(await branchWasCommittedTo(repo.path, "merged")).toBe(true);

  await repo.branch("picked", "main~1");
  await repo.switch("picked");
  await repo.git("cherry-pick", more);
  expect(await branchWasCommittedTo(repo.path, "picked")).toBe(true);

  await repo.branch("reverted", "main");
  await repo.switch("reverted");
  await repo.git("revert", "--no-edit", "HEAD");
  expect(await branchWasCommittedTo(repo.path, "reverted")).toBe(true);
});

test("an empty, expired or unreadable reflog counts as committed to", async () => {
  await repo.git("-c", "core.logAllRefUpdates=false", "branch", "unlogged");
  expect(await branchWasCommittedTo(repo.path, "unlogged")).toBe(true);
  await repo.branch("expired");
  await repo.git("reflog", "expire", "--expire=now", "--expire-unreachable=now", "refs/heads/expired");
  expect(await branchWasCommittedTo(repo.path, "expired")).toBe(true);
  expect(await branchWasCommittedTo(repo.path, "missing")).toBe(true);
});
