import { expect, test } from "vitest";
import { readGuardStatus } from "../../../src/core/guard-install/read-guard-status.js";

const COMMAND = "/opt/homebrew/bin/node /opt/grove/dist/cli/bin.js guard --claude";
const ANNOUNCE = COMMAND.replace(/ guard --claude$/, " guard --announce");

function settings(...commands: string[]): string {
  return JSON.stringify({ hooks: { PreToolUse: commands.map((command) => ({ matcher: "Bash", hooks: [{ type: "command", command }] })) } });
}

function both(announce = ANNOUNCE): string {
  return JSON.stringify({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: COMMAND }] }],
      SessionStart: [{ hooks: [{ type: "command", command: announce }] }],
    },
  });
}

test("no file, or no grove hook, is absent; a group whose matcher is not Bash does not count", () => {
  expect(readGuardStatus(null, COMMAND)).toEqual({ status: "absent", pluginEnabled: false, hooksDisabled: false, problem: null });
  expect(readGuardStatus(settings("echo hi"), COMMAND).status).toBe("absent");
  const edit = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: COMMAND }] }] } });
  expect(readGuardStatus(edit, COMMAND).status).toBe("absent");
});

test("the wanted Bash hook and the matching session notice together are installed; either one alone, another command, or two hooks, is stale", () => {
  expect(readGuardStatus(both(), COMMAND).status).toBe("installed");
  expect(readGuardStatus(settings(COMMAND), COMMAND).status).toBe("stale");
  expect(readGuardStatus(JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: ANNOUNCE }] }] } }), COMMAND).status).toBe("stale");
  expect(readGuardStatus(both("/old/node /old/git-grove/dist/cli/bin.js guard --announce"), COMMAND).status).toBe("stale");
  expect(readGuardStatus(settings("/old/node /old/git-grove/dist/cli/bin.js guard --claude"), COMMAND).status).toBe("stale");
  expect(readGuardStatus(settings(COMMAND, COMMAND), COMMAND).status).toBe("stale");
});

test("a file that cannot be parsed, or that the reader could not read, is unreadable with why", () => {
  expect(readGuardStatus("{ nope", COMMAND)).toMatchObject({ status: "unreadable", problem: expect.stringContaining("is not valid JSON") });
  expect(readGuardStatus(null, COMMAND, "cannot be read (EACCES)")).toEqual({ status: "unreadable", pluginEnabled: false, hooksDisabled: false, problem: "cannot be read (EACCES)" });
});

test("disableAllHooks: true in the file is reported", () => {
  expect(readGuardStatus(JSON.stringify({ disableAllHooks: true }), COMMAND)).toEqual({ status: "absent", pluginEnabled: false, hooksDisabled: true, problem: null });
  expect(readGuardStatus(JSON.stringify({ disableAllHooks: "true" }), COMMAND).hooksDisabled).toBe(false);
});

test("grove's hook is known by what grove writes: a dist/cli/bin.js path, or git-grove or git grove before guard --claude", () => {
  for (const command of ["git grove guard --claude", "npx @deepanshugoel/git-grove guard --claude", "'/Users/Robin Example/git-grove/dist/cli/bin.js' guard --claude"]) {
    expect(readGuardStatus(settings(command), COMMAND).status, command).toBe("stale");
  }
  expect(readGuardStatus(settings("my-sec-tool guard --claude"), COMMAND).status).toBe("absent");
});

test("grove's hook under a matcher of *, none, or a list naming Bash counts when the session notice is there; under Edit the Bash hook does not count", () => {
  const under = (group: Record<string, unknown>): string =>
    JSON.stringify({
      hooks: {
        PreToolUse: [{ ...group, hooks: [{ type: "command", command: COMMAND }] }],
        SessionStart: [{ hooks: [{ type: "command", command: ANNOUNCE }] }],
      },
    });
  expect(readGuardStatus(under({ matcher: "*" }), COMMAND).status).toBe("installed");
  expect(readGuardStatus(under({}), COMMAND).status).toBe("installed");
  expect(readGuardStatus(under({ matcher: "Write|Bash" }), COMMAND).status).toBe("installed");
  expect(readGuardStatus(under({ matcher: "Edit" }), COMMAND).status).toBe("stale");
  const startup = JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "~/bin/hello.sh" }] }] } });
  expect(readGuardStatus(startup, COMMAND).status).toBe("absent");
});

test("enabledPlugins naming grove's plugin as true reads pluginEnabled; anything else reads false and never unreadable", () => {
  const read = (enabledPlugins: unknown) => readGuardStatus(JSON.stringify({ enabledPlugins }), COMMAND);
  expect(read({ "git-grove@git-grove": true })).toEqual({ status: "absent", pluginEnabled: true, hooksDisabled: false, problem: null });
  for (const value of [{ "git-grove@git-grove": false }, {}, [], "x"]) {
    expect(read(value), JSON.stringify(value)).toMatchObject({ status: "absent", pluginEnabled: false });
  }
  expect(readGuardStatus("{}", COMMAND).pluginEnabled).toBe(false);
});
