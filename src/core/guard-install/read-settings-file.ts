import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SettingsFile } from "./guard-install.types.js";

function codeOf(error: unknown): string | null {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
}

/**
 * Reads the settings file at `path`, with the SHA-256 of its bytes. A missing file has no text and the hash
 * `missing`. One that cannot be read, or is not UTF-8 text, has no text, a hash no file has, and a `problem` that
 * follows "It".
 */
export async function readSettingsFile(path: string): Promise<SettingsFile> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return { path, text: null, hash: "missing", problem: null };
    return { path, text: null, hash: "unreadable", problem: `cannot be read (${codeOf(error) ?? (error instanceof Error ? error.message : String(error))})` };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  try {
    return { path, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), hash, problem: null };
  } catch {
    return { path, text: null, hash, problem: "is not UTF-8 text" };
  }
}
