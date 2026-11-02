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

function armed(state: State): State {
  return reduce(state, { type: "dialog-armed", dialog: state.dialog?.id ?? 0, planId: state.dialog?.planId ?? "" });
}

function confirm(state: State): State {
  return reduce(state, { type: "dialog-confirm", planId: state.dialog?.planId ?? "" });
}

function step(index: number, state: StepEvent["state"], ms: number | null = null): StepEvent {
  return { index, state, detail: "", ms };
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return { action: "restack", ok: true, refused: false, title: "Restacked 1 level", lines: [], pins: ["refs/grove/pins/feat/coupons-ui/1"], undo: [{ branch: "feat/coupons-ui", pinRef: "refs/grove/pins/feat/coupons-ui/1" }], at: 9, ...overrides };
}

function running(): State {
  return reduce(confirm(armed(planned(opened()))), { type: "run-started", planId: "p0", runId: "r1" });
}

function choice(id: string, overrides: Partial<Choice> = {}): Choice {
  return { id, label: id, detail: "", selectable: true, selected: true, health: "fine", ...overrides };
}

test("opening a dialog previews at once with the spec's first values", () => {
  const state = opened();
  expect(state.dialog).toMatchObject({ action: "restack", repoId: 1, stage: "review", planning: true, debounce: false, revision: 0, plan: null, armed: null, values: { feature: "checkout coupons", stash: true } });
  expect(state.palette).toBeNull();
});

test("a field change re-previews after a pause, and a reply for an older revision is dropped", () => {
  const ready = armed(planned(opened()));
  expect(ready.dialog).toMatchObject({ planning: false, planId: "p0", armed: "p0" });
  const changed = reduce(ready, { type: "dialog-field", name: "stash", value: false });
  expect(changed.dialog).toMatchObject({ revision: 1, planning: true, debounce: true, armed: null, values: { stash: false } });
  expect(changed.dialog?.plan).not.toBeNull();
  const late = reduce(changed, { type: "dialog-planned", dialog: changed.dialog?.id ?? 0, revision: 0, planId: "old", plan: plan() });
  expect(late.dialog).toMatchObject({ planning: true, revision: 1 });
  const fresh = armed(planned(changed, { blockers: ["feat/coupons-ui has uncommitted changes. Turn on set aside, or commit them first."] }));
  expect(fresh.dialog).toMatchObject({ planning: false, planId: "p1" });
  expect(confirm(fresh).run).toBeNull();
});

test("a confirm before the arming delay is ignored, and a plan that replaces an armed one starts unarmed", () => {
  const shown = planned(opened());
  expect(confirm(shown).run).toBeNull();
  const ready = armed(shown);
  expect(confirm(ready).run).not.toBeNull();
  const replaced = planned(reduce(ready, { type: "dialog-field", name: "stash", value: false }));
  expect(replaced.dialog?.armed).toBeNull();
  const stale = reduce(replaced, { type: "dialog-armed", dialog: replaced.dialog?.id ?? 0, planId: "p0" });
  expect(stale.dialog?.armed).toBeNull();
});

test("a confirm whose painted plan id is not the dialog's plan is ignored", () => {
  const ready = armed(planned(opened()));
  expect(reduce(ready, { type: "dialog-confirm", planId: "p-other" })).toBe(ready);
  expect(reduce(ready, { type: "dialog-confirm", planId: "p0" }).run?.planId).toBe("p0");
});

test("a reply for a dialog that was closed and opened again is dropped", () => {
  const first = opened();
  const again = run(first, { type: "dialog-close" }, { type: "dialog-open", action: "restack", ctx });
  const stale = reduce(again, { type: "dialog-planned", dialog: first.dialog?.id ?? 0, revision: 0, planId: "x", plan: plan() });
  expect(stale.dialog?.plan).toBeNull();
});

test("a form without what it needs does not preview, and says what is missing", () => {
  const form = opened("new");
  expect(form.dialog).toMatchObject({ planning: false, missing: "Name the feature.", error: null });
  const named = reduce(form, { type: "dialog-field", name: "feature", value: "gift cards" });
  expect(named.dialog).toMatchObject({ planning: true, missing: null, error: null });
});

test("a 400 shows its message, leaves nothing to confirm, and keeps the last choices on screen", () => {
  const choices = [choice("/r/fix"), choice("/r/gone")];
  const shown = armed(planned(opened("cleanup"), { action: "cleanup", choices }));
  const changed = reduce(shown, { type: "dialog-pick", name: "paths", ids: ["/r/fix"], on: false });
  const failed = reduce(changed, { type: "dialog-plan-failed", dialog: changed.dialog?.id ?? 0, revision: changed.dialog?.revision ?? 0, message: "/r/gone is not a merged worktree or a detached sandbox" });
  expect(failed.dialog).toMatchObject({ planning: false, error: "/r/gone is not a merged worktree or a detached sandbox", plan: null, planId: null });
  expect(failed.dialog?.choices).toEqual(choices);
  const dropped = reduce(failed, { type: "dialog-pick", name: "paths", ids: ["/r/gone"], on: false });
  expect(dropped.dialog?.values["paths"]).toEqual([]);
  expect(dropped.dialog).toMatchObject({ planning: true, error: null });
  expect(confirm(failed).run).toBeNull();
});

test("Preview again after an error previews afresh", () => {
  const state = opened();
  const failed = reduce(state, { type: "dialog-plan-failed", dialog: state.dialog?.id ?? 0, revision: 0, message: "git grove isn't running. Start it with git grove ui." });
  const again = reduce(failed, { type: "dialog-again" });
  expect(again.dialog).toMatchObject({ stage: "review", planning: true, debounce: false, error: null, revision: 1 });
});

test("picks keep only choices that can be picked; one that became blocked is dropped and checked again", () => {
  const ready = planned(opened("cleanup"), { action: "cleanup", choices: [choice("/r/fix"), choice("/r/a"), choice("/r/bump", { selectable: false, selected: false })] });
  const tried = reduce(ready, { type: "dialog-pick", name: "paths", ids: ["/r/bump"], on: true });
  expect(tried).toBe(ready);
  const picked = reduce(ready, { type: "dialog-pick", name: "paths", ids: ["/r/a"], on: false });
  expect(picked.dialog?.values["paths"]).toEqual(["/r/fix"]);
  const blocked = planned(picked, { action: "cleanup", choices: [choice("/r/fix", { selectable: false, selected: true }), choice("/r/a", { selected: false })] });
  expect(blocked.dialog?.values["paths"]).toEqual([]);
  expect(blocked.dialog).toMatchObject({ planning: true, debounce: false, planId: null });
});

test("confirm starts the run from the plan shown; step and receipt events for another run are ignored", () => {
  const state = running();
  expect(state.dialog?.stage).toBe("run");
  expect(state.run).toMatchObject({ planId: "p0", runId: "r1", sync: 1, synced: 0, events: [], receipt: null });
  const other = run(state, { type: "event", at: 1, event: { type: "step", runId: "r2", event: step(0, "running") } }, { type: "event", at: 2, event: { type: "receipt", runId: "r2", receipt: receipt() } });
  expect(other.run).toMatchObject({ events: [], receipt: null });
  const ours = run(state, { type: "event", at: 1, event: { type: "step", runId: "r1", event: step(0, "running") } }, { type: "event", at: 2, event: { type: "step", runId: "r1", event: step(0, "done", 40) } });
  expect(ours.run?.events).toEqual([step(0, "running"), step(0, "done", 40)]);
  const done = reduce(ours, { type: "event", at: 3, event: { type: "receipt", runId: "r1", receipt: receipt() } });
  expect(done.run?.receipt?.title).toBe("Restacked 1 level");
});

test("confirm twice starts one run", () => {
  const once = confirm(armed(planned(opened())));
  expect(reduce(once, { type: "dialog-confirm", planId: "p0" })).toBe(once);
});

test("steps published before the run was known come from its state, merged with the live ones", () => {
  const state = running();
  const live = reduce(state, { type: "event", at: 1, event: { type: "step", runId: "r1", event: step(1, "running") } });
  const synced = reduce(live, { type: "run-synced", runId: "r1", request: 1, state: { plan: plan(), events: [step(0, "running"), step(0, "done", 30), step(1, "running")], receipt: null } });
  expect(synced.run?.events).toEqual([step(0, "running"), step(0, "done", 30), step(1, "running")]);
  expect(synced.run).toMatchObject({ sync: 1, synced: 1 });
  const later = reduce(synced, { type: "event", at: 2, event: { type: "step", runId: "r1", event: step(1, "done", 50) } });
  expect(later.run?.events.at(-1)).toEqual(step(1, "done", 50));
  const finished = reduce(later, { type: "run-synced", runId: "r1", request: 1, state: { plan: plan(), events: [step(0, "running"), step(0, "done", 30), step(1, "running"), step(1, "done", 50)], receipt: receipt() } });
  expect(finished.run?.events).toHaveLength(4);
  expect(finished.run?.receipt?.title).toBe("Restacked 1 level");
});

test("a dropped stream asks for the run's state again once it is back, even while a read is in flight", () => {
  const state = running();
  const back = run(state, { type: "live", state: "down" }, { type: "live", state: "up" });
  expect(back.run).toMatchObject({ sync: 2, synced: 0 });
  const first = reduce(back, { type: "run-synced", runId: "r1", request: 1, state: { plan: plan(), events: [], receipt: null } });
  expect(first.run).toMatchObject({ sync: 2, synced: 1 });
});

test("a 410 previews again and shows the new plan; nothing runs until it is confirmed again", () => {
  const sent = confirm(armed(planned(opened())));
  const expired = reduce(sent, { type: "run-failed", planId: "p0", status: 410, message: "This preview expired; preview it again" });
  expect(expired.run).toBeNull();
  expect(expired.dialog).toMatchObject({ stage: "review", planning: true, debounce: false, planId: null, armed: null, revision: 1 });
  expect(expired.dialog?.notice).toContain("checked again");
  const again = planned(expired, { title: "Restack checkout coupons" });
  expect(again.dialog).toMatchObject({ stage: "review", planId: "p1", planning: false });
  expect(again.dialog?.notice).toContain("checked again");
  expect(again.run).toBeNull();
});

test("a run that is refused for another reason says why and goes back to the plan", () => {
  const sent = confirm(armed(planned(opened())));
  const busy = reduce(sent, { type: "run-failed", planId: "p0", status: 409, message: "This plan already ran" });
  expect(busy.dialog).toMatchObject({ stage: "review", error: "This plan already ran", planId: null });
});

test("Undo prepares the undo as a restore plan in the same review dialog", () => {
  const done = reduce(running(), { type: "event", at: 3, event: { type: "receipt", runId: "r1", receipt: receipt() } });
  const undo = reduce(done, { type: "dialog-undo" });
  expect(undo.run).toBeNull();
  expect(undo.dialog).toMatchObject({ action: "restore", stage: "review", planning: true, plan: null, armed: null });
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
  const choices: Choice[] = ["/r/fix", "/r/a", "/r/b"].map((id) => choice(id));
  const ready = planned(opened("cleanup"), { action: "cleanup", choices });
  const dropped = reduce(ready, { type: "dialog-pick", name: "paths", ids: ["/r/a", "/r/b"], on: false });
  expect(dropped.dialog?.values["paths"]).toEqual(["/r/fix"]);
  expect(dropped.dialog).toMatchObject({ planning: true, debounce: true });
  const back = reduce(dropped, { type: "dialog-pick", name: "paths", ids: ["/r/a", "/r/b"], on: true });
  expect(back.dialog?.values["paths"]).toEqual(["/r/fix", "/r/a", "/r/b"]);
});

test("the palette never opens over a dialog; it opens over a hidden run", () => {
  const dialog = opened();
  expect(reduce(dialog, { type: "palette-open" })).toBe(dialog);
  const hidden = reduce(running(), { type: "dialog-close" });
  const state = reduce(hidden, { type: "palette-open" });
  expect(state.palette).toEqual({ query: "", index: 0 });
  expect(state.run).not.toBeNull();
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

test("going to a row in a folded group unfolds that group", () => {
  const folded = reduce(start(), { type: "toggle-group", key: `f:${coupons.id}` });
  expect(folded.closed).toEqual([`f:${coupons.id}`]);
  const there = reduce(folded, { type: "route", route: { view: "repo", repo: 1, pick: { kind: "feature", feature: coupons.id, branch: "feat/coupons-ui" } } });
  expect(there.closed).toEqual([]);
  const health = run(start(), { type: "tab", tab: "health" }, { type: "toggle-group", key: "h:action" });
  const healthThere = reduce(health, { type: "route", route: { view: "repo", repo: 1, pick: { kind: "feature", feature: coupons.id, branch: "feat/coupons-ui" } } });
  expect(healthThere.closed).toEqual([]);
});
