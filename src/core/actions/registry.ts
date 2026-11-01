import type { ActionContext, ActionDef, Prepared } from "./action.types.js";
import { ackAction } from "./ack-action.js";
import { InvalidInputError } from "./invalid-input.error.js";
import type { ActionName } from "./plan.types.js";
import { restackAction } from "./restack/restack-action.js";
import { restoreAction } from "./restore-action.js";

/** The actions that run, by name. */
export const ACTIONS: Partial<Record<ActionName, ActionDef>> = {
  restore: restoreAction,
  ack: ackAction,
  restack: restackAction,
};

/** Prepares the named action from `raw`. Throws InvalidInputError for an action that is not registered. */
export async function prepareAction(name: ActionName, ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const action = ACTIONS[name];
  if (action === undefined) throw new InvalidInputError("unknown action");
  return action.prepare(ctx, raw);
}
