import { expect, test } from "vitest";
import { createApi } from "../../ui/src/api.js";
import { ApiError } from "../../ui/src/api.error.js";
import { featureDetail, plan, project, repoView } from "./wire-fixtures.js";

const TOKEN = "a".repeat(64);

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(reply: (url: string) => Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return reply(String(input));
  };
  return { fetch: impl, calls };
}

function json(status: number, body: unknown): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(error)}`);
  return error;
}

test("POST sends X-Grove-Token and JSON", async () => {
  const { fetch, calls } = fakeFetch(json(200, { planId: "p1", plan: plan() }));
  const reply = await createApi(fetch, TOKEN).plan({ repo: 1, action: "restore", input: { branch: "feat/x" } });
  expect(reply.planId).toBe("p1");
  const [call] = calls;
  expect(call?.url).toBe("/api/plans");
  expect(call?.init?.method).toBe("POST");
  const headers = new Headers(call?.init?.headers);
  expect(headers.get("x-grove-token")).toBe(TOKEN);
  expect(headers.get("content-type")).toBe("application/json");
  expect(JSON.parse(String(call?.init?.body))).toEqual({ repo: 1, action: "restore", input: { branch: "feat/x" } });
});

test("GET sends the token too and builds its query", async () => {
  const { fetch, calls } = fakeFetch((url) => (url.startsWith("/api/features/") ? json(200, featureDetail())() : json(200, [])()));
  const api = createApi(fetch, TOKEN);
  await api.activity({ repo: 3, limit: 8 });
  await api.feature("1.YS9i");
  expect(calls.map((call) => call.url)).toEqual(["/api/activity?repo=3&limit=8", "/api/features/1.YS9i"]);
  expect(new Headers(calls[0]?.init?.headers).get("x-grove-token")).toBe(TOKEN);
  expect(calls[0]?.init?.method).toBe("GET");
});

test("a 401 becomes the sign-in message", async () => {
  const { fetch } = fakeFetch(json(401, { error: "open the dashboard from your terminal: git grove ui" }));
  const error = await failure(createApi(fetch, TOKEN).projects());
  expect(error.status).toBe(401);
  expect(error.message).toBe("Open the dashboard from your terminal: git grove ui");
});

test("{ error } JSON surfaces as the message", async () => {
  const { fetch } = fakeFetch(json(400, { error: "no pin found for feat/x" }));
  const error = await failure(createApi(fetch, TOKEN).plan({ repo: 1, action: "restore", input: {} }));
  expect(error).toMatchObject({ status: 400, message: "no pin found for feat/x" });
});

test('a rejected fetch becomes status 0 with "git grove isn\'t running"', async () => {
  const { fetch } = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  const error = await failure(createApi(fetch, TOKEN).repo(1));
  expect(error.status).toBe(0);
  expect(error.message).toBe("git grove isn't running. Start it with git grove ui.");
});

test("a reply of the wrong shape is refused, not cast", async () => {
  const projects = await createApi(fakeFetch(json(200, [project()])).fetch, TOKEN).projects();
  expect(projects).toHaveLength(1);
  const wrong = await failure(createApi(fakeFetch(json(200, [{ id: "1" }])).fetch, TOKEN).projects());
  expect(wrong.message).toContain("Reload");
  const view = await createApi(fakeFetch(json(200, repoView())).fetch, TOKEN).repo(1);
  expect(view.trunk).toBe("main");
  await failure(createApi(fakeFetch(json(200, { ...repoView(), orphans: null })).fetch, TOKEN).repo(1));
});

test("an error page that is not JSON still gives a message", async () => {
  const { fetch } = fakeFetch(async () => new Response("<html>oops</html>", { status: 502 }));
  expect(await failure(createApi(fetch, TOKEN).needsYou())).toMatchObject({ status: 502, message: "git grove answered 502" });
});
