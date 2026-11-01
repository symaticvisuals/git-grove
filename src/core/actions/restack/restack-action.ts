import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { findFeature } from "../../stacks/find-feature.js";
import { readStackFacts } from "../../stacks/read-stack-facts.js";
import type { ActionContext, ActionDef, Prepared } from "../action.types.js";
import { InvalidInputError } from "../invalid-input.error.js";
import { readRestack } from "./read-restack.js";
import { restackPlan } from "./restack-plan.js";
import { runRestack } from "./run-restack.js";

const SHAPE = "restack takes { feature, stash? }";

function parseInput(raw: unknown): { feature: string; stash: boolean } {
  if (typeof raw !== "object" || raw === null || !("feature" in raw)) throw new InvalidInputError(SHAPE);
  const { feature } = raw;
  const stash = "stash" in raw ? raw.stash : undefined;
  if (typeof feature !== "string" || feature === "") throw new InvalidInputError(SHAPE);
  if (stash !== undefined && typeof stash !== "boolean") throw new InvalidInputError(SHAPE);
  return { feature, stash: stash === true };
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const input = parseInput(raw);
  const facts = await readRepoFacts(ctx.root);
  const feature = findFeature(await readStackFacts(facts.root, facts), input.feature);
  if (feature === null) throw new InvalidInputError(`no feature or branch named ${input.feature}`);
  if (feature.kind !== "stack") throw new InvalidInputError(`${feature.name} is not a stack`);
  const read = await readRestack(ctx, facts, feature, input.stash);
  return { plan: restackPlan(facts, read), execute: (run) => runRestack(ctx, read, run) };
}

/**
 * Moves each level of a stack onto the latest version of its parent: `{ feature, stash? }`, where `feature` is the
 * feature's name or any of its branches. With `stash`, a level's uncommitted changes are set aside around its rebase;
 * without it they block. Never pushes.
 */
export const restackAction: ActionDef = { name: "restack", prepare };
