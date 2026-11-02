import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { GuardEdit } from "./guard-install.types.js";
import { readSettingsFile } from "./read-settings-file.js";
import { SettingsChangedError } from "./settings-changed.error.js";
import { settingsBackupPath } from "./settings-backup-path.js";

const NEW_FILE_MODE = 0o600;
const NEW_DIR_MODE = 0o700;

function refuseRealClaudeUnderVitest(path: string): void {
  if (process.env["VITEST"] === undefined) return;
  const rel = relative(join(userInfo().homedir, ".claude"), resolve(path));
  if (rel === "" || !(rel.startsWith("..") || isAbsolute(rel))) throw new Error("writeSettingsFile refuses to write the real ~/.claude under vitest");
}

async function writeAtomically(target: string, text: string, mode: number): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.grove-${randomBytes(6).toString("hex")}.tmp`);
  try {
    const handle = await open(temp, "wx", mode);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temp, mode);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Makes `edit`: reads the file again and throws SettingsChangedError unless it still hashes to `edit.saw`; writes
 * what it held to `<path>.grove-backup` (no backup for a file that did not exist); then writes the new text to a temp
 * file in the same folder, with the file's mode (0600 when new), and renames it over the file, so no reader ever sees
 * part of it. A symbolic link is followed, so the link stays. A missing folder is created 0700. Under vitest
 * (`VITEST` set) it refuses to write inside the real home's `.claude`.
 */
export async function writeSettingsFile(edit: GuardEdit): Promise<{ backup: string | null }> {
  refuseRealClaudeUnderVitest(edit.path);
  const current = await readSettingsFile(edit.path);
  if (current.hash !== edit.saw) throw new SettingsChangedError(edit.path);
  const target = current.text === null ? edit.path : await realpath(edit.path);
  refuseRealClaudeUnderVitest(target);
  let backup: string | null = null;
  let mode = NEW_FILE_MODE;
  if (current.text !== null) {
    mode = (await stat(target)).mode & 0o7777;
    backup = settingsBackupPath(edit.path);
    await writeFile(backup, current.text, { mode });
    await chmod(backup, mode);
  } else {
    await mkdir(dirname(target), { recursive: true, mode: NEW_DIR_MODE });
  }
  await writeAtomically(target, edit.text, mode);
  return { backup };
}
