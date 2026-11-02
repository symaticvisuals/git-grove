import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { makeRepo, type TestRepo } from "../support/make-repo.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const execFileAsync = promisify(execFile);
const ROOT = join(import.meta.dirname, "..", "..");
const BIN = join(ROOT, "dist", "cli", "bin.js");

type Spawned = { code: number; stdout: string; stderr: string };

let home: string;
let repo: TestRepo;

function exitCode(error: unknown): number {
  return error instanceof Error && "code" in error && typeof error.code === "number" ? error.code : -1;
}

/** Runs the built bin with the Node that runs the tests. */
async function bin(args: string[], cwd: string): Promise<Spawned> {
  const env = { ...process.env, GIT_GROVE_HOME: home };
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], { cwd, env, encoding: "utf8" });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const output = error instanceof Error && "stdout" in error && "stderr" in error ? error : null;
    return { code: exitCode(error), stdout: String(output?.stdout ?? ""), stderr: String(output?.stderr ?? "") };
  }
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-home-"));
  repo = await makeRepo();
  await repo.commit("base.txt", "base\n", "base");
}, 60_000);
afterAll(async () => {
  await repo.cleanup();
  await rm(home, { recursive: true, force: true });
});

test("the built bin prints status with nothing on stderr", async () => {
  const result = await bin(["status"], repo.path);
  expect(result).toMatchObject({ code: 0, stderr: "" });
  expect(result.stdout).toContain("Nothing needs you");
});

test("the built bin outside a repository prints exactly one line on stderr", async () => {
  const outside = await mkdtemp(join(tmpdir(), "git-grove-outside-"));
  try {
    const result = await bin(["status"], outside);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^git-grove: [^\n]+\n$/);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("an unexpected error prints one line and exits 1", async () => {
  const boom = `data:text/javascript,process.cwd = () => { throw new Error("boom"); };`;
  const env = { ...process.env, GIT_GROVE_HOME: home };
  const result = await execFileAsync(process.execPath, ["--import", boom, BIN, "status"], { cwd: repo.path, env, encoding: "utf8" }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: unknown) => {
      const output = error instanceof Error && "stdout" in error && "stderr" in error ? error : null;
      return { code: exitCode(error), stdout: String(output?.stdout ?? ""), stderr: String(output?.stderr ?? "") };
    },
  );
  expect(result).toEqual({ code: 1, stdout: "", stderr: "git-grove: unexpected error: boom\n" });
});
