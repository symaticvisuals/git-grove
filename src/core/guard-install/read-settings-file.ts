import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, stat } from "node:fs/promises";
import type { SettingsFile } from "./guard-install.types.js";

function codeOf(error: unknown): string | null {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
}

function nothing(path: string, hash: string, problem: string | null): SettingsFile {
  return { path, text: null, bytes: null, hash, problem, readOnly: false };
}

async function readOnly(path: string): Promise<boolean> {
  if (((await stat(path)).mode & 0o200) === 0) return true;
  return access(path, constants.W_OK).then(
    () => false,
    () => true,
  );
}

/**
 * Reads the settings file at `path`, with the SHA-256 of its bytes. A missing file has no text and the hash
 * `missing`. A symbolic link whose target is missing, a file that cannot be read, and one that is not UTF-8 text
 * have no text, a hash no file has, and a `problem` that follows "It". A byte-order mark is kept in the text, so the
 * strict parse sees it. A file with no owner-write bit, or that this process cannot write, is `readOnly`.
 */
export async function readSettingsFile(path: string): Promise<SettingsFile> {
  let link = false;
  let bytes: Buffer;
  try {
    link = (await lstat(path)).isSymbolicLink();
    bytes = await readFile(path);
  } catch (error) {
    const code = codeOf(error);
    if (code === "ENOENT" && link) return nothing(path, "dangling", "is a link to a missing file");
    if (code === "ENOENT") return nothing(path, "missing", null);
    return nothing(path, "unreadable", `cannot be read (${code ?? (error instanceof Error ? error.message : String(error))})`);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ...nothing(path, hash, "is not UTF-8 text"), bytes };
  }
  return { path, text, bytes, hash, problem: null, readOnly: await readOnly(path) };
}
