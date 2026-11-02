import { expect, test } from "vitest";
import { planGuardInstall } from "../../../src/core/guard-install/plan-guard-install.js";
import type { SettingsPlan } from "../../../src/core/guard-install/settings-plan.types.js";

const COMMAND = "/opt/homebrew/bin/node /usr/local/lib/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js guard --claude";
const OLD = "/opt/homebrew/Cellar/node/24.1.0/bin/node /usr/local/lib/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js guard --claude";
const GROUP = { matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 10 }] };

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function changed(plan: SettingsPlan): Extract<SettingsPlan, { kind: "change" }> {
  if (plan.kind !== "change") throw new Error(`expected a change, got ${plan.kind}`);
  return plan;
}

function written(plan: SettingsPlan): Record<string, unknown> {
  const value: unknown = JSON.parse(changed(plan).text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected an object");
  return Object.fromEntries(Object.entries(value));
}

test("installing into a missing file starts from {} and writes one group of grove's own", () => {
  const plan = changed(planGuardInstall(null, COMMAND));
  expect(plan.text).toBe(text({ hooks: { PreToolUse: [GROUP] } }));
  expect(plan.adds).toEqual(GROUP);
  expect(plan.removes).toEqual([]);
  expect(plan.reformats).toBe(false);
});

test("installing into {} adds hooks.PreToolUse with grove's group", () => {
  expect(written(planGuardInstall("{}\n", COMMAND))).toEqual({ hooks: { PreToolUse: [GROUP] } });
  expect(changed(planGuardInstall("{}\n", COMMAND)).reformats).toBe(false);
});

test("installing keeps every other setting and every other group, the user's own Bash group included, in order, and never merges into it", () => {
  const userBash = { matcher: "Bash", hooks: [{ type: "command", command: "~/bin/log-bash.sh" }] };
  const edits = { matcher: "Edit|Write", hooks: [{ type: "command", command: "prettier --write" }] };
  const before = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
    permissions: { allow: ["Bash(npm run lint)"] },
    hooks: { PreToolUse: [userBash, edits], PostToolUse: [edits] },
    model: "opus",
  };
  const after = written(planGuardInstall(text(before), COMMAND));
  expect(after).toEqual({ ...before, hooks: { PreToolUse: [userBash, edits, GROUP], PostToolUse: [edits] } });
  expect(Object.keys(after)).toEqual(["$schema", "permissions", "hooks", "model"]);
});

test("installing over a stale entry replaces it, and says what it removes", () => {
  const stale = { matcher: "Bash", hooks: [{ type: "command", command: OLD, timeout: 10 }] };
  const plan = changed(planGuardInstall(text({ hooks: { PreToolUse: [stale] } }), COMMAND));
  expect(JSON.parse(plan.text)).toEqual({ hooks: { PreToolUse: [GROUP] } });
  expect(plan.removes).toEqual([stale]);
});

test("installing collapses two grove entries into one, taking grove's hook out of a user's group without touching the rest of it", () => {
  const stale = { matcher: "Bash", hooks: [{ type: "command", command: OLD, timeout: 10 }] };
  const mine = { type: "command", command: "~/bin/log-bash.sh" };
  const shared = { matcher: "Bash", hooks: [mine, { type: "command", command: COMMAND }] };
  const plan = changed(planGuardInstall(text({ hooks: { PreToolUse: [stale, shared] } }), COMMAND));
  expect(JSON.parse(plan.text)).toEqual({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [mine] }, GROUP] } });
  expect(plan.removes).toEqual([stale, { type: "command", command: COMMAND }]);
});

test("a file that already runs the wanted command once is a no-op", () => {
  expect(planGuardInstall(text({ hooks: { PreToolUse: [GROUP] } }), COMMAND)).toEqual({ kind: "unchanged" });
  const elsewhere = { matcher: "Bash", hooks: [{ type: "command", command: "~/bin/log.sh" }, { type: "command", command: COMMAND, timeout: 30 }] };
  expect(planGuardInstall(text({ hooks: { PreToolUse: [elsewhere] } }), COMMAND)).toEqual({ kind: "unchanged" });
});

test("invalid JSON, a file that is not an object, a hooks that is not an object and a PreToolUse that is not a list are refused", () => {
  expect(planGuardInstall('{ "model": "opus", }\n', COMMAND)).toMatchObject({ kind: "refused", problem: expect.stringMatching(/^is not valid JSON \(/) });
  expect(planGuardInstall("// my settings\n{}\n", COMMAND)).toMatchObject({ kind: "refused" });
  expect(planGuardInstall("[]\n", COMMAND)).toEqual({ kind: "refused", problem: "is not a JSON object" });
  expect(planGuardInstall("null\n", COMMAND)).toEqual({ kind: "refused", problem: "is not a JSON object" });
  expect(planGuardInstall('{ "hooks": [] }\n', COMMAND)).toEqual({ kind: "refused", problem: 'has a "hooks" that is not an object' });
  expect(planGuardInstall('{ "hooks": { "PreToolUse": {} } }\n', COMMAND)).toEqual({ kind: "refused", problem: 'has a "hooks.PreToolUse" that is not a list' });
});

test("a file holding only whitespace is read as {}", () => {
  expect(written(planGuardInstall("  \n", COMMAND))).toEqual({ hooks: { PreToolUse: [GROUP] } });
});

test("a file not written as 2-space JSON is rewritten with 2-space indentation, and the plan says so; a missing final newline alone is not", () => {
  const tabs = '{\n\t"model": "opus"\n}\n';
  const plan = changed(planGuardInstall(tabs, COMMAND));
  expect(plan.reformats).toBe(true);
  expect(plan.text).toBe(text({ model: "opus", hooks: { PreToolUse: [GROUP] } }));
  expect(changed(planGuardInstall('{"model":"opus"}', COMMAND)).reformats).toBe(true);
  expect(changed(planGuardInstall('{\n  "model": "opus"\n}', COMMAND)).reformats).toBe(false);
});
