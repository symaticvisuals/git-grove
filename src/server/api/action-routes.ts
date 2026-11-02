import { stat } from "node:fs/promises";
import { errorLine } from "../../core/actions/error-line.js";
import { InvalidInputError } from "../../core/actions/invalid-input.error.js";
import type { ActionName } from "../../core/actions/plan.types.js";
import { ACTIONS, prepareAction } from "../../core/actions/registry.js";
import { readConfig } from "../../core/config/read-config.js";
import { NotAWorktreeError } from "../../core/facts/not-a-worktree.error.js";
import { appCommand } from "../../core/open/app-command.js";
import { launchDetached } from "../../core/open/launch-detached.js";
import { HttpError } from "../http/http.error.js";
import { isRecord } from "../http/is-record.js";
import type { Router } from "../http/router.js";
import { findRepo } from "./find-repo.js";
import { readSnapshotOrFail } from "./read-snapshot-or-fail.js";

type PlanRequest = { repo: number; action: string; input?: unknown };
type RunRequest = { planId: string };
type ScanRequest = { repo?: number };
type OpenRequest = { repo: number; path: string; app: "editor" | "terminal" };

function isRepoId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPlanRequest(value: unknown): value is PlanRequest {
  return isRecord(value) && isRepoId(value["repo"]) && typeof value["action"] === "string";
}

function isActionName(name: string): name is ActionName {
  return Object.hasOwn(ACTIONS, name);
}

function isRunRequest(value: unknown): value is RunRequest {
  return isRecord(value) && typeof value["planId"] === "string";
}

function isScanRequest(value: unknown): value is ScanRequest {
  return isRecord(value) && (value["repo"] === undefined || isRepoId(value["repo"]));
}

function isOpenRequest(value: unknown): value is OpenRequest {
  if (!isRecord(value)) return false;
  const app = value["app"];
  return isRepoId(value["repo"]) && typeof value["path"] === "string" && (app === "editor" || app === "terminal");
}

function planGone(state: "expired" | "taken"): never {
  if (state === "expired") throw new HttpError(410, "This preview expired; preview it again");
  throw new HttpError(409, "This plan already ran");
}

async function isFolder(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

/**
 * Adds the action routes. `POST /api/plans` `{ repo, action, input }` previews an action: 200 `{ planId, plan }`, or
 * 400 for input the action refuses, including a path that is not a worktree.
 * `POST /api/actions` `{ planId }` runs that plan once in the background: 202 `{ runId }`, 409 when it already ran,
 * 410 when it expired, and 503 while the server stops, which leaves the plan to run later. `GET /api/runs/:id` is the run's plan, step events and receipt. `POST /api/scan` `{ repo? }`
 * starts a scan: 202. `POST /api/open` `{ repo, path, app }` starts the editor or terminal, without a shell, in `path`,
 * which must be one of the repository's worktrees (400); a launch that fails is a 500 with its message.
 */
export function registerActionRoutes(router: Router): void {
  router.post("/api/plans", async (req, ctx) => {
    const body = req.body;
    if (!isPlanRequest(body)) throw new InvalidInputError("a preview takes { repo, action, input }");
    const { action } = body;
    if (!isActionName(action)) throw new InvalidInputError("unknown action");
    const repo = findRepo(ctx, String(body.repo));
    const snapshot = await readSnapshotOrFail(ctx, repo.id);
    const prepared = await prepareAction(action, { root: snapshot.facts.root, store: ctx.store, now: Date.now }, body.input).catch(
      (error: unknown) => {
        throw error instanceof NotAWorktreeError ? new InvalidInputError(errorLine(error)) : error;
      },
    );
    return { status: 200, body: { planId: ctx.plans.put(repo.id, prepared), plan: prepared.plan } };
  });

  router.post("/api/actions", async (req, ctx) => {
    const body = req.body;
    if (!isRunRequest(body)) throw new InvalidInputError("a run takes { planId }");
    if (ctx.runs.stopping) throw new HttpError(503, "git grove is stopping");
    const peeked = ctx.plans.peek(body.planId);
    if (typeof peeked === "string") planGone(peeked);
    const repo = findRepo(ctx, String(peeked.repoId));
    const cached = ctx.plans.take(body.planId);
    if (typeof cached === "string") planGone(cached);
    return { status: 202, body: { runId: ctx.runs.start(repo.id, repo.root, cached.prepared) } };
  });

  router.get("/api/runs/:id", async (req, ctx) => {
    const state = ctx.runs.get(req.params["id"] ?? "");
    if (state === null) throw new HttpError(404, "unknown run");
    return { status: 200, body: state };
  });

  router.post("/api/scan", async (req, ctx) => {
    const body = req.body;
    if (!isScanRequest(body)) throw new InvalidInputError("a scan takes { repo? }");
    const repoId = body.repo === undefined ? undefined : findRepo(ctx, String(body.repo)).id;
    ctx.hub.scan(repoId).catch(() => undefined);
    return { status: 202, body: { ok: true } };
  });

  router.post("/api/open", async (req, ctx) => {
    const body = req.body;
    if (!isOpenRequest(body)) throw new InvalidInputError('open takes { repo, path, app: "editor" | "terminal" }');
    const repo = findRepo(ctx, String(body.repo));
    const { facts } = await readSnapshotOrFail(ctx, repo.id);
    const worktree = facts.worktrees.find((candidate) => candidate.path === body.path && !candidate.prunable);
    if (worktree === undefined || !(await isFolder(worktree.path))) {
      throw new InvalidInputError("that is not one of this repository's worktrees");
    }
    const command = appCommand(body.app, worktree.path, await readConfig(ctx.home), process.platform);
    await launchDetached(command).catch((error: unknown) => {
      throw new HttpError(500, error instanceof Error ? error.message : String(error));
    });
    return { status: 200, body: { ok: true } };
  });
}
