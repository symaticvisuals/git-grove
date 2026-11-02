import { expect, test } from "vitest";
import type { Receipt, StepEvent } from "../../src/core/actions/plan.types.js";
import { DIALOGS, type DialogContext } from "../../ui/src/dialogs/dialog-specs.js";
import { renderPlanBody } from "../../ui/src/render/render-plan-body.js";
import { renderPlanFooter } from "../../ui/src/render/render-plan-footer.js";
import { renderReceipt } from "../../ui/src/render/render-receipt.js";
import { renderSteps } from "../../ui/src/render/render-steps.js";
import { feature, plan, repoView } from "./wire-fixtures.js";

const ctx: DialogContext = { repo: repoView(), feature: feature(), level: null, branch: null, targets: null, worktree: null };

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return { action: "restore", ok: true, refused: false, title: "Restored 3 commits on feat/x", lines: ["Moved feat/x from f01aa41 to d598a02"], pins: ["refs/grove/pins/feat/x/1"], undo: null, at: 1_000, ...overrides };
}

function tagOf(text: string, marker: string): string {
  return [...text.matchAll(/<[a-z]+\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(marker)) ?? "";
}

test("a plan with blockers renders a disabled confirm with the first blocker as the note", () => {
  const blocked = plan({ confirm: "Restack 2 levels", blockers: ["feat/x has uncommitted changes. Turn on set aside, or commit them first.", "second"] });
  const text = renderPlanFooter(blocked, false, null).text;
  expect(tagOf(text, 'data-dlg="confirm"')).toContain("disabled");
  expect(text).toContain("Restack 2 levels");
  expect(text).toContain("feat/x has uncommitted changes. Turn on set aside, or commit them first.");
  expect(text).not.toContain("second");

  const clear = renderPlanFooter(plan({ confirm: "Restack 2 levels", note: "Nothing is pushed." }), false, null).text;
  expect(tagOf(clear, 'data-dlg="confirm"')).not.toContain("disabled");
  expect(clear).toContain("Nothing is pushed.");
});

test("while it re-previews, confirm is disabled and the note reads Checking…; an error replaces the note", () => {
  const checking = renderPlanFooter(plan(), true, null).text;
  expect(tagOf(checking, 'data-dlg="confirm"')).toContain("disabled");
  expect(checking).toContain("Checking…");
  const failed = renderPlanFooter(null, false, "no stack named <x>").text;
  expect(tagOf(failed, 'data-dlg="confirm"')).toContain("disabled");
  expect(failed).toContain("no stack named &lt;x&gt;");
});

test("the git commands disclosure lists every command, escaped", () => {
  const text = renderPlanBody(plan({ commands: ["git grove restore a<b refs/grove/pins/a<b/1", "git worktree remove 'x y'"] }), {}, DIALOGS.restore, ctx, 2_000).text;
  expect(text).toContain('<details class="cmds"');
  expect(text).toContain("Show the git commands");
  expect(text).toContain("git grove restore a&lt;b refs/grove/pins/a&lt;b/1");
  expect(text).toContain("git worktree remove &#39;x y&#39;");
  expect(text).not.toContain("a<b");
});

test("checks render pass and fail with their why", () => {
  const checks = [
    { ok: true, text: "No local edits in 01-x", why: null },
    { ok: false, text: "Uncommitted changes in <02-y>", why: "src/a.ts, src/b.ts" },
  ];
  const text = renderPlanBody(plan({ checks, readAt: 1_000 }), {}, DIALOGS.restack, ctx, 4_000).text;
  expect(text).toContain("No local edits in 01-x");
  expect(text).toMatch(/class="check bad"[^]*Uncommitted changes in &lt;02-y&gt;[^]*<div class="why">src\/a\.ts, src\/b\.ts<\/div>/);
  expect(text).toContain('aria-label="passes"');
  expect(text).toContain('aria-label="fails"');
  expect(text.replace(/<[^>]+>/g, "")).toContain("checked 3 s ago");
  expect(text).toContain('data-at="1000"');
});

test("blockers render as failing checks above the plan's own", () => {
  const text = renderPlanBody(plan({ blockers: ["Nothing to restack"], checks: [{ ok: true, text: "02 onto 01", why: null }] }), {}, DIALOGS.restack, ctx, 2_000).text;
  expect(text.indexOf("Nothing to restack")).toBeLessThan(text.indexOf("02 onto 01"));
});

test("toggles render from the values, effects under What else changes", () => {
  const on = renderPlanBody(plan({ effects: ["Pin each level that moves, so you can undo this."] }), { feature: "coupons", stash: true }, DIALOGS.restack, ctx, 2_000).text;
  expect(tagOf(on, 'data-field="stash"')).toContain("checked");
  expect(on).toContain("What else changes");
  expect(on).toContain("Pin each level that moves, so you can undo this.");
  const off = renderPlanBody(plan(), { feature: "coupons", stash: false }, DIALOGS.restack, ctx, 2_000).text;
  expect(tagOf(off, 'data-field="stash"')).not.toContain("checked");
});

test("before and after lanes render side by side", () => {
  const lane = (caption: string, subject: string) => ({ caption, commits: [{ sha: "a41c0000", subject, tip: true, base: false, lost: false, pinned: false }] });
  const text = renderPlanBody(plan({ before: lane("Now", "squashed"), after: lane("After", "apply <coupon>") }), {}, DIALOGS.restore, ctx, 2_000).text;
  expect(text).toMatch(/class="compare"[^]*Now[^]*squashed[^]*After[^]*apply &lt;coupon&gt;/);
});

test("folders render new entries marked new", () => {
  const folders = [
    { path: "01-feat-gift-cards-model", isNew: false, note: "on main" },
    { path: "02-feat-<ui>", isNew: true, note: "on feat/gift-cards-model" },
  ];
  const expects = [{ kind: "absent" as const, path: "/src/acme-shop/.worktrees/gift-cards/02-feat-<ui>" }];
  const text = renderPlanBody(plan({ action: "add-level", folders, expects }), { feature: "gift cards", branch: "feat/<ui>", on: "x", env: true }, DIALOGS["add-level"], ctx, 2_000).text;
  expect(text).toContain(".worktrees/gift-cards/");
  expect(text).toMatch(/<b>01-feat-gift-cards-model<\/b> <span class="on">on main<\/span>/);
  expect(text).toMatch(/<b>02-feat-&lt;ui&gt;<\/b> <span class="new">new, on feat\/gift-cards-model<\/span>/);
});

test("cleanup picks render from the plan's choices; a blocked one is greyed out with its reason", () => {
  const choices = [
    { id: "/src/acme-shop/.worktrees/fix", label: "fix/invoice", detail: "copies 1 file to main first", selectable: true, selected: true, health: "loses" as const },
    { id: "/src/acme-shop/.worktrees/bump", label: "chore/bump", detail: "2 commits only here", selectable: false, selected: false, health: "loses" as const },
  ];
  const text = renderPlanBody(plan({ action: "cleanup", choices }), {}, DIALOGS.cleanup, ctx, 2_000).text;
  expect(tagOf(text, "fix/invoice")).toBe("");
  const picks = [...text.matchAll(/<label class="pick[^"]*"[^]*?<\/label>/g)].map((match) => match[0]);
  expect(picks).toHaveLength(2);
  expect(tagOf(picks[0] ?? "", "<input")).toContain("checked");
  expect(picks[1]).toContain('class="pick off"');
  expect(tagOf(picks[1] ?? "", "<input")).toContain("disabled");
  expect(picks[1]).toContain("2 commits only here");
});

test("steps render pending, running, done with seconds, failed and skipped from events", () => {
  const steps = ["Check nothing moved", "Pin the current tip", "Move the branch back", "Check all 3 commits are back", "Copy env"].map((title) => ({ title, detail: `${title} detail` }));
  const events: StepEvent[] = [
    { index: 0, state: "running", detail: "", ms: null },
    { index: 0, state: "done", detail: "Still at f01aa41", ms: 412 },
    { index: 1, state: "running", detail: "", ms: null },
    { index: 2, state: "failed", detail: "a <hook> failed", ms: 1_250 },
    { index: 3, state: "skipped", detail: "Not reached", ms: null },
  ];
  const text = renderSteps(plan({ steps }), events).text;
  const items = [...text.matchAll(/<li class="step[^"]*"[^]*?<\/li>/g)].map((match) => match[0]);
  expect(items).toHaveLength(5);
  expect(items[0]).toContain("0.4 s");
  expect(items[0]).toContain("Still at f01aa41");
  expect(items[0]).toContain('aria-label="passes"');
  expect(items[1]).toContain('class="spin"');
  expect(items[2]).toContain('class="step bad"');
  expect(items[2]).toContain("a &lt;hook&gt; failed");
  expect(items[2]).toContain("1.3 s");
  expect(items[3]).toContain('class="step skipped"');
  expect(items[3]).toContain("Not reached");
  expect(items[4]).toContain('class="step pending"');
  expect(items[4]).toContain("Copy env detail");
});

test("a step's last state wins whatever order its events arrive in", () => {
  const steps = [{ title: "Check", detail: "" }];
  const text = renderSteps(plan({ steps }), [
    { index: 0, state: "done", detail: "ok", ms: 30 },
    { index: 0, state: "running", detail: "", ms: null },
  ]).text;
  expect(text).not.toContain('class="spin"');
  expect(text).toContain("0.0 s");
  expect(text).toContain("done");
});

test("an undoable receipt renders Undo; a refused one renders its lines and \"Preview again\"", () => {
  const undoable = renderReceipt(receipt({ undo: [{ branch: "feat/x", pinRef: "refs/grove/pins/feat/x/2" }] })).text;
  expect(undoable).toContain("Restored 3 commits on feat/x");
  expect(undoable).toContain("Moved feat/x from f01aa41 to d598a02");
  expect(undoable).toMatch(/data-dlg="undo"[^>]*>[^]*Undo/);
  expect(undoable).not.toContain("Preview again");

  const refused = renderReceipt(receipt({ ok: false, refused: true, title: "Changed since you looked", lines: ["feat/x moved: was f01aa41, now <b>"], undo: null })).text;
  expect(refused).toContain("Changed since you looked");
  expect(refused).toContain("feat/x moved: was f01aa41, now &lt;b&gt;");
  expect(refused).toContain('data-dlg="again"');
  expect(refused).toContain("Preview again");
  expect(refused).not.toContain('data-dlg="undo"');
  expect(refused).toContain('class="receipt bad"');
});
