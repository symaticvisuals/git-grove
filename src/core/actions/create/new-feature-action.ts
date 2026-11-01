import { basename } from "node:path";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { readStackFacts } from "../../stacks/read-stack-facts.js";
import type { ActionContext, ActionDef, Prepared } from "../action.types.js";
import { InvalidInputError } from "../invalid-input.error.js";
import { createLevelPlan } from "./create-level-plan.js";
import { parseLevelInput } from "./parse-level-input.js";
import { readNewLevel } from "./read-new-level.js";
import { runCreateLevel } from "./run-create-level.js";
import { slugOf } from "./slug-of.js";

const SHAPE = "new takes { feature, branch?, from?, env?, install?, open? }";

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const input = parseLevelInput(raw, SHAPE);
  if (input.on !== undefined) throw new InvalidInputError(SHAPE);
  const facts = await readRepoFacts(ctx.root);
  const { trunk } = facts;
  if (input.from !== undefined && input.from !== trunk.name && input.from !== trunk.ref) {
    throw new InvalidInputError(`new starts from the trunk (${trunk.name}); to build on another branch use add-level`);
  }
  const branch = input.branch ?? slugOf(input.feature);
  if (branch === "") throw new InvalidInputError("the feature name has no letters or digits to make a branch from; pass --branch");

  const { level, blockers } = await readNewLevel(facts, {
    feature: input.feature,
    branch,
    parent: trunk.name,
    forkPoint: trunk.sha,
    depth: 1,
    recordFeature: true,
    env: input.env,
    install: input.install,
    open: input.open,
  });
  const taken = (await readStackFacts(facts.root, facts)).find(
    (feature) => feature.kind === "stack" && (feature.name === input.feature || slugOf(feature.name) === slugOf(input.feature)),
  );
  if (taken !== undefined) blockers.push(`A feature named ${taken.name} already exists; use add-level to build on it`);

  const plan = createLevelPlan(facts, level, {
    action: "new",
    title: `New feature ${input.feature}`,
    summary: `Level 01 on ${trunk.name}, in its own folder.`,
    folders: [{ path: basename(level.folder), isNew: true, note: `on ${trunk.name}` }],
    blockers,
  });
  return { plan, execute: (run) => runCreateLevel(level, run) };
}

/**
 * Starts a feature: `{ feature, branch?, from?, env?, install?, open? }`. Creates `branch` (default the feature's
 * slug) from the trunk, in `.worktrees/<feature>/01-<branch>`, and records it as level 1. `from` may only name the
 * trunk. Copies the main worktree's ignored `.env*` files unless `env` is false, installs and opens the editor only
 * when asked. Blocked when the branch, the folder or the feature already exists.
 */
export const newFeatureAction: ActionDef = { name: "new", prepare };
