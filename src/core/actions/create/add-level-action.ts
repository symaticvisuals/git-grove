import { basename } from "node:path";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { findFeature } from "../../stacks/find-feature.js";
import { readStackFacts } from "../../stacks/read-stack-facts.js";
import type { Level } from "../../stacks/stacks.types.js";
import type { ActionContext, ActionDef, Prepared } from "../action.types.js";
import { InvalidInputError } from "../invalid-input.error.js";
import type { FolderLine } from "../plan.types.js";
import { createLevelPlan } from "./create-level-plan.js";
import { parseLevelInput } from "./parse-level-input.js";
import { readNewLevel } from "./read-new-level.js";
import { runCreateLevel } from "./run-create-level.js";

const SHAPE = "add-level takes { feature, branch, on?, env?, install?, open? }";

function deepest(levels: Level[]): Level | undefined {
  return levels.reduce<Level | undefined>((best, level) => (best === undefined || level.depth >= best.depth ? level : best), undefined);
}

function folderLines(levels: Level[]): FolderLine[] {
  return levels.flatMap((level) =>
    level.worktree === null ? [] : [{ path: basename(level.worktree.path), isNew: false, note: `on ${level.parent}` }],
  );
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const input = parseLevelInput(raw, SHAPE);
  const { branch } = input;
  if (branch === undefined || input.from !== undefined) throw new InvalidInputError(SHAPE);
  const facts = await readRepoFacts(ctx.root);
  const feature = findFeature(await readStackFacts(facts.root, facts), input.feature);
  if (feature === null || feature.kind !== "stack") throw new InvalidInputError(`no stack named ${input.feature}`);

  const parent = input.on === undefined ? deepest(feature.levels) : feature.levels.find((level) => level.branch === input.on);
  if (parent === undefined) throw new InvalidInputError(`${input.on ?? input.feature} is not a level of ${feature.name}`);
  const tip = facts.branches.find((candidate) => candidate.name === parent.branch)?.tip;
  if (tip === undefined) throw new InvalidInputError(`${parent.branch} no longer exists; pick another level with --on`);

  const { level, blockers } = await readNewLevel(facts, {
    feature: feature.name,
    branch,
    parent: parent.branch,
    forkPoint: tip,
    depth: parent.depth + 1,
    recordFeature: false,
    env: input.env,
    install: input.install,
    open: input.open,
  });
  const existing = folderLines(feature.levels);
  const plan = createLevelPlan(facts, level, {
    action: "add-level",
    title: `Add ${branch} to ${feature.name}`,
    summary: `Level ${String(level.depth).padStart(2, "0")} on ${parent.branch}.`,
    folders: [...existing, { path: basename(level.folder), isNew: true, note: `on ${parent.branch}` }],
    blockers,
  });
  return { plan, execute: (run) => runCreateLevel(level, run) };
}

/**
 * Adds a level to a stack: `{ feature, branch, on?, env?, install?, open? }`, where `feature` is the feature's name or
 * any of its branches. The new branch starts at the tip of `on` (default the feature's deepest level, the last one
 * found when several share that depth) in the next numbered folder, and records `stackparent` and `stackforkpoint`.
 * Env, install and open behave as in `new`. Blocked when the branch or folder already exists.
 */
export const addLevelAction: ActionDef = { name: "add-level", prepare };
