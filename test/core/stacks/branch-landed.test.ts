import { afterEach, beforeEach, expect, test } from "vitest";
import { branchLanded } from "../../../src/core/stacks/branch-landed.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit("base.txt", "base\n", "base");
});
afterEach(() => repo.cleanup());

const tipOf = async (name: string): Promise<{ name: string; tip: string }> => ({
  name,
  tip: (await repo.git("rev-parse", name)).trim(),
});

test("a branch only created on the trunk has not landed; one committed to and merged has", async () => {
  await repo.branch("fresh");
  expect(await branchLanded(repo.path, await tipOf("fresh"), "refs/heads/main")).toBe(false);

  await repo.branch("used");
  await repo.switch("used");
  await repo.commit("u.txt", "u\n", "add u");
  await repo.switch("main");
  expect(await branchLanded(repo.path, await tipOf("used"), "refs/heads/main")).toBe(false);
  await repo.git("merge", "--no-ff", "--no-edit", "used");
  expect(await branchLanded(repo.path, await tipOf("used"), "refs/heads/main")).toBe(true);
});

test("a git failure counts as not landed", async () => {
  const bogus = { name: "gone", tip: "1234567890abcdef1234567890abcdef12345678" };
  expect(await branchLanded(repo.path, bogus, "refs/heads/main")).toBe(false);
});
