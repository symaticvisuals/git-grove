import type { IncomingMessage, ServerResponse } from "node:http";
import { checkRequest } from "../auth/check-request.js";
import type { ServerContext } from "../server-context.types.js";
import { readJsonBody } from "./read-json-body.js";
import type { Router } from "./router.js";
import { runHandler } from "./run-handler.js";
import { send } from "./send.js";
import { serveStatic } from "./serve-static.js";

export type RequestDeps = { router: Router; context: ServerContext; uiDir: string; closing: () => boolean };

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "cache-control": "no-store",
};

const COOKIE_ATTRIBUTES = "HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000";

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}

function reads(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function endKeepAliveIfNeeded(req: IncomingMessage, res: ServerResponse, deps: RequestDeps): void {
  if (deps.closing() || (!reads(req.method ?? "") && !req.readableEnded)) res.setHeader("connection", "close");
}

async function respond(req: IncomingMessage, res: ServerResponse, deps: RequestDeps): Promise<void> {
  const reply = (status: number, body: unknown): void => {
    endKeepAliveIfNeeded(req, res, deps);
    send(res, status, body);
  };
  const method = req.method ?? "";
  const target = req.url ?? "";
  if (!target.startsWith("/")) {
    reply(400, { error: "bad request target" });
    return;
  }
  const url = new URL(target, "http://127.0.0.1");
  const { context } = deps;
  const gate = checkRequest(
    {
      method,
      path: url.pathname,
      query: url.searchParams,
      host: header(req, "host"),
      cookie: header(req, "cookie"),
      tokenHeader: header(req, "x-grove-token"),
      origin: header(req, "origin"),
      secFetchSite: header(req, "sec-fetch-site"),
      contentType: header(req, "content-type"),
    },
    context,
  );
  if (gate.kind === "deny") {
    reply(gate.status, { error: gate.reason });
    return;
  }
  if (gate.kind === "set-cookie") {
    res.writeHead(302, { location: gate.location, "set-cookie": `grove_token=${context.token}; ${COOKIE_ATTRIBUTES}` });
    res.end();
    return;
  }

  const match = deps.router.match(method, url.pathname);
  if (match?.kind === "stream") {
    match.fn(req, res, context);
    return;
  }
  if (match?.kind === "json") {
    const result = await runHandler(
      async () => {
        const body = reads(method) ? undefined : await readJsonBody(req);
        return match.handler({ params: match.params, query: url.searchParams, body }, context);
      },
      `${method} ${url.pathname}`,
    );
    reply(result.status, result.body);
    return;
  }
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    reply(404, { error: "not found" });
    return;
  }
  if (!reads(method)) {
    reply(405, { error: "method not allowed" });
    return;
  }
  await serveStatic(res, { uiDir: deps.uiDir, path: url.pathname, page: { token: context.token, version: context.version } });
}

/**
 * Answers one request: the security headers on every response, then the gate (`checkRequest`), then a route of
 * `router`, a 404 under `/api/`, or a file of `uiDir`. Anything that throws is a 500, logged to stderr.
 */
export async function handleRequest(req: IncomingMessage, res: ServerResponse, deps: RequestDeps): Promise<void> {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (deps.closing()) res.setHeader("connection", "close");
  try {
    await respond(req, res, deps);
  } catch (error) {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`git-grove: ${req.method ?? ""} ${req.url ?? ""}: ${detail}\n`);
    if (res.headersSent) res.destroy();
    else send(res, 500, { error: "internal error" });
  }
}
