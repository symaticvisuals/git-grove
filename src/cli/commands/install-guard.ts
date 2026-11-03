import { ephemeralRefusal } from "../../core/guard-install/ephemeral-refusal.js";
import { PLUGIN_INSTALL } from "../../core/guard-install/plugin-commands.js";
import type { CliIo } from "../cli-io.types.js";

/** Where this CLI runs from: its `bin.js`, which the plugin's hook runs once `git grove ui` records it. */
export type GuardInstallation = { bin: string };

/**
 * Runs `git grove install-guard`: prints the two commands that install the agent guard as a Claude Code plugin, and
 * that `git grove ui` must run once so the plugin's hook can find this grove. It writes no file. From a package
 * runner's cache, which may be cleared under the hook, it also asks for a global install on stderr and exits 1.
 */
export function installGuardCommand(io: CliIo, where: GuardInstallation): number {
  io.out(
    [
      "Install the agent guard as a Claude Code plugin:",
      "",
      ...PLUGIN_INSTALL.map((command) => `  ${command}`),
      "",
      "git grove changed no file. Run git grove ui once so the plugin's hook can find git grove.",
      "",
    ].join("\n"),
  );
  const refusal = ephemeralRefusal(where.bin);
  if (refusal === null) return 0;
  io.err(`git-grove: ${refusal.charAt(0).toLowerCase()}${refusal.slice(1)}\n`);
  return 1;
}
