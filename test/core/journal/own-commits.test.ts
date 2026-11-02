import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ownCommits } from "../../../src/core/journal/own-commits.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: TestRepo;

beforeEach(async () => {
  repo = await makeRepo();
});
afterEach(async () => {
  await repo.cleanup();
});

test("lists base..tip oldest first, with no patch ID for merge and empty commits", async () => {
  const base = await repo.commit("base.txt", "base\n", "base");
  await repo.branch("side");
  await repo.switch("side");
  const side = await repo.commit("s.txt", "s\n", "add s");
  await repo.switch("main");
  const a = await repo.commit("a.txt", "a\n", "add a");
  await repo.git("merge", "--no-ff", "--no-edit", "-m", "merge side", "side");
  const merge = (await repo.git("rev-parse", "HEAD")).trim();
  await repo.git("commit", "--allow-empty", "-m", "nothing");
  const empty = (await repo.git("rev-parse", "HEAD")).trim();

  const commits = await ownCommits(repo.path, base, empty);
  expect(commits.map((commit) => commit.sha)).toEqual([side, a, merge, empty]);
  expect(commits.map((commit) => commit.patchId === null)).toEqual([false, false, true, true]);
  expect(commits[1]?.meta).toBe(`author@example.com\0${Date.UTC(2026, 10, 1, 10, 2) / 1000}\0add a`);
  expect(await ownCommits(repo.path, empty, empty)).toEqual([]);
});
