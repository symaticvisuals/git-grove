import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/core/snapshot/read-snapshot.js";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { featureId } from "../../src/server/wire/feature-id.js";
import { serverRequest } from "../support/server-request.js";
import { squashedFixture, type SquashedFixture } from "../support/squashed-fixture.js";
import { type UiFixture, uiFixture } from "../support/ui-fixture.js";

let home: string;
let ui: UiFixture;
let server: RunningServer;
let fixture: SquashedFixture;
let repoId: number;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-read-api-"));
  ui = await uiFixture();
  fixture = await squashedFixture();
  server = await startServer({ port: 0, home, uiDir: ui.dir, version: "9.9.9" });
  repoId = (await readSnapshot(fixture.repo.path, server.context.store, Date.now())).repoId;
  await fixture.squash();
});
afterEach(async () => {
  await server.close();
  await rm(home, { recursive: true, force: true });
  await ui.cleanup();
  await fixture.repo.cleanup();
});

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const reply = await serverRequest(server.port, { path, headers: { "x-grove-token": server.token } });
  return { status: reply.status, body: JSON.parse(reply.body) };
}

function list(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value.filter(isRecord);
}

function record(value: unknown): Json {
  if (!isRecord(value)) throw new Error("expected an object");
  return value;
}

const COUPONS = "checkout coupons";

test("GET /api/projects lists the repo as loses with its needs-you count", async () => {
  const { status, body } = await get("/api/projects");
  expect(status).toBe(200);
  const [project] = list(body);
  expect(project).toMatchObject({ id: repoId, health: "loses", error: null, worktrees: 6 });
  expect(project?.["needsYou"]).toBeGreaterThanOrEqual(2);
  expect(project?.["pins"]).toBe(1);
});

test("GET /api/repos/:id/features groups the stack, the single and the sandbox", async () => {
  const { status, body } = await get(`/api/repos/${repoId}/features`);
  expect(status).toBe(200);
  const view = record(body);
  const features = list(view["features"]);
  const stack = features.find((feature) => feature["name"] === COUPONS);
  const levels = list(stack?.["levels"]);
  expect(levels.map((level) => [level["number"], level["depth"]])).toEqual([["01", 1], ["02", 2], ["03", 3]]);
  expect(levels[0]).toMatchObject({ branch: "feat/coupons-model", health: "loses", state: "History rewritten", pinnedLost: 3 });
  expect(stack).toMatchObject({ id: featureId(repoId, COUPONS), kind: "stack", health: "loses" });
  expect(features.find((feature) => feature["name"] === "fix/invoice-rounding")).toMatchObject({ kind: "single" });
  expect(list(view["detached"])).toHaveLength(1);
  expect(view["trunk"]).toBe("main");
  expect(view["cleanupCount"]).toBe(1);
});

test("GET /api/features/:id for the squashed level has before and now lanes with 3 lost commits", async () => {
  const { status, body } = await get(`/api/features/${featureId(repoId, COUPONS)}`);
  expect(status).toBe(200);
  const detail = record(body);
  const [rewrite] = list(detail["rewrites"]);
  const lanes = (lane: unknown): Json[] => list(record(lane)["commits"]);
  expect(lanes(rewrite?.["before"]).filter((commit) => commit["lost"] === true)).toHaveLength(3);
  expect(lanes(rewrite?.["now"]).filter((commit) => commit["base"] === false)).toHaveLength(1);
  expect(rewrite).toMatchObject({ branch: "feat/coupons-model", lost: 3 });
  expect(list(detail["activity"])[0]).toMatchObject({ title: "History rewritten on feat/coupons-model", severity: "loses-work" });
});

test("GET /api/activity lists the rewrite first, and ?feature= keeps only that feature's branches", async () => {
  await get(`/api/repos/${repoId}/features`);
  const all = list((await get("/api/activity")).body);
  expect(all[0]).toMatchObject({ kind: "rewritten", branch: "feat/coupons-model" });
  expect(all[0]?.["id"]).toMatch(/^j:\d+$/);
  const own = list((await get(`/api/activity?feature=${featureId(repoId, COUPONS)}`)).body);
  expect(own.every((item) => String(item["branch"]).startsWith("feat/coupons-"))).toBe(true);
  expect(own.length).toBeGreaterThan(0);
  const single = list((await get(`/api/activity?feature=${featureId(repoId, "fix/invoice-rounding")}`)).body);
  expect(single.some((item) => item["kind"] === "rewritten")).toBe(false);
  expect(list((await get("/api/activity?limit=1")).body)).toHaveLength(1);
  expect((await get("/api/activity?limit=0")).status).toBe(400);
});

test("GET /api/needs-you puts loses-work first", async () => {
  const { body } = await get("/api/needs-you");
  const items = list(body);
  const severities = items.map((item) => record(item["finding"])["severity"]);
  expect(severities[0]).toBe("loses-work");
  expect(severities).toContain("needs-action");
  expect(severities.indexOf("needs-action")).toBeGreaterThan(severities.lastIndexOf("loses-work"));
  expect(items[0]).toMatchObject({ repoId, featureId: featureId(repoId, COUPONS) });
});

test("GET /api/pins lists the pin the rewrite took", async () => {
  await get("/api/projects");
  const pins = list((await get(`/api/pins?repo=${repoId}`)).body);
  expect(pins).toHaveLength(1);
  expect(pins[0]).toMatchObject({ branch: "feat/coupons-model" });
});

test("an unknown repo or feature is 404 JSON", async () => {
  for (const path of [
    "/api/repos/999/features",
    "/api/repos/abc/features",
    "/api/features/nope",
    `/api/features/${featureId(repoId, "missing")}`,
    `/api/features/${featureId(999, COUPONS)}`,
    "/api/activity?repo=999",
    "/api/pins?repo=999",
  ]) {
    const { status, body } = await get(path);
    expect(status, path).toBe(404);
    expect(record(body)["error"], path).toEqual(expect.any(String));
  }
});

test("a repo whose folder was deleted is listed with an error, not a 500", async () => {
  await get("/api/projects");
  await fixture.repo.cleanup();
  await new Promise((resolve) => setTimeout(resolve, 2100));
  const { status, body } = await get("/api/projects");
  expect(status).toBe(200);
  const [project] = list(body);
  expect(project).toMatchObject({ id: repoId });
  expect(project?.["error"]).toEqual(expect.any(String));
  expect(project?.["error"]).not.toMatch(/git not found/);
  expect((await get(`/api/repos/${repoId}/features`)).status).toBe(503);
});

test("the read routes need the token", async () => {
  const reply = await serverRequest(server.port, { path: "/api/projects" });
  expect(reply.status).toBe(401);
});
