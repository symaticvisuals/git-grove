import { DatabaseSync } from "node:sqlite";
import type { ActivityItem } from "./store.types.js";

/** An activity row for the repository whose common git dir is `commonDir`. */
export type ActivityRow = { commonDir: string; item: ActivityItem };

const BUSY_TIMEOUT_MS = 200;
const COLUMNS = ["at", "branch", "detail", "id", "kind", "repo_id", "title"];

/**
 * Appends activity rows to the existing database at `path`, for repositories it already knows, and resolves to how
 * many it wrote. Built for a short-lived hook: it waits at most 200 ms for the write lock, runs no schema statement or
 * pragma beyond the busy timeout, and writes nothing, without throwing, when the `activity` table is missing, has
 * other columns, or the database cannot be written.
 */
export function appendActivity(path: string, rows: readonly ActivityRow[]): number {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const columns = db.prepare("SELECT name FROM pragma_table_info('activity')").all().map((row) => String(row["name"]));
    if (columns.sort().join() !== COLUMNS.join()) return 0;
    const findRepo = db.prepare("SELECT id FROM repos WHERE common_dir = ?");
    const insert = db.prepare("INSERT INTO activity (repo_id, kind, branch, title, detail, at) VALUES (?, ?, ?, ?, ?, ?)");
    let written = 0;
    for (const { commonDir, item } of rows) {
      const repoId = findRepo.get(commonDir)?.["id"];
      if (typeof repoId !== "number") continue;
      insert.run(repoId, item.kind, item.branch, item.title, item.detail, item.at);
      written++;
    }
    return written;
  } catch {
    return 0;
  } finally {
    if (db?.isOpen) db.close();
  }
}
