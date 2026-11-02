import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { stableNodePath } from "../../src/cli/stable-node-path.js";

let linked: string;
let other: string;

beforeEach(async () => {
  linked = await mkdtemp(join(tmpdir(), "git-grove-nodes-"));
  other = await mkdtemp(join(tmpdir(), "git-grove-other-node-"));
  await symlink(process.execPath, join(linked, "node"));
  await writeFile(join(other, "node"), "#!/bin/sh\n");
  await chmod(join(other, "node"), 0o755);
});
afterEach(async () => {
  await rm(linked, { recursive: true, force: true });
  await rm(other, { recursive: true, force: true });
});

test("stableNodePath takes the first node on PATH that is the running Node", () => {
  expect(stableNodePath(process.execPath, [other, linked, "/usr/bin"].join(delimiter))).toBe(join(linked, "node"));
});

test("with no node on PATH that is the running Node, stableNodePath keeps the running Node's own path", () => {
  expect(stableNodePath(process.execPath, [other, "", join(linked, "missing")].join(delimiter))).toBe(process.execPath);
});
