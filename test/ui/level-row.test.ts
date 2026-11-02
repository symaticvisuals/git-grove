import { expect, test } from "vitest";
import { levelRow } from "../../ui/src/render/level-row.js";
import { finding, level } from "./wire-fixtures.js";

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);

test('a rewritten level shows "3 commits pinned" as a pin pill and ↓ behind', () => {
  const row = levelRow(
    level({ health: "loses", state: "History rewritten", findings: [finding("history-rewritten", { severity: "loses-work" })], pinnedLost: 3, behindTrunk: 3 }),
    NOW,
  );
  expect(row.pills).toEqual([{ text: "3 commits pinned", pin: true }]);
  expect(row.num).toBe("↓3");
});

test('parent moved shows "+1 parent"', () => {
  const row = levelRow(level({ depth: 2, number: "02", parent: "feat/model", parentCommitsSinceFork: 1, behindTrunk: 5 }), NOW);
  expect(row.num).toBe("+1 parent");
});

test('a pushed level with nothing ahead shows "pushed"', () => {
  expect(levelRow(level({ upstream: { ahead: 0, behind: 0, gone: false } }), NOW).pills).toEqual([{ text: "pushed", pin: false }]);
  expect(levelRow(level({ upstream: { ahead: 2, behind: 0, gone: false } }), NOW).pills).toEqual([{ text: "2 to push", pin: false }]);
});

test("a merged level with an ignored file and a change shows each, and no pushed", () => {
  const row = levelRow(
    level({
      merged: true,
      precious: 1,
      upstream: { ahead: 0, behind: 0, gone: false },
      worktree: { path: "/w", rel: "w", dirty: 2, operation: null, touchedAt: null },
    }),
    NOW,
  );
  expect(row.pills.map((pill) => pill.text)).toEqual(["merged", "1 ignored file", "2 changes"]);
});

test("when is the time since the worktree was last touched", () => {
  const at = (ms: number) => levelRow(level({ worktree: { path: "/w", rel: "w", dirty: 0, operation: null, touchedAt: NOW - ms } }), NOW).when;
  expect(at(10_000)).toBe("now");
  expect(at(4 * 60_000)).toBe("4m");
  expect(at(3 * 3_600_000)).toBe("3h");
  expect(at(16 * 86_400_000)).toBe("16d");
  expect(levelRow(level({ worktree: null }), NOW).when).toBe("");
});
