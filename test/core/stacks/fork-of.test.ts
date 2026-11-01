import { afterEach, beforeEach, expect, test } from "vitest";
import type { BranchFacts, StackEdge } from "../../../src/core/facts/facts.types.js";
import { forkOf } from "../../../src/core/stacks/fork-of.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
let base: string;
let parentOld: string;

async function commitOn(branch: string, file: string, message: string): Promise<string> {
  await repo.switch(branch);
  return repo.commit(file, `${message}\n`, message);
}

async function facts(name: string): Promise<BranchFacts> {
  return { name, tip: (await repo.git("rev-parse", name)).trim(), upstream: null };
}

const edge = (forkPoint: string | null): StackEdge => ({ branch: "feat/ui", parent: "feat/api", forkPoint, feature: null });

beforeEach(async () => {
  repo = await makeRepo();
  base = await repo.commit("base.txt", "base\n", "base");
  await repo.branch("feat/api");
  parentOld = await commitOn("feat/api", "api.txt", "api");
  await repo.branch("feat/ui");
  await commitOn("feat/ui", "ui.txt", "ui");
  await repo.git("switch", "feat/api");
  await repo.git("commit", "--amend", "-m", "api, amended");
});
afterEach(() => repo.cleanup());

test("the configured fork point wins while it is in the branch's history", async () => {
  expect(await forkOf(repo.path, edge(base), await facts("feat/ui"), await facts("feat/api"), parentOld)).toBe(base);
});

test("the hint stands in for a fork point that is missing or outside the branch", async () => {
  const outside = (await repo.git("rev-parse", "feat/api")).trim();
  expect(await forkOf(repo.path, edge(null), await facts("feat/ui"), await facts("feat/api"), parentOld)).toBe(parentOld);
  expect(await forkOf(repo.path, edge(outside), await facts("feat/ui"), await facts("feat/api"), parentOld)).toBe(parentOld);
});

test("without a usable fork point or hint it is the merge base", async () => {
  const outside = (await repo.git("rev-parse", "feat/api")).trim();
  expect(await forkOf(repo.path, edge(null), await facts("feat/ui"), await facts("feat/api"))).toBe(base);
  expect(await forkOf(repo.path, undefined, await facts("feat/ui"), await facts("feat/api"), outside)).toBe(base);
});
