import { homedir } from "node:os";
import { claudeSettingsPath } from "./claude-settings-path.js";

/** This user's Claude Code settings file, from this process's environment. Throws under vitest (`VITEST` set), where only a temp folder belongs. */
export function realClaudeSettingsPath(): string {
  if (process.env["VITEST"] !== undefined) throw new Error("realClaudeSettingsPath refuses to run under vitest; give the code under test a temp settings path");
  return claudeSettingsPath(process.env, homedir());
}
