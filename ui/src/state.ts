import type { Plan } from "../../src/core/actions/plan.types.js";
import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import type { ActivityItem, NeedsYouItem, WireFeatureDetail, WireProject, WireRepoView } from "../../src/server/wire/wire.types.js";
import { activityQuery } from "./activity-query.js";
import { effectivePick } from "./effective-pick.js";
import { groupKeyOf } from "./render/group-key-of.js";
import { type DialogAction, type DialogSlices, type DialogState, type PaletteState, reduceDialog, type RunSlice } from "./dialogs/reduce-dialog.js";
import type { LiveProblem, LiveState } from "./live.js";
import type { Route } from "./parse-route.js";
import { SLICE_NAMES, type SliceName } from "./slice-names.js";
import { type RepoPins, type SliceResult, sliceRequests } from "./slice-requests.js";

/** A slice that is loading, loaded (`stale` once git grove says it changed), or failed, keeping what it showed before. */
export type Load<T> = { status: "loading" } | { status: "ready"; data: T; stale: boolean } | { status: "error"; message: string; data: T | null };

export type Tab = "feature" | "health" | "activity";

export type State = {
  route: Route;
  /** The version the page was served at, from its `grove-version` meta. */
  pageVersion: string;
  projects: Load<WireProject[]>;
  repo: Load<WireRepoView> | null;
  feature: Load<WireFeatureDetail> | null;
  preview: Load<Plan> | null;
  activity: Load<ActivityItem[]> | null;
  pins: Load<RepoPins[]> | null;
  needs: Load<NeedsYouItem[]> | null;
  tab: Tab;
  needsOnly: boolean;
  /** Keys of the list groups that are folded. */
  closed: string[];
  live: LiveState;
  /** Why the live stream is down, while it is. */
  liveProblem: LiveProblem | null;
  /** The live stream dropped since it was last up, so whatever is shown is reloaded when it is back. */
  liveDropped: boolean;
  /** When the project list was last asked to reload; it is reloaded every 30 s while live, failed or not, so its scan times stay fresh. */
  projectsCheckedAt: number | null;
  lastEventAt: number | null;
  updateAvailable: boolean;
  signedOut: boolean;
  dialog: DialogState | null;
  run: RunSlice | null;
  palette: PaletteState | null;
  /** The id the last dialog opened got; each open takes the next one. */
  dialogSeq: number;
};

export type UiAction =
  | { type: "route"; route: Route }
  | { type: "loaded"; key: string; result: SliceResult }
  | { type: "failed"; slice: SliceName; key: string; status: number; message: string }
  | { type: "invalidate"; slice: SliceName }
  | { type: "event"; event: ServerEvent; at: number }
  | { type: "live"; state: LiveState; problem?: LiveProblem }
  | { type: "tick"; now: number }
  | { type: "tab"; tab: Tab }
  | { type: "needs-only"; on: boolean }
  | { type: "toggle-group"; key: string }
  | { type: "signed-out" }
  | DialogAction;

type Change = <T>(load: Load<T> | null) => Load<T> | null;

const LOADING: { status: "loading" } = { status: "loading" };
const FEATURE_ACTIVITY_LIMIT = 50;
const PROJECTS_EVERY_MS = 30_000;

function dataOf<T>(load: Load<T> | null): T | null {
  return load === null || load.status === "loading" ? null : load.data;
}

function update(state: State, slice: SliceName, change: Change): State {
  switch (slice) {
    case "projects":
      return { ...state, projects: change(state.projects) ?? state.projects };
    case "repo":
      return { ...state, repo: change(state.repo) };
    case "feature":
      return { ...state, feature: change(state.feature) };
    case "preview":
      return { ...state, preview: change(state.preview) };
    case "activity":
      return { ...state, activity: change(state.activity) };
    case "pins":
      return { ...state, pins: change(state.pins) };
    case "needs":
      return { ...state, needs: change(state.needs) };
  }
}

function settle(state: State, result: SliceResult): State {
  const ready = <T>(data: T): Load<T> => ({ status: "ready", data, stale: false });
  switch (result.slice) {
    case "projects":
      return { ...state, projects: ready(result.data) };
    case "repo":
      return { ...state, repo: ready(result.data) };
    case "feature":
      return { ...state, feature: ready(result.data) };
    case "preview":
      return { ...state, preview: ready(result.data) };
    case "activity":
      return { ...state, activity: ready(result.data) };
    case "pins":
      return { ...state, pins: ready(result.data) };
    case "needs":
      return { ...state, needs: ready(result.data) };
  }
}

const markStale: Change = (load) => (load?.status === "ready" && !load.stale ? { ...load, stale: true } : load);

const invalidate: Change = (load) => {
  if (load === null || load.status !== "error") return markStale(load);
  return load.data === null ? LOADING : { status: "ready", data: load.data, stale: true };
};

function everySlice(state: State, change: Change): State {
  return SLICE_NAMES.reduce((next, slice) => update(next, slice, change), state);
}

function withDialogs(state: State, action: DialogAction): State {
  const slices: DialogSlices = { dialog: state.dialog, run: state.run, palette: state.palette, dialogSeq: state.dialogSeq };
  const next = reduceDialog(slices, action);
  return next === slices ? state : { ...state, ...next };
}

function comeBack(state: State): State {
  const up: State = { ...state, live: "up", liveProblem: null };
  return state.liveDropped ? withDialogs({ ...everySlice(up, invalidate), liveDropped: false }, { type: "run-resync" }) : up;
}

function joined(items: readonly ActivityItem[], item: ActivityItem, limit: number): ActivityItem[] | null {
  return items.some((existing) => existing.id === item.id) ? null : [item, ...items].slice(0, limit);
}

function onActivity(state: State, item: ActivityItem): State {
  let next = state;
  const query = activityQuery(state);
  const list = state.activity;
  if (list?.status === "ready" && query !== null && (query.repo === undefined || query.repo === item.repoId)) {
    const items = joined(list.data, item, query.limit);
    if (items !== null) next = { ...next, activity: { ...list, data: items } };
  }
  const feature = state.feature;
  if (feature?.status === "ready" && feature.data.feature.repoId === item.repoId && feature.data.feature.levels.some((level) => level.branch === item.branch)) {
    const items = joined(feature.data.activity, item, FEATURE_ACTIVITY_LIMIT);
    if (items !== null) next = { ...next, feature: { ...feature, data: { ...feature.data, activity: items } } };
  }
  return next;
}

function onDigest(state: State, repoId: number, at: number): State {
  const shown = state.route.view === "repo" && state.route.repo === repoId;
  const listed = activityQuery(state);
  const slices: SliceName[] = shown ? ["projects", "needs", "pins", "repo", "feature", "preview"] : ["projects", "needs", "pins"];
  if (listed !== null && (listed.repo === undefined || listed.repo === repoId)) slices.push("activity");
  const checked: State = { ...state, projectsCheckedAt: at };
  return slices.reduce((next, slice) => update(next, slice, invalidate), checked);
}

function onTick(state: State, now: number): State {
  if (state.live !== "up" || state.projects.status === "loading") return state;
  if (state.projectsCheckedAt === null) return { ...state, projectsCheckedAt: now };
  if (now - state.projectsCheckedAt < PROJECTS_EVERY_MS) return state;
  return { ...update(state, "projects", invalidate), projectsCheckedAt: now };
}

function onEvent(state: State, event: ServerEvent, at: number): State {
  const next: State = { ...state, lastEventAt: at };
  switch (event.type) {
    case "hello":
      return comeBack({ ...next, updateAvailable: next.updateAvailable || event.version !== next.pageVersion });
    case "digest":
      return onDigest(next, event.repoId, at);
    case "activity":
      return onActivity(next, event.item);
    case "step":
      return withDialogs(next, { type: "run-step", runId: event.runId, event: event.event });
    case "receipt":
      return withDialogs(next, { type: "run-receipt", runId: event.runId, receipt: event.receipt });
  }
}

function unfoldedFor(state: State, route: Route): string[] {
  const loaded = state.repo !== null && state.repo.status !== "loading" ? state.repo.data : null;
  if (route.view !== "repo" || loaded === null || loaded.project.id !== route.repo) return state.closed;
  const pick = effectivePick(route, loaded);
  const key = pick === null ? null : groupKeyOf(loaded, state.tab === "health", pick);
  return key === null || !state.closed.includes(key) ? state.closed : state.closed.filter((closed) => closed !== key);
}

function step(state: State, action: UiAction): State {
  switch (action.type) {
    case "route":
      return { ...state, route: action.route, closed: unfoldedFor(state, action.route) };
    case "loaded":
      return sliceRequests(state)[action.result.slice]?.key === action.key ? settle(state, action.result) : state;
    case "failed": {
      if (sliceRequests(state)[action.slice]?.key !== action.key) return state;
      const failed = update(state, action.slice, (load) => ({ status: "error", message: action.message, data: dataOf(load) }));
      return action.status === 401 ? { ...failed, signedOut: true } : failed;
    }
    case "invalidate":
      return update(state, action.slice, invalidate);
    case "event":
      return onEvent(state, action.event, action.at);
    case "live":
      if (action.state === "up") return comeBack(state);
      if (action.state === "down") return { ...state, live: "down", liveDropped: true, liveProblem: action.problem ?? "unreachable" };
      return { ...state, live: action.state };
    case "tick":
      return onTick(state, action.now);
    case "tab":
      return { ...state, tab: action.tab };
    case "needs-only":
      return { ...state, needsOnly: action.on };
    case "toggle-group":
      return { ...state, closed: state.closed.includes(action.key) ? state.closed.filter((key) => key !== action.key) : [...state.closed, action.key] };
    case "signed-out":
      return { ...state, signedOut: true };
    default:
      return withDialogs(state, action);
  }
}

function reconcile(before: State, after: State): State {
  const was = sliceRequests(before);
  const now = sliceRequests(after);
  let out = after;
  for (const slice of SLICE_NAMES) {
    const key = now[slice]?.key ?? null;
    if (key !== (was[slice]?.key ?? null)) out = update(out, slice, () => (key === null ? null : LOADING));
  }
  return out;
}

/** The state of a page opened at `route`, with each slice that route needs loading. */
export function initialState(route: Route, pageVersion: string): State {
  const blank: State = {
    route,
    pageVersion,
    projects: LOADING,
    repo: null,
    feature: null,
    preview: null,
    activity: null,
    pins: null,
    needs: null,
    tab: "feature",
    needsOnly: false,
    closed: [],
    live: "connecting",
    liveProblem: null,
    liveDropped: false,
    projectsCheckedAt: null,
    lastEventAt: null,
    updateAvailable: false,
    signedOut: false,
    dialog: null,
    run: null,
    palette: null,
    dialogSeq: 0,
  };
  const wanted = sliceRequests(blank);
  return SLICE_NAMES.reduce((state, slice) => (wanted[slice] === null ? state : update(state, slice, () => LOADING)), blank);
}

/**
 * The next state; pure. A reply is kept only for the slice and key the state still asks for. A digest reloads the
 * slices it concerns, failed ones included, among them an activity list that shows its repository, so activity another
 * process recorded, such as a CLI receipt, appears; an activity event joins the lists it belongs to; while live, the project
 * list reloads every 30 s; and once the live stream is back after dropping, every slice is reloaded. A slice the
 * route no longer needs is cleared; one it newly needs starts loading. A route to a row in a folded group unfolds it. Dialog, run and palette actions, and the
 * step and receipt events, go to `reduceDialog`; a stream that is back after dropping reads the current run again.
 */
export function reduce(state: State, action: UiAction): State {
  const next = step(state, action);
  return next === state ? state : reconcile(state, next);
}
