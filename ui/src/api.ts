import type { ActionName, Plan } from "../../src/core/actions/plan.types.js";
import type { GuardChange, GuardPlan, GuardReceipt, GuardState } from "../../src/core/guard-install/guard-install.types.js";
import type { PinEntry } from "../../src/core/runner/list-pins.js";
import type { RunState } from "../../src/server/actions/runs.js";
import type { ActivityItem, NeedsYouItem, WireFeatureDetail, WireProject, WireRepoView } from "../../src/server/wire/wire.types.js";
import { ApiError } from "./api.error.js";
import { isActivityItem } from "./is-activity-item.js";
import { isGuardStatus } from "./is-guard-status.js";
import { isReceipt } from "./is-receipt.js";
import { isRecord } from "./is-record.js";
import { isStepEvent } from "./is-step-event.js";
import { MESSAGES } from "./messages.js";

export type PlanRequest = { repo: number; action: ActionName; input: unknown };
export type ActivityQuery = { repo?: number; feature?: string; limit?: number };
export type OpenRequest = { repo: number; path: string; app: "editor" | "terminal" };

export type Api = {
  projects(): Promise<WireProject[]>;
  repo(id: number): Promise<WireRepoView>;
  feature(id: string): Promise<WireFeatureDetail>;
  activity(query: ActivityQuery): Promise<ActivityItem[]>;
  pins(repo?: number): Promise<PinEntry[]>;
  needsYou(): Promise<NeedsYouItem[]>;
  plan(request: PlanRequest): Promise<{ planId: string; plan: Plan }>;
  run(planId: string): Promise<{ runId: string }>;
  runState(runId: string): Promise<RunState>;
  scan(repo?: number): Promise<void>;
  open(request: OpenRequest): Promise<void>;
  guard(): Promise<GuardState>;
  guardPlan(change: GuardChange): Promise<{ planId: string; plan: GuardPlan }>;
  guardRun(planId: string): Promise<{ receipt: GuardReceipt }>;
};

type Guard<T> = (value: unknown) => value is T;

function listOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

function isNullableNumber(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isProject(value: unknown): value is WireProject {
  return (
    isRecord(value) &&
    typeof value["id"] === "number" &&
    typeof value["name"] === "string" &&
    typeof value["root"] === "string" &&
    typeof value["health"] === "string" &&
    typeof value["worktrees"] === "number" &&
    typeof value["needsYou"] === "number" &&
    typeof value["pins"] === "number" &&
    isNullableNumber(value["scannedAt"]) &&
    isNullableString(value["error"])
  );
}

function isRepoView(value: unknown): value is WireRepoView {
  return (
    isRecord(value) &&
    isProject(value["project"]) &&
    typeof value["trunk"] === "string" &&
    isNullableNumber(value["lastFetchAt"]) &&
    Array.isArray(value["features"]) &&
    Array.isArray(value["detached"]) &&
    Array.isArray(value["orphans"]) &&
    Array.isArray(value["findings"]) &&
    typeof value["cleanupCount"] === "number" &&
    typeof value["rescueCount"] === "number"
  );
}

function isFeatureDetail(value: unknown): value is WireFeatureDetail {
  return (
    isRecord(value) &&
    isRecord(value["feature"]) &&
    Array.isArray(value["feature"]["levels"]) &&
    Array.isArray(value["rewrites"]) &&
    listOf(isActivityItem)(value["activity"])
  );
}

function isPin(value: unknown): value is PinEntry {
  return isRecord(value) && ["ref", "sha", "branch", "at"].every((key) => typeof value[key] === "string");
}

function isNeedsYouItem(value: unknown): value is NeedsYouItem {
  return (
    isRecord(value) &&
    typeof value["repoId"] === "number" &&
    typeof value["repoName"] === "string" &&
    isNullableString(value["featureId"]) &&
    isNullableString(value["orphan"]) &&
    isRecord(value["finding"])
  );
}

function isRecordOrNull(value: unknown): boolean {
  return value === null || isRecord(value);
}

function isListOrNull(value: unknown): boolean {
  return value === null || Array.isArray(value);
}

function isPlan(value: unknown): value is Plan {
  return (
    isRecord(value) &&
    ["action", "context", "title", "summary", "confirm"].every((key) => typeof value[key] === "string") &&
    isRecordOrNull(value["before"]) &&
    isRecordOrNull(value["after"]) &&
    isListOrNull(value["folders"]) &&
    isListOrNull(value["choices"]) &&
    ["checks", "effects", "commands", "steps", "blockers", "moves", "expects"].every((key) => Array.isArray(value[key])) &&
    isNullableString(value["note"]) &&
    typeof value["undoable"] === "boolean" &&
    typeof value["readAt"] === "number"
  );
}

function isPlanReply(value: unknown): value is { planId: string; plan: Plan } {
  return isRecord(value) && typeof value["planId"] === "string" && isPlan(value["plan"]);
}

function isRunReply(value: unknown): value is { runId: string } {
  return isRecord(value) && typeof value["runId"] === "string";
}

function isRunState(value: unknown): value is RunState {
  return isRecord(value) && isPlan(value["plan"]) && Array.isArray(value["events"]) && value["events"].every(isStepEvent) && (value["receipt"] === null || isReceipt(value["receipt"]));
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isGuardChange(value: unknown): value is GuardChange {
  return value === "install" || value === "uninstall";
}

function isGuardState(value: unknown): value is GuardState {
  return (
    isRecord(value) &&
    isGuardStatus(value["status"]) &&
    ["settingsPath", "command"].every((key) => typeof value[key] === "string") &&
    typeof value["hooksDisabled"] === "boolean" &&
    isNullableString(value["refusal"])
  );
}

function isGuardPlan(value: unknown): value is GuardPlan {
  return (
    isRecord(value) &&
    isGuardChange(value["change"]) &&
    ["title", "summary", "confirm", "settingsPath"].every((key) => typeof value[key] === "string") &&
    isNullableString(value["backupPath"]) &&
    isNullableString(value["adds"]) &&
    ["removes", "lines", "warnings", "blockers"].every((key) => isStrings(value[key])) &&
    typeof value["readAt"] === "number"
  );
}

function isGuardPlanReply(value: unknown): value is { planId: string; plan: GuardPlan } {
  return isRecord(value) && typeof value["planId"] === "string" && isGuardPlan(value["plan"]);
}

function isGuardReceipt(value: unknown): value is GuardReceipt {
  return (
    isRecord(value) &&
    isGuardChange(value["change"]) &&
    typeof value["updated"] === "boolean" &&
    typeof value["ok"] === "boolean" &&
    typeof value["refused"] === "boolean" &&
    typeof value["title"] === "string" &&
    isStrings(value["lines"]) &&
    (value["undo"] === null || isGuardChange(value["undo"])) &&
    typeof value["at"] === "number"
  );
}

function isGuardRunReply(value: unknown): value is { receipt: GuardReceipt } {
  return isRecord(value) && isGuardReceipt(value["receipt"]);
}

function isOk(value: unknown): value is { ok: true } {
  return isRecord(value) && value["ok"] === true;
}

function messageOf(body: unknown, status: number): string {
  return isRecord(body) && typeof body["error"] === "string" ? body["error"] : `git grove answered ${status}`;
}

/**
 * The dashboard's client for git grove's API. Every request sends `X-Grove-Token`; a POST sends JSON. A reply is
 * checked against the shape it should have before it is returned. Failures are `ApiError`s: status 0 when nothing
 * answered, 401 with the sign-in sentence, otherwise the server's `{ error }` message.
 */
export function createApi(fetchImpl: typeof fetch, token: string): Api {
  async function call<T>(method: "GET" | "POST", path: string, body: unknown, guard: Guard<T>): Promise<T> {
    const headers: Record<string, string> = { "x-grove-token": token, accept: "application/json" };
    if (method === "POST") headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetchImpl(path, { method, headers, body: method === "POST" ? JSON.stringify(body) : null, cache: "no-store", credentials: "omit" });
    } catch {
      throw new ApiError(0, MESSAGES.notRunning);
    }
    const parsed: unknown = await response.json().catch(() => undefined);
    if (response.status === 401) throw new ApiError(401, MESSAGES.signedOut);
    if (!response.ok) throw new ApiError(response.status, messageOf(parsed, response.status));
    if (!guard(parsed)) throw new ApiError(response.status, MESSAGES.unexpected);
    return parsed;
  }
  const get = <T>(path: string, guard: Guard<T>): Promise<T> => call("GET", path, undefined, guard);
  const post = <T>(path: string, body: unknown, guard: Guard<T>): Promise<T> => call("POST", path, body, guard);
  const query = (params: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value));
    const text = search.toString();
    return text === "" ? "" : `?${text}`;
  };
  return {
    projects: () => get("/api/projects", listOf(isProject)),
    repo: (id) => get(`/api/repos/${id}/features`, isRepoView),
    feature: (id) => get(`/api/features/${encodeURIComponent(id)}`, isFeatureDetail),
    activity: ({ repo, feature, limit }) => get(`/api/activity${query({ repo, feature, limit })}`, listOf(isActivityItem)),
    pins: (repo) => get(`/api/pins${query({ repo })}`, listOf(isPin)),
    needsYou: () => get("/api/needs-you", listOf(isNeedsYouItem)),
    plan: (request) => post("/api/plans", request, isPlanReply),
    run: (planId) => post("/api/actions", { planId }, isRunReply),
    runState: (runId) => get(`/api/runs/${encodeURIComponent(runId)}`, isRunState),
    scan: async (repo) => {
      await post("/api/scan", repo === undefined ? {} : { repo }, isOk);
    },
    open: async (request) => {
      await post("/api/open", request, isOk);
    },
    guard: () => get("/api/guard", isGuardState),
    guardPlan: (change) => post("/api/guard/plans", { change }, isGuardPlanReply),
    guardRun: (planId) => post("/api/guard/actions", { planId }, isGuardRunReply),
  };
}
