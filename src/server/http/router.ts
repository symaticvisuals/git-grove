import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "../server-context.types.js";
import type { HandlerResult } from "./run-handler.js";

export type HandlerRequest = { params: Record<string, string>; query: URLSearchParams; body: unknown };

export type Handler = (req: HandlerRequest, ctx: ServerContext) => Promise<HandlerResult>;

export type StreamHandler = (req: IncomingMessage, res: ServerResponse, ctx: ServerContext) => void;

export type RouteMatch =
  | { kind: "json"; handler: Handler; params: Record<string, string> }
  | { kind: "stream"; fn: StreamHandler; params: Record<string, string> };

export type Router = {
  get(pattern: string, handler: Handler): void;
  post(pattern: string, handler: Handler): void;
  /** A GET whose handler writes the response itself, such as Server-Sent Events. */
  stream(pattern: string, fn: StreamHandler): void;
  match(method: string, path: string): RouteMatch | null;
};

type Route = {
  method: "GET" | "POST";
  parts: string[];
  target: { kind: "json"; handler: Handler } | { kind: "stream"; fn: StreamHandler };
};

function paramsOf(parts: string[], path: string): Record<string, string> | null {
  const segments = path.split("/");
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of parts.entries()) {
    const segment = segments[i] ?? "";
    if (!part.startsWith(":")) {
      if (segment !== part) return null;
      continue;
    }
    if (segment === "") return null;
    try {
      params[part.slice(1)] = decodeURIComponent(segment);
    } catch {
      return null;
    }
  }
  return params;
}

/** Routes by method and a pattern whose `:name` segments become decoded params, checked in the order added. */
export function createRouter(): Router {
  const routes: Route[] = [];
  const add = (method: Route["method"], pattern: string, target: Route["target"]): void => {
    routes.push({ method, parts: pattern.split("/"), target });
  };
  return {
    get: (pattern, handler) => add("GET", pattern, { kind: "json", handler }),
    post: (pattern, handler) => add("POST", pattern, { kind: "json", handler }),
    stream: (pattern, fn) => add("GET", pattern, { kind: "stream", fn }),
    match(method, path) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const params = paramsOf(route.parts, path);
        if (params === null) continue;
        return route.target.kind === "json"
          ? { kind: "json", handler: route.target.handler, params }
          : { kind: "stream", fn: route.target.fn, params };
      }
      return null;
    },
  };
}
