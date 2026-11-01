import { expect, test } from "vitest";
import type { RepoFacts, StackEdge, WorktreeFacts } from "../../../src/core/facts/facts.types.js";
import { groupFeatures } from "../../../src/core/stacks/group-features.js";

function worktree(path: string, branch: string | null, overrides: Partial<WorktreeFacts> = {}): WorktreeFacts {
  return {
    path,
    gitDir: `${path}/.git`,
    head: "a".repeat(40),
    branch,
    isMain: false,
    locked: false,
    prunable: false,
    operation: null,
    changes: null,
    touchedAt: null,
    ...overrides,
  };
}

function facts(branches: string[], edges: StackEdge[], worktrees: WorktreeFacts[]): RepoFacts {
  return {
    root: "/r",
    commonDir: "/r/.git",
    trunk: { name: "main", ref: "main", sha: "a".repeat(40) },
    lastFetchAt: null,
    worktrees: [worktree("/r", "main", { isMain: true }), ...worktrees],
    branches: ["main", ...branches].map((name) => ({ name, tip: "a".repeat(40), upstream: null })),
    edges,
    stashes: [],
    pins: [],
    readAt: 0,
  };
}

const edge = (branch: string, parent: string, feature: string | null = null): StackEdge => ({
  branch,
  parent,
  forkPoint: null,
  feature,
});

test("a stack with a fan-out groups into one feature, parents before children", () => {
  const result = groupFeatures(
    facts(
      ["feat/api", "feat/ui", "feat/admin"],
      [edge("feat/ui", "feat/api"), edge("feat/api", "main"), edge("feat/admin", "feat/api")],
      [worktree("/w/api", "feat/api")],
    ),
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.kind).toBe("stack");
  expect(result[0]?.name).toBe("feat/api");
  expect(result[0]?.branches[0]).toBe("feat/api");
  expect([...(result[0]?.branches ?? [])].sort()).toEqual(["feat/admin", "feat/api", "feat/ui"]);
});

test("grovefeature on the root names the stack", () => {
  const result = groupFeatures(facts(["feat/api"], [edge("feat/api", "main", "checkout")], []));
  expect(result[0]?.name).toBe("checkout");
});

test("a stack whose root parent branch is missing still roots there", () => {
  const result = groupFeatures(facts(["feat/ui"], [edge("feat/ui", "gone")], []));
  expect(result.map((f) => f.name)).toEqual(["feat/ui"]);
});

test("a branch with no worktree and no stack is not a feature", () => {
  expect(groupFeatures(facts(["lonely"], [], []))).toEqual([]);
});

test("a branch with a worktree outside any stack is a single", () => {
  const result = groupFeatures(facts(["solo"], [], [worktree("/w/solo", "solo")]));
  expect(result).toEqual([{ name: "solo", kind: "single", branches: ["solo"] }]);
});

test("the trunk is never a feature", () => {
  expect(groupFeatures(facts([], [], []))).toEqual([]);
});

test("detached worktrees form one detached feature, prunable ones excluded", () => {
  const result = groupFeatures(
    facts([], [], [worktree("/w/1", null), worktree("/w/2", null), worktree("/w/3", null, { prunable: true })]),
  );
  expect(result).toEqual([{ name: "detached", kind: "detached", branches: [] }]);
});
