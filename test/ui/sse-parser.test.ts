import { expect, test } from "vitest";
import { createSseParser, type SseMessage } from "../../ui/src/sse-parser.js";

function collect(): { messages: SseMessage[]; retries: number[]; push: (chunk: string) => void } {
  const messages: SseMessage[] = [];
  const retries: number[] = [];
  const parser = createSseParser({ onMessage: (message) => messages.push(message), onRetry: (ms) => retries.push(ms) });
  return { messages, retries, push: (chunk) => parser.push(chunk) };
}

test("reads retry, then a typed event with its data", () => {
  const { messages, retries, push } = collect();
  push('retry: 3000\n\nevent: hello\ndata: {"type":"hello","version":"1"}\n\n');
  expect(retries).toEqual([3000]);
  expect(messages).toEqual([{ event: "hello", data: '{"type":"hello","version":"1"}' }]);
});

test("a message split anywhere across chunks, even inside CRLF, arrives once and whole", () => {
  const { messages, push } = collect();
  const text = "event: digest\r\ndata: {\"a\":1}\r\n\r\nevent: activity\r\ndata: 2\r\n\r\n";
  for (const char of text) push(char);
  expect(messages).toEqual([
    { event: "digest", data: '{"a":1}' },
    { event: "activity", data: "2" },
  ]);
});

test("a ping comment dispatches nothing, and an event with no data is dropped", () => {
  const { messages, push } = collect();
  push(": ping\n\nevent: lonely\n\n");
  expect(messages).toEqual([]);
});

test("data lines join with a newline, and a missing event name is message", () => {
  const { messages, push } = collect();
  push("data: one\ndata:two\n\n");
  expect(messages).toEqual([{ event: "message", data: "one\ntwo" }]);
});

test("a line still open at the end of a chunk waits for the rest", () => {
  const { messages, push } = collect();
  push("event: hel");
  push("lo\ndata: x");
  expect(messages).toEqual([]);
  push("\n\n");
  expect(messages).toEqual([{ event: "hello", data: "x" }]);
});
