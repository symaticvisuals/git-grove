import type { ServerResponse } from "node:http";

/** Writes `body` as a JSON response with `status`. */
export function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}
