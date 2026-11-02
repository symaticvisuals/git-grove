import { expect, test } from "vitest";
import type { Choice, Receipt, StepEvent } from "../../src/core/actions/plan.types.js";
import type { DialogContext } from "../../ui/src/dialogs/dialog-specs.js";
import { loadable } from "../../ui/src/loadable.js";
import { sliceRequests } from "../../ui/src/slice-requests.js";
import { initialState, reduce, type State, type UiAction } from "../../ui/src/state.js";
import { feature, finding, level, plan, repoView } from "./wire-fixtures.js";

const coupons = feature({ name: "checkout coupons", levels: [level({ branch: "feat/coupons-ui", health: "action", findings: [finding("parent-moved")] })] });
const view = repoView({ features: [coupons], detached: [{ path: "/r/a", rel: "a", head: null, touchedAt: null, health: "fine", state: "" }, { path: "/r/b", rel: "b", head: null, touchedAt: null, health: "fine", state: "" }] });
const ctx: DialogContext = { repo: view, feature: coupons, level: null, branch: null, targets: null, worktree: null };

function run(state: State, ...actions: UiAction[]): State {
  return actions.reduce(reduce, state);
}

function start(): State {
  const blank = initialState({ view: "repo", repo: 1, pick: null }, "1.0.0");
  return reduce(blank, { type: "loaded", key: sliceRequests(blank).repo?.key ?? "", result: { slice: "repo", data: view } });
}

function opened(action: "restack" | "new" | "cleanup" = "restack"): State {
  return reduce(start(), { type: "dialog-open", action, ctx });
}

function planned(state: State, overrides: Parameters<typeof plan>[0] = {}): State {
  const dialog = state.dialog;
  if (dialog === null) throw new Error("no dialog");
  return reduce(state, { type: "dialog-planned", dialog: dialog.id, revision: dialog.revision, planId: `p${dialog.revision}`, plan: plan(overrides) });
}

function step(index: number, state: StepEvent["state"], ms: number | null = null): StepEvent {
  return { index, state, detail: "", ms };
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return { action: "restack", ok: true, refused: false, title: "Restacked 1 level", lines: [], pins: ["refs/grove/pins/feat/coupons-ui/1"], undo: [{ branch: "feat/coupons-ui", pinRef: "refs/grove/pins/feat/coupons-ui/1" }], at: 9, ...overrides };
}

function running(): State {
  const ready = planned(opened());
  return run(ready, { type: "dialog-confirm" }, { type: "run-started", planId: "p0", runId: "r1" });
}

test("opening a dialog previews at once with the spec's first values", () => {
  const state = opened();
  expect(state.dialog).toMatchObject({ action: "restack", repoId: 1, stage: "review", planning: true, debounce: false, revision: 0, plan: null, values: { feature: "checkout coupons", stash: true } });
  expect(state.palette).toBeNull();
});

test("a field change re-previews after a pause, and a reply for an older revision is dropped", () => {
  const ready = planned(opened());
  expect(ready.dialog).toMatchObject({ planning: false, planId: "p0" });
  const changed = reduce(ready, { type: "dialog-field", name: "stash", value: false });
  expect(changed.dialog).toMatchObject({ revision: 1, planning: true, debounce: true, values: { stash: false } });
  expect(changed.dialog?.plan).not.toBeNull();
  const late = reduce(changed, { type: "dialog-planned", dialog: changed.dialog?.id ?? 0, revision: 0, planId: "old", plan: plan() });
  expect(late.dialog).toMatchObject({ planning: true, revision: 1 });
  const fresh = planned(changed, { blockers: ["feat/coupons-ui has uncommitted changes. Turn on set aside, or commit them first."] });
  expect(fresh.dialog).toMatchObject({ planning: false, planId: "p1" });
  expect(reduce(fresh, { type: "dialog-confirm" }).run).toBeNull();
});

test("a reply for a dialog that was closed and opened again is dropped", () => {
  const first = opened();
  const again = run(first, { type: "dialog-close" }, { type: "dialog-open", action: "restack", ctx });
  const stale = reduce(again, { type: "dialog-planned", dialog: first.dialog?.id ?? 0, revision: 0, planId: "x", plan: plan() });
  expect(stale.dialog?.plan).toBeNull();
});

test("a form without what it needs does not preview, and says what is missing", () => {
  const form = opened("new");
  expect(form.dialog).toMatchObject({ planning: false, error: "Name the feature." });
  const named = reduce(form, { type: "dialog-field", name: "feature", value: "gift cards" });
  expect(named.dialog).toMatchObject({ planning: true, error: null });
});

test("a 400 shows its message and leaves nothing to confirm", () => {
  const state = opened();
  const failed = reduce(state, { type: "dialog-plan-failed", dialog: state.dialog?.id ?? 0, revision: 0, message: "no stack named x" });
  expect(failed.dialog).toMatchObject({ planning: false, error: "no stack named x", plan: null, planId: null });
  expect(reduce(failed, { type: "dialog-confirm" }).run).toBeNull();
});

test("confirm starts the run from the plan shown; step and receipt events for another run are ignored", () => {
  const state = running();
  expect(state.dialog?.stage).toBe("run");
  expect(state.run).toMatchObject({ planId: "p0", runId: "r1", sync: true, events: [], receipt: null });
  const other = run(state, { type: "event", at: 1, event: { type: "step", runId: "r2", event: step(0, "running") } }, { type: "event", at: 2, event: { type: "receipt", runId: "r2", receipt: receipt() } });
  expect(other.run).toMatchObject({ events: [], receipt: null });
  const ours = run(state, { type: "event", at: 1, event: { type: "step", runId: "r1", event: step(0, "running") } }, { type: "event", at: 2, event: { type: "step", runId: "r1", event: step(0, "done", 40) } });
  expect(ours.run?.events).toEqual([step(0, "running"), step(0, "done", 40)]);
  const done = reduce(ours, { type: "event", at: 3, event: { type: "receipt", runId: "r1", receipt: receipt() } });
  expect(done.run?.receipt?.title).toBe("Restacked 1 level");
});

test("confirm twice starts one run", () => {
  const ready = planned(opened());
  const once = reduce(ready, { type: "dialog-confirm" });
  expect(reduce(once, { type: "dialog-confirm" })).toBe(once);
});

test("steps published before the run was known come from its state, merged with the live ones", () => {
  const state = running();
  const live = reduce(state, { type: "event", at: 1, event: { type: "step", runId: "r1", event: step(1, "running") } });
  const synced = reduce(live, { type: "run-synced", runId: "r1", state: { plan: plan(), events: [step(0, "running"), step(0, "done", 30), step(1, "running")], receipt: null } });
  expect(synced.run?.events).toEqual([step(0, "running"), step(0, "done", 30), step(1, "running")]);
  expect(synced.run?.sync).toBe(false);
  const later = reduce(synced, { type: "event", at: 2, event: { type: "step", runId: "r1", event: step(1, "done", 50) } });
  expect(later.run?.events.at(-1)).toEqual(step(1, "done", 50));
  const finished = reduce(later, { type: "run-synced", runId: "r1", state: { plan: plan(), events: [step(0, "running"), step(0, "done", 30), step(1, "running"), step(1, "done", 50)], receipt: receipt() } });
  expect(finished.run?.events).toHaveLength(4);
  expect(finished.run?.receipt?.title).toBe("Restacked 1 level");
});

test("a dropped stream reads the run's state again once it is back", () => {
  const synced = reduce(running(), { type: "run-synced", runId: "r1", state: { plan: plan(), events: [], receipt: null } });
  const back = run(synced, { type: "live", state: "down" }, { type: "live", state: "up" });
  expect(back.run?.sync).toBe(true);
});

test("a 410 previews again and shows the new plan; nothing runs until it is confirmed again", () => {
  const ready = planned(opened());
  const sent = reduce(ready, { type: "dialog-confirm" });
  const expired = reduce(sent, { type: "run-failed", planId: "p0", status: 410, message: "This preview expired; preview it again" });
  expect(expired.run).toBeNull();
  expect(expired.dialog).toMatchObject({ stage: "review", planning: true, debounce: false, planId: null, revision: 1 });
  expect(expired.dialog?.notice).toContain("checked again");
  const again = planned(expired, { title: "Restack checkout coupons" });
  expect(again.dialog).toMatchObject({ stage: "review", planId: "p1", planning: false });
  expect(again.dialog?.notice).toContain("checked again");
  expect(again.run).toBeNull();
});

test("a run that is refused for another reason says why and goes back to the plan", () => {
  const sent = reduce(planned(opened()), { type: "dialog-confirm" });
  const busy = reduce(sent, { type: "run-failed", planId: "p0", status: 409, message: "This plan already ran" });
  expect(busy.dialog).toMatchObject({ stage: "review", error: "This plan already ran", planId: null });
});

test("Undo prepares the undo as a restore plan in the same review dialog", () => {
  const done = reduce(running(), { type: "event", at: 3, event: { type: "receipt", runId: "r1", receipt: receipt() } });
  const undo = reduce(done, { type: "dialog-undo" });
  expect(undo.run).toBeNull();
  expect(undo.dialog).toMatchObject({ action: "restore", stage: "review", planning: true, plan: null });
  expect(undo.dialog?.ctx.targets).toEqual([{ branch: "feat/coupons-ui", pinRef: "refs/grove/pins/feat/coupons-ui/1" }]);
  expect(undo.dialog?.id).toBeGreaterThan(done.dialog?.id ?? 0);
});

test("Preview again after a refusal previews afresh", () => {
  const refused = reduce(running(), { type: "event", at: 3, event: { type: "receipt", runId: "r1", receipt: receipt({ ok: false, refused: true, title: "Changed since you looked", undo: null }) } });
  const again = reduce(refused, { type: "dialog-again" });
  expect(again.run).toBeNull();
  expect(again.dialog).toMatchObject({ action: "restack", stage: "review", planning: true, planId: null });
});

test("Hide keeps the run going and its receipt still lands", () => {
  const hidden = reduce(running(), { type: "dialog-close" });
  expect(hidden.dialog).toBeNull();
  const done = reduce(hidden, { type: "event", at: 3, event: { type: "receipt", runId: "r1", receipt: receipt() } });
  expect(done.run?.receipt).not.toBeNull();
});

test("picking the detached group picks or drops all of its sandboxes together", () => {
  const choices: Choice[] = ["/r/fix", "/r/a", "/r/b"].map((id) => ({ id, label: id, detail: "", selectable: true, selected: true, health: "fine" }));
  const ready = planned(opened("cleanup"), { action: "cleanup", choices });
  const dropped = reduce(ready, { type: "dialog-pick", name: "paths", ids: ["/r/a", "/r/b"], on: false });
  expect(dropped.dialog?.values["paths"]).toEqual(["/r/fix"]);
  expect(dropped.dialog).toMatchObject({ planning: true, debounce: true });
  const back = reduce(dropped, { type: "dialog-pick", name: "paths", ids: ["/r/a", "/r/b"], on: true });
  expect(back.dialog?.values["paths"]).toEqual(["/r/fix", "/r/a", "/r/b"]);
});

test("the palette opens over a dialog, hiding it, and its selection stays in the list", () => {
  const state = reduce(opened(), { type: "palette-open" });
  expect(state.dialog).toBeNull();
  expect(state.palette).toEqual({ query: "", index: 0 });
  const moved = run(state, { type: "palette-move", delta: 1, count: 3 }, { type: "palette-move", delta: 1, count: 3 }, { type: "palette-move", delta: 1, count: 3 });
  expect(moved.palette?.index).toBe(2);
  expect(reduce(moved, { type: "palette-query", query: "re" }).palette).toEqual({ query: "re", index: 0 });
  expect(reduce(moved, { type: "palette-close" }).palette).toBeNull();
  expect(reduce(moved, { type: "dialog-open", action: "new", ctx }).palette).toBeNull();
});

test("while a dialog is open the detail preview is not reloaded by a digest; once it closes it is", () => {
  const blank = initialState({ view: "repo", repo: 1, pick: { kind: "feature", feature: coupons.id, branch: "feat/coupons-ui" } }, "1.0.0");
  const loaded = reduce(blank, { type: "loaded", key: sliceRequests(blank).repo?.key ?? "", result: { slice: "repo", data: view } });
  const shown = reduce(loaded, { type: "loaded", key: sliceRequests(loaded).preview?.key ?? "", result: { slice: "preview", data: plan() } });
  const open = run(shown, { type: "dialog-open", action: "restack", ctx }, { type: "event", at: 5, event: { type: "digest", repoId: 1, digest: "d", at: 5 } });
  expect(open.preview).toMatchObject({ stale: true });
  expect(loadable(open, "preview")).toBe(false);
  expect(loadable(open, "repo")).toBe(true);
  expect(loadable(reduce(open, { type: "dialog-close" }), "preview")).toBe(true);
});
