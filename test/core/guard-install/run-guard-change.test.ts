import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { GuardChange } from "../../../src/core/guard-install/guard-install.types.js";
import { prepareGuardChange } from "../../../src/core/guard-install/prepare-guard-change.js";
import { readSettingsFile } from "../../../src/core/guard-install/read-settings-file.js";
import { runGuardChange } from "../../../src/core/guard-install/run-guard-change.js";

const COMMAND = "/opt/homebrew/bin/node /opt/grove/dist/cli/bin.js guard --claude";
const REFUSAL = "This git grove runs from a package runner's cache";

let home: string;
let path: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-claude-"));
  path = join(home, ".claude", "settings.json");
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function prepare(change: GuardChange, refusal: string | null = null) {
  return prepareGuardChange({ change, file: await readSettingsFile(path), command: COMMAND, refusal, now: 1_000 });
}

async function settings(): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

test("an install's plan names the file, its backup, the group it adds, that the rest is kept, and when Claude Code picks it up", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, '{\n  "model": "opus"\n}\n');
  const { plan, edit } = await prepare("install");
  expect(plan).toMatchObject({ change: "install", title: "Install the agent guard", confirm: "Install", settingsPath: path, backupPath: `${path}.grove-backup`, removes: [], warnings: [], blockers: [] });
  const announce = COMMAND.replace(/ guard --claude$/, " guard --announce");
  expect(JSON.parse(plan.adds ?? "")).toEqual({
    PreToolUse: { matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 10 }] },
    SessionStart: { hooks: [{ type: "command", command: announce, timeout: 10 }] },
  });
  expect(plan.lines).toEqual([
    "Your other settings and hooks are kept.",
    "Claude Code reloads this file when it changes, so running sessions normally pick the hook up; new sessions always do.",
  ]);
  expect(edit?.path).toBe(path);
});

test("the plan says when it rewrites the file with 2-space indentation, warns when the file turns hooks off, and offers no backup for a new file", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, '{"disableAllHooks":true}');
  const { plan } = await prepare("install");
  expect(plan.lines).toContain("This file is not written as 2-space JSON, so grove rewrites it with 2-space indentation. No setting changes.");
  expect(plan.warnings).toEqual(["This file sets disableAllHooks to true, so the hook will not run unless a project turns hooks back on."]);
  await rm(path);
  expect((await prepare("install")).plan.backupPath).toBeNull();
});

test("a file grove cannot parse, an install from a package runner's cache and a no-op are blocked, with no edit", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, '{ "model": "opus", }');
  const broken = await prepare("install");
  expect(broken.edit).toBeNull();
  expect(broken.plan.blockers[0]).toMatch(new RegExp(`^grove will not edit ${path.replaceAll(".", "\\.")}: it is not valid JSON \\(.*\\)\\. To add the hook yourself, run git grove install-guard\\.$`));
  await writeFile(path, "{}\n");
  expect((await prepare("install", REFUSAL)).plan.blockers).toEqual([REFUSAL]);
  expect((await prepare("uninstall")).plan.blockers).toEqual(["The agent guard is not installed."]);
  const receipt = await runGuardChange(await prepare("uninstall"));
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Not run", undo: null });
  expect(await readFile(path, "utf8")).toBe("{}\n");
});

test("an install's receipt offers Undo, and the undo, planned against the file as it is then, keeps a key the user added since", async () => {
  const installed = await runGuardChange(await prepare("install"));
  expect(installed).toMatchObject({ change: "install", ok: true, refused: false, title: "Installed the agent guard", lines: [`Created ${path}`], undo: "uninstall" });
  expect((await prepare("install")).plan.blockers).toEqual(["The agent guard is already installed."]);
  const now = await readFile(path, "utf8");
  await writeFile(path, now.replace('{\n  "hooks"', '{\n  "theme": "dark",\n  "hooks"'));
  const undone = await runGuardChange(await prepare("uninstall"));
  expect(undone).toMatchObject({ ok: true, title: "Uninstalled the agent guard", undo: "install" });
  expect(await settings()).toEqual({ theme: "dark" });
});

test("a plan whose file changed before it ran is refused as changed since you looked", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, "{}\n");
  const prepared = await prepare("install");
  await writeFile(path, '{ "model": "opus" }\n');
  expect(await runGuardChange(prepared)).toMatchObject({ ok: false, refused: true, title: "Changed since you looked", lines: ["settings.json changed since the review; review again"] });
  expect(await readFile(path, "utf8")).toBe('{ "model": "opus" }\n');
});

test("replacing a stale command is an update", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/old/node /old/git-grove/dist/cli/bin.js guard --claude" }] }] } }));
  const prepared = await prepare("install");
  expect(prepared.plan.title).toBe("Update the agent guard");
  expect(prepared.plan.removes).toHaveLength(1);
  expect(await runGuardChange(prepared)).toMatchObject({ title: "Updated the agent guard", updated: true, undo: "uninstall" });
});

test("a read-only file is read for its status, and every change to it is blocked", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, "{}\n");
  await chmod(path, 0o444);
  const install = await prepare("install");
  expect(install.edit).toBeNull();
  expect(install.plan.blockers).toEqual([`grove will not edit ${path}: it is read-only. To add the hook yourself, run git grove install-guard.`]);
  expect(await runGuardChange(install)).toMatchObject({ ok: false, refused: true, title: "Not run" });
  expect(await readFile(path, "utf8")).toBe("{}\n");
});

test("the receipt names the backup, and the first time the original copy grove never overwrites", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, '{\n  "model": "opus"\n}\n');
  expect((await runGuardChange(await prepare("install"))).lines).toEqual([
    `Wrote ${path}`,
    `The file as it was is in ${path}.grove-backup`,
    `It is also in ${path}.grove-original, which grove never overwrites`,
  ]);
  expect((await runGuardChange(await prepare("uninstall"))).lines).toEqual([
    `Wrote ${path}`,
    `The file as it was is in ${path}.grove-backup`,
    `The file from before grove first changed it is in ${path}.grove-original`,
  ]);
  expect(await readFile(`${path}.grove-original`, "utf8")).toBe('{\n  "model": "opus"\n}\n');
});
