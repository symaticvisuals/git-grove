import { relative } from "node:path";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { worst } from "../../core/rules/needs-you.js";
import { SEVERITY_RANK, type Finding } from "../../core/rules/rule.types.js";
import type { Feature, Level } from "../../core/stacks/stacks.types.js";
import { findingsOfLevel } from "./findings-of-level.js";
import { healthOf } from "./health-of.js";
import type { WireLevel } from "./wire.types.js";

function worstTitle(findings: Finding[]): string {
  const [top] = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return top?.title ?? "In sync";
}

/** A level as the browser receives it; `number` is the depth padded to two digits, for a level of a stack only. */
export function toWireLevel(snapshot: Snapshot, feature: Feature, level: Level): WireLevel {
  const { facts, removals, journal } = snapshot;
  const findings = findingsOfLevel(snapshot, feature, level);
  const upstream = facts.branches.find((branch) => branch.name === level.branch)?.upstream ?? null;
  const worktree = level.worktree;
  const verdict = worktree === null ? undefined : removals.get(worktree.path);
  const changes = worktree?.changes ?? null;
  return {
    branch: level.branch,
    parent: level.parent,
    depth: level.depth,
    number: feature.kind === "stack" ? String(level.depth).padStart(2, "0") : null,
    health: healthOf(worst(findings)),
    state: worstTitle(findings),
    findings,
    worktree:
      worktree === null
        ? null
        : {
            path: worktree.path,
            rel: relative(facts.root, worktree.path) || ".",
            dirty: changes === null ? 0 : changes.staged + changes.unstaged + changes.untracked,
            operation: worktree.operation,
            touchedAt: worktree.touchedAt,
          },
    upstream: upstream === null ? null : { ahead: upstream.ahead, behind: upstream.behind, gone: upstream.gone },
    behindTrunk: level.behindTrunk,
    parentCommitsSinceFork: level.parentCommitsSinceFork,
    pinnedLost: journal
      .filter((entry) => entry.branch === level.branch && entry.pinRef !== null)
      .reduce((total, entry) => total + entry.lost.length, 0),
    merged: verdict !== undefined,
    precious: (verdict?.reasons ?? []).filter((reason) => reason.code === "precious-ignored").reduce((total, reason) => total + reason.paths.length, 0),
  };
}
