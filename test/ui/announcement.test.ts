import { expect, test } from "vitest";
import { announcement } from "../../ui/src/announcement.js";
import { notices } from "../../ui/src/render/notices.js";
import { failed } from "../../ui/src/render/failed.js";
import { loading } from "../../ui/src/render/loading.js";
import { sliceRequests } from "../../ui/src/slice-requests.js";
import { initialState, reduce, type State, type UiAction } from "../../ui/src/state.js";
import { activityItem, feature, plan, repoView } from "./wire-fixtures.js";

const START = initialState({ view: "repo", repo: 1, pick: null }, "1.0.0");

function said(state: State, action: UiAction): string | null {
  return announcement(state, reduce(state, action), action);
}

test("a new alert is announced; an info change is not", () => {
  expect(said(START, { type: "event", at: 1, event: { type: "activity", item: activityItem({ title: "History rewritten on feat/x", severity: "loses-work" }) } })).toBe("History rewritten on feat/x.");
  expect(said(START, { type: "event", at: 1, event: { type: "activity", item: activityItem({ severity: "info" }) } })).toBeNull();
});

test("a load that newly fails is announced once, not again with the same message", () => {
  const key = sliceRequests(START).repo?.key ?? "";
  const fail: UiAction = { type: "failed", slice: "repo", key, status: 0, message: "git grove isn't running. Start it with git grove ui." };
  expect(said(START, fail)).toBe("git grove isn't running. Start it with git grove ui.");
  expect(said(reduce(START, fail), fail)).toBeNull();
});

test("dropping, being busy, an update and signing out are each announced on the change only", () => {
  expect(said(START, { type: "live", state: "down" })).toBe("git grove isn't running. Start it with git grove ui.");
  expect(said(START, { type: "live", state: "down", problem: "busy" })).toBe("Too many open dashboards. Close one and this one reconnects.");
  const dropped = reduce(START, { type: "live", state: "down" });
  expect(said(dropped, { type: "live", state: "down" })).toBeNull();
  expect(said(START, { type: "event", at: 1, event: { type: "hello", version: "2.0.0" } })).toBe("git grove was updated. Reload to use the new dashboard.");
  expect(said(START, { type: "signed-out" })).toBe("Open the dashboard from your terminal: git grove ui");
  expect(said(START, { type: "tab", tab: "health" })).toBeNull();
});

test("repainted states carry no live role, so a repaint announces nothing", () => {
  for (const out of [failed("x", "repo").text, loading().text, notices({ liveDropped: true, live: "down", liveProblem: "unreachable", updateAvailable: true }).text]) {
    expect(out).not.toMatch(/role="(alert|status)"|aria-live/);
  }
});

test("the busy notice asks to close a dashboard; a refused connection still says git grove isn't running", () => {
  expect(notices({ liveDropped: true, live: "connecting", liveProblem: "busy", updateAvailable: false }).text).toContain("Too many open dashboards. Close one and this one reconnects.");
  expect(notices({ liveDropped: true, live: "down", liveProblem: "unreachable", updateAvailable: false }).text).toContain("git grove isn&#39;t running");
});

test("each run step is announced once, when it first finishes or fails", () => {
  const view = repoView();
  const shown = reduce(START, { type: "loaded", key: sliceRequests(START).repo?.key ?? "", result: { slice: "repo", data: view } });
  const ctx = { repo: view, feature: feature(), level: null, branch: null, targets: null, worktree: null };
  const steps = ["Check nothing moved since you looked", "Pin the current tip", "Move the branch back", "Check all 3 commits are back"].map((title) => ({ title, detail: "" }));
  let state = reduce(shown, { type: "dialog-open", action: "restore", ctx });
  state = reduce(state, { type: "dialog-planned", dialog: state.dialog?.id ?? 0, revision: 0, planId: "p", plan: plan({ steps }) });
  state = reduce(state, { type: "dialog-armed", dialog: state.dialog?.id ?? 0, planId: "p" });
  state = reduce(reduce(state, { type: "dialog-confirm", planId: "p" }), { type: "run-started", planId: "p", runId: "r" });
  const event = (runId: string, index: number, kind: "running" | "done" | "failed"): UiAction => ({ type: "event", at: 1, event: { type: "step", runId, event: { index, state: kind, detail: "", ms: 3 } } });
  expect(said(state, event("r", 1, "running"))).toBeNull();
  const pinned = reduce(state, event("r", 1, "done"));
  expect(announcement(state, pinned, event("r", 1, "done"))).toBe("Step 2 of 4 done: Pin the current tip");
  expect(said(pinned, event("r", 1, "done"))).toBeNull();
  expect(said(pinned, event("r", 2, "failed"))).toBe("Step 3 of 4 failed: Move the branch back");
  expect(said(pinned, event("other", 3, "done"))).toBeNull();
  const synced: UiAction = { type: "run-synced", runId: "r", request: 1, state: { plan: plan({ steps }), events: [{ index: 0, state: "done", detail: "", ms: 2 }, { index: 1, state: "done", detail: "", ms: 3 }], receipt: null } };
  expect(said(state, synced)).toBe("Step 1 of 4 done: Check nothing moved since you looked. Step 2 of 4 done: Pin the current tip");
});
