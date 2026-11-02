import { expect, test } from "vitest";
import type { Route } from "../../ui/src/parse-route.js";
import { sliceRequests } from "../../ui/src/slice-requests.js";
import { initialState, reduce, type State, type UiAction } from "../../ui/src/state.js";
import { activityItem, feature, featureDetail, level, project, repoView } from "./wire-fixtures.js";

const REPO_ROUTE: Route = { view: "repo", repo: 1, pick: { kind: "feature", feature: "1.Y291cG9ucw", branch: "feat/x" } };

function run(state: State, ...actions: UiAction[]): State {
  return actions.reduce(reduce, state);
}

function keyOf(state: State, slice: "repo" | "feature" | "projects" | "activity"): string {
  const key = sliceRequests(state)[slice]?.key;
  if (key === undefined) throw new Error(`no ${slice} request`);
  return key;
}

function shownRepo(): State {
  const start = initialState(REPO_ROUTE, "1.0.0");
  return run(
    start,
    { type: "loaded", key: keyOf(start, "repo"), result: { slice: "repo", data: repoView() } },
    { type: "loaded", key: keyOf(start, "feature"), result: { slice: "feature", data: featureDetail() } },
  );
}

test("a repo route starts loading the repo and the routed feature", () => {
  const state = initialState(REPO_ROUTE, "1.0.0");
  expect(state.projects).toEqual({ status: "loading" });
  expect(state.repo).toEqual({ status: "loading" });
  expect(state.feature).toEqual({ status: "loading" });
  expect(state.needs).toBeNull();
});

test("a digest for the shown repo marks it stale; one for another repo leaves it", () => {
  const state = shownRepo();
  const other = reduce(state, { type: "event", at: 5, event: { type: "digest", repoId: 2, digest: "b", at: 5 } });
  expect(other.repo).toMatchObject({ status: "ready", stale: false });
  expect(other.feature).toMatchObject({ status: "ready", stale: false });
  const same = reduce(state, { type: "event", at: 5, event: { type: "digest", repoId: 1, digest: "a", at: 5 } });
  expect(same.repo).toMatchObject({ status: "ready", stale: true });
  expect(same.feature).toMatchObject({ status: "ready", stale: true });
  expect(same.lastEventAt).toBe(5);
});

test("every digest marks the project list stale", () => {
  const start = initialState({ view: "projects" }, "1.0.0");
  const loaded = reduce(start, { type: "loaded", key: keyOf(start, "projects"), result: { slice: "projects", data: [project()] } });
  const after = reduce(loaded, { type: "event", at: 1, event: { type: "digest", repoId: 9, digest: "x", at: 1 } });
  expect(after.projects).toMatchObject({ status: "ready", stale: true });
});

test("a failed reload keeps the last data with the error", () => {
  const state = shownRepo();
  const key = keyOf(state, "repo");
  const failed = reduce(state, { type: "failed", slice: "repo", key, status: 0, message: "git grove isn't running. Start it with git grove ui." });
  expect(failed.repo).toEqual({ status: "error", message: "git grove isn't running. Start it with git grove ui.", data: repoView() });
  expect(failed.signedOut).toBe(false);
});

test("a reply for a view no longer shown is dropped", () => {
  const state = initialState(REPO_ROUTE, "1.0.0");
  const oldKey = keyOf(state, "repo");
  const moved = reduce(state, { type: "route", route: { view: "repo", repo: 2, pick: null } });
  expect(moved.repo).toEqual({ status: "loading" });
  expect(moved.feature).toBeNull();
  const late = reduce(moved, { type: "loaded", key: oldKey, result: { slice: "repo", data: repoView() } });
  expect(late.repo).toEqual({ status: "loading" });
});

test("with no branch in the route, the repo's worst level is picked and its feature loaded", () => {
  const start = initialState({ view: "repo", repo: 1, pick: null }, "1.0.0");
  expect(start.feature).toBeNull();
  const broken = feature({ id: "1.YnJva2Vu", name: "broken", levels: [level({ branch: "feat/b", health: "loses" })] });
  const view = repoView({ features: [feature(), broken] });
  const loaded = reduce(start, { type: "loaded", key: keyOf(start, "repo"), result: { slice: "repo", data: view } });
  expect(loaded.feature).toEqual({ status: "loading" });
  expect(keyOf(loaded, "feature")).toContain("1.YnJva2Vu");
});

test("hello with another version sets updateAvailable", () => {
  const state = shownRepo();
  expect(reduce(state, { type: "event", at: 1, event: { type: "hello", version: "1.0.0" } }).updateAvailable).toBe(false);
  expect(reduce(state, { type: "event", at: 1, event: { type: "hello", version: "1.1.0" } }).updateAvailable).toBe(true);
});

test("live goes down when the stream drops and up on hello; coming back refetches what was shown", () => {
  const state = shownRepo();
  const down = reduce(state, { type: "live", state: "down" });
  expect(down.live).toBe("down");
  expect(down.repo).toMatchObject({ stale: false });
  const failed = reduce(down, { type: "failed", slice: "feature", key: keyOf(down, "feature"), status: 0, message: "down" });
  const connecting = reduce(failed, { type: "live", state: "connecting" });
  expect(connecting.live).toBe("connecting");
  const back = reduce(connecting, { type: "event", at: 2, event: { type: "hello", version: "1.0.0" } });
  expect(back.live).toBe("up");
  expect(back.repo).toMatchObject({ status: "ready", stale: true });
  expect(back.feature).toMatchObject({ status: "ready", stale: true });
  expect(reduce(back, { type: "event", at: 3, event: { type: "hello", version: "1.0.0" } }).repo).toBe(back.repo);
});

test("a 401 signs the page out", () => {
  const state = shownRepo();
  const out = reduce(state, { type: "failed", slice: "repo", key: keyOf(state, "repo"), status: 401, message: "Open the dashboard from your terminal: git grove ui" });
  expect(out.signedOut).toBe(true);
});

test("an activity event joins the shown feature's activity once, newest first", () => {
  const state = shownRepo();
  const item = activityItem({ id: "j:7", branch: "feat/x", at: 9 });
  const once = run(state, { type: "event", at: 9, event: { type: "activity", item } }, { type: "event", at: 9, event: { type: "activity", item } });
  expect(once.feature?.status === "ready" ? once.feature.data.activity.map((entry) => entry.id) : null).toEqual(["j:7"]);
  const elsewhere = reduce(state, { type: "event", at: 9, event: { type: "activity", item: activityItem({ id: "j:8", branch: "feat/other" }) } });
  expect(elsewhere.feature).toBe(state.feature);
});

test("the activity tab loads the repo's activity, and its events join it", () => {
  const state = reduce(shownRepo(), { type: "tab", tab: "activity" });
  expect(state.activity).toEqual({ status: "loading" });
  const loaded = reduce(state, { type: "loaded", key: keyOf(state, "activity"), result: { slice: "activity", data: [] } });
  const joined = reduce(loaded, { type: "event", at: 1, event: { type: "activity", item: activityItem({ id: "a:1", repoId: 1 }) } });
  const ignored = reduce(loaded, { type: "event", at: 1, event: { type: "activity", item: activityItem({ id: "a:2", repoId: 2 }) } });
  expect(joined.activity).toMatchObject({ status: "ready", data: [{ id: "a:1" }] });
  expect(ignored.activity).toMatchObject({ status: "ready", data: [] });
});
