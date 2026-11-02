import type { WireRepoView } from "../../../src/server/wire/wire.types.js";
import { type RowRef, routeHash } from "../parse-route.js";
import { groupsOf } from "./groups-of.js";
import { healthGroupsOf } from "./health-groups-of.js";
import { rowHref } from "./row-href.js";

/** The key of the list group that holds the row `pick` selects, grouped by health or by feature; null when no row does. */
export function groupKeyOf(repo: WireRepoView, byHealth: boolean, pick: RowRef): string | null {
  const id = repo.project.id;
  const href = routeHash({ view: "repo", repo: id, pick });
  const groups = byHealth ? healthGroupsOf(repo) : groupsOf(repo);
  return groups.find((group) => group.rows.some((row) => rowHref(id, row).href === href))?.key ?? null;
}
