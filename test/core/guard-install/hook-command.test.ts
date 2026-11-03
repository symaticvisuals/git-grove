import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { hookCommandPath, readHookCommand, writeHookCommand } from "../../../src/core/guard-install/hook-command.js";

let home: string;
let node: string;
let bin: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-hook-command-"));
  node = join(home, "node");
  bin = join(home, "dist", "cli", "bin.js");
  await mkdir(join(home, "dist", "cli"), { recursive: true });
  await writeFile(node, "");
  await writeFile(bin, "");
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

test("writes node and bin as two lines, mode 0600", async () => {
  expect(await writeHookCommand(home, node, bin)).toBe("written");
  expect(await readFile(hookCommandPath(home), "utf8")).toBe(`${node}\n${bin}\n`);
  expect((await stat(hookCommandPath(home))).mode & 0o777).toBe(0o600);
});

test("the same content again is \"unchanged\" and keeps the file's mtime", async () => {
  await writeHookCommand(home, node, bin);
  const old = new Date(2020, 0, 1);
  await utimes(hookCommandPath(home), old, old);
  expect(await writeHookCommand(home, node, bin)).toBe("unchanged");
  expect((await stat(hookCommandPath(home))).mtimeMs).toBe(old.getTime());
});

test("different content replaces the file", async () => {
  await writeHookCommand(home, node, bin);
  const other = join(home, "other.js");
  expect(await writeHookCommand(home, node, other)).toBe("written");
  expect(await readFile(hookCommandPath(home), "utf8")).toBe(`${node}\n${other}\n`);
});

test("an npx-cache bin writes nothing and answers \"ephemeral\"", async () => {
  expect(await writeHookCommand(home, node, "/Users/robin/.npm/_npx/abc/node_modules/@x/git-grove/dist/cli/bin.js")).toBe("ephemeral");
  await expect(stat(hookCommandPath(home))).rejects.toMatchObject({ code: "ENOENT" });
});

test("readHookCommand reads the recorded pair", async () => {
  await writeHookCommand(home, node, bin);
  expect(await readHookCommand(home)).toEqual({ node, bin });
});

test("readHookCommand is null when either path is gone, or the file has fewer than two lines", async () => {
  expect(await readHookCommand(home)).toBeNull();
  await writeFile(hookCommandPath(home), `${node}\n${join(home, "gone.js")}\n`);
  expect(await readHookCommand(home)).toBeNull();
  await writeFile(hookCommandPath(home), `${join(home, "gone-node")}\n${bin}\n`);
  expect(await readHookCommand(home)).toBeNull();
  await writeFile(hookCommandPath(home), `${node}\n`);
  expect(await readHookCommand(home)).toBeNull();
});
