import { expect, test } from "vitest";
import { parseRoute, type Route, routeHash } from "../../ui/src/parse-route.js";

const ROUTES: [string, Route][] = [
  ["#/", { view: "projects" }],
  ["#/needs", { view: "needs" }],
  ["#/activity", { view: "activity" }],
  ["#/pins", { view: "pins" }],
  ["#/setup", { view: "setup" }],
  ["#/r/3", { view: "repo", repo: 3, pick: null }],
  ["#/r/3/f/3.Y2hlY2tvdXQgY291cG9ucw", { view: "repo", repo: 3, pick: { kind: "feature", feature: "3.Y2hlY2tvdXQgY291cG9ucw", branch: null } }],
  [
    "#/r/3/f/3.Y2hlY2tvdXQgY291cG9ucw/feat%2Fcoupons-model",
    { view: "repo", repo: 3, pick: { kind: "feature", feature: "3.Y2hlY2tvdXQgY291cG9ucw", branch: "feat/coupons-model" } },
  ],
  ["#/r/3/deleted/feat%2Fold%20one", { view: "repo", repo: 3, pick: { kind: "deleted", branch: "feat/old one" } }],
  ["#/r/3/detached", { view: "repo", repo: 3, pick: { kind: "detached" } }],
];

test.each(ROUTES)("%s round-trips through routeHash", (hash, route) => {
  expect(parseRoute(hash)).toEqual(route);
  expect(routeHash(route)).toBe(hash);
});

test.each(["", "#", "#/nope", "#/r/abc", "#/r/0", "#/r/3/f", "#/r/3/x/y", "#/r/3/f/a/%E0%A4%A", "#token=abc"])(
  "%s gives projects",
  (hash) => {
    expect(parseRoute(hash)).toEqual({ view: "projects" });
  },
);

test("a branch with characters a URL would split is encoded", () => {
  const route: Route = { view: "repo", repo: 1, pick: { kind: "feature", feature: "1.YQ", branch: "a/b#c?d%e" } };
  expect(parseRoute(routeHash(route))).toEqual(route);
});
