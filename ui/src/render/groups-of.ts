import type { Health } from "../../../src/server/wire/health-of.js";
import type { WireFeature, WireLevel, WireOrphan, WireRepoView, WireSandbox } from "../../../src/server/wire/wire.types.js";
import { HEALTH_RANK } from "../health-rank.js";
import { plural } from "../plural.js";

export type ListRow =
  | { kind: "level"; health: Health; feature: WireFeature; level: WireLevel; depth: number }
  | { kind: "deleted"; health: Health; orphan: WireOrphan }
  | { kind: "detached"; health: Health; sandboxes: WireSandbox[] };

export type ListGroup = { key: string; kind: "stack" | "singles" | "deleted" | "detached" | "health"; name: string; meta: string; feature: WireFeature | null; rows: ListRow[] };

function worstHealth(sandboxes: readonly WireSandbox[]): Health {
  return sandboxes.reduce<Health>((worst, sandbox) => (HEALTH_RANK[sandbox.health] < HEALTH_RANK[worst] ? sandbox.health : worst), "fine");
}

/** The list's groups by feature: each stack, then Singles, then Deleted branches, then one Detached row; empty groups are left out. */
export function groupsOf(repo: WireRepoView): ListGroup[] {
  const groups: ListGroup[] = [];
  const singles: ListRow[] = [];
  for (const feature of repo.features) {
    if (feature.kind === "stack") {
      const rows: ListRow[] = feature.levels.map((level) => ({ kind: "level", health: level.health, feature, level, depth: level.depth }));
      groups.push({ key: `f:${feature.id}`, kind: "stack", name: feature.name, meta: `stack, ${plural(feature.levels.length, "level")}`, feature, rows });
    } else {
      for (const level of feature.levels) singles.push({ kind: "level", health: level.health, feature, level, depth: 0 });
    }
  }
  if (singles.length > 0) groups.push({ key: "singles", kind: "singles", name: "Singles", meta: "branches outside a stack", feature: null, rows: singles });
  if (repo.orphans.length > 0) {
    const rows: ListRow[] = repo.orphans.map((orphan) => ({ kind: "deleted", health: "loses", orphan }));
    groups.push({ key: "deleted", kind: "deleted", name: "Deleted branches", meta: "their commits are pinned", feature: null, rows });
  }
  if (repo.detached.length > 0) {
    const rows: ListRow[] = [{ kind: "detached", health: worstHealth(repo.detached), sandboxes: repo.detached }];
    groups.push({ key: "detached", kind: "detached", name: "Detached", meta: "agent sandboxes", feature: null, rows });
  }
  return groups;
}
