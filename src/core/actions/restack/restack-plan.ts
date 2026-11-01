import { relative } from "node:path";
import type { RepoFacts } from "../../facts/facts.types.js";
import { plural } from "../../rules/plural.js";
import { displayPath } from "../display-path.js";
import { listPaths } from "../list-paths.js";
import type { Check, Expectation, Plan } from "../plan.types.js";
import type { RestackLevel, RestackRead } from "./restack.types.js";

function shortRef(ref: string): string {
  return ref.replace(/^refs\/(?:heads|remotes)\//, "");
}

function settingAside(read: RestackRead, level: RestackLevel): boolean {
  return read.stash && level.dirty.length > 0;
}

function moveCheck(read: RestackRead, level: RestackLevel, index: number): Check {
  const text = `${level.label} onto ${level.ontoLabel}`;
  if (index > 0) return { ok: true, text, why: "Conflicts are checked when this level runs" };
  if (read.conflicts === null) return { ok: true, text, why: "Conflicts not checked (needs git 2.40)" };
  if (read.conflicts.length > 0) return { ok: false, text, why: `conflicts likely in ${listPaths(read.conflicts)}` };
  return { ok: true, text, why: `${plural(level.own, "commit")}, no conflicts expected` };
}

function dirtyChecks(read: RestackRead, level: RestackLevel): Check[] {
  const count = level.dirty.length;
  if (count === 0) return [];
  const changes = `${plural(count, "uncommitted change")} in ${level.move.branch}`;
  if (!read.stash) return [{ ok: false, text: changes, why: "Turn on set aside, or commit them first." }];
  const back = count === 1 ? "goes back exactly as it is now." : "go back exactly as they are now.";
  return [{ ok: true, text: `${changes} will be set aside`, why: `${listPaths(level.dirty)} ${back}` }];
}

function blockersOf(root: string, read: RestackRead): string[] {
  const blockers = read.levels.length === 0 ? ["Nothing to restack: every level is on top of its parent"] : [];
  for (const level of read.levels) {
    const { branch } = level.move;
    if (level.holder === undefined) blockers.push(`${branch} has no worktree; restack it by hand`);
    if (level.busy?.operation) {
      const there = displayPath(root, level.busy.path);
      blockers.push(`${branch} has a ${level.busy.operation} in progress in ${there}. Finish or abort it first.`);
    }
    if (level.dirty.length > 0 && !read.stash) {
      blockers.push(`${branch} has uncommitted changes. Turn on set aside, or commit them first.`);
    }
  }
  for (const branch of read.rewritten) blockers.push(`${branch} has a rewrite to restore or keep first`);
  return blockers;
}

function effectsOf(root: string, read: RestackRead): string[] {
  const effects = ["Pin each level that moves, so you can undo this."];
  for (const level of read.levels) {
    if (settingAside(read, level) && level.holder !== undefined) {
      effects.push(`Set aside the uncommitted changes in ${displayPath(root, level.holder.path)} and put them back after.`);
    }
    if (level.move.ontoTrunk) {
      effects.push(`Record ${read.trunk.name} as the parent of ${level.move.branch}, since ${level.parent} is merged.`);
    }
  }
  return [...effects, "Record where each level now forks from its parent."];
}

function commandsOf(root: string, read: RestackRead): string[] {
  return read.levels.flatMap((level) => {
    const { branch, onto, ontoTrunk } = level.move;
    const git = level.holder === undefined ? "git" : `git -C ${relative(root, level.holder.path) || "."}`;
    const aside = settingAside(read, level);
    return [
      ...(aside ? [`${git} stash push --include-untracked -m "${read.stashMessage}"`] : []),
      `${git} rebase --no-update-refs --no-autosquash --onto ${ontoTrunk ? shortRef(read.trunk.ref) : onto} ${level.fork} ${branch}`,
      ...(ontoTrunk ? [`${git} config branch.${branch}.stackparent ${read.trunk.name}`] : []),
      ...(aside ? [`${git} stash pop --index`] : []),
    ];
  });
}

function stepsOf(read: RestackRead): Plan["steps"] {
  const count = read.levels.length;
  return [
    { title: "Check nothing moved since you looked", detail: `${plural(read.tips.size, "level")} and ${read.trunk.name} unchanged` },
    ...(count > 0 ? [{ title: "Pin every level that moves", detail: plural(count, "pin") }] : []),
    ...read.levels.map((level) => ({
      title: `Move ${level.move.branch} onto ${level.move.onto}`,
      detail: `${plural(level.own, "commit")} to replay${settingAside(read, level) ? ", with your changes set aside" : ""}`,
    })),
    { title: "Check nothing was lost", detail: "every old commit matched" },
  ];
}

function expectsOf(read: RestackRead): Expectation[] {
  const tips = [...read.tips].map(([branch, sha]): Expectation => ({ kind: "tip", branch, sha }));
  const trunk: Expectation[] =
    read.trunk.ref === `refs/heads/${read.trunk.name}` ? [{ kind: "tip", branch: read.trunk.name, sha: read.trunk.sha }] : [];
  const worktrees = read.levels.flatMap(({ holder, dirty }): Expectation[] =>
    holder === undefined ? [] : [{ kind: "worktree", path: holder.path, head: holder.head, dirty, operation: holder.operation }],
  );
  return [...tips, ...trunk, ...worktrees];
}

/**
 * The plan for a restack: a check per level that moves (conflicts predicted for the first, whose new base is final),
 * one per level left alone, the exact git commands, and a step per level between the pin step and the final check.
 * It is blocked when nothing would move, when a level that moves has no worktree, an operation in progress or
 * uncommitted changes that are not to be set aside, and when any level has an open rewrite.
 */
export function restackPlan(facts: RepoFacts, read: RestackRead): Plan {
  const { root } = facts;
  const count = read.levels.length;
  const untouched = read.untouched.map((label): Check => ({ ok: true, text: `${label} is already up to date`, why: "Left alone" }));
  return {
    action: "restack",
    context: read.feature.name,
    title: `Restack ${read.feature.name}`,
    summary: "Each level moves onto the latest version of the level below it.",
    confirm: `Restack ${plural(count, "level")}`,
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [
      ...read.levels.map((level, index) => moveCheck(read, level, index)),
      ...untouched,
      ...read.levels.flatMap((level) => dirtyChecks(read, level)),
    ],
    effects: effectsOf(root, read),
    commands: commandsOf(root, read),
    steps: stepsOf(read),
    blockers: blockersOf(root, read),
    note: "Nothing is pushed.",
    undoable: count > 0,
    moves: read.levels.map((level) => level.move.branch),
    expects: expectsOf(read),
    readAt: facts.readAt,
  };
}
