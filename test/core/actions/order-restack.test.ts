import { expect, test } from "vitest";
import { orderRestack } from "../../../src/core/actions/restack/order-restack.js";
import type { Feature, Level } from "../../../src/core/stacks/stacks.types.js";

function level(branch: string, parent: string, depth: number, overrides: Partial<Level> = {}): Level {
  return {
    branch,
    parent,
    depth,
    worktree: null,
    parentCommitsSinceFork: 0,
    behindTrunk: 0,
    parentMerged: false,
    parentMissing: false,
    ...overrides,
  };
}

function feature(levels: Level[]): Feature {
  return { name: "checkout", kind: "stack", levels };
}

const drifted = (): Feature =>
  feature([
    level("feat/model", "main", 1, { parentCommitsSinceFork: 4, behindTrunk: 4 }),
    level("feat/ui", "feat/model", 2, { parentCommitsSinceFork: 1 }),
    level("feat/admin", "feat/model", 2),
    level("feat/email", "feat/ui", 3),
  ]);

test("level 1 never moves", () => {
  const { moves, untouched } = orderRestack(drifted(), "main");
  expect(moves.map((move) => move.branch)).not.toContain("feat/model");
  expect(untouched).not.toContain("feat/model");
});

test("a child of a moving level moves even when it did not drift", () => {
  const { moves } = orderRestack(drifted(), "main");
  expect(moves).toEqual([
    { branch: "feat/ui", onto: "feat/model", ontoTrunk: false, reason: "parent-moved" },
    { branch: "feat/email", onto: "feat/ui", ontoTrunk: false, reason: "parent-restacked" },
  ]);
});

test("a level whose parent merged moves onto the trunk", () => {
  const { moves } = orderRestack(
    feature([
      level("feat/model", "main", 1),
      level("feat/ui", "feat/model", 2, { parentMerged: true, parentCommitsSinceFork: 1 }),
      level("feat/email", "feat/ui", 3),
    ]),
    "main",
  );
  expect(moves).toEqual([
    { branch: "feat/ui", onto: "main", ontoTrunk: true, reason: "parent-merged" },
    { branch: "feat/email", onto: "feat/ui", ontoTrunk: false, reason: "parent-restacked" },
  ]);
});

test("admin with no drift stays in untouched", () => {
  expect(orderRestack(drifted(), "main").untouched).toEqual(["feat/admin"]);
});

test("levels listed child first still move parent first", () => {
  const { moves } = orderRestack(
    feature([
      level("feat/email", "feat/ui", 3),
      level("feat/ui", "feat/model", 2, { parentCommitsSinceFork: 2 }),
      level("feat/model", "main", 1),
    ]),
    "main",
  );
  expect(moves.map((move) => move.branch)).toEqual(["feat/ui", "feat/email"]);
});
