import { join } from "node:path";
import { existsSync } from "node:fs";
import { findWorktree } from "../../facts/find-worktree.js";
import { listMainEnvFiles } from "../../facts/list-main-env-files.js";
import { readRepoFacts } from "../../facts/read-repo-facts.js";
import { plural } from "../../rules/plural.js";
import type { ActionContext, ActionDef, Prepared } from "../action.types.js";
import { displayPath } from "../display-path.js";
import { InvalidInputError } from "../invalid-input.error.js";
import { listPaths } from "../list-paths.js";
import type { Plan } from "../plan.types.js";
import { shellWord } from "../shell-word.js";
import { copyEnvFiles } from "./copy-env-files.js";

const SHAPE = "copy-env takes { worktree }";

function parseWorktree(raw: unknown): string {
  const worktree = typeof raw === "object" && raw !== null && "worktree" in raw ? raw.worktree : undefined;
  if (typeof worktree !== "string" || worktree === "") throw new InvalidInputError(SHAPE);
  return worktree;
}

async function prepare(ctx: ActionContext, raw: unknown): Promise<Prepared> {
  const target = parseWorktree(raw);
  const facts = await readRepoFacts(ctx.root);
  const worktree = await findWorktree(facts, ctx.root, target);
  if (worktree.isMain) throw new InvalidInputError("the main checkout is where the env files come from");
  const shown = displayPath(facts.root, worktree.path);
  const files = await listMainEnvFiles(facts);
  const missing = files.filter((file) => !existsSync(join(worktree.path, file)));
  const present = files.length - missing.length;

  const plan: Plan = {
    action: "copy-env",
    context: shown,
    title: `Copy env files into ${shown}`,
    summary: "Ignored .env files from the main checkout that this worktree lacks.",
    confirm: "Copy",
    before: null,
    after: null,
    folders: null,
    choices: null,
    checks: [
      ...(missing.length > 0 ? [{ ok: true, text: `${plural(missing.length, "file")} to copy`, why: listPaths(missing) }] : []),
      ...(present > 0 ? [{ ok: true, text: `${plural(present, "file")} already there`, why: "Left as they are" }] : []),
    ],
    effects: [],
    commands: missing.map((file) => `cp -n ${shellWord(file)} ${shellWord(`${shown}/${file}`)}`),
    steps: [
      { title: "Check nothing moved since you looked", detail: `${plural(missing.length, "file")} still missing` },
      { title: `Copy ${plural(missing.length, "env file")}`, detail: "Never overwriting" },
    ],
    blockers: files.length === 0 ? ["The main checkout has no ignored .env files"] : missing.length === 0 ? [`${shown} already has every env file`] : [],
    note: "Nothing already in the worktree is overwritten.",
    undoable: false,
    moves: [],
    expects: missing.map((file) => ({ kind: "absent", path: join(worktree.path, file) })),
    readAt: facts.readAt,
  };

  return {
    plan,
    async execute(run) {
      const result = await run.step(run.firstStep, async () => {
        const { copied, kept } = await copyEnvFiles(run.facts.root, worktree.path, files);
        return `${plural(copied.length, "env file")} copied${kept.length > 0 ? `, ${kept.length} already there` : ""}`;
      });
      return { ok: true, title: `Copied env files into ${shown}`, lines: [result], undo: null };
    },
  };
}

/**
 * Copies the main checkout's ignored `.env*` files into a worktree that lacks them: `{ worktree }`, a path or a folder
 * inside the repository. Never overwrites a file the worktree has. Blocked for the main checkout, when there are no
 * env files, and when the worktree already has them all.
 */
export const copyEnvAction: ActionDef = { name: "copy-env", prepare };
