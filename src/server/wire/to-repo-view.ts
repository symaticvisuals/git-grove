import { relative } from "node:path";
import { worst } from "../../core/rules/needs-you.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { healthOf } from "./health-of.js";
import { toWireFeature } from "./to-wire-feature.js";
import type { WireOrphan, WireProject, WireRepoView, WireSandbox } from "./wire.types.js";

function sandboxes(snapshot: Snapshot): WireSandbox[] {
  const { facts, findings } = snapshot;
  return facts.worktrees
    .filter((worktree) => worktree.branch === null && !worktree.prunable)
    .map((worktree) => {
      const own = findings.filter(({ subject }) => subject.kind === "worktree" && subject.id === worktree.path);
      const [top] = own;
      return {
        path: worktree.path,
        rel: relative(facts.root, worktree.path) || ".",
        head: worktree.head,
        touchedAt: worktree.touchedAt,
        health: healthOf(worst(own)),
        state: top?.title ?? "Nothing to keep",
      };
    });
}

function orphansOf(snapshot: Snapshot): WireOrphan[] {
  const present = new Set(snapshot.facts.branches.map((branch) => branch.name));
  const newest = new Map<string, WireOrphan>();
  for (const entry of snapshot.journal) {
    if (entry.kind !== "deleted" || present.has(entry.branch)) continue;
    const held = newest.get(entry.branch);
    if (held === undefined || held.at <= entry.at) {
      newest.set(entry.branch, { branch: entry.branch, lost: entry.lost, pinRef: entry.pinRef, lastTip: entry.oldTip, at: entry.at });
    }
  }
  return [...newest.values()];
}

function cleanupOf(snapshot: Snapshot): Pick<WireRepoView, "cleanupCount" | "rescueCount"> {
  const verdicts = [...snapshot.removals.values(), ...snapshot.sandboxRemovals.values()];
  const rescuable = verdicts.filter(({ ok, reasons }) => !ok && reasons.length > 0 && reasons.every((reason) => reason.code === "precious-ignored"));
  return { cleanupCount: verdicts.filter((verdict) => verdict.ok).length, rescueCount: rescuable.length };
}

/**
 * The dashboard's view of one repository: its features (stacks and singles) with their levels, the detached
 * sandboxes, the deleted branches still unresolved, every finding, and how many worktrees clean up would offer: those
 * whose removal verdict is safe, and those it would remove only after a rescue. `project` and `pins` pass through unchanged.
 */
export function toRepoView(project: WireProject, snapshot: Snapshot, pins: number): WireRepoView {
  return {
    project: { ...project, pins },
    trunk: snapshot.facts.trunk.name,
    lastFetchAt: snapshot.facts.lastFetchAt,
    features: snapshot.features.filter((feature) => feature.kind !== "detached").map((feature) => toWireFeature(snapshot, feature)),
    detached: sandboxes(snapshot),
    orphans: orphansOf(snapshot),
    findings: snapshot.findings,
    ...cleanupOf(snapshot),
  };
}
