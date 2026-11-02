import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readSnapshot } from "../../src/core/snapshot/read-snapshot.js";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { serverRequest } from "../support/server-request.js";
import { squashedFixture, type SquashedFixture } from "../support/squashed-fixture.js";
import { type UiFixture, uiFixture } from "../support/ui-fixture.js";

let home: string;
let ui: UiFixture;
let server: RunningServer;
let fixture: SquashedFixture;
const aborts: AbortController[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-events-"));
  ui = await uiFixture();
  fixture = await squashedFixture();
  server = await startServer({ port: 0, home, uiDir: ui.dir, version: "9.9.9", watch: { debounceMs: 30, pollMs: 60_000 } });
  await readSnapshot(fixture.repo.path, server.context.store, Date.now());
});
afterEach(async () => {
  for (const abort of aborts.splice(0)) abort.abort();
  await server.close();
  await rm(home, { recursive: true, force: true });
  await ui.cleanup();
  await fixture.repo.cleanup();
});

async function openStream(): Promise<{ response: Response; read: (until: string) => Promise<string> }> {
  const abort = new AbortController();
  aborts.push(abort);
  const response = await fetch(`http://127.0.0.1:${server.port}/events`, { headers: { "x-grove-token": server.token }, signal: abort.signal });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("no body");
  const decoder = new TextDecoder();
  let text = "";
  return {
    response,
    async read(until) {
      while (!text.includes(until)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text;
    },
  };
}

test("GET /events streams hello, then a digest after a commit", async () => {
  const stream = await openStream();
  expect(stream.response.status).toBe(200);
  expect(stream.response.headers.get("content-type")).toContain("text/event-stream");
  const hello = await stream.read("event: hello");
  expect(hello.startsWith("retry: 3000\n\n")).toBe(true);
  expect(hello).toContain('data: {"type":"hello","version":"9.9.9"}');
  await server.context.hub.scan();
  expect(await stream.read("event: digest")).toContain("event: digest");
  await fixture.squash();
  expect(await stream.read("History rewritten")).toContain("event: activity");
});

test("/events without the token is 401", async () => {
  const reply = await serverRequest(server.port, { path: "/events" });
  expect(reply.status).toBe(401);
});

test("the stream ends cleanly when the server closes", async () => {
  const stream = await openStream();
  await stream.read("event: hello");
  const closing = server.close();
  const text = await stream.read("never appears");
  expect(text).toContain("event: hello");
  await closing;
});

test("a 17th client gets 503", async () => {
  for (let i = 0; i < 16; i += 1) await (await openStream()).read("event: hello");
  const reply = await serverRequest(server.port, { path: "/events", headers: { "x-grove-token": server.token } });
  expect(reply.status).toBe(503);
});
