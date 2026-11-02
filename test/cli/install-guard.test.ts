import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { installGuardCommand } from "../../src/cli/commands/install-guard.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const execFileAsync = promisify(execFile);
const ROOT = join(import.meta.dirname, "..", "..");
const BIN = join(ROOT, "dist", "cli", "bin.js");

let home: string;

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

async function installGuard(args: string[] = []): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
  delete env["GIT_GROVE_HOME"];
  delete env["CLAUDE_CONFIG_DIR"];
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, "install-guard", ...args], { cwd: home, env, encoding: "utf8" });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "number" ? error.code : -1;
    return { code, stdout: "", stderr: String(error) };
  }
}

beforeAll(async () => {
  await execFileAsync(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], { cwd: ROOT });
  home = await mkdtemp(join(tmpdir(), "git-grove-user-"));
}, 60_000);
afterAll(() => rm(home, { recursive: true, force: true }));

test("install-guard prints a valid hook block whose command is this Node and this bin, by absolute path", async () => {
  const result = await installGuard();
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(`Add this to ${join(home, ".claude", "settings.json")}`);
  const block = jsonBlock(result.stdout);
  expect(at(block, "hooks", "PreToolUse", 0, "matcher")).toBe("Bash");
  expect(at(block, "hooks", "PreToolUse", 0, "hooks", 0, "type")).toBe("command");
  expect(at(block, "hooks", "PreToolUse", 0, "hooks", 0, "timeout")).toBe(10);
  const command = at(block, "hooks", "PreToolUse", 0, "hooks", 0, "command");
  expect(command).toBe(`${process.execPath} ${BIN} guard --claude`);
  expect(isAbsolute(process.execPath) && isAbsolute(BIN)).toBe(true);
  expect(result.stdout).toContain("To check it works");
});

test("install-guard writes nothing under HOME", async () => {
  const before = await readdir(home, { recursive: true });
  expect((await installGuard()).code).toBe(0);
  expect(await readdir(home, { recursive: true })).toEqual(before);
});

test("install-guard quotes paths that hold spaces", () => {
  const out: string[] = [];
  const code = installGuardCommand(
    { out: (s) => out.push(s), err: () => undefined, cwd: "/" },
    { node: "/opt/my node/bin/node", bin: "/Users/Robin Example/lib/git-grove/dist/cli/bin.js", home: "/Users/Robin Example" },
  );
  expect(code).toBe(0);
  expect(at(jsonBlock(out.join("")), "hooks", "PreToolUse", 0, "hooks", 0, "command")).toBe(
    "'/opt/my node/bin/node' '/Users/Robin Example/lib/git-grove/dist/cli/bin.js' guard --claude",
  );
});

test("install-guard from an npx cache refuses with exit 1 and asks for a global install", () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = installGuardCommand(
    { out: (s) => out.push(s), err: (s) => err.push(s), cwd: "/" },
    { node: "/usr/local/bin/node", bin: "/Users/robin/.npm/_npx/4f1e/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js", home: "/Users/robin" },
  );
  expect(code).toBe(1);
  expect(out.join("")).toBe("");
  expect(err.join("")).toContain("npm i -g @deepanshugoel/git-grove");
});
