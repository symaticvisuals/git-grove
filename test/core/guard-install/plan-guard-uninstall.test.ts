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
