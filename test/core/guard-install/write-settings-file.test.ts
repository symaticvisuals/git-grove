import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readGuardStatus } from "../../../src/core/guard-install/read-guard-status.js";
import { readSettingsFile } from "../../../src/core/guard-install/read-settings-file.js";
import { SettingsChangedError } from "../../../src/core/guard-install/settings-changed.error.js";
import { SettingsRefusedError } from "../../../src/core/guard-install/settings-refused.error.js";
import { writeSettingsFile } from "../../../src/core/guard-install/write-settings-file.js";

let home: string;
let path: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-claude-"));
  path = join(home, ".claude", "settings.json");
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

async function seed(text: string, mode = 0o644): Promise<string> {
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(path, text);
  await chmod(path, mode);
  return (await readSettingsFile(path)).hash;
}

test("a file that changed since the plan read it is refused, and nothing is written", async () => {
  const saw = await seed('{ "model": "opus" }\n');
  await writeFile(path, '{ "model": "sonnet" }\n');
  await expect(writeSettingsFile({ path, saw, text: "{}\n" })).rejects.toThrow(new SettingsChangedError(path));
  await expect(writeSettingsFile({ path, saw, text: "{}\n" })).rejects.toThrow("settings.json changed since the review; review again");
  expect(await readFile(path, "utf8")).toBe('{ "model": "sonnet" }\n');
  expect(await readdir(join(home, ".claude"))).toEqual(["settings.json"]);
});

test("a file created since a plan that saw none is refused", async () => {
  await seed("{}\n");
  await expect(writeSettingsFile({ path, saw: "missing", text: "{}\n" })).rejects.toBeInstanceOf(SettingsChangedError);
});

test("the backup holds the file as it was, and the file the new text", async () => {
  const before = '{\n\t"model": "opus"\n}\n';
  const saw = await seed(before);
  const result = await writeSettingsFile({ path, saw, text: '{\n  "model": "opus"\n}\n' });
  expect(result).toEqual({ backup: `${path}.grove-backup`, original: { path: `${path}.grove-original`, written: true } });
  expect(await readFile(`${path}.grove-backup`, "utf8")).toBe(before);
  expect(await readFile(path, "utf8")).toBe('{\n  "model": "opus"\n}\n');
});

test("the first change to an existing file also keeps it as .grove-original, which later changes never overwrite; the backup rolls", async () => {
  const first = '{\n    "model": "opus"\n}\n';
  let saw = await seed(first);
  await writeSettingsFile({ path, saw, text: '{\n  "model": "opus"\n}\n' });
  saw = (await readSettingsFile(path)).hash;
  const second = await writeSettingsFile({ path, saw, text: '{\n  "model": "sonnet"\n}\n' });
  expect(second.original).toEqual({ path: `${path}.grove-original`, written: false });
  expect(await readFile(`${path}.grove-original`, "utf8")).toBe(first);
  expect(await readFile(`${path}.grove-backup`, "utf8")).toBe('{\n  "model": "opus"\n}\n');
});

test("a new file gets no backup, a 0700 folder and mode 0600", async () => {
  const result = await writeSettingsFile({ path, saw: "missing", text: "{}\n" });
  expect(result).toEqual({ backup: null, original: null });
  expect(await readdir(join(home, ".claude"))).toEqual(["settings.json"]);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(home, ".claude"))).mode & 0o777).toBe(0o700);
});

test("an existing file keeps its mode", async () => {
  const saw = await seed("{}\n", 0o640);
  await writeSettingsFile({ path, saw, text: '{ "a": 1 }\n' });
  expect((await stat(path)).mode & 0o777).toBe(0o640);
});

test("the new text goes in by renaming a temp file over the old one, so no reader sees part of it, and no temp file is left", async () => {
  const saw = await seed("{}\n");
  const before = (await stat(path)).ino;
  await writeSettingsFile({ path, saw, text: `${JSON.stringify({ big: "x".repeat(200_000) })}\n` });
  expect((await stat(path)).ino).not.toBe(before);
  expect((await readdir(join(home, ".claude"))).sort()).toEqual(["settings.json", "settings.json.grove-backup", "settings.json.grove-original"]);
});

test("a settings file that is a symbolic link is written through the link, which stays", async () => {
  const dotfiles = join(home, "dotfiles");
  await mkdir(dotfiles);
  await writeFile(join(dotfiles, "claude.json"), "{}\n");
  await mkdir(join(home, ".claude"));
  await symlink(join(dotfiles, "claude.json"), path);
  const saw = (await readSettingsFile(path)).hash;
  await writeSettingsFile({ path, saw, text: '{ "a": 1 }\n' });
  expect((await stat(path, { bigint: false })).isFile()).toBe(true);
  expect(await readFile(join(dotfiles, "claude.json"), "utf8")).toBe('{ "a": 1 }\n');
  expect((await readdir(join(home, ".claude"), { withFileTypes: true })).find((entry) => entry.name === "settings.json")?.isSymbolicLink()).toBe(true);
});

test("a read-only settings file is refused, in the read and again at write time, and left as it was", async () => {
  const saw = await seed('{ "model": "opus" }\n', 0o444);
  expect(await readSettingsFile(path)).toMatchObject({ readOnly: true, problem: null });
  await expect(writeSettingsFile({ path, saw, text: "{}\n" })).rejects.toThrow(new SettingsRefusedError(path, "is read-only"));
  await expect(writeSettingsFile({ path, saw, text: "{}\n" })).rejects.toThrow(`grove will not edit ${path}: it is read-only.`);
  expect(await readFile(path, "utf8")).toBe('{ "model": "opus" }\n');
  expect(await readdir(join(home, ".claude"))).toEqual(["settings.json"]);
});

test("an old read-only backup never blocks a later change", async () => {
  const saw = await seed("{}\n");
  await writeFile(`${path}.grove-backup`, "old\n");
  await chmod(`${path}.grove-backup`, 0o444);
  await writeSettingsFile({ path, saw, text: '{ "a": 1 }\n' });
  expect(await readFile(`${path}.grove-backup`, "utf8")).toBe("{}\n");
  expect(await readFile(path, "utf8")).toBe('{ "a": 1 }\n');
});

test("a change that fails before its last step leaves the file and the earlier backups as they were", async () => {
  if (process.getuid?.() === 0) return;
  const store = join(home, "store");
  await mkdir(store);
  await writeFile(join(store, "settings.json"), "{}\n");
  await mkdir(join(home, ".claude"));
  await symlink(join(store, "settings.json"), path);
  await writeFile(`${path}.grove-backup`, "earlier backup\n");
  await writeFile(`${path}.grove-original`, "earlier original\n");
  await chmod(store, 0o555);
  try {
    const saw = (await readSettingsFile(path)).hash;
    await expect(writeSettingsFile({ path, saw, text: '{ "a": 1 }\n' })).rejects.toMatchObject({ code: "EACCES" });
    expect(await readFile(`${path}.grove-backup`, "utf8")).toBe("earlier backup\n");
    expect(await readFile(`${path}.grove-original`, "utf8")).toBe("earlier original\n");
    expect(await readFile(path, "utf8")).toBe("{}\n");
  } finally {
    await chmod(store, 0o755);
  }
});

test("a settings file that is a link to a missing file is refused, and the link stays", async () => {
  await mkdir(join(home, ".claude"));
  await symlink(join(home, "dotfiles", "claude.json"), path);
  const file = await readSettingsFile(path);
  expect(file).toMatchObject({ text: null, problem: "is a link to a missing file" });
  await expect(writeSettingsFile({ path, saw: file.hash, text: "{}\n" })).rejects.toThrow(`grove will not edit ${path}: it is a link to a missing file.`);
  await expect(writeSettingsFile({ path, saw: "missing", text: "{}\n" })).rejects.toBeInstanceOf(SettingsChangedError);
  expect((await lstat(path)).isSymbolicLink()).toBe(true);
});

test("a byte-order mark is kept in the text, so the strict parse refuses it, and a backup would hold the raw bytes", async () => {
  await mkdir(join(home, ".claude"), { recursive: true });
  const raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}\n")]);
  await writeFile(path, raw);
  const file = await readSettingsFile(path);
  expect(file.text?.startsWith("\uFEFF")).toBe(true);
  expect(Buffer.from(file.bytes ?? new Uint8Array()).equals(raw)).toBe(true);
  expect(readGuardStatus(file.text, "x", file.problem)).toEqual({ status: "unreadable", hooksDisabled: false, problem: "starts with a byte-order mark" });
});

test("a file that is not UTF-8 text cannot be read", async () => {
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(path, Buffer.from([0x7b, 0xff, 0x7d]));
  expect(await readSettingsFile(path)).toMatchObject({ text: null, problem: "is not UTF-8 text" });
});
