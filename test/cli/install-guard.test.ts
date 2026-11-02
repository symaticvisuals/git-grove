import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { installGuardCommand } from "../../src/cli/commands/install-guard.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const execFileAsync = promisify(execFile);
const ROOT = join(import.meta.dirname, "..", "..");
const BIN = join(ROOT, "dist", "cli", "bin.js");

let home: string;
let nodes: string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  let here = value;
  for (const key of path) {
    if (typeof key === "number") here = Array.isArray(here) ? here[key] : undefined;
    else here = isRecord(here) ? here[key] : undefined;
  }
  return here;
}

/** The JSON block printed between a line holding only `{` and the next line holding only `}`. */
function jsonBlock(out: string): unknown {
  const start = out.indexOf("\n{\n") + 1;
  const end = out.indexOf("\n}\n", start) + 2;
  if (start === 0 || end === 1) throw new Error(`no JSON block in:\n${out}`);
  return JSON.parse(out.slice(start, end));
}

function hookCommand(out: string): unknown {
  return at(jsonBlock(out), "hooks", "PreToolUse", 0, "hooks", 0, "command");
}

/** Runs the built bin's install-guard with a temp HOME and `nodes`, holding a link to this Node, first on PATH. */
async function installGuard(): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, PATH: `${nodes}${delimiter}${process.env["PATH"] ?? ""}` };
  delete env["GIT_GROVE_HOME"];
  delete env["CLAUDE_CONFIG_DIR"];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, "install-guard"], { cwd: home, env, encoding: "utf8" });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "number" ? error.code : -1;
    return { code, stdout: "", stderr: String(error) };
  }
}

function install(node: string, bin: string): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = installGuardCommand({ out: (s) => out.push(s), err: (s) => err.push(s), cwd: "/" }, { node, bin, home: "/Users/robin" });
  return { code, out: out.join(""), err: err.join("") };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-user-"));
  nodes = await mkdtemp(join(tmpdir(), "git-grove-nodes-"));
  await symlink(process.execPath, join(nodes, "node"));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(nodes, { recursive: true, force: true });
});

test("install-guard prints a valid hook block that runs the node on PATH and this bin, by absolute path", async () => {
  const result = await installGuard();
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(`Add this to ${join(home, ".claude", "settings.json")}`);
  const block = jsonBlock(result.stdout);
  expect(at(block, "hooks", "PreToolUse", 0, "matcher")).toBe("Bash");
  expect(at(block, "hooks", "PreToolUse", 0, "hooks", 0, "type")).toBe("command");
  expect(at(block, "hooks", "PreToolUse", 0, "hooks", 0, "timeout")).toBe(10);
  expect(hookCommand(result.stdout)).toBe(`${join(nodes, "node")} ${BIN} guard --claude`);
  expect(result.stdout).toContain("Run install-guard again after you change Node versions.");
  expect(result.stdout).toContain("To check it works");
});

test("install-guard writes nothing under HOME", async () => {
  const before = await readdir(home, { recursive: true });
  expect((await installGuard()).code).toBe(0);
  expect(await readdir(home, { recursive: true })).toEqual(before);
});

test("install-guard quotes paths that hold spaces or quotes", () => {
  expect(hookCommand(install("/opt/my node/bin/node", "/Users/Robin Example/lib/git-grove/dist/cli/bin.js").out)).toBe(
    "'/opt/my node/bin/node' '/Users/Robin Example/lib/git-grove/dist/cli/bin.js' guard --claude",
  );
  expect(hookCommand(install('/opt/"node"/bin/node', "/Users/robin/it's/dist/cli/bin.js").out)).toBe(
    `'/opt/"node"/bin/node' '/Users/robin/it'\\''s/dist/cli/bin.js' guard --claude`,
  );
});

test("install-guard from an npx, pnpm dlx, bunx or yarn dlx cache refuses with exit 1 and asks for a global install", () => {
  for (const bin of [
    "/Users/robin/.npm/_npx/4f1e/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
    "/Users/robin/Library/Caches/pnpm/dlx/abc/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
    "/private/tmp/bunx-501-@deepanshugoel/git-grove@latest/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
    "/private/tmp/xfs-1a2b3c4d/dlx-5678/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
  ]) {
    const result = install("/usr/local/bin/node", bin);
    expect(result.code, bin).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("a package runner's cache (npx, pnpm dlx, bunx, yarn dlx)");
    expect(result.err).toContain("npm i -g @deepanshugoel/git-grove");
  }
});
