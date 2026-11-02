import { expect, test } from "vitest";
import { swRoute } from "../../ui/src/sw-route.js";

const ORIGIN = "http://127.0.0.1:47683";

function route(path: string, options: { method?: string; mode?: string; origin?: string } = {}): string | null {
  return swRoute({ method: options.method ?? "GET", url: `${options.origin ?? ORIGIN}${path}`, mode: options.mode ?? "cors" }, ORIGIN);
}

test("the API and the event stream are never answered by the worker", () => {
  for (const path of ["/api", "/api/projects", "/api/health", "/api/shutdown", "/events", "/events?x=1"]) {
    expect(route(path), path).toBeNull();
    expect(route(path, { mode: "navigate" }), path).toBeNull();
  }
});

test("a navigation to / is the page; other navigations go straight to the network", () => {
  expect(route("/", { mode: "navigate" })).toBe("page");
  expect(route("/index.html", { mode: "navigate" })).toBeNull();
  expect(route("/fonts/OFL.txt", { mode: "navigate" })).toBeNull();
});

test("other same-origin reads come from the cache first", () => {
  for (const path of ["/app.js?v=0.1.0", "/styles.css?v=0.1.0", "/favicon.svg", "/icons/icon-192.png", "/fonts/martian-mono.woff2", "/"]) {
    expect(route(path), path).toBe("shell");
  }
});

test("writes and other origins are left alone", () => {
  expect(route("/app.js", { method: "POST" })).toBeNull();
  expect(route("/app.js", { method: "HEAD" })).toBeNull();
  expect(route("/app.js", { origin: "http://localhost:47683" })).toBeNull();
  expect(route("/app.js", { origin: "http://127.0.0.1:47684" })).toBeNull();
});
