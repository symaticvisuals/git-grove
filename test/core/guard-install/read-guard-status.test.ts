import { expect, test } from "vitest";
import { readGuardStatus } from "../../../src/core/guard-install/read-guard-status.js";

const COMMAND = "/opt/homebrew/bin/node /opt/grove/dist/cli/bin.js guard --claude";

function settings(...commands: string[]): string {
  return JSON.stringify({ hooks: { PreToolUse: commands.map((command) => ({ matcher: "Bash", hooks: [{ type: "command", command }] })) } });
}

test("no file, or no grove hook, is absent; a group whose matcher is not Bash does not count", () => {
  expect(readGuardStatus(null, COMMAND)).toEqual({ status: "absent", hooksDisabled: false, problem: null });
  expect(readGuardStatus(settings("echo hi"), COMMAND).status).toBe("absent");
  const edit = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: COMMAND }] }] } });
  expect(readGuardStatus(edit, COMMAND).status).toBe("absent");
});

test("one grove hook running the wanted command is installed; another command, or two hooks, is stale", () => {
  expect(readGuardStatus(settings(COMMAND), COMMAND).status).toBe("installed");
  expect(readGuardStatus(settings("/old/node /old/bin.js guard --claude"), COMMAND).status).toBe("stale");
  expect(readGuardStatus(settings(COMMAND, COMMAND), COMMAND).status).toBe("stale");
});

test("a file that cannot be parsed, or that the reader could not read, is unreadable with why", () => {
  expect(readGuardStatus("{ nope", COMMAND)).toMatchObject({ status: "unreadable", problem: expect.stringContaining("is not valid JSON") });
  expect(readGuardStatus(null, COMMAND, "cannot be read (EACCES)")).toEqual({ status: "unreadable", hooksDisabled: false, problem: "cannot be read (EACCES)" });
});

test("disableAllHooks: true in the file is reported", () => {
  expect(readGuardStatus(JSON.stringify({ disableAllHooks: true }), COMMAND)).toEqual({ status: "absent", hooksDisabled: true, problem: null });
  expect(readGuardStatus(JSON.stringify({ disableAllHooks: "true" }), COMMAND).hooksDisabled).toBe(false);
});
