import { join } from "node:path";
import { claudeConfigDir } from "./claude-config-dir.js";

/** Claude Code's user settings file: `settings.json` in `claudeConfigDir` when `CLAUDE_CONFIG_DIR` is set, else `<home>/.claude/settings.json`. */
export function claudeSettingsPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(claudeConfigDir(env, home) ?? join(home, ".claude"), "settings.json");
}
