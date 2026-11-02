import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { GuardEdit } from "./guard-install.types.js";
import { readSettingsFile } from "./read-settings-file.js";
import { SettingsChangedError } from "./settings-changed.error.js";
import { settingsBackupPath } from "./settings-backup-path.js";
import { settingsOriginalPath } from "./settings-original-path.js";
import { SettingsRefusedError } from "./settings-refused.error.js";

const NEW_FILE_MODE = 0o600;
const NEW_DIR_MODE = 0o700;

export type WrittenSettings = { backup: string | null; original: { path: string; written: boolean } | null };

function refuseRealClaudeUnderVitest(path: string): void {
  if (process.env["VITEST"] === undefined) return;
  const rel = relative(join(userInfo().homedir, ".claude"), resolve(path));
  if (rel === "" || !(rel.startsWith("..") || isAbsolute(rel))) throw new Error("writeSettingsFile refuses to write the real ~/.claude under vitest");
}

async function tempBeside(target: string, content: string | Uint8Array, mode: number): Promise<string> {
  const temp = join(dirname(target), `.${basename(target)}.grove-${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temp, "wx", mode);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temp, mode);
    return temp;
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function replace(target: string, content: Uint8Array, mode: number): Promise<void> {
  const temp = await tempBeside(target, content, mode);
  await rename(temp, target).catch(async (error: unknown) => {
    await rm(temp, { force: true });
    throw error;
  });
}

/**
 * Makes `edit`, so that no reader ever sees part of a file and a failure before the last step leaves the file and its
 * earlier backups as they were. It refuses a file that is read-only or that grove cannot read (SettingsRefusedError),
 * and one that no longer hashes to `edit.saw` (SettingsChangedError). Then, in order: it writes the new text to a temp
 * file beside the file, with the file's mode (0600 when new), and syncs it; checks the hash again; replaces
 * `<path>.grove-backup` with the file's bytes as they were, and the first time also writes `<path>.grove-original`,
 * which it never overwrites; and renames the temp file over the file. A symbolic link is followed, so the link stays;
 * a missing folder is created 0700; a new file gets no backup. Under vitest (`VITEST` set) it refuses to write inside
 * the real home's `.claude`.
 */
export async function writeSettingsFile(edit: GuardEdit): Promise<WrittenSettings> {
  refuseRealClaudeUnderVitest(edit.path);
  const before = await readSettingsFile(edit.path);
  if (before.hash !== edit.saw) throw new SettingsChangedError(edit.path);
  if (before.problem !== null) throw new SettingsRefusedError(edit.path, before.problem);
  if (before.readOnly) throw new SettingsRefusedError(edit.path, "is read-only");
  const target = before.bytes === null ? edit.path : await realpath(edit.path);
  refuseRealClaudeUnderVitest(target);
  const mode = before.bytes === null ? NEW_FILE_MODE : (await stat(target)).mode & 0o7777;
  if (before.bytes === null) await mkdir(dirname(target), { recursive: true, mode: NEW_DIR_MODE });
  const temp = await tempBeside(target, edit.text, mode);
  try {
    const now = await readSettingsFile(edit.path);
    if (now.hash !== edit.saw) throw new SettingsChangedError(edit.path);
    let backup: string | null = null;
    let original: WrittenSettings["original"] = null;
    if (now.bytes !== null) {
      const originalPath = settingsOriginalPath(edit.path);
      const first = !existsSync(originalPath);
      if (first) await replace(originalPath, now.bytes, mode);
      original = { path: originalPath, written: first };
      backup = settingsBackupPath(edit.path);
      await replace(backup, now.bytes, mode);
    }
    await rename(temp, target);
    return { backup, original };
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
