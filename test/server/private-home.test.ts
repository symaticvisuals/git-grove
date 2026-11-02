import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { privateHome } from "../../src/server/private-home.js";

const savedHome = process.env["HOME"];
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "git-grove-private-"));
  process.env["HOME"] = root;
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = savedHome;
  await rm(root, { recursive: true, force: true });
});

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

test("a folder grove creates is 0700, parents included", async () => {
  const home = join(root, "made", "for", "grove");
  await privateHome(home);
  expect(await mode(home)).toBe(0o700);
  expect(await mode(join(root, "made"))).toBe(0o700);
});

test("an existing folder grove did not create keeps its mode", async () => {
  const shared = join(root, "shared");
  await mkdir(shared);
  await chmod(shared, 0o755);
  await privateHome(shared);
  expect(await mode(shared)).toBe(0o755);
});

test("~/.git-grove is narrowed to 0700 even when it already exists", async () => {
  const own = join(root, ".git-grove");
  await mkdir(own);
  await chmod(own, 0o755);
  await privateHome(own);
  expect(await mode(own)).toBe(0o700);
});
