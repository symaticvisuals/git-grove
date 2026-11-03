import { expect, test } from "vitest";
import { planGuardUninstall } from "../../../src/core/guard-install/plan-guard-uninstall.js";

const COMMAND = "/opt/homebrew/bin/node /opt/grove/dist/cli/bin.js guard --claude";
const GROUP = { matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 10 }] };

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

test("uninstalling keeps the user's hooks, their own Bash group included, and every other setting, in order", () => {
  const mine = { type: "command", command: "~/bin/log-bash.sh" };
  const userBash = { matcher: "Bash", hooks: [mine, { type: "command", command: COMMAND }] };
  const edits = { matcher: "Edit", hooks: [{ type: "command", command: "prettier --write" }] };
  const before = { model: "opus", hooks: { PreToolUse: [userBash, GROUP, edits], Stop: [edits] }, env: { A: "1" } };
  const plan = planGuardUninstall(text(before));
  expect(plan).toMatchObject({ kind: "change", adds: null, removes: [{ type: "command", command: COMMAND }, GROUP], reformats: false });
  if (plan.kind !== "change") return;
  expect(JSON.parse(plan.text)).toEqual({ model: "opus", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [mine] }, edits], Stop: [edits] }, env: { A: "1" } });
});

test("uninstalling drops only the groups and keys it emptied", () => {
  const onlyGrove = planGuardUninstall(text({ model: "opus", hooks: { PreToolUse: [GROUP] } }));
  expect(onlyGrove.kind === "change" ? JSON.parse(onlyGrove.text) : null).toEqual({ model: "opus" });
  const otherEvent = planGuardUninstall(text({ hooks: { PreToolUse: [GROUP], Stop: [] } }));
  expect(otherEvent.kind === "change" ? JSON.parse(otherEvent.text) : null).toEqual({ hooks: { Stop: [] } });
  const alreadyEmpty = { matcher: "Bash", hooks: [] };
  const kept = planGuardUninstall(text({ hooks: { PreToolUse: [alreadyEmpty, GROUP] } }));
  expect(kept.kind === "change" ? JSON.parse(kept.text) : null).toEqual({ hooks: { PreToolUse: [alreadyEmpty] } });
});

test("a file with no grove hook, or none at all, is unchanged; an unreadable one is refused", () => {
  expect(planGuardUninstall(null)).toEqual({ kind: "unchanged" });
  expect(planGuardUninstall(text({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo" }] }] } }))).toEqual({ kind: "unchanged" });
  expect(planGuardUninstall('{ "hooks": { "PreToolUse": "x" } }')).toMatchObject({ kind: "refused" });
});

test("invalid JSON, a file that is not an object, a hooks that is not an object and a PreToolUse that is not a list are refused", () => {
  expect(planGuardUninstall('{ "model": "opus", }\n')).toMatchObject({ kind: "refused", problem: expect.stringMatching(/^is not valid JSON \(/) });
  expect(planGuardUninstall("// my settings\n{}\n")).toMatchObject({ kind: "refused" });
  expect(planGuardUninstall("[]\n")).toEqual({ kind: "refused", problem: "is not a JSON object" });
  expect(planGuardUninstall("null\n")).toEqual({ kind: "refused", problem: "is not a JSON object" });
  expect(planGuardUninstall('{ "hooks": [] }\n')).toEqual({ kind: "refused", problem: 'has a "hooks" that is not an object' });
  expect(planGuardUninstall('{ "hooks": { "PreToolUse": {} } }\n')).toEqual({ kind: "refused", problem: 'has a "hooks.PreToolUse" that is not a list' });
});

test("a number grove cannot write back exactly, and a byte-order mark, are refused rather than rewritten", () => {
  expect(planGuardUninstall(`{ "x": 12345678901234567890, "hooks": { "PreToolUse": [${JSON.stringify(GROUP)}] } }\n`)).toEqual({ kind: "refused", problem: "holds a number grove cannot write back exactly" });
  expect(planGuardUninstall('{ "y": [1e400] }\n')).toEqual({ kind: "refused", problem: "holds a number grove cannot write back exactly" });
  expect(planGuardUninstall(`\uFEFF${text({ hooks: { PreToolUse: [GROUP] } })}`)).toEqual({ kind: "refused", problem: "starts with a byte-order mark" });
});

test("a file not written as 2-space JSON is rewritten with 2-space indentation, and the plan says so; a missing final newline alone is not", () => {
  const tabs = `{\n\t"model": "opus",\n\t"hooks": { "PreToolUse": [${JSON.stringify(GROUP)}] }\n}\n`;
  const plan = planGuardUninstall(tabs);
  expect(plan).toMatchObject({ kind: "change", reformats: true });
  expect(plan.kind === "change" ? plan.text : null).toBe(text({ model: "opus" }));
  expect(planGuardUninstall(text({ model: "opus", hooks: { PreToolUse: [GROUP] } }).trimEnd())).toMatchObject({ kind: "change", reformats: false });
});

test("a user's own hook that ends in guard --claude is not grove's, and is kept", () => {
  const theirs = { matcher: "Bash", hooks: [{ type: "command", command: "my-sec-tool guard --claude" }] };
  expect(planGuardUninstall(text({ hooks: { PreToolUse: [theirs] } }))).toEqual({ kind: "unchanged" });
});

test("grove's hook under a matcher that matches Bash, *, an empty one, none or a list naming Bash, is taken out, and the rest of that group kept", () => {
  const old = "/opt/homebrew/Cellar/node/24.1.0/bin/node /usr/local/lib/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js guard --claude";
  for (const matcher of ["*", "", undefined, "Edit|Bash"]) {
    const mine = { type: "command", command: "~/bin/audit.sh" };
    const group = { ...(matcher === undefined ? {} : { matcher }), hooks: [mine, { type: "command", command: old }] };
    const plan = planGuardUninstall(text({ hooks: { PreToolUse: [group] } }));
    expect(plan, String(matcher)).toMatchObject({ kind: "change", removes: [{ type: "command", command: old }] });
    expect(plan.kind === "change" ? JSON.parse(plan.text) : null, String(matcher)).toEqual({ hooks: { PreToolUse: [{ ...group, hooks: [mine] }] } });
  }
  const edits = { matcher: "Edit|Write", hooks: [{ type: "command", command: old }] };
  expect(planGuardUninstall(text({ hooks: { PreToolUse: [edits] } }))).toEqual({ kind: "unchanged" });
});
