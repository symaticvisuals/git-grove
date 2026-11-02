import type { Health } from "../../../src/server/wire/health-of.js";
import type { WireRepoView } from "../../../src/server/wire/wire.types.js";
import { HEALTH_LABEL } from "../health-label.js";
import { plural } from "../plural.js";
import { groupsOf, type ListGroup } from "./groups-of.js";

const ORDER: Health[] = ["loses", "action", "review", "idle", "fine"];

/** The list's groups by health, worst first, with every row flat. */
export function healthGroupsOf(repo: WireRepoView): ListGroup[] {
  const rows = groupsOf(repo).flatMap((group) => group.rows.map((row) => (row.kind === "level" ? { ...row, depth: 0 } : row)));
  return ORDER.flatMap((health) => {
    const own = rows.filter((row) => row.health === health);
    return own.length === 0 ? [] : [{ key: `h:${health}`, kind: "health" as const, name: HEALTH_LABEL[health], meta: plural(own.length, "row"), feature: null, rows: own }];
  });
}
