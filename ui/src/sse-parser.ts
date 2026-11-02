export type SseMessage = { event: string; data: string };

export type SseParser = { push(chunk: string): void };

const LINE_END = /\r\n|\n|\r/;

/**
 * Reads a Server-Sent Events stream fed in chunks of any size. A blank line dispatches the message gathered so far
 * (`event` defaults to `message`, `data` lines join with a newline); one with no data dispatches nothing. Comment
 * lines are skipped, and `retry` reports the reconnect delay the server asks for.
 */
export function createSseParser(handlers: { onMessage(message: SseMessage): void; onRetry?(ms: number): void }): SseParser {
  let buffer = "";
  let event = "";
  let data: string[] = [];

  const dispatch = (): void => {
    if (data.length > 0) handlers.onMessage({ event: event === "" ? "message" : event, data: data.join("\n") });
    event = "";
    data = [];
  };

  const line = (text: string): void => {
    if (text === "") return dispatch();
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    const raw = colon === -1 ? "" : text.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "retry" && /^\d+$/.test(value)) handlers.onRetry?.(Number(value));
  };

  return {
    push(chunk) {
      buffer += chunk;
      for (let match = LINE_END.exec(buffer); match !== null; match = LINE_END.exec(buffer)) {
        if (match[0] === "\r" && match.index === buffer.length - 1) return;
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
  };
}
