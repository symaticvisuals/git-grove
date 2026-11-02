import { join, resolve } from "node:path";

/** Claude Code's user settings file: `$CLAUDE_CONFIG_DIR/settings.json` when it is set and not empty, else `<home>/.claude/settings.json`. */
export function claudeSettingsPath(env: NodeJS.ProcessEnv, home: string): string {
  const dir = env["CLAUDE_CONFIG_DIR"];
  return dir !== undefined && dir !== "" ? join(resolve(dir), "settings.json") : join(home, ".claude", "settings.json");
}
