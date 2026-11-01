import type { RepoFacts } from "../../facts/facts.types.js";
import { listPaths } from "../list-paths.js";
import { displayPath } from "../display-path.js";
import { shellWord } from "../shell-word.js";
import type { Expectation, FolderLine, Plan } from "../plan.types.js";
import { levelSteps } from "./level-steps.js";
import type { NewLevel } from "./new-level.types.js";

function commandsOf(facts: RepoFacts, level: NewLevel): string[] {
  const { branch } = level;
  const keys = [
    `git config branch.${branch}.stackparent ${shellWord(level.parent)}`,
    `git config branch.${branch}.stackforkpoint ${level.forkPoint}`,
    ...(level.recordFeature ? [`git config branch.${branch}.grovefeature ${shellWord(level.feature)}`] : []),
  ];
  return [
    `git worktree add -b ${shellWord(branch)} ${shellWord(displayPath(facts.root, level.folder))} ${level.forkPoint.slice(0, 7)}`,
    ...keys,
    ...(level.ignoreWorktrees ? ["echo '.worktrees/' >> .git/info/exclude"] : []),
    ...(level.install === null ? [] : [`cd ${shellWord(displayPath(facts.root, level.folder))} && ${level.install.label}`]),
  ];
}

function expectsOf(facts: RepoFacts, level: NewLevel): Expectation[] {
  const parent = facts.branches.find((branch) => branch.name === level.parent);
  return [
    { kind: "tip", branch: level.branch, sha: null },
    { kind: "absent", path: level.folder },
    ...(parent !== undefined && parent.tip === level.forkPoint ? [{ kind: "tip" as const, branch: level.parent, sha: level.forkPoint }] : []),
  ];
}

function effectsOf(level: NewLevel): string[] {
  return [
    ...(level.envFiles.length > 0 ? [`Copy ${listPaths(level.envFiles)} from the main checkout; nothing is overwritten`] : []),
    ...(level.installHint === null ? [] : [`Run \`${level.installHint}\` in the new folder when you need it`]),
    ...(level.open ? ["Open the new folder in your editor"] : []),
  ];
}

/**
 * The plan for creating a level, shared by `new` and `add-level`: it creates a branch and its folder, records the
 * stack keys, and optionally ignores `.worktrees/`, copies env files, installs and opens the editor. It changes
 * nothing that exists today, and expects the branch and folder to still be absent and the parent to be where it was.
 */
export function createLevelPlan(
  facts: RepoFacts,
  level: NewLevel,
  parts: { action: "new" | "add-level"; title: string; summary: string; folders: FolderLine[]; blockers: string[] },
): Plan {
  const number = String(level.depth).padStart(2, "0");
  return {
    action: parts.action,
    context: level.feature,
    title: parts.title,
    summary: parts.summary,
    confirm: "Create",
    before: null,
    after: null,
    folders: parts.folders,
    choices: null,
    checks: [
      { ok: true, text: `${level.parent} is at ${level.forkPoint.slice(0, 7)}`, why: `Level ${number} starts here` },
      level.ignoreWorktrees
        ? { ok: true, text: ".worktrees/ is not ignored in this clone", why: "Grove adds it to .git/info/exclude" }
        : { ok: true, text: ".worktrees/ is already ignored", why: null },
    ],
    effects: effectsOf(level),
    commands: commandsOf(facts, level),
    steps: [
      { title: "Check nothing moved since you looked", detail: `${level.branch} and its folder still free` },
      ...levelSteps(level).map(({ title, detail }) => ({ title, detail })),
    ],
    blockers: parts.blockers,
    note: "Nothing that exists today is changed.",
    undoable: false,
    moves: [],
    expects: expectsOf(facts, level),
    readAt: facts.readAt,
  };
}
