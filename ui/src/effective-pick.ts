import type { WireLevel, WireRepoView } from "../../src/server/wire/wire.types.js";
import { HEALTH_RANK } from "./health-rank.js";
import type { Route, RowRef } from "./parse-route.js";

function worstOf(levels: readonly WireLevel[]): WireLevel | null {
  let worst: WireLevel | null = null;
  for (const level of levels) if (worst === null || HEALTH_RANK[level.health] < HEALTH_RANK[worst.health]) worst = level;
  return worst;
}

/**
 * What the detail panel shows on a repo route. A route naming a branch, a deleted branch or the detached sandboxes
 * is used as it is; one naming only a feature shows that feature's worst level. With nothing named, the repo's worst
 * level is shown if it needs the user, else its first deleted branch, else nothing. `repo` must be the routed repo's
 * view, or null while it loads.
 */
export function effectivePick(route: Route, repo: WireRepoView | null): RowRef | null {
  if (route.view !== "repo") return null;
  const { pick } = route;
  if (pick !== null && (pick.kind !== "feature" || pick.branch !== null)) return pick;
  if (repo === null) return pick;
  if (pick !== null) {
    const feature = repo.features.find((candidate) => candidate.id === pick.feature);
    const level = feature === undefined ? null : worstOf(feature.levels);
    return feature === undefined || level === null ? pick : { kind: "feature", feature: feature.id, branch: level.branch };
  }
  let found: { feature: string; level: WireLevel } | null = null;
  for (const feature of repo.features) {
    const level = worstOf(feature.levels);
    if (level !== null && (found === null || HEALTH_RANK[level.health] < HEALTH_RANK[found.level.health])) found = { feature: feature.id, level };
  }
  if (found !== null && found.level.health === "loses") return { kind: "feature", feature: found.feature, branch: found.level.branch };
  const [orphan] = repo.orphans;
  if (orphan !== undefined) return { kind: "deleted", branch: orphan.branch };
  if (found !== null && found.level.health === "action") return { kind: "feature", feature: found.feature, branch: found.level.branch };
  return null;
}
