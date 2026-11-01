import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { RescueFailedError } from "../../../src/core/actions/remove/rescue-failed.error.js";
import { rescueFiles } from "../../../src/core/actions/remove/rescue-files.js";
import { rescueTarget } from "../../../src/core/actions/remove/rescue-target.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
let main: string;
let worktree: string;

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

beforeEach(async () => {
  repo = await makeRepo();
  main = await realpath(repo.path);
  await repo.commit(".gitignore", ".worktrees/\n.local/\n", "ignore");
  worktree = join(main, ".worktrees", "old");
  await repo.worktree(worktree, "old");
  await write(join(worktree, ".local", "seed.sql"), "seed\n");
});
afterEach(() => repo.cleanup());

test("rescueTarget keeps the path when main has nothing there, else adds .from-<folder>, then -2, -3", () => {
  const taken = new Set<string>();
  const exists = (path: string): boolean => taken.has(path);
  expect(rescueTarget("a/seed.sql", "old", exists)).toBe("a/seed.sql");
  taken.add("a/seed.sql");
  expect(rescueTarget("a/seed.sql", "old", exists)).toBe("a/seed.sql.from-old");
  taken.add("a/seed.sql.from-old");
  expect(rescueTarget("a/seed.sql", "old", exists)).toBe("a/seed.sql.from-old-2");
  taken.add("a/seed.sql.from-old-2");
  expect(rescueTarget("a/seed.sql", "old", exists)).toBe("a/seed.sql.from-old-3");
});

test("rescueFiles copies into main at the same path, creating folders", async () => {
  expect(await rescueFiles(main, worktree, [".local/seed.sql"])).toEqual([
    { from: ".local/seed.sql", to: ".local/seed.sql", digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
  ]);
  expect(await readFile(join(main, ".local", "seed.sql"), "utf8")).toBe("seed\n");
});

test("rescueFiles never overwrites: an existing file, or a dangling link, sends the copy elsewhere", async () => {
  await write(join(main, ".local", "seed.sql"), "main\n");
  await symlink(join(main, "nowhere"), join(main, ".local", "seed.sql.from-old"));
  expect(await rescueFiles(main, worktree, [".local/seed.sql"])).toMatchObject([
    { from: ".local/seed.sql", to: ".local/seed.sql.from-old-2" },
  ]);
  expect(await readFile(join(main, ".local", "seed.sql"), "utf8")).toBe("main\n");
  expect(await readFile(join(main, ".local", "seed.sql.from-old-2"), "utf8")).toBe("seed\n");
});

test("two files of one batch never land on the same path", async () => {
  await write(join(main, "a"), "main\n");
  await write(join(worktree, "a"), "a\n");
  await write(join(worktree, "a.from-old"), "b\n");
  const pairs = await rescueFiles(main, worktree, ["a", "a.from-old"]);
  expect(pairs).toMatchObject([
    { from: "a", to: "a.from-old" },
    { from: "a.from-old", to: "a.from-old.from-old" },
  ]);
});

test("a target folder in main that resolves into a worktree is refused before anything is copied", async () => {
  await symlink(join(worktree, ".local"), join(main, ".local"));
  await expect(rescueFiles(main, worktree, [".local/seed.sql"])).rejects.toMatchObject({
    reason: "the target folder in main points into a worktree",
  });
  expect(await readFile(join(worktree, ".local", "seed.sql"), "utf8")).toBe("seed\n");
});

test("a refused rescue makes no folder inside the worktree", async () => {
  await mkdir(join(worktree, "node_modules", "cache"), { recursive: true });
  await symlink(join(worktree, "node_modules", "cache"), join(main, ".local"));
  await write(join(worktree, ".local", "deep", "notes.md"), "mine\n");
  await expect(rescueFiles(main, worktree, [".local/deep/notes.md"])).rejects.toMatchObject({
    reason: "the target folder in main points into a worktree",
  });
  expect(existsSync(join(worktree, "node_modules", "cache", "deep"))).toBe(false);
});

test("a copy whose bytes differ throws RescueFailedError naming the file", async () => {
  const wrong = async (_from: string, to: string): Promise<void> => {
    await write(to, "other\n");
  };
  const failure = rescueFiles(main, worktree, [".local/seed.sql"], wrong);
  await expect(failure).rejects.toBeInstanceOf(RescueFailedError);
  await expect(failure).rejects.toMatchObject({ path: ".local/seed.sql" });
});

test("a copy that fails, or a source that is gone, throws RescueFailedError", async () => {
  const broken = async (): Promise<void> => {
    throw new Error("disk full");
  };
  await expect(rescueFiles(main, worktree, [".local/seed.sql"], broken)).rejects.toThrow(/disk full/);
  await expect(rescueFiles(main, worktree, [".local/missing.sql"])).rejects.toMatchObject({
    path: ".local/missing.sql",
    reason: "it is gone",
  });
  await mkdir(join(worktree, ".local", "folder.sql"));
  await expect(rescueFiles(main, worktree, [".local/folder.sql"])).rejects.toMatchObject({ reason: "it is not a regular file" });
});
