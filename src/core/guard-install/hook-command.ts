import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isEphemeralBin } from "../is-ephemeral-bin.js";

/** `<home>/hook-command`: the Node and the `dist/cli/bin.js`, one per line, that the Claude Code plugin's hook runs. */
export function hookCommandPath(home: string): string {
  return join(home, "hook-command");
}

async function currentText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Records `node` and `bin` in `<home>/hook-command`, mode 0600, in one rename so a hook never reads half of it. Answers
 * "unchanged" and leaves the file alone when it already says so, and "ephemeral" without writing when `bin` runs from a
 * package runner's cache, which may be cleared under the hook.
 */
export async function writeHookCommand(home: string, node: string, bin: string): Promise<"written" | "unchanged" | "ephemeral"> {
  if (isEphemeralBin(bin)) return "ephemeral";
  const path = hookCommandPath(home);
  const text = `${node}\n${bin}\n`;
  if ((await currentText(path)) === text) return "unchanged";
  await mkdir(home, { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}`;
  try {
    await writeFile(temp, text, { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return "written";
}

/** The Node and bin recorded in `<home>/hook-command`; null when the file is missing, has fewer than two lines, or either path is gone. */
export async function readHookCommand(home: string): Promise<{ node: string; bin: string } | null> {
  const [node, bin] = (await currentText(hookCommandPath(home)))?.split("\n") ?? [];
  if (node === undefined || bin === undefined || node === "" || bin === "") return null;
  return (await exists(node)) && (await exists(bin)) ? { node, bin } : null;
}
