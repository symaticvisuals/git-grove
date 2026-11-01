import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLOutputValue, type StatementResultingChanges } from "node:sqlite";
import type { Sha } from "../facts/facts.types.js";
import type { ChangeKind } from "./classify-tip-change.js";
import { StoreCorruptError } from "./store-corrupt.error.js";
import type { JournalEntry, LastTip, Store, TipSwap } from "./store.types.js";

type Row = Record<string, SQLOutputValue>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY,
  common_dir TEXT NOT NULL UNIQUE,
  root TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tips (
  repo_id INTEGER NOT NULL REFERENCES repos (id),
  ref TEXT NOT NULL,
  sha TEXT NOT NULL,
  parent_sha TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (repo_id, ref)
);
CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repos (id),
  ref TEXT NOT NULL,
  old_sha TEXT NOT NULL,
  new_sha TEXT NOT NULL,
  kind TEXT NOT NULL,
  lost TEXT NOT NULL,
  matched_by_patch INTEGER NOT NULL,
  matched_by_meta INTEGER NOT NULL,
  pin_ref TEXT,
  at INTEGER NOT NULL,
  found_later INTEGER NOT NULL,
  acked_at INTEGER,
  UNIQUE (repo_id, ref, old_sha, new_sha)
);
`;

const CHANGE_COLUMNS = "ref, old_sha, new_sha, kind, lost, matched_by_patch, matched_by_meta, pin_ref, at, found_later, acked_at";
const ENTRY_COLUMNS = `id, ${CHANGE_COLUMNS}`;

const KINDS: Record<ChangeKind, true> = { advanced: true, rebased: true, amended: true, rewritten: true, deleted: true };

function isChangeKind(value: string): value is ChangeKind {
  return Object.hasOwn(KINDS, value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new StoreCorruptError(column);
  return value;
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isInteger(value)) throw new StoreCorruptError(column);
  return value;
}

function orNull<T>(row: Row, column: string, read: (row: Row, column: string) => T): T | null {
  return row[column] === null ? null : read(row, column);
}

function shaList(row: Row, column: string): Sha[] {
  let value: unknown;
  try {
    value = JSON.parse(text(row, column));
  } catch {
    throw new StoreCorruptError(column);
  }
  if (!isStringArray(value)) throw new StoreCorruptError(column);
  return value;
}

function readEntry(row: Row): JournalEntry {
  const kind = text(row, "kind");
  if (!isChangeKind(kind)) throw new StoreCorruptError("kind");
  const newSha = text(row, "new_sha");
  return {
    id: integer(row, "id"),
    branch: text(row, "ref"),
    oldTip: text(row, "old_sha"),
    newTip: newSha === "" ? null : newSha,
    kind,
    lost: shaList(row, "lost"),
    matchedByPatch: integer(row, "matched_by_patch"),
    matchedByMeta: integer(row, "matched_by_meta"),
    pinRef: orNull(row, "pin_ref", text),
    at: integer(row, "at"),
    foundLater: integer(row, "found_later") === 1,
    acked: orNull(row, "acked_at", integer) !== null,
  };
}

function changed(result: StatementResultingChanges): boolean {
  return Number(result.changes) > 0;
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function defaultPath(): string {
  return join(process.env["GIT_GROVE_HOME"] ?? join(homedir(), ".git-grove"), "grove.db");
}

/**
 * Opens grove's SQLite database (default `$GIT_GROVE_HOME/grove.db`, else `~/.git-grove/grove.db`),
 * creating the folder and tables. WAL with a 2 s busy timeout lets several processes share it.
 * Throws StoreCorruptError when a row holds a value of the wrong shape.
 */
export function openStore(path: string = defaultPath()): Store {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 2000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(SCHEMA);

  const statements = {
    repoId: db.prepare(
      "INSERT INTO repos (common_dir, root) VALUES (?, ?) ON CONFLICT (common_dir) DO UPDATE SET root = excluded.root RETURNING id",
    ),
    findRepoId: db.prepare("SELECT id FROM repos WHERE common_dir = ?"),
    lastTips: db.prepare("SELECT ref, sha, parent_sha FROM tips WHERE repo_id = ?"),
    saveTip: db.prepare(
      `INSERT INTO tips (repo_id, ref, sha, parent_sha, seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (repo_id, ref) DO UPDATE SET sha = excluded.sha, parent_sha = excluded.parent_sha, seen_at = excluded.seen_at`,
    ),
    insertTip: db.prepare(
      "INSERT INTO tips (repo_id, ref, sha, parent_sha, seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    ),
    updateTip: db.prepare(
      "UPDATE tips SET sha = ?, parent_sha = ?, seen_at = ? WHERE repo_id = ? AND ref = ? AND sha = ?",
    ),
    deleteTip: db.prepare("DELETE FROM tips WHERE repo_id = ? AND ref = ? AND sha = ?"),
    record: db.prepare(
      `INSERT INTO journal (repo_id, ${CHANGE_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
    ),
    entries: db.prepare(`SELECT ${ENTRY_COLUMNS} FROM journal WHERE repo_id = ? ORDER BY at, id`),
    unresolved: db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM journal
       WHERE repo_id = ? AND kind IN ('rewritten', 'deleted') AND acked_at IS NULL ORDER BY at, id`,
    ),
    ack: db.prepare("UPDATE journal SET acked_at = ? WHERE repo_id = ? AND id = ? AND acked_at IS NULL"),
  };

  const insertEntry = (repoId: number, entry: JournalEntry): number | null => {
    const row = statements.record.get(
      repoId,
      entry.branch,
      entry.oldTip,
      entry.newTip ?? "",
      entry.kind,
      JSON.stringify(entry.lost),
      entry.matchedByPatch,
      entry.matchedByMeta,
      entry.pinRef,
      entry.at,
      entry.foundLater ? 1 : 0,
      entry.acked ? entry.at : null,
    );
    return row === undefined ? null : integer(row, "id");
  };

  const moveTip = (repoId: number, { ref, from, to, at }: TipSwap): boolean => {
    if (to === null) return from !== null && changed(statements.deleteTip.run(repoId, ref, from));
    if (from === null) return changed(statements.insertTip.run(repoId, ref, to.sha, to.parentSha, at));
    return changed(statements.updateTip.run(to.sha, to.parentSha, at, repoId, ref, from));
  };

  return {
    repoId(commonDir, root) {
      const row = statements.repoId.get(commonDir, root);
      if (row === undefined) throw new StoreCorruptError("repos.id");
      return integer(row, "id");
    },
    findRepoId(commonDir) {
      const row = statements.findRepoId.get(commonDir);
      return row === undefined ? null : integer(row, "id");
    },
    lastTips(repoId) {
      const tips = new Map<string, LastTip>();
      for (const row of statements.lastTips.all(repoId)) {
        tips.set(text(row, "ref"), { sha: text(row, "sha"), parentSha: text(row, "parent_sha") });
      }
      return tips;
    },
    saveTip(repoId, ref, sha, parentSha, at) {
      statements.saveTip.run(repoId, ref, sha, parentSha, at);
    },
    swapTip(repoId, swap) {
      return inTransaction(db, () => {
        const swapped = moveTip(repoId, swap);
        return { swapped, entryId: swapped && swap.entry !== null ? insertEntry(repoId, swap.entry) : null };
      });
    },
    record: insertEntry,
    entries(repoId, options = {}) {
      return (options.unresolved ? statements.unresolved : statements.entries).all(repoId).map(readEntry);
    },
    ack(repoId, entryId, at) {
      statements.ack.run(at, repoId, entryId);
    },
    close() {
      db.close();
    },
  };
}
