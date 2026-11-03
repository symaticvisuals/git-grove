import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { trustsKnownBare } from "../../src/cli/trusts-known-bare.js";
import { openStore } from "../../src/core/journal/open-store.js";

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

test("a bare repository is trusted only once grove watches it", async () => {
  expect(await trustsKnownBare("/work/proj/.bare")).toBe(false);
  const store = openStore();
  store.repoId("/work/proj/.bare", "/work/proj/.bare");
  store.close();
  expect(await trustsKnownBare("/work/proj/.bare")).toBe(true);
  expect(await trustsKnownBare("/work/other/.bare")).toBe(false);
});
