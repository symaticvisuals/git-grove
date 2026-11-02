import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { pinChoicePlan } from "../../../src/core/actions/pin-choice-plan.js";
import type { RepoFacts } from "../../../src/core/facts/facts.types.js";
import { readRepoFacts } from "../../../src/core/facts/read-repo-facts.js";
import type { PinEntry } from "../../../src/core/runner/list-pins.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let repo: TestRepo;
let facts: RepoFacts;

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit("base.txt", "base\n", "base");
  facts = await readRepoFacts(repo.path);
});
afterEach(() => repo.cleanup());

function pins(count: number): PinEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const at = `202611${String(20 - index).padStart(2, "0")}T070000Z`;
    return { ref: `refs/grove/pins/feat/${at}`, sha: String(index).padStart(40, "a"), branch: "feat", at };
  });
}

test("a branch with many pins shows the newest 10 and points at pins list for the rest", () => {
  const all = pins(14);
  const plan = pinChoicePlan(facts, [{ branch: "feat", pins: all }]);
  expect(plan.blockers).toHaveLength(12);
  expect(plan.blockers[1]).toBe(`${all[0]?.ref} at aaaaaaa, pinned 2026-11-20 07:00 UTC`);
  expect(plan.blockers[10]).toBe(`${all[9]?.ref} at aaaaaaa, pinned 2026-11-11 07:00 UTC`);
  expect(plan.blockers[11]).toBe("and 4 older pins: git grove pins list feat");
  expect(plan.commands).toEqual(all.slice(0, 10).map((pin) => `git grove restore feat ${pin.ref}`));
});

test("ten pins or fewer are all shown, with no pointer line", () => {
  const plan = pinChoicePlan(facts, [{ branch: "feat", pins: pins(10) }]);
  expect(plan.blockers).toHaveLength(11);
  expect(plan.blockers.at(-1)).not.toContain("older pin");
  expect(pinChoicePlan(facts, [{ branch: "feat", pins: pins(11) }]).blockers.at(-1)).toBe("and 1 older pin: git grove pins list feat");
});
