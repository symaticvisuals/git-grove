import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const GUARD = join(ROOT, "plugin", "hooks", "guard.sh");
const BIN = join(ROOT, "dist", "cli", "bin.js");

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "guard-sh-grove-")));
  writeFileSync(join(dir, "hook-command"), `${process.execPath}\n${BIN}\n`);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function hook(command: string) {
  const input = JSON.stringify({ session_id: "s-1", cwd: dir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
  return spawnSync("/bin/sh", [GUARD], { cwd: dir, env: { HOME: dir, GIT_GROVE_HOME: dir, PATH: "/usr/bin:/bin" }, input, encoding: "utf8" });
}

test("the plugin's hook runs the built grove from hook-command: it blocks git grove ack with the reason", () => {
  const result = hook("git grove ack foo");
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("git grove blocked: git grove ack marks a rewrite or a deleted branch as intended");
});

test("the plugin's hook runs the built grove from hook-command: it allows ls", () => {
  const result = hook("ls");
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
});

test("the plugin's session hook runs the built grove's announce: it tells the session the agent is bounded", () => {
  const result = spawnSync("/bin/sh", [GUARD, "--announce"], { cwd: dir, env: { HOME: dir, GIT_GROVE_HOME: dir, PATH: "/usr/bin:/bin" }, input: "{}", encoding: "utf8" });
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(output.hookSpecificOutput.additionalContext.length).toBeGreaterThan(0);
});
