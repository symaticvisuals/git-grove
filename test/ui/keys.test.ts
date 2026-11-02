import { expect, test } from "vitest";
import { adjacentRow } from "../../ui/src/adjacent-row.js";
import { cycleFocus } from "../../ui/src/cycle-focus.js";
import { keyCommand, type KeyInput } from "../../ui/src/keys.js";
import { paletteChoice } from "../../ui/src/palette/palette-choice.js";
import type { PaletteItem } from "../../ui/src/palette/palette-items.js";
import { shortcutTarget } from "../../ui/src/shortcut-target.js";
import { feature, finding, level, repoView } from "./wire-fixtures.js";

function key(name: string, overrides: Partial<KeyInput> = {}): KeyInput {
  return { key: name, meta: false, ctrl: false, alt: false, repeat: false, typing: false, submits: false, onControl: false, onRow: false, onGroup: false, ...overrides };
}

test("⌘K and Ctrl-K open the palette from the page, even a text field, and close it again; in a dialog they do nothing", () => {
  expect(keyCommand(key("k", { meta: true }), "page")).toBe("palette");
  expect(keyCommand(key("K", { ctrl: true, typing: true }), "page")).toBe("palette");
  expect(keyCommand(key("k", { meta: true }), "palette")).toBe("close");
  expect(keyCommand(key("k", { meta: true }), "dialog")).toBeNull();
  expect(keyCommand(key("K", { ctrl: true, typing: true, submits: true }), "dialog")).toBeNull();
});

test("a held key repeats no shortcut and no Enter; the palette's arrows still repeat", () => {
  for (const name of ["n", "r", "s", "a", "j", "k"]) expect(keyCommand(key(name, { repeat: true }), "page")).toBeNull();
  expect(keyCommand(key("k", { meta: true, repeat: true }), "page")).toBeNull();
  expect(keyCommand(key("Enter", { repeat: true, typing: true, submits: true }), "dialog")).toBeNull();
  expect(keyCommand(key("Enter", { repeat: true, typing: true }), "palette")).toBeNull();
  expect(keyCommand(key("Escape", { repeat: true }), "dialog")).toBeNull();
  expect(keyCommand(key("ArrowDown", { repeat: true, typing: true }), "palette")).toBe("down");
});

test("the page's letters open dialogs and move the selection, but not while typing or with a modifier", () => {
  expect(keyCommand(key("n"), "page")).toBe("new");
  expect(keyCommand(key("N"), "page")).toBe("new");
  expect(keyCommand(key("r"), "page")).toBe("quick");
  expect(keyCommand(key("s"), "page")).toBe("restack");
  expect(keyCommand(key("a"), "page")).toBe("ack");
  expect(keyCommand(key("j"), "page")).toBe("next");
  expect(keyCommand(key("k"), "page")).toBe("prev");
  expect(keyCommand(key("n", { typing: true }), "page")).toBeNull();
  expect(keyCommand(key("r", { meta: true }), "page")).toBeNull();
  expect(keyCommand(key("Escape"), "page")).toBeNull();
});

test("the arrow keys move the selection only from a row", () => {
  expect(keyCommand(key("ArrowDown", { onRow: true }), "page")).toBe("next");
  expect(keyCommand(key("ArrowUp", { onRow: true }), "page")).toBe("prev");
  expect(keyCommand(key("ArrowDown"), "page")).toBeNull();
});

test("in a dialog Esc closes; Enter confirms only from a field where Enter submits, never from the page or the box", () => {
  expect(keyCommand(key("Escape"), "dialog")).toBe("close");
  expect(keyCommand(key("Enter", { typing: true, submits: true }), "dialog")).toBe("confirm");
  expect(keyCommand(key("Enter"), "dialog")).toBeNull();
  expect(keyCommand(key("Enter", { typing: true }), "dialog")).toBeNull();
  expect(keyCommand(key("Enter", { onControl: true }), "dialog")).toBeNull();
  expect(keyCommand(key("n"), "dialog")).toBeNull();
  expect(keyCommand(key("j"), "dialog")).toBeNull();
});

test("← on a row or open group folds it, → on a folded group unfolds it, and the arrows walk headers too", () => {
  expect(keyCommand(key("ArrowLeft", { onRow: true }), "page")).toBe("fold");
  expect(keyCommand(key("ArrowLeft", { onGroup: true }), "page")).toBe("fold");
  expect(keyCommand(key("ArrowRight", { onGroup: true }), "page")).toBe("unfold");
  expect(keyCommand(key("ArrowRight", { onRow: true }), "page")).toBeNull();
  expect(keyCommand(key("ArrowDown", { onGroup: true }), "page")).toBe("next");
  expect(keyCommand(key("ArrowLeft"), "page")).toBeNull();
});

test("Tab and Shift+Tab cycle inside a dialog, never leaving it", () => {
  expect(cycleFocus(0, 3, false)).toBe(1);
  expect(cycleFocus(2, 3, false)).toBe(0);
  expect(cycleFocus(0, 3, true)).toBe(2);
  expect(cycleFocus(-1, 3, false)).toBe(0);
  expect(cycleFocus(-1, 3, true)).toBe(2);
  expect(cycleFocus(-1, 0, false)).toBeNull();
});

test("the palette runs the item it painted, its index held to a list that shrank", () => {
  const item = (text: string): PaletteItem => ({ kind: "Go to", text, hint: null, run: { route: { view: "pins" } } });
  const painted = [item("a"), item("b")];
  expect(paletteChoice(painted, 1)).toEqual({ index: 1, item: painted[1] });
  expect(paletteChoice(painted, 7)).toEqual({ index: 1, item: painted[1] });
  expect(paletteChoice([], 3)).toEqual({ index: 0, item: null });
});

test("in the palette the arrows move, Enter runs and Esc closes", () => {
  expect(keyCommand(key("ArrowDown", { typing: true }), "palette")).toBe("down");
  expect(keyCommand(key("ArrowUp", { typing: true }), "palette")).toBe("up");
  expect(keyCommand(key("Enter", { typing: true }), "palette")).toBe("run-item");
  expect(keyCommand(key("Escape", { typing: true }), "palette")).toBe("close");
  expect(keyCommand(key("n", { typing: true }), "palette")).toBeNull();
});

test("j and k step through the rows in order and stop at the ends", () => {
  const rows = ["#/r/1/f/a/x", "#/r/1/f/a/y", "#/r/1/detached"];
  expect(adjacentRow(rows, "#/r/1/f/a/x", 1)).toBe("#/r/1/f/a/y");
  expect(adjacentRow(rows, "#/r/1/detached", 1)).toBe("#/r/1/detached");
  expect(adjacentRow(rows, "#/r/1/f/a/x", -1)).toBe("#/r/1/f/a/x");
  expect(adjacentRow(rows, null, -1)).toBe("#/r/1/f/a/x");
  expect(adjacentRow([], null, 1)).toBeNull();
});

const rewritten = level({ branch: "feat/model", number: "01", health: "loses", pinnedLost: 3, findings: [finding("history-rewritten", { severity: "loses-work" })] });
const moved = level({ branch: "feat/ui", number: "02", depth: 2, health: "action", findings: [finding("parent-moved")] });
const merged = level({ branch: "fix/rounding", number: null, health: "loses", findings: [finding("unsafe-merged-worktree", { severity: "loses-work" })], worktree: { path: "/w/fix", rel: "fix", dirty: 0, operation: null, touchedAt: null } });
const fine = level({ branch: "feat/fine", number: "01" });
const stack = feature({ id: "1.cw", name: "coupons", levels: [rewritten, moved] });
const calm = feature({ id: "1.Yw", name: "calm", levels: [fine] });
const singles = feature({ id: "1.cg", name: "fix/rounding", kind: "single", levels: [merged] });
const repo = repoView({ features: [stack, calm, singles], orphans: [{ branch: "feat/gone", lost: ["a41c0000"], pinRef: "refs/grove/pins/feat/gone/1", lastTip: "a41c0000", at: 1 }] });

test("R is the selected row's primary fix: bring back, restack or copy then remove", () => {
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.cw", branch: "feat/model" }, "quick")).toEqual({ action: "restore", data: { feature: "1.cw", branch: "feat/model" } });
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.cw", branch: "feat/ui" }, "quick")).toEqual({ action: "restack", data: { feature: "1.cw" } });
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.cg", branch: "fix/rounding" }, "quick")).toEqual({ action: "remove", data: { feature: "1.cg", branch: "fix/rounding", path: "/w/fix" } });
  expect(shortcutTarget(repo, { kind: "deleted", branch: "feat/gone" }, "quick")).toEqual({ action: "restore", data: { branch: "feat/gone", pin: "refs/grove/pins/feat/gone/1" } });
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.Yw", branch: "feat/fine" }, "quick")).toBeNull();
  expect(shortcutTarget(repo, null, "quick")).toBeNull();
});

test("S restacks the selected row's stack when one of its levels needs it; A keeps a rewrite or a deletion", () => {
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.cw", branch: "feat/model" }, "restack")).toEqual({ action: "restack", data: { feature: "1.cw" } });
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.Yw", branch: "feat/fine" }, "restack")).toBeNull();
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.cw", branch: "feat/model" }, "ack")).toEqual({ action: "ack", data: { feature: "1.cw", branch: "feat/model" } });
  expect(shortcutTarget(repo, { kind: "deleted", branch: "feat/gone" }, "ack")).toEqual({ action: "ack", data: { branch: "feat/gone" } });
  expect(shortcutTarget(repo, { kind: "feature", feature: "1.cw", branch: "feat/ui" }, "ack")).toBeNull();
});
