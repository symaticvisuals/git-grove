import type { Plan } from "../../src/core/actions/plan.types.js";
import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import type { ActivityItem, NeedsYouItem, WireFeatureDetail, WireProject, WireRepoView } from "../../src/server/wire/wire.types.js";
import { activityQuery } from "./activity-query.js";
import type { LiveState } from "./live.js";
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
  /** The live stream dropped since it was last up, so whatever is shown is reloaded when it is back. */
  liveDropped: boolean;
  lastEventAt: number | null;
  updateAvailable: boolean;
  signedOut: boolean;
};

export type UiAction =
  | { type: "route"; route: Route }
  | { type: "loaded"; key: string; result: SliceResult }
  | { type: "failed"; slice: SliceName; key: string; status: number; message: string }
  | { type: "invalidate"; slice: SliceName }
  | { type: "event"; event: ServerEvent; at: number }
  | { type: "live"; state: LiveState }
  | { type: "tab"; tab: Tab }
  | { type: "needs-only"; on: boolean }
  | { type: "toggle-group"; key: string }
  | { type: "signed-out" };

type Change = <T>(load: Load<T> | null) => Load<T> | null;

const LOADING: { status: "loading" } = { status: "loading" };
const FEATURE_ACTIVITY_LIMIT = 50;

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

function comeBack(state: State): State {
  const up: State = { ...state, live: "up" };
  return state.liveDropped ? { ...everySlice(up, invalidate), liveDropped: false } : up;
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

function onDigest(state: State, repoId: number): State {
  const shown = state.route.view === "repo" && state.route.repo === repoId;
  const stale = (slices: SliceName[]): State => slices.reduce((next, slice) => update(next, slice, markStale), state);
  return stale(shown ? ["projects", "needs", "pins", "repo", "feature", "preview"] : ["projects", "needs", "pins"]);
}

function onEvent(state: State, event: ServerEvent, at: number): State {
  const next: State = { ...state, lastEventAt: at };
  switch (event.type) {
    case "hello":
      return comeBack({ ...next, updateAvailable: next.updateAvailable || event.version !== next.pageVersion });
    case "digest":
      return onDigest(next, event.repoId);
    case "activity":
      return onActivity(next, event.item);
    case "step":
    case "receipt":
      return next;
  }
}

function step(state: State, action: UiAction): State {
  switch (action.type) {
    case "route":
      return { ...state, route: action.route };
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
      return action.state === "down" ? { ...state, live: "down", liveDropped: true } : { ...state, live: action.state };
    case "tab":
      return { ...state, tab: action.tab };
    case "needs-only":
      return { ...state, needsOnly: action.on };
    case "toggle-group":
      return { ...state, closed: state.closed.includes(action.key) ? state.closed.filter((key) => key !== action.key) : [...state.closed, action.key] };
    case "signed-out":
      return { ...state, signedOut: true };
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
    liveDropped: false,
    lastEventAt: null,
    updateAvailable: false,
    signedOut: false,
  };
  const wanted = sliceRequests(blank);
  return SLICE_NAMES.reduce((state, slice) => (wanted[slice] === null ? state : update(state, slice, () => LOADING)), blank);
}

/**
 * The next state; pure. A reply is kept only for the slice and key the state still asks for. A digest marks the
 * slices it concerns stale, an activity event joins the lists it belongs to, and once the live stream is back after
 * dropping, every slice is reloaded. A slice the route no longer needs is cleared; one it newly needs starts loading.
 */
export function reduce(state: State, action: UiAction): State {
  const next = step(state, action);
  return next === state ? state : reconcile(state, next);
}
