import { realClaudeSettingsPath } from "../core/guard-install/real-claude-settings-path.js";
import type { GuardSetup } from "../server/guard/guard-setup.types.js";
import { binPath } from "./bin-path.js";
import { stableNodePath } from "./stable-node-path.js";

/** The agent guard's hook as this process would install it: its stable Node, this CLI's bin and this user's Claude Code settings. Throws under vitest. */
export function realGuardSetup(): GuardSetup {
  return { node: stableNodePath(), bin: binPath(), settingsPath: realClaudeSettingsPath() };
}
