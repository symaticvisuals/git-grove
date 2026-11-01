import { expect, test } from "vitest";
import { run } from "../../src/cli/main.js";

test("--version prints the package version", async () => {
  const out: string[] = [];
  expect(await run(["--version"], { out: (s) => out.push(s), err: () => {}, cwd: process.cwd() })).toBe(0);
  expect(out.join("")).toMatch(/^git-grove \d+\.\d+\.\d+\n$/);
});

test("unknown command exits 1 with usage on stderr", async () => {
  const err: string[] = [];
  expect(await run(["nope"], { out: () => {}, err: (s) => err.push(s), cwd: process.cwd() })).toBe(1);
  expect(err.join("")).toContain("Usage: git grove");
});
