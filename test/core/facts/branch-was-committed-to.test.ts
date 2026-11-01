import { afterEach, beforeEach, expect, test } from "vitest";
import { branchWasCommittedTo } from "../../../src/core/facts/branch-was-committed-to.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

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

test("a branch with no reflog or no such branch reports false", async () => {
  await repo.git("-c", "core.logAllRefUpdates=false", "branch", "unlogged");
  expect(await branchWasCommittedTo(repo.path, "unlogged")).toBe(false);
  expect(await branchWasCommittedTo(repo.path, "missing")).toBe(false);
});
