import { expect, test } from "vitest";
import { findFeature } from "../../../src/core/stacks/find-feature.js";
import type { Feature, Level } from "../../../src/core/stacks/stacks.types.js";

function level(branch: string, parent: string, depth: number): Level {
  return {
    branch,
    parent,
    depth,
    worktree: null,
    parentCommitsSinceFork: 0,
    behindTrunk: 0,
    parentMerged: false,
    parentMissing: false,
  };
}

const features: Feature[] = [
  { name: "feat/search", kind: "stack", levels: [level("feat/search", "main", 1)] },
  { name: "checkout", kind: "stack", levels: [level("feat/model", "main", 1), level("feat/search", "feat/model", 2)] },
];

test("a name matches before a branch does", () => {
  expect(findFeature(features, "feat/search")?.name).toBe("feat/search");
  expect(findFeature(features, "checkout")?.name).toBe("checkout");
});

test("any level's branch finds its feature, and nothing else finds one", () => {
  expect(findFeature(features, "feat/model")?.name).toBe("checkout");
  expect(findFeature(features, "nope")).toBeNull();
});
