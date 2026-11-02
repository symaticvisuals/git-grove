import { expect, test } from "vitest";
import type { WireRepoView } from "../../src/server/wire/wire.types.js";
import { paletteItems } from "../../ui/src/palette/palette-items.js";
import { sliceRequests } from "../../ui/src/slice-requests.js";
import { initialState, reduce, type State } from "../../ui/src/state.js";
import { feature, finding, level, project, repoView } from "./wire-fixtures.js";

const coupons = feature({
  id: "1.Y291cG9ucw",
  name: "checkout coupons",
  health: "loses",
  levels: [
    level({ branch: "feat/coupons-model", depth: 1, number: "01", health: "loses", pinnedLost: 3, findings: [finding("history-rewritten", { severity: "loses-work" })] }),
    level({ branch: "feat/coupons-ui", depth: 2, number: "02", health: "action", findings: [finding("parent-moved")] }),
  ],
});

const gifts = feature({ id: "1.Z2lmdHM", name: "gift cards", levels: [level({ branch: "feat/gift-cards", depth: 1, number: "01" })] });

function shown(view: WireRepoView): State {
  const start = initialState({ view: "repo", repo: 1, pick: null }, "1.0.0");
  const key = sliceRequests(start).repo?.key ?? "";
  const withRepo = reduce(start, { type: "loaded", key, result: { slice: "repo", data: view } });
  return reduce(withRepo, { type: "loaded", key: "projects", result: { slice: "projects", data: [view.project, project({ id: 2, name: "api" })] } });
}

const state = shown(repoView({ features: [coupons, gifts], cleanupCount: 2 }));

test("an empty query lists Actions before Go to", () => {
  const items = paletteItems(state, "");
  const kinds = items.map((item) => item.kind);
  expect(kinds[0]).toBe("Actions");
  expect(kinds.lastIndexOf("Actions")).toBeLessThan(kinds.indexOf("Go to"));
  expect(items[0]).toMatchObject({ text: "Start a new feature", hint: "N", run: { open: "new" } });
  expect(items.map((item) => item.text)).toEqual(expect.arrayContaining(["Clean up worktrees", "Scan now", "feat/coupons-ui", "feat/gift-cards", "api"]));
  expect(items.find((item) => item.text === "Clean up worktrees")?.hint).toBe("2 safe");
  expect(items.find((item) => item.text === "Scan now")?.run).toEqual({ scan: 1 });
});

test("\"restack\" finds the restack action for the stack that needs one", () => {
  const items = paletteItems(state, "restack");
  expect(items.map((item) => item.text)).toEqual(["Restack checkout coupons"]);
  const [item] = items;
  expect(item?.hint).toBe("S");
  expect(item?.run).toMatchObject({ open: "restack", ctx: { feature: { name: "checkout coupons" } } });
});

test("a rewritten level adds \"Bring back N commits on <branch>\"", () => {
  const items = paletteItems(state, "bring back");
  expect(items.map((item) => item.text)).toEqual(["Bring back 3 commits on feat/coupons-model"]);
  expect(items[0]?.run).toMatchObject({ open: "restore", ctx: { targets: [{ branch: "feat/coupons-model" }] } });
  expect(paletteItems(state, "keep the squash").map((item) => item.run)).toMatchObject([{ open: "ack", ctx: { branch: "feat/coupons-model" } }]);
});

test("Go to a branch routes to its row", () => {
  const [item] = paletteItems(state, "gift-cards");
  expect(item).toMatchObject({ kind: "Go to", text: "feat/gift-cards", hint: "gift cards" });
  expect(item?.run).toEqual({ route: { view: "repo", repo: 1, pick: { kind: "feature", feature: "1.Z2lmdHM", branch: "feat/gift-cards" } } });
});

test("the filter ignores case and matches anywhere in the text", () => {
  expect(paletteItems(state, "COUPONS-UI").map((item) => item.text)).toEqual(["feat/coupons-ui"]);
});

test("no match gives []", () => {
  expect(paletteItems(state, "zebra")).toEqual([]);
});

test("away from a repo it offers the views and the repos", () => {
  const home = reduce(initialState({ view: "projects" }, "1.0.0"), { type: "loaded", key: "projects", result: { slice: "projects", data: [project()] } });
  const items = paletteItems(home, "");
  expect(items.map((item) => item.text)).toEqual(["Needs you", "Activity", "Pins", "acme-shop"]);
  expect(items.every((item) => item.kind === "Go to")).toBe(true);
});
