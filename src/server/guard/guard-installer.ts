import { ephemeralRefusal } from "../../core/guard-install/ephemeral-refusal.js";
import { guardHookCommand } from "../../core/guard-install/guard-hook-command.js";
import type { GuardChange, GuardPlan, GuardReceipt, GuardState, PreparedGuardChange, SettingsFile } from "../../core/guard-install/guard-install.types.js";
import { prepareGuardChange } from "../../core/guard-install/prepare-guard-change.js";
import { readGuardStatus } from "../../core/guard-install/read-guard-status.js";
import { readSettingsFile } from "../../core/guard-install/read-settings-file.js";
import { runGuardChange } from "../../core/guard-install/run-guard-change.js";
import { willNotEdit } from "../../core/guard-install/will-not-edit.js";
import { createPlanCache, type PlanCacheOptions } from "../actions/plan-cache.js";
import { HttpError } from "../http/http.error.js";
import type { GuardSetup } from "./guard-setup.types.js";

export type GuardInstaller = {
  /** Where the guard stands in the settings file now. */
  state(): Promise<GuardState>;
  /** Plans `change` against the settings file as it is, and holds the plan to run once. */
  plan(change: GuardChange): Promise<{ planId: string; plan: GuardPlan }>;
  /** Runs a held plan once: 409 when it already ran, 410 when it expired or was never held. */
  run(planId: string): Promise<GuardReceipt>;
};

type Read = { setup: GuardSetup; command: string; file: SettingsFile };

/**
 * Installs and uninstalls the agent guard's hook in Claude Code's user settings, after a review: a plan, held in its
 * own plan cache (`createPlanCache`) and run once by id, then a receipt. Runs are made one at a time. `setup` is read
 * at each call; without one, every call is a 503.
 */
export function createGuardInstaller(setup: (() => GuardSetup) | null, options: PlanCacheOptions = {}): GuardInstaller {
  const now = options.now ?? Date.now;
  const plans = createPlanCache<PreparedGuardChange>(options);
  let queue: Promise<unknown> = Promise.resolve();

  const read = async (): Promise<Read> => {
    if (setup === null) throw new HttpError(503, "This git grove server cannot install the agent guard");
    const resolved = setup();
    return { setup: resolved, command: guardHookCommand(resolved.node, resolved.bin), file: await readSettingsFile(resolved.settingsPath) };
  };

  return {
    async state() {
      const { setup: resolved, command, file } = await read();
      const reading = readGuardStatus(file.text, command, file.problem);
      const unreadable = reading.problem === null ? null : willNotEdit(resolved.settingsPath, reading.problem);
      return {
        status: reading.status,
        settingsPath: resolved.settingsPath,
        command,
        hooksDisabled: reading.hooksDisabled,
        refusal: ephemeralRefusal(resolved.bin) ?? unreadable,
      };
    },
    async plan(change) {
      const { setup: resolved, command, file } = await read();
      const prepared = prepareGuardChange({ change, file, command, refusal: ephemeralRefusal(resolved.bin), now: now() });
      return { planId: plans.put(prepared), plan: prepared.plan };
    },
    async run(planId) {
      const taken = plans.take(planId);
      if (taken === "expired") throw new HttpError(410, "This preview expired; preview it again");
      if (taken === "taken") throw new HttpError(409, "This plan already ran");
      const running = queue.then(() => runGuardChange(taken, now));
      queue = running.catch(() => undefined);
      return running;
    },
  };
}
