import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Plan, StepEvent } from "../../src/core/actions/plan.types.js";
import type { RunState } from "../../src/server/actions/runs.js";
import type { Api, PlanRequest } from "../../ui/src/api.js";
import { ApiError } from "../../ui/src/api.error.js";
import { createDialogEffects } from "../../ui/src/dialogs/dialog-effects.js";
import type { DialogContext } from "../../ui/src/dialogs/dialog-specs.js";
import { sliceRequests } from "../../ui/src/slice-requests.js";
import { initialState, reduce, type State, type UiAction } from "../../ui/src/state.js";
import { feature, plan, repoView } from "./wire-fixtures.js";

type FakeApi = Pick<Api, "plan" | "run" | "runState">;

const coupons = feature({ name: "checkout coupons" });
const view = repoView({ features: [coupons] });
const ctx: DialogContext = { repo: view, feature: coupons, level: null, branch: null, targets: null, worktree: null };

function step(index: number, state: StepEvent["state"]): StepEvent {
  return { index, state, detail: "", ms: state === "running" ? null : 20 };
}

function store(api: FakeApi) {
  const blank = initialState({ view: "repo", repo: 1, pick: null }, "1.0.0");
  let state: State = reduce(blank, { type: "loaded", key: sliceRequests(blank).repo?.key ?? "", result: { slice: "repo", data: view } });
  const toasts: [string, boolean][] = [];
  const effects = createDialogEffects({ api: () => api, state: () => state, dispatch: (action) => dispatch(action), toast: (text, ok) => toasts.push([text, ok]) });
  function dispatch(action: UiAction): void {
    const before = state;
    state = reduce(state, action);
    if (state !== before) effects.after(before, state);
  }
  return { dispatch, toasts, get state() { return state; } };
}

function api(overrides: Partial<FakeApi> = {}): FakeApi & { plans: PlanRequest[]; runs: string[]; states: string[] } {
  const plans: PlanRequest[] = [];
  const runs: string[] = [];
  const states: string[] = [];
  return {
    plans,
    runs,
    states,
    plan: async (request) => {
      plans.push(request);
      return { planId: `p${plans.length}`, plan: plan({ title: `plan ${plans.length}` }) };
    },
    run: async (planId) => {
      runs.push(planId);
      return { runId: "r1" };
    },
    runState: async (runId): Promise<RunState> => {
      states.push(runId);
      return { plan: plan(), events: [step(0, "running"), step(0, "done")], receipt: null };
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("opening previews at once; typing previews once, 250 ms after the last change", async () => {
  const fake = api();
  const page = store(fake);
  page.dispatch({ type: "dialog-open", action: "restack", ctx });
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.plans).toEqual([{ repo: 1, action: "restack", input: { feature: "checkout coupons", stash: true } }]);
  expect(page.state.dialog).toMatchObject({ planId: "p1", planning: false });

  page.dispatch({ type: "dialog-field", name: "stash", value: false });
  await vi.advanceTimersByTimeAsync(100);
  page.dispatch({ type: "dialog-field", name: "stash", value: true });
  await vi.advanceTimersByTimeAsync(100);
  page.dispatch({ type: "dialog-field", name: "stash", value: false });
  await vi.advanceTimersByTimeAsync(249);
  expect(fake.plans).toHaveLength(1);
  expect(page.state.dialog?.planning).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(fake.plans).toHaveLength(2);
  expect(fake.plans[1]?.input).toEqual({ feature: "checkout coupons", stash: false });
  expect(page.state.dialog).toMatchObject({ planId: "p2", planning: false });
});

test("a 400 shows its message in the note", async () => {
  const page = store(api({ plan: async () => Promise.reject(new ApiError(400, "checkout coupons is not a stack")) }));
  page.dispatch({ type: "dialog-open", action: "restack", ctx });
  await vi.advanceTimersByTimeAsync(0);
  expect(page.state.dialog).toMatchObject({ error: "checkout coupons is not a stack", planning: false });
});

test("a run reads its state once right after it starts, so steps sent before it subscribed still show", async () => {
  const fake = api();
  const page = store(fake);
  page.dispatch({ type: "dialog-open", action: "restack", ctx });
  await vi.advanceTimersByTimeAsync(0);
  page.dispatch({ type: "dialog-confirm" });
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.runs).toEqual(["p1"]);
  expect(fake.states).toEqual(["r1"]);
  expect(page.state.run?.events).toEqual([step(0, "running"), step(0, "done")]);
  page.dispatch({ type: "event", at: 1, event: { type: "step", runId: "r1", event: step(1, "running") } });
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.states).toHaveLength(1);
  expect(page.state.run?.events).toHaveLength(3);
});

test("the receipt toasts and reloads what the run changed", async () => {
  const page = store(api());
  page.dispatch({ type: "dialog-open", action: "restack", ctx });
  await vi.advanceTimersByTimeAsync(0);
  page.dispatch({ type: "dialog-confirm" });
  await vi.advanceTimersByTimeAsync(0);
  const receipt = { action: "restack" as const, ok: true, refused: false, title: "Restacked 2 levels", lines: [], pins: [], undo: null, at: 5 };
  page.dispatch({ type: "event", at: 5, event: { type: "receipt", runId: "r1", receipt } });
  expect(page.toasts).toEqual([["Restacked 2 levels", true]]);
  expect(page.state.repo).toMatchObject({ status: "ready", stale: true });
});

test("a run that gets 410 previews again at once and shows the new plan without running it", async () => {
  let first = true;
  const fake = api({
    run: async () => {
      if (first) {
        first = false;
        throw new ApiError(410, "This preview expired; preview it again");
      }
      return { runId: "r9" };
    },
  });
  const page = store(fake);
  page.dispatch({ type: "dialog-open", action: "restack", ctx });
  await vi.advanceTimersByTimeAsync(0);
  page.dispatch({ type: "dialog-confirm" });
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.plans).toHaveLength(2);
  expect(page.state.run).toBeNull();
  expect(page.state.dialog).toMatchObject({ stage: "review", planId: "p2", planning: false });
  expect(page.state.dialog?.plan?.title).toBe("plan 2");
});

test("a run that fails after its dialog was hidden says so in a toast", async () => {
  const page = store(api({ run: async () => Promise.reject(new ApiError(503, "git grove is stopping")) }));
  page.dispatch({ type: "dialog-open", action: "restack", ctx });
  await vi.advanceTimersByTimeAsync(0);
  page.dispatch({ type: "dialog-confirm" });
  page.dispatch({ type: "dialog-close" });
  await vi.advanceTimersByTimeAsync(0);
  expect(page.toasts).toEqual([["git grove is stopping", false]]);
});

test("a preview that answers after its dialog closed changes nothing", async () => {
  let release: (value: { planId: string; plan: Plan }) => void = () => undefined;
  const page = store(api({ plan: () => new Promise((resolve) => (release = resolve)) }));
  page.dispatch({ type: "dialog-open", action: "restack", ctx });
  await vi.advanceTimersByTimeAsync(0);
  page.dispatch({ type: "dialog-close" });
  release({ planId: "late", plan: plan() });
  await vi.advanceTimersByTimeAsync(0);
  expect(page.state.dialog).toBeNull();
});
