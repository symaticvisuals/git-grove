import { basename } from "node:path";
import type { RepoFacts } from "../../facts/facts.types.js";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { plural } from "../../rules/plural.js";
import type { ActionContext, ActionDef, Prepared } from "../action.types.js";
import { InvalidInputError } from "../invalid-input.error.js";
import type { Choice, Plan } from "../plan.types.js";
import { copyDetail } from "./copy-detail.js";
import { readCleanupCandidates } from "./read-cleanup-candidates.js";
import type { Removal } from "./read-removal.js";
import { removalCommands } from "./removal-commands.js";
import { runCleanup } from "./run-cleanup.js";

const SHAPE = "cleanup takes { paths?: [worktree path] }";

function parsePaths(raw: unknown): string[] | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new InvalidInputError(SHAPE);
  const list: unknown = "paths" in raw ? raw.paths : undefined;
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new InvalidInputError(SHAPE);
  const items: unknown[] = list;
  const paths = items.map((item) => {
    if (typeof item !== "string" || item === "") throw new InvalidInputError(SHAPE);
    return item;
  });
  if (new Set(paths).size !== paths.length) throw new InvalidInputError("each worktree can be picked once");
  return paths;
}

function detailOf(candidate: Removal): string {
  if (candidate.blockers.length > 0) return candidate.blockers.join(", ");
  return candidate.copies.length > 0 ? `copies ${plural(candidate.copies.length, "file")} to main first` : "nothing to keep";
}

function choiceOf(candidate: Removal, picked: ReadonlySet<string>): Choice {
  const selectable = candidate.blockers.length === 0;
  return {
    id: candidate.worktree.path,
    label: candidate.label,
    detail: detailOf(candidate),
    selectable,
    selected: picked.has(candidate.worktree.path),
    health: !selectable ? "idle" : candidate.copies.length > 0 ? "loses" : "fine",
  };
}

function blockersOf(candidates: Removal[], picked: Removal[]): string[] {
  const blocked = picked.filter((candidate) => candidate.blockers.length > 0);
  if (blocked.length > 0) return blocked.map((candidate) => `${candidate.label}: ${detailOf(candidate)}`);
  if (picked.length > 0) return [];
  return candidates.some((candidate) => candidate.blockers.length === 0) ? ["Pick at least one worktree."] : ["Nothing here is safe to clean up"];
}

function planOf(facts: RepoFacts, candidates: Removal[], picked: Removal[]): Plan {
  const ids = new Set(picked.map((candidate) => candidate.worktree.path));
  const files = picked.reduce((sum, candidate) => sum + candidate.copies.length, 0);
  return {
    action: "cleanup",
    context: basename(facts.root),
    title: "Clean up worktrees",
    summary: "Only folders whose work is safe somewhere else. Grove re-checks each one right before removing it.",
    confirm: "Clean up",
    before: null,
    after: null,
    folders: null,
    choices: candidates.map((candidate) => choiceOf(candidate, ids)),
    checks: [],
    effects: [
      ...(files > 0 ? [`Copy ${plural(files, "ignored file")} to main first, never overwriting, and check each copy.`] : []),
      "Re-check each folder right before removing it, and skip any that changed.",
      "Keep every branch.",
    ],
    commands: picked.flatMap((candidate) => removalCommands(candidate, true)),
    steps: [
      { title: "Check nothing moved since you looked", detail: "Each folder is checked again right before it goes" },
      ...picked.flatMap((candidate) => [
        ...candidate.copies.map((copy) => ({ title: `${candidate.label}: copy ${copy.from} to main`, detail: copyDetail(copy) })),
        { title: `${candidate.label}: remove folder`, detail: candidate.worktree.branch === null ? "nothing to keep" : "branch kept" },
      ]),
    ],
    blockers: blockersOf(candidates, picked),
    note: "Each folder is re-checked right before it goes. Branches are kept.",
    undoable: false,
    moves: [],
    expects: [],
    readAt: facts.readAt,
  };
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const paths = parsePaths(raw);
  const facts = await readRepoFacts(ctx.root);
  const candidates = await readCleanupCandidates(facts);
  const known = new Set(candidates.map((candidate) => candidate.worktree.path));
  const unknown = paths?.find((path) => !known.has(path));
  if (unknown !== undefined) throw new InvalidInputError(`${unknown} is not a merged worktree or a detached sandbox`);
  const wanted = new Set(paths ?? candidates.filter((candidate) => candidate.blockers.length === 0).map((candidate) => candidate.worktree.path));
  const picked = candidates.filter((candidate) => wanted.has(candidate.worktree.path));
  return { plan: planOf(facts, candidates, picked), execute: (run) => runCleanup(picked, run) };
}

/**
 * Removes merged worktrees and detached sandboxes in one go: `{ paths? }`, worktree paths from the plan's choices,
 * by default every one that can be picked. A picked worktree's precious ignored files are copied into main first, never
 * overwriting. The plan expects nothing as a whole: each worktree is checked against what the plan read, and its full
 * verdict re-read, right before it goes; one that changed is skipped and the rest still go. Every branch is kept. A
 * path that is not a choice is invalid input.
 */
export const cleanupAction: ActionDef = { name: "cleanup", prepare };
