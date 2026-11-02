import { join, resolve } from "node:path";

/** `$CLAUDE_CONFIG_DIR` as an absolute path, a leading `~` and a relative path both taken from `home`; null when it is unset or empty. */
export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string | null {
  const dir = env["CLAUDE_CONFIG_DIR"];
  if (dir === undefined || dir === "") return null;
  if (dir === "~") return home;
  return dir.startsWith("~/") ? join(home, dir.slice(2)) : resolve(home, dir);
}
