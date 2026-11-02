import { expect, test } from "vitest";
import { notificationFor } from "../../ui/src/notify.js";
import { sidebar } from "../../ui/src/render/sidebar.js";
import { activityItem, project } from "./wire-fixtures.js";

test("an activity item that loses work raises a notification tagged with its id", () => {
  const item = activityItem({ id: "j:42", title: "History rewritten on feat/coupons-model", severity: "loses-work" });
  expect(notificationFor({ type: "activity", item })).toEqual({
    title: "git grove",
    body: "History rewritten on feat/coupons-model",
    tag: "j:42",
    icon: "/icons/icon-192.png",
    href: "#/needs",
  });
});

test("nothing else raises one", () => {
  for (const severity of ["needs-action", "waiting-on-review", "idle", "info"] as const) {
    expect(notificationFor({ type: "activity", item: activityItem({ severity }) })).toBeNull();
  }
  expect(notificationFor({ type: "hello", version: "1.0.0" })).toBeNull();
  expect(notificationFor({ type: "digest", repoId: 1, digest: "x", at: 1 })).toBeNull();
});

test("the sidebar offers Notify me only while the browser has not been asked", () => {
  const base = { route: { view: "projects" } as const, projects: { status: "ready" as const, data: [project()], stale: false }, repo: null, live: "up" as const, now: 1 };
  expect(sidebar({ ...base, notify: "default" }).text).toContain('data-ui="notify"');
  expect(sidebar({ ...base, notify: "default" }).text).toContain("Notify me");
  for (const notify of ["granted", "denied", "unsupported"] as const) expect(sidebar({ ...base, notify }).text).not.toContain("Notify me");
  expect(sidebar(base).text).not.toContain("Notify me");
});
