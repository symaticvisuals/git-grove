import { afterEach, expect, test, vi } from "vitest";
import { InvalidInputError } from "../../src/core/actions/invalid-input.error.js";
import { HttpError } from "../../src/server/http/http.error.js";
import { createRouter, type Handler } from "../../src/server/http/router.js";
import { runHandler } from "../../src/server/http/run-handler.js";

const ok: Handler = async () => ({ status: 200, body: null });

afterEach(() => vi.restoreAllMocks());

test("match finds a route by method and fills its params, decoded", () => {
  const router = createRouter();
  const read: Handler = async () => ({ status: 200, body: "read" });
  const write: Handler = async () => ({ status: 200, body: "write" });
  router.get("/api/features/:id", read);
  router.post("/api/features/:id", write);
  expect(router.match("GET", "/api/features/feat%2Fsearch")).toEqual({ kind: "json", handler: read, params: { id: "feat/search" } });
  expect(router.match("POST", "/api/features/x")).toEqual({ kind: "json", handler: write, params: { id: "x" } });
});

test("match is null for another method, another shape or a param that does not decode", () => {
  const router = createRouter();
  router.get("/api/repos/:id/features", ok);
  expect(router.match("POST", "/api/repos/1/features")).toBeNull();
  expect(router.match("GET", "/api/repos/1")).toBeNull();
  expect(router.match("GET", "/api/repos/1/features/x")).toBeNull();
  expect(router.match("GET", "/api/repos//features")).toBeNull();
  expect(router.match("GET", "/api/repos/%E0%A4%A/features")).toBeNull();
});

test("a stream route matches GET only", () => {
  const router = createRouter();
  const fn = (): void => undefined;
  router.stream("/events", fn);
  expect(router.match("GET", "/events")).toEqual({ kind: "stream", fn, params: {} });
  expect(router.match("POST", "/events")).toBeNull();
});

test("runHandler maps HttpError to its status and InvalidInputError to 400", async () => {
  expect(await runHandler(() => Promise.reject(new HttpError(409, "plan already ran")), "POST /x")).toEqual({
    status: 409,
    body: { error: "plan already ran" },
  });
  expect(await runHandler(() => Promise.reject(new InvalidInputError("branch is required")), "POST /x")).toEqual({
    status: 400,
    body: { error: "branch is required" },
  });
});

test("runHandler turns anything else into a 500 and logs it to stderr", async () => {
  const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  expect(await runHandler(() => Promise.reject(new Error("disk on fire")), "GET /api/x")).toEqual({
    status: 500,
    body: { error: "internal error" },
  });
  expect(write).toHaveBeenCalledWith(expect.stringContaining("GET /api/x"));
  expect(write).toHaveBeenCalledWith(expect.stringContaining("disk on fire"));
});

test("runHandler passes a result through", async () => {
  expect(await runHandler(() => Promise.resolve({ status: 202, body: { ok: true } }), "POST /x")).toEqual({ status: 202, body: { ok: true } });
});
