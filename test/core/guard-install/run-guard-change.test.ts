import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { prepareGuardChange } from "../../../src/core/guard-install/prepare-guard-change.js";
import { readSettingsFile } from "../../../src/core/guard-install/read-settings-file.js";
import { runGuardChange } from "../../../src/core/guard-install/run-guard-change.js";

const COMMAND = "/opt/homebrew/bin/node /opt/grove/dist/cli/bin.js guard --claude";
const GROUP = { matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 10 }] };

let home: string;
let path: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-claude-"));
  path = join(home, ".claude", "settings.json");
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function prepare() {
  return prepareGuardChange({ file: await readSettingsFile(path), now: 1_000 });
}

async function settings(): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Writes `settings` as 2-space JSON, creating the folder. */
async function write(value: unknown): Promise<string> {
  await mkdir(join(home, ".claude"), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text);
  return text;
}

test("an uninstall's plan names the file, its backup, the group it removes, that the rest is kept, and when Claude Code drops it", async () => {
  await write({ model: "opus", hooks: { PreToolUse: [GROUP] } });
  const { plan, edit } = await prepare();
  expect(plan).toMatchObject({ change: "uninstall", title: "Remove the old hook", confirm: "Remove", settingsPath: path, backupPath: `${path}.grove-backup`, adds: null, blockers: [] });
  expect(plan.removes.map((removed) => JSON.parse(removed))).toEqual([GROUP]);
  expect(plan.lines).toEqual([
    "Your other settings and hooks are kept.",
    "Claude Code reloads this file when it changes, so running sessions normally drop the hook; new sessions always do.",
  ]);
  expect(edit?.path).toBe(path);
});

const NO_PLUGIN = "The Claude Code plugin isn't enabled, so removing this hook leaves no agent guard until you install it.";

test("removing the old hook warns that no guard is left while the plugin is not enabled in that file", async () => {
  await write({ hooks: { PreToolUse: [GROUP] } });
  expect((await prepare()).plan.warnings).toEqual([NO_PLUGIN]);
  await write({ enabledPlugins: { "git-grove@git-grove": false }, hooks: { PreToolUse: [GROUP] } });
  expect((await prepare()).plan.warnings).toEqual([NO_PLUGIN]);
  await write({ enabledPlugins: { "git-grove@git-grove": true }, hooks: { PreToolUse: [GROUP] } });
  expect((await prepare()).plan.warnings).toEqual([]);
  await write({});
  expect((await prepare()).plan.warnings).toEqual([]);
});

test("the plan says when it rewrites the file with 2-space indentation, and offers no backup for a missing file", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, JSON.stringify({ hooks: { PreToolUse: [GROUP] } }));
  expect((await prepare()).plan.lines).toContain("This file is not written as 2-space JSON, so grove rewrites it with 2-space indentation. No setting changes.");
  await rm(path);
  expect((await prepare()).plan.backupPath).toBeNull();
});

test("a file grove cannot parse and a file with no grove hook are blocked, with no edit", async () => {
  await mkdir(join(home, ".claude"));
  await writeFile(path, '{ "model": "opus", }');
  const broken = await prepare();
  expect(broken.edit).toBeNull();
  expect(broken.plan.blockers[0]).toMatch(new RegExp(`^grove will not edit ${path.replaceAll(".", "\\.")}: it is not valid JSON \\(.*\\)\\. To take grove's hook out, edit the file yourself\\.$`));
  await writeFile(path, "{}\n");
  expect((await prepare()).plan.blockers).toEqual(["There is no old hook in this file."]);
  const receipt = await runGuardChange(await prepare());
  expect(receipt).toMatchObject({ ok: false, refused: true, title: "Not run", undo: null });
  expect(await readFile(path, "utf8")).toBe("{}\n");
});

test("an uninstall's receipt offers no undo, and the uninstall, planned against the file as it is, keeps a key the user added", async () => {
  await write({ theme: "dark", hooks: { PreToolUse: [GROUP] } });
  const undone = await runGuardChange(await prepare());
  expect(undone).toMatchObject({ change: "uninstall", ok: true, refused: false, title: "Removed the old hook", undo: null });
  expect(await settings()).toEqual({ theme: "dark" });
  expect((await prepare()).plan.blockers).toEqual(["There is no old hook in this file."]);
});

test("a stale grove hook, running another command, is taken out too", async () => {
  await write({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/old/node /old/git-grove/dist/cli/bin.js guard --claude" }] }] } });
  const prepared = await prepare();
  expect(prepared.plan.removes).toHaveLength(1);
  expect(await runGuardChange(prepared)).toMatchObject({ ok: true, title: "Removed the old hook" });
  expect(await settings()).toEqual({});
});

test("a plan whose file changed before it ran is refused as changed since you looked", async () => {
  await write({ hooks: { PreToolUse: [GROUP] } });
  const prepared = await prepare();
  await writeFile(path, '{ "model": "opus" }\n');
  expect(await runGuardChange(prepared)).toMatchObject({ ok: false, refused: true, title: "Changed since you looked", lines: ["settings.json changed since the review; review again"] });
  expect(await readFile(path, "utf8")).toBe('{ "model": "opus" }\n');
});

test("a read-only file is blocked, and running its plan writes nothing", async () => {
  const before = await write({ hooks: { PreToolUse: [GROUP] } });
  await chmod(path, 0o444);
  const uninstall = await prepare();
  expect(uninstall.edit).toBeNull();
  expect(uninstall.plan.blockers).toEqual([`grove will not edit ${path}: it is read-only. To take grove's hook out, edit the file yourself.`]);
  expect(await runGuardChange(uninstall)).toMatchObject({ ok: false, refused: true, title: "Not run" });
  expect(await readFile(path, "utf8")).toBe(before);
});

test("the receipt names the backup, and the first time the original copy grove never overwrites", async () => {
  const first = await write({ model: "opus", hooks: { PreToolUse: [GROUP] } });
  expect((await runGuardChange(await prepare())).lines).toEqual([
    `Wrote ${path}`,
    `The file as it was is in ${path}.grove-backup`,
    `It is also in ${path}.grove-original, which grove never overwrites`,
  ]);
  const second = await write({ model: "sonnet", hooks: { PreToolUse: [GROUP] } });
  expect((await runGuardChange(await prepare())).lines).toEqual([
    `Wrote ${path}`,
    `The file as it was is in ${path}.grove-backup`,
    `The file from before grove first changed it is in ${path}.grove-original`,
  ]);
  expect(await readFile(`${path}.grove-original`, "utf8")).toBe(first);
  expect(await readFile(`${path}.grove-backup`, "utf8")).toBe(second);
  expect(await settings()).toEqual({ model: "sonnet" });
});
