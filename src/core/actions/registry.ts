import type { ActionContext, ActionDef, Prepared } from "./action.types.js";
import { ackAction } from "./ack-action.js";
import { addLevelAction } from "./create/add-level-action.js";
import { copyEnvAction } from "./create/copy-env-action.js";
import { newFeatureAction } from "./create/new-feature-action.js";
import { InvalidInputError } from "./invalid-input.error.js";
import type { ActionName } from "./plan.types.js";
import { cleanupAction } from "./remove/cleanup-action.js";
import { forgetAction } from "./remove/forget-action.js";
import { removeAction } from "./remove/remove-action.js";
import { restackAction } from "./restack/restack-action.js";
import { restoreAction } from "./restore-action.js";

/** The actions that run, by name. */
export const ACTIONS: Partial<Record<ActionName, ActionDef>> = {
  restore: restoreAction,
  ack: ackAction,
  restack: restackAction,
  new: newFeatureAction,
  "add-level": addLevelAction,
  "copy-env": copyEnvAction,
  remove: removeAction,
  cleanup: cleanupAction,
  forget: forgetAction,
};

/** Prepares the named action from `raw`. Throws InvalidInputError for an action that is not registered. */
export async function prepareAction(name: ActionName, ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const action = ACTIONS[name];
  if (action === undefined) throw new InvalidInputError("unknown action");
  return action.prepare(ctx, raw);
}
