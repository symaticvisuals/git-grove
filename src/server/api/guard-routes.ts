import { InvalidInputError } from "../../core/actions/invalid-input.error.js";
import { PLUGIN_INSTALL } from "../../core/guard-install/plugin-commands.js";
import { isRecord } from "../http/is-record.js";
import type { Router } from "../http/router.js";

const AS_PLUGIN = `the agent guard installs as a Claude Code plugin: ${PLUGIN_INSTALL.join(", then ")}`;

/**
 * Adds the agent guard's routes, which change Claude Code's user settings, never a repository, so they take no repo
 * lock and pin nothing. `GET /api/guard` is where the guard stands (`GuardState`). `POST /api/guard/plans`
 * `{ change: "uninstall" }` previews taking grove's old hook out: 200 `{ planId, plan }`; `{ change: "install" }` is a
 * 400 naming the plugin's commands. `POST /api/guard/actions` `{ planId }` makes it once and answers 200
 * `{ receipt }`, 409 when it already ran and 410 when it expired.
 */
export function registerGuardRoutes(router: Router): void {
  router.get("/api/guard", async (_req, ctx) => ({ status: 200, body: await ctx.guard.state() }));

  router.post("/api/guard/plans", async (req, ctx) => {
    const change = isRecord(req.body) ? req.body["change"] : undefined;
    if (change === "install") throw new InvalidInputError(AS_PLUGIN);
    if (change !== "uninstall") throw new InvalidInputError('a guard preview takes { change: "uninstall" }');
    return { status: 200, body: await ctx.guard.plan() };
  });

  router.post("/api/guard/actions", async (req, ctx) => {
    const planId = isRecord(req.body) ? req.body["planId"] : undefined;
    if (typeof planId !== "string") throw new InvalidInputError("a guard change takes { planId }");
    return { status: 200, body: { receipt: await ctx.guard.run(planId) } };
  });
}
