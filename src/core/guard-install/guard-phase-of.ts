import type { GuardPhase, GuardReading } from "./guard-install.types.js";

/**
 * Which guard Claude Code runs: the plugin, the old hook in settings, both, or neither. The old hook is present when
 * its status is `installed` or `stale`. The guard is `done` only on the plugin alone, with hooks not turned off and the
 * plugin's `hook-command` record in place (`hookCommand`).
 */
export function guardPhaseOf(input: { reading: GuardReading; hookCommand: boolean }): { phase: GuardPhase; done: boolean } {
  const { reading, hookCommand } = input;
  const oldHook = reading.status === "installed" || reading.status === "stale";
  const phase: GuardPhase = reading.pluginEnabled ? (oldHook ? "plugin-and-hook" : "plugin") : oldHook ? "hook" : "absent";
  return { phase, done: phase === "plugin" && !reading.hooksDisabled && hookCommand };
}
