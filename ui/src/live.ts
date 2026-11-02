import type { ServerEvent } from "../../src/server/live/server-event.types.js";
import { isServerEvent } from "./is-server-event.js";
import { createSseParser } from "./sse-parser.js";

export type LiveState = "connecting" | "up" | "down";

export type LiveOptions = {
  fetchImpl: typeof fetch;
  token: string;
  onEvent(event: ServerEvent): void;
  onState(state: LiveState): void;
  /** Called once when the server refuses the token; the connection is not retried after it. */
  onUnauthorized(): void;
  /** How the next attempt waits; a timer by default. */
  wait?: (ms: number) => Promise<void>;
};

const MAX_BACKOFF_MS = 30_000;
const DEFAULT_RETRY_MS = 3_000;
const SILENCE_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStream(body: ReadableStream<Uint8Array>, feed: (text: string) => void, attempt: AbortController): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let silence = setTimeout(() => attempt.abort(), SILENCE_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      clearTimeout(silence);
      if (done) return;
      silence = setTimeout(() => attempt.abort(), SILENCE_MS);
      feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    clearTimeout(silence);
  }
}

/**
 * Follows `/events` with `fetch` and a streaming reader, so it can send `X-Grove-Token`, and passes on each event it
 * recognises. It reports `up` while a stream is open and `down` when it ends or fails, then reconnects after the
 * server's `retry` delay, doubling after each failed attempt up to 30 s. A stream silent for 60 s is dropped. The
 * returned function stops it.
 */
export function connectLive(options: LiveOptions): () => void {
  const wait = options.wait ?? sleep;
  const stopping = new AbortController();
  let retryMs = DEFAULT_RETRY_MS;
  const parser = createSseParser({
    onMessage: ({ data }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (isServerEvent(parsed)) options.onEvent(parsed);
    },
    onRetry: (ms) => {
      retryMs = ms;
    },
  });

  const attempt = async (): Promise<"opened" | "failed" | "stop"> => {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    stopping.signal.addEventListener("abort", abort);
    let opened = false;
    try {
      options.onState("connecting");
      const response = await options.fetchImpl("/events", {
        headers: { "x-grove-token": options.token, accept: "text/event-stream" },
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status === 401) {
        options.onUnauthorized();
        return "stop";
      }
      if (response.ok && response.body !== null) {
        opened = true;
        options.onState("up");
        await readStream(response.body, (text) => parser.push(text), controller);
      }
    } catch {
      if (stopping.signal.aborted) return "stop";
    } finally {
      stopping.signal.removeEventListener("abort", abort);
    }
    return opened ? "opened" : "failed";
  };

  void (async () => {
    let delay = retryMs;
    while (!stopping.signal.aborted) {
      const outcome = await attempt();
      if (outcome === "stop" || stopping.signal.aborted) break;
      options.onState("down");
      if (outcome === "opened") delay = retryMs;
      await wait(delay);
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    }
  })();

  return () => stopping.abort();
}
