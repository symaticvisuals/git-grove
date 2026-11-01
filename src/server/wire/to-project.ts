import { basename } from "node:path";
import type { StoredRepo } from "../../core/journal/store.types.js";
import { needsYou, worst } from "../../core/rules/needs-you.js";
import type { Snapshot } from "../../core/snapshot/read-snapshot.js";
import { healthOf } from "./health-of.js";
import type { WireProject } from "./wire.types.js";

/**
 * A repository as the project list shows it. Without a `snapshot` it has no health and no counts;
 * `error` says why the scan failed.
 */
export function toProject(repo: StoredRepo, snapshot: Snapshot | null, pins: number, error: string | null): WireProject {
  return {
    id: repo.id,
    name: basename(repo.root),
    root: repo.root,
    health: healthOf(snapshot === null ? "fine" : worst(snapshot.findings)),
    worktrees: snapshot?.facts.worktrees.length ?? 0,
    needsYou: snapshot === null ? 0 : needsYou(snapshot.findings).length,
    pins,
    scannedAt: snapshot?.readAt ?? null,
    error,
  };
}
