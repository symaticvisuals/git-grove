import { expect, test } from "vitest";
import type { Plan, Receipt } from "../../src/core/actions/plan.types.js";
import { renderPlan } from "../../src/cli/render-plan.js";
import { renderReceipt } from "../../src/cli/render-receipt.js";
import { renderStepEvent } from "../../src/cli/render-step-event.js";

const PIN = "refs/grove/pins/feat/20261101T173014Z";

const plan: Plan = {
  action: "restore",
  context: "Singles",
  title: "Bring back 3 commits on feat",
  summary: "The branch goes back at d598a02, the tip grove pinned. Nothing is deleted.",
  confirm: "Bring back 3 commits",
  before: {
    caption: "Now",
    commits: [
      { sha: "a41c0de", subject: "main", tip: false, base: true, lost: false, pinned: false },
      { sha: "f01aa41", subject: "squashed", tip: true, base: false, lost: false, pinned: false },
    ],
  },
  after: null,
  folders: null,
  choices: null,
  checks: [
    { ok: true, text: "No local edits in .worktrees/feat", why: null },
    { ok: false, text: "A rebase is in progress in the main checkout", why: "Finish or abort it first." },
  ],
  effects: ["Keep the current tip, f01aa41, in its own pin, so you can undo this."],
  commands: [`git grove restore feat ${PIN}`],
  steps: [
    { title: "Check nothing moved since you looked", detail: "Still at f01aa41, worktree clean" },
    { title: "Pin the current tip", detail: "f01aa41" },
  ],
  blockers: ["feat has a rebase in progress in the main checkout. Finish or abort it first."],
  note: null,
  undoable: true,
  moves: ["feat"],
  expects: [],
  readAt: 0,
};

test("a restore plan renders its title, its checks and its command", () => {
  const text = renderPlan(plan);
  expect(text.split("\n").slice(0, 2)).toEqual(["Singles", "Bring back 3 commits on feat"]);
  expect(text).toContain("\nChecks\n  ✓ No local edits in .worktrees/feat\n  ✖ A rebase is in progress in the main checkout\n      Finish or abort it first.\n");
  expect(text).toContain(`\nCommands\n  git grove restore feat ${PIN}\n`);
  expect(text).toContain("\nNow\n  f01aa41  squashed  (tip)\n  a41c0de  main\n");
  expect(text).toContain("\nBlocked\n  ✖ feat has a rebase in progress");
});

test("a step event renders its title, then its detail and time once done", () => {
  expect(renderStepEvent(plan, { index: 1, state: "running", detail: "", ms: null })).toBe("  … Pin the current tip\n");
  expect(renderStepEvent(plan, { index: 1, state: "done", detail: PIN, ms: 12 })).toBe(`  ✓ Pin the current tip  ${PIN} (12 ms)\n`);
  expect(renderStepEvent(plan, { index: 0, state: "skipped", detail: "Not run", ms: null })).toBe(
    "  - Check nothing moved since you looked  skipped: Not run\n",
  );
});

test("a receipt renders its title, lines, pins and undo command", () => {
  const receipt: Receipt = {
    action: "restore",
    ok: true,
    refused: false,
    title: "Restored 3 commits on feat",
    lines: ["3 of 3 commits are back"],
    pins: [{ ref: PIN, reused: false }],
    undo: [{ branch: "feat", pinRef: PIN }],
    at: 0,
  };
  expect(renderReceipt(receipt)).toBe(
    `✓ Restored 3 commits on feat\n  3 of 3 commits are back\n  pinned ${PIN}\n  undo: git grove restore feat ${PIN}\n`,
  );
});

test("a pin that already pointed at the tip reads already pinned, not pinned", () => {
  const old = "refs/grove/pins/feat/coupon-ui/20261102T070013Z";
  const receipt: Receipt = { action: "restack", ok: true, refused: false, title: "Restacked 1 level", lines: [], pins: [{ ref: old, reused: true }], undo: null, at: 0 };
  expect(renderReceipt(receipt)).toBe(`✓ Restacked 1 level\n  already pinned at ${old}\n`);
});
