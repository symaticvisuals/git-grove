import { expect, test } from "vitest";
import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import { connectLive, type LiveState } from "../../ui/src/live.js";

const TOKEN = "b".repeat(64);

function stream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 20));
      controller.enqueue(bytes.slice(20));
      controller.close();
    },
  });
}

test("reads events with the token header, reports up then down, and waits before reconnecting", async () => {
  const events: ServerEvent[] = [];
  const states: LiveState[] = [];
  const waits: number[] = [];
  const headers: (string | null)[] = [];
  let stop = (): void => undefined;
  const body = 'retry: 3000\n\nevent: hello\ndata: {"type":"hello","version":"1.0.0"}\n\n: ping\n\nevent: digest\ndata: {"type":"digest","repoId":1,"digest":"d","at":2}\n\nevent: digest\ndata: {"type":"digest"}\n\n';
  const done = new Promise<void>((resolve) => {
    stop = connectLive({
      fetchImpl: async (_input, init) => {
        headers.push(new Headers(init?.headers).get("x-grove-token"));
        return new Response(stream(body), { status: 200, headers: { "content-type": "text/event-stream" } });
      },
      token: TOKEN,
      onEvent: (event) => events.push(event),
      onState: (state) => states.push(state),
      onUnauthorized: () => undefined,
      wait: async (ms) => {
        waits.push(ms);
        stop();
        resolve();
      },
    });
  });
  await done;
  expect(headers).toEqual([TOKEN]);
  expect(events).toEqual([
    { type: "hello", version: "1.0.0" },
    { type: "digest", repoId: 1, digest: "d", at: 2 },
  ]);
  expect(states).toEqual(["connecting", "up", "down"]);
  expect(waits).toEqual([3000]);
});

test("failed attempts back off, and a 401 stops for good", async () => {
  const waits: number[] = [];
  let unauthorized = 0;
  let attempts = 0;
  await new Promise<void>((resolve) => {
    connectLive({
      fetchImpl: async () => {
        attempts += 1;
        if (attempts <= 3) throw new TypeError("Failed to fetch");
        resolve();
        return new Response("{}", { status: 401 });
      },
      token: TOKEN,
      onEvent: () => undefined,
      onState: () => undefined,
      onUnauthorized: () => {
        unauthorized += 1;
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(waits).toEqual([3000, 6000, 12000]);
  expect(unauthorized).toBe(1);
  expect(attempts).toBe(4);
});

type Step = { kind: "fail" } | { kind: "status"; status: number } | { kind: "stream"; body: string };

function scripted(steps: Step[]): { run: Promise<{ events: ServerEvent[]; states: [LiveState, string | undefined][]; waits: number[] }> } {
  const events: ServerEvent[] = [];
  const states: [LiveState, string | undefined][] = [];
  const waits: number[] = [];
  let index = 0;
  let stop = (): void => undefined;
  const run = new Promise<{ events: ServerEvent[]; states: [LiveState, string | undefined][]; waits: number[] }>((resolve) => {
    stop = connectLive({
      fetchImpl: async () => {
        const step = steps[index++];
        if (step === undefined || step.kind === "fail") throw new TypeError("Failed to fetch");
        if (step.kind === "status") return new Response("{}", { status: step.status });
        return new Response(stream(step.body), { status: 200 });
      },
      token: TOKEN,
      onEvent: (event) => events.push(event),
      onState: (state, problem) => states.push([state, problem]),
      onUnauthorized: () => undefined,
      wait: async (ms) => {
        waits.push(ms);
        if (waits.length >= steps.length) {
          stop();
          resolve({ events, states, waits });
        }
      },
    });
  });
  return { run };
}

test("a line cut off by a dropped stream is never joined to the next stream", async () => {
  const { run } = scripted([
    { kind: "stream", body: 'event: hello\ndata: {"type":"hello","ver' },
    { kind: "stream", body: 'sion":"9.9.9"}\n\nevent: digest\ndata: {"type":"digest","repoId":1,"digest":"d","at":2}\n\n' },
  ]);
  const { events } = await run;
  expect(events).toEqual([{ type: "digest", repoId: 1, digest: "d", at: 2 }]);
});

test("failures double the wait up to 30 s, and an open stream resets it", async () => {
  const fail: Step = { kind: "fail" };
  const { run } = scripted([fail, fail, fail, fail, fail, fail, { kind: "stream", body: ": ping\n\n" }, fail]);
  const { waits } = await run;
  expect(waits).toEqual([3000, 6000, 12000, 24000, 30000, 30000, 3000, 6000]);
});

test("a 503 is down as busy; a refused connection or another status is unreachable", async () => {
  const { run } = scripted([{ kind: "status", status: 503 }, { kind: "fail" }, { kind: "status", status: 500 }]);
  const { states } = await run;
  expect(states.filter(([state]) => state === "down")).toEqual([
    ["down", "busy"],
    ["down", "unreachable"],
    ["down", "unreachable"],
  ]);
});
