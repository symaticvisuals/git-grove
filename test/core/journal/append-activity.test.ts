import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { appendActivity } from "../../../src/core/journal/append-activity.js";
import { openStore } from "../../../src/core/journal/open-store.js";
import type { ActivityItem } from "../../../src/core/journal/store.types.js";

const ITEM: ActivityItem = { kind: "action", branch: "x", title: "Guard blocked git worktree remove", detail: "it holds a file", at: 1_000 };

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "git-grove-store-"));
  path = join(dir, "grove.db");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function names(sql: string): string[] {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).all().map((row) => String(row["name"]));
  } finally {
    db.close();
  }
}

test("appendActivity adds a row for a repository the store knows, and none for one it does not", () => {
  const store = openStore(path);
  const repoId = store.repoId("/repo/.git", "/repo");
  store.close();
  expect(appendActivity(path, [{ commonDir: "/repo/.git", item: ITEM }, { commonDir: "/elsewhere/.git", item: ITEM }])).toBe(1);
  const reopened = openStore(path);
  expect(reopened.activity(repoId, 10).map(({ title, branch, at }) => ({ title, branch, at }))).toEqual([{ title: ITEM.title, branch: "x", at: 1_000 }]);
  reopened.close();
});

test("appendActivity runs no schema statement: a dropped index stays dropped", () => {
  const store = openStore(path);
  store.repoId("/repo/.git", "/repo");
  store.close();
  const db = new DatabaseSync(path);
  db.exec("DROP INDEX activity_by_repo");
  db.close();
  expect(appendActivity(path, [{ commonDir: "/repo/.git", item: ITEM }])).toBe(1);
  expect(names("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'activity_by_repo'")).toEqual([]);
});

test("appendActivity leaves a database with no activity table, or other columns in it, alone", () => {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE repos (id INTEGER PRIMARY KEY, common_dir TEXT, root TEXT); INSERT INTO repos (common_dir, root) VALUES ('/repo/.git', '/repo')");
  db.close();
  expect(appendActivity(path, [{ commonDir: "/repo/.git", item: ITEM }])).toBe(0);
  expect(names("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual(["repos"]);

  const changed = new DatabaseSync(path);
  changed.exec("CREATE TABLE activity (id INTEGER PRIMARY KEY, repo_id INTEGER, kind TEXT, branch TEXT, title TEXT, detail TEXT, at INTEGER, actor TEXT NOT NULL)");
  changed.close();
  expect(appendActivity(path, [{ commonDir: "/repo/.git", item: ITEM }])).toBe(0);
});

test("appendActivity gives up within a moment when another process holds the write lock", () => {
  const store = openStore(path);
  store.repoId("/repo/.git", "/repo");
  store.close();
  const holder = new DatabaseSync(path);
  holder.exec("BEGIN IMMEDIATE");
  try {
    const started = Date.now();
    expect(appendActivity(path, [{ commonDir: "/repo/.git", item: ITEM }])).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
  } finally {
    holder.exec("ROLLBACK");
    holder.close();
  }
});
