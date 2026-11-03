import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { installGuardCommand } from "../../src/cli/commands/install-guard.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const execFileAsync = promisify(execFile);
const ROOT = join(import.meta.dirname, "..", "..");
const BIN = join(ROOT, "dist", "cli", "bin.js");

const PRINTED = [
  "Install the agent guard as a Claude Code plugin:",
  "",
  "  claude plugin marketplace add symaticvisuals/git-grove",
  "  claude plugin install git-grove@git-grove",
  "",
  "git grove changed no file. Run git grove ui once so the plugin's hook can find git grove.",
  "",
].join("\n");

let home: string;

/** Runs the built bin's install-guard with a temp HOME. */
async function installGuard(): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
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

function install(bin: string): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = installGuardCommand({ out: (s) => out.push(s), err: (s) => err.push(s), cwd: "/" }, { bin });
  return { code, out: out.join(""), err: err.join("") };
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-user-"));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

test("install-guard prints the two plugin commands and exits 0", async () => {
  const result = await installGuard();
  expect(result).toEqual({ code: 0, stdout: PRINTED, stderr: "" });
});

test("install-guard writes nothing under HOME", async () => {
  const before = await readdir(home, { recursive: true });
  expect((await installGuard()).code).toBe(0);
  expect(await readdir(home, { recursive: true })).toEqual(before);
});

test("install-guard from an npx, pnpm dlx, bunx or yarn dlx cache prints the commands, asks for a global install on stderr and exits 1", () => {
  for (const bin of [
    "/Users/robin/.npm/_npx/4f1e/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
    "/Users/robin/Library/Caches/pnpm/dlx/abc/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
    "/private/tmp/bunx-501-@deepanshugoel/git-grove@latest/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
    "/private/tmp/xfs-1a2b3c4d/dlx-5678/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js",
  ]) {
    const result = install(bin);
    expect(result.code, bin).toBe(1);
    expect(result.out).toBe(PRINTED);
    expect(result.err).toBe(
      "git-grove: this git grove runs from a package runner's cache (npx, pnpm dlx, bunx, yarn dlx), which may be cleared under the hook; install it first: npm i -g @deepanshugoel/git-grove\n",
    );
  }
});

test("install-guard from a global install prints only the commands", () => {
  expect(install("/usr/local/lib/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js")).toEqual({ code: 0, out: PRINTED, err: "" });
});
