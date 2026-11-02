import { existsSync } from "node:fs";
import { join } from "node:path";
import { type GuardContext, guardActivity } from "../core/guard/guard-activity.js";
import type { GuardDecision } from "../core/guard/guard-decision.types.js";
import { groveHome } from "../core/grove-home.js";

/**
 * Writes a guard decision's activity rows to grove's database, for repositories grove already knows; a repository it
 * has never seen gets none, so the guard does not add it to the dashboard. Opens the database only when there is a
 * row to write and the database exists, loads `node:sqlite` only then, and waits at most 200 ms for its write lock.
 */
export async function recordGuardActivity(decision: GuardDecision, context: GuardContext): Promise<void> {
  const rows = guardActivity(decision, context, Date.now());
  const path = join(groveHome(), "grove.db");
  if (rows.length === 0 || !existsSync(path)) return;
  const { appendActivity } = await import("../core/journal/append-activity.js");
  appendActivity(path, rows);
}
