import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { groveHome } from "../grove-home.js";

/** `editor` and `terminal` are the commands that open a folder; null when not configured. */
export type GroveConfig = { editor: string[] | null; terminal: string[] | null };

function isArgv(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item: unknown) => typeof item === "string" && item !== "");
}

function argvOf(parsed: object, key: string): string[] | null {
  const value: unknown = key in parsed ? Reflect.get(parsed, key) : undefined;
  if (typeof value === "string" && value !== "") return [value];
  return isArgv(value) ? value : null;
}

/**
 * Reads `config.json` in grove's folder. `editor` and `terminal` may each be a string, which is one program and is
 * never split (its path may contain spaces), or an array of the program followed by its arguments.
 * A missing, unreadable or malformed file, and any key of the wrong shape, give null for it.
 */
export async function readConfig(): Promise<GroveConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(groveHome(), "config.json"), "utf8"));
  } catch {
    return { editor: null, terminal: null };
  }
  if (typeof parsed !== "object" || parsed === null) return { editor: null, terminal: null };
  return { editor: argvOf(parsed, "editor"), terminal: argvOf(parsed, "terminal") };
}
