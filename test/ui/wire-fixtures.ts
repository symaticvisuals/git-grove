import type { Plan } from "../../src/core/actions/plan.types.js";
import type { Finding } from "../../src/core/rules/rule.types.js";
import type {
  ActivityItem,
  WireFeature,
  WireFeatureDetail,
  WireLevel,
  WireProject,
  WireRepoView,
} from "../../src/server/wire/wire.types.js";

export function project(overrides: Partial<WireProject> = {}): WireProject {
  return { id: 1, name: "acme-shop", root: "/src/acme-shop", health: "fine", worktrees: 4, needsYou: 0, pins: 0, scannedAt: 1_000, error: null, ...overrides };
}

export function finding(rule: string, overrides: Partial<Finding> = {}): Finding {
  return { rule, severity: "needs-action", subject: { kind: "branch", id: "feat/x" }, title: rule, detail: "", action: null, ...overrides };
}

export function level(overrides: Partial<WireLevel> = {}): WireLevel {
  return {
    branch: "feat/x",
    parent: "main",
    depth: 1,
    number: "01",
    health: "fine",
    state: "In sync",
    findings: [],
    worktree: { path: "/src/acme-shop/.worktrees/x/01-x", rel: ".worktrees/x/01-x", dirty: 0, operation: null, touchedAt: null },
    upstream: null,
    behindTrunk: 0,
    parentCommitsSinceFork: 0,
    pinnedLost: 0,
    merged: false,
    precious: 0,
    ...overrides,
  };
}

export function feature(overrides: Partial<WireFeature> = {}): WireFeature {
  return { id: "1.Y291cG9ucw", repoId: 1, name: "coupons", kind: "stack", health: "fine", levels: [level()], ...overrides };
}

export function repoView(overrides: Partial<WireRepoView> = {}): WireRepoView {
  return { project: project(), trunk: "main", lastFetchAt: null, features: [feature()], detached: [], orphans: [], findings: [], cleanupCount: 0, rescueCount: 0, ...overrides };
}

export function featureDetail(overrides: Partial<WireFeatureDetail> = {}): WireFeatureDetail {
  return { feature: feature(), rewrites: [], activity: [], ...overrides };
}

export function activityItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return { id: "j:1", repoId: 1, at: 1_000, kind: "rewritten", branch: "feat/x", title: "History rewritten", detail: "", severity: "loses-work", ...overrides };
}

export function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    action: "restack",
    context: "coupons",
    title: "Restack coupons",
    summary: "",
    confirm: "Restack",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [],
    effects: [],
    commands: [],
    steps: [],
    blockers: [],
    note: null,
    undoable: true,
    moves: [],
    expects: [],
    readAt: 1_000,
    ...overrides,
  };
}
