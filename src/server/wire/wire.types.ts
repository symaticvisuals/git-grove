import type { ActivityKind } from "../../core/journal/store.types.js";
import type { Operation } from "../../core/facts/facts.types.js";
import type { Lane } from "../../core/actions/plan.types.js";
import type { ChangeKind } from "../../core/journal/classify-tip-change.js";
import type { Finding, Severity } from "../../core/rules/rule.types.js";
import type { FeatureKind } from "../../core/stacks/stacks.types.js";
import type { Health } from "./health-of.js";

export type WireProject = {
  id: number;
  name: string;
  root: string;
  health: Health;
  worktrees: number;
  needsYou: number;
  pins: number;
  scannedAt: number | null;
  error: string | null;
};

export type WireLevel = {
  branch: string;
  parent: string;
  depth: number;
  number: string | null;
  health: Health;
  state: string;
  findings: Finding[];
  worktree: { path: string; rel: string; dirty: number; operation: Operation | null; touchedAt: number | null } | null;
  upstream: { ahead: number; behind: number; gone: boolean } | null;
  behindTrunk: number;
  parentCommitsSinceFork: number;
  pinnedLost: number;
  merged: boolean;
  precious: number;
};

export type WireFeature = { id: string; repoId: number; name: string; kind: FeatureKind; health: Health; levels: WireLevel[] };

export type WireSandbox = { path: string; rel: string; head: string | null; touchedAt: number | null; health: Health; state: string };

export type WireRepoView = {
  project: WireProject;
  trunk: string;
  lastFetchAt: number | null;
  features: WireFeature[];
  detached: WireSandbox[];
  findings: Finding[];
  cleanupCount: number;
};

export type WireRewrite = {
  branch: string;
  pinRef: string | null;
  at: number;
  lost: number;
  matchedByPatch: number;
  matchedByMeta: number;
  before: Lane;
  now: Lane | null;
};

/** One line of the activity feed. `id` is `j:<id>` for a journal entry and `a:<id>` for a stored activity row.
 * `severity` is `"info"` for a change that loses nothing. */
export type ActivityItem = {
  id: string;
  repoId: number;
  at: number;
  kind: ChangeKind | ActivityKind;
  branch: string | null;
  title: string;
  detail: string;
  severity: Severity | "info" | null;
};

export type WireFeatureDetail = { feature: WireFeature; rewrites: WireRewrite[]; activity: ActivityItem[] };

export type NeedsYouItem = { repoId: number; repoName: string; featureId: string | null; finding: Finding };
