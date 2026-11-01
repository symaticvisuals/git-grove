import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readOrCreateToken } from "../../src/server/auth/read-or-create-token.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-token-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

test("creates 32 random bytes as hex, readable only by the owner, and reads them back after", async () => {
  const token = await readOrCreateToken(home);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect((await stat(join(home, "token"))).mode & 0o777).toBe(0o600);
  expect(await readOrCreateToken(home)).toBe(token);
});

test("callers racing on a missing token all get the one that was written", async () => {
  const tokens = await Promise.all(Array.from({ length: 8 }, () => readOrCreateToken(home)));
  expect(new Set(tokens).size).toBe(1);
  expect(await readFile(join(home, "token"), "utf8")).toBe(tokens[0]);
  expect(await readdir(home)).toEqual(["token"]);
});

test("a token file that holds something else is refused", async () => {
  await writeFile(join(home, "token"), "not a token\n", { mode: 0o600 });
  await expect(readOrCreateToken(home)).rejects.toThrow("does not hold a grove token");
});
