import { expect, test } from "vitest";
import { cleanupLabel } from "../../ui/src/cleanup-label.js";

test("the cleanup chip says how many are safe, and how many need a rescue first", () => {
  expect(cleanupLabel({ cleanupCount: 0, rescueCount: 0 })).toBeNull();
  expect(cleanupLabel({ cleanupCount: 2, rescueCount: 0 })).toBe("2 worktrees safe to clean up");
  expect(cleanupLabel({ cleanupCount: 0, rescueCount: 1 })).toBe("1 worktree to clean up, needs a rescue");
  expect(cleanupLabel({ cleanupCount: 0, rescueCount: 2 })).toBe("2 worktrees to clean up, need a rescue");
  expect(cleanupLabel({ cleanupCount: 2, rescueCount: 1 })).toBe("3 worktrees to clean up, 1 needs a rescue");
});
