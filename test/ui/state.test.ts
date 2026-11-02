import { expect, test } from "vitest";
import type { Route } from "../../ui/src/parse-route.js";
import { loadable } from "../../ui/src/loadable.js";
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

test("a digest reloads an activity list that shows its repository, so a CLI receipt appears without a reload", () => {
  const digest = (repoId: number): UiAction => ({ type: "event", at: 5, event: { type: "digest", repoId, digest: "d", at: 5 } });
  const tab = reduce(shownRepo(), { type: "tab", tab: "activity" });
  const repoActivity = reduce(tab, { type: "loaded", key: keyOf(tab, "activity"), result: { slice: "activity", data: [] } });
  expect(reduce(repoActivity, digest(1)).activity).toMatchObject({ status: "ready", stale: true });
  expect(loadable(reduce(repoActivity, digest(1)), "activity")).toBe(true);
  expect(reduce(repoActivity, digest(2)).activity).toMatchObject({ status: "ready", stale: false });

  const start = initialState({ view: "activity" }, "1.0.0");
  const everywhere = reduce(start, { type: "loaded", key: keyOf(start, "activity"), result: { slice: "activity", data: [] } });
  expect(reduce(everywhere, digest(9)).activity).toMatchObject({ status: "ready", stale: true });
  expect(loadable(everywhere, "activity")).toBe(false);
  expect(loadable(reduce(everywhere, digest(9)), "activity")).toBe(true);
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

test("while live is up, a quiet project list reloads every 30 s, and the footer then shows a fresh scan", async () => {
  const { sidebar } = await import("../../ui/src/render/sidebar.js");
  const start = initialState({ view: "projects" }, "1.0.0");
  const old = [project({ scannedAt: 0 })];
  const shown = run(start, { type: "loaded", key: keyOf(start, "projects"), result: { slice: "projects", data: old } }, { type: "live", state: "up" });
  const first = reduce(shown, { type: "tick", now: 1_000 });
  expect(first.projects).toMatchObject({ stale: false });
  expect(reduce(first, { type: "tick", now: 25_000 })).toBe(first);
  const due = reduce(first, { type: "tick", now: 31_000 });
  expect(due.projects).toMatchObject({ status: "ready", stale: true });
  const fresh = reduce(due, { type: "loaded", key: keyOf(due, "projects"), result: { slice: "projects", data: [project({ scannedAt: 30_500 })] } });
  const footer = sidebar({ route: fresh.route, projects: fresh.projects, repo: null, live: fresh.live, now: 31_200 }).text;
  expect(footer).toContain("Watching 1 repo, ");
  expect(footer).toContain(">0 s ago</time>");
  const down = reduce(reduce(fresh, { type: "live", state: "down" }), { type: "tick", now: 90_000 });
  expect(down.projects).toMatchObject({ stale: false });
});

test("a digest for the shown repo retries a slice that failed", () => {
  const state = shownRepo();
  const failed = reduce(state, { type: "failed", slice: "repo", key: keyOf(state, "repo"), status: 503, message: "scan failed" });
  const after = reduce(failed, { type: "event", at: 4, event: { type: "digest", repoId: 1, digest: "x", at: 4 } });
  expect(after.repo).toEqual({ status: "ready", data: repoView(), stale: true });
  const empty = initialState({ view: "repo", repo: 1, pick: null }, "1.0.0");
  const neverLoaded = reduce(empty, { type: "failed", slice: "repo", key: keyOf(empty, "repo"), status: 503, message: "scan failed" });
  expect(reduce(neverLoaded, { type: "event", at: 4, event: { type: "digest", repoId: 1, digest: "x", at: 4 } }).repo).toEqual({ status: "loading" });
});

test("a 503 from the live stream is remembered as busy until it is back", () => {
  const state = shownRepo();
  const busy = reduce(state, { type: "live", state: "down", problem: "busy" });
  expect(busy.liveProblem).toBe("busy");
  expect(reduce(busy, { type: "live", state: "up" }).liveProblem).toBeNull();
  expect(reduce(state, { type: "live", state: "down" }).liveProblem).toBe("unreachable");
});

test("a project list that failed is retried every 30 s while live, too", () => {
  const start = initialState({ view: "projects" }, "1.0.0");
  const failed = run(
    start,
    { type: "live", state: "up" },
    { type: "failed", slice: "projects", key: keyOf(start, "projects"), status: 503, message: "scan failed" },
    { type: "tick", now: 1_000 },
  );
  expect(failed.projects).toMatchObject({ status: "error" });
  expect(reduce(failed, { type: "tick", now: 20_000 })).toBe(failed);
  expect(reduce(failed, { type: "tick", now: 31_000 }).projects).toEqual({ status: "loading" });
  const withData = run(
    start,
    { type: "live", state: "up" },
    { type: "loaded", key: keyOf(start, "projects"), result: { slice: "projects", data: [project()] } },
    { type: "failed", slice: "projects", key: keyOf(start, "projects"), status: 0, message: "down" },
    { type: "tick", now: 1_000 },
  );
  expect(reduce(withData, { type: "tick", now: 31_000 }).projects).toEqual({ status: "ready", data: [project()], stale: true });
});
