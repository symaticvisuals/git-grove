import type { ServerResponse } from "node:http";
import type { Router } from "../http/router.js";
import { send } from "../http/send.js";
import type { ServerEvent } from "./server-event.types.js";

const MAX_CLIENTS = 16;
const PING_MS = 25_000;
const MAX_BACKLOG_BYTES = 4 * 1024 * 1024;

function frame(event: ServerEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function open(res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write("retry: 3000\n\n");
}

/**
 * Adds `GET /events`: a Server-Sent Events stream that opens with `retry: 3000` and a `hello` event, then carries every
 * hub event as `event: <type>` / `data: <json>`, with a `: ping` comment every 25 s. It needs the `X-Grove-Token` header,
 * so the browser reads it with `fetch`, not `EventSource`. A 17th client gets 503. When the hub closes, the stream ends
 * normally so the client reconnects.
 */
export function registerEventsRoute(router: Router): void {
  router.stream("/events", (req, res, ctx) => {
    if (ctx.hub.subscribers() >= MAX_CLIENTS) {
      send(res, 503, { error: "too many open dashboards" });
      return;
    }
    open(res);
    res.write(frame({ type: "hello", version: ctx.version }));
    let ping: NodeJS.Timeout | null = null;
    let unsubscribe = (): void => undefined;
    const finish = (): void => {
      if (ping !== null) clearInterval(ping);
      ping = null;
      unsubscribe();
    };
    unsubscribe = ctx.hub.subscribe(
      (event) => {
        if (res.writableLength > MAX_BACKLOG_BYTES) {
          finish();
          res.destroy();
          return;
        }
        res.write(frame(event));
      },
      () => {
        finish();
        res.end();
      },
    );
    ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
    ping.unref();
    req.on("close", finish);
    res.on("close", finish);
  });
}
