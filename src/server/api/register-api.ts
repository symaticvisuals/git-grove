import type { Router } from "../http/router.js";

const RESTART_EXIT_CODE = 75;

/**
 * Adds every API route to `router`: `GET /api/health` (no token needed; `{ ok, version, pid }`) and `POST /api/shutdown`,
 * which answers 202 and then stops the server with exit code 75, so a login service starts it again.
 */
export function registerApi(router: Router): void {
  router.get("/api/health", async (_req, ctx) => ({ status: 200, body: { ok: true, version: ctx.version, pid: process.pid } }));
  router.post("/api/shutdown", async (_req, ctx) => {
    ctx.shutdown(RESTART_EXIT_CODE);
    return { status: 202, body: { ok: true } };
  });
}
