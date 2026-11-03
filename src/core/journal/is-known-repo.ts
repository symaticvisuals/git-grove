import { DatabaseSync } from "node:sqlite";

/**
 * Whether grove's database at `path` has the repository whose common git dir is `commonDir`. Opens it read-only for a
 * short-lived hook, and answers false, without throwing, when it cannot be read.
 */
export function isKnownRepo(path: string, commonDir: string): boolean {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    return db.prepare("SELECT 1 FROM repos WHERE common_dir = ?").get(commonDir) !== undefined;
  } catch {
    return false;
  } finally {
    if (db?.isOpen) db.close();
  }
}
