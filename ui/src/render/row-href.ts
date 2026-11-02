import { type RowRef, routeHash } from "../parse-route.js";
import type { ListRow } from "./groups-of.js";

/** What a list row selects, and the hash that selects it. */
export function rowHref(repoId: number, row: ListRow): { ref: RowRef; href: string } {
  const ref: RowRef =
    row.kind === "level" ? { kind: "feature", feature: row.feature.id, branch: row.level.branch } : row.kind === "deleted" ? { kind: "deleted", branch: row.orphan.branch } : { kind: "detached" };
  return { ref, href: routeHash({ view: "repo", repo: repoId, pick: ref }) };
}
