import { type IncomingHttpHeaders, request } from "node:http";

export type ServerReply = { status: number; headers: IncomingHttpHeaders; body: string };

/**
 * Sends one request to `<address>:<port>` (default 127.0.0.1) through node:http, which sends the path verbatim and
 * any `Host`, `Origin` or `Sec-Fetch-*` header given, as fetch does not.
 */
export function serverRequest(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string; address?: string } = {},
): Promise<ServerReply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: options.address ?? "127.0.0.1", port, method: options.method ?? "GET", path: options.path ?? "/", headers: options.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}
