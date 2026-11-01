import { plural } from "../../rules/plural.js";
import type { NewLevel } from "./new-level.types.js";

export type LevelStepKey = "create" | "record" | "ignore" | "env" | "install" | "open";

export type LevelStep = { key: LevelStepKey; title: string; detail: string };

/**
 * The steps that create a level, after the plan's first one: the branch and its folder, its stack keys, then
 * whichever of ignoring `.worktrees/`, copying env files, installing and opening apply.
 */
export function levelSteps(level: NewLevel): LevelStep[] {
  const number = String(level.depth).padStart(2, "0");
  const steps: LevelStep[] = [
    { key: "create", title: `Create branch ${level.branch} and its folder`, detail: `From ${level.parent} at ${level.forkPoint.slice(0, 7)}` },
    { key: "record", title: `Record it as level ${number} of ${level.feature}`, detail: `On top of ${level.parent}` },
  ];
  if (level.ignoreWorktrees) {
    steps.push({ key: "ignore", title: "Ignore .worktrees/ in this clone", detail: "Added to .git/info/exclude" });
  }
  if (level.envFiles.length > 0) {
    steps.push({ key: "env", title: `Copy ${plural(level.envFiles.length, "env file")}`, detail: "From the main checkout, never overwriting" });
  }
  if (level.install !== null) steps.push({ key: "install", title: "Install dependencies", detail: level.install.label });
  if (level.open) steps.push({ key: "open", title: "Open in your editor", detail: "" });
  return steps;
}
