import type { RestoreTargetInput } from "../../../src/core/actions/parse-restore-targets.js";
import type { ActionName } from "../../../src/core/actions/plan.types.js";
import type { WireFeature, WireLevel, WireRepoView } from "../../../src/server/wire/wire.types.js";

export type FieldValue = string | boolean | string[];

export type FieldValues = Record<string, FieldValue>;

export type FieldOption = { value: string; label: string };

/** A control in a dialog. `picks` lists the plan's choices; the others edit `values[name]`. */
export type Field = {
  kind: "text" | "select" | "toggle" | "picks";
  name: string;
  label: string;
  mono?: boolean;
  why?: string;
  placeholder?: string;
  options?: (ctx: DialogContext) => FieldOption[];
};

/** What a dialog is about: the repository shown, and the feature, level, branch, restore targets or worktree its button named. */
export type DialogContext = {
  repo: WireRepoView;
  feature: WireFeature | null;
  level: WireLevel | null;
  branch: string | null;
  targets: RestoreTargetInput[] | null;
  worktree: string | null;
};

export type Heading = { context: string; title: string; summary: string };

/**
 * How one action is asked for: its fields, their first values, and the input the server takes. `heading` is shown
 * until a plan arrives, and for good when `fixed`. `incomplete` names what a form still needs; it is not previewed
 * until it needs nothing.
 */
export type DialogSpec = {
  action: ActionName;
  fields: Field[];
  heading(ctx: DialogContext): Heading;
  fixed?: boolean;
  initial(ctx: DialogContext): FieldValues;
  toInput(values: FieldValues): unknown;
  incomplete?(values: FieldValues): string | null;
};

function text(values: FieldValues, name: string): string {
  const value = values[name];
  return typeof value === "string" ? value : "";
}

function flag(values: FieldValues, name: string): boolean {
  return values[name] === true;
}

function list(values: FieldValues, name: string): string[] {
  const value = values[name];
  return Array.isArray(value) ? value : [];
}

function deepestFirst(feature: WireFeature | null): WireLevel[] {
  return [...(feature?.levels ?? [])].sort((a, b) => b.depth - a.depth);
}

function heading(context: string, title: string, summary = ""): Heading {
  return { context, title, summary };
}

const ENV: Field = { kind: "toggle", name: "env", label: "Copy .env files from main", why: "Ignored .env files from the main checkout. Nothing there is overwritten." };

const restore: DialogSpec = {
  action: "restore",
  fields: [],
  heading: (ctx) => heading(ctx.feature?.name ?? ctx.repo.project.name, `Bring back ${ctx.targets?.map((target) => target.branch).join(", ") ?? "the branch"}`),
  initial: (ctx) => ({
    branches: (ctx.targets ?? []).map((target) => target.branch),
    pins: (ctx.targets ?? []).map((target) => target.pinRef ?? ""),
  }),
  toInput: (values) => {
    const pins = list(values, "pins");
    return { targets: list(values, "branches").map((branch, index) => (pins[index] ? { branch, pinRef: pins[index] } : { branch })) };
  },
};

const ack: DialogSpec = {
  action: "ack",
  fields: [],
  heading: (ctx) => heading(ctx.feature?.name ?? ctx.repo.project.name, `Keep the change on ${ctx.branch ?? "the branch"}`),
  initial: (ctx) => ({ branch: ctx.branch ?? ctx.level?.branch ?? "" }),
  toInput: (values) => ({ branch: text(values, "branch") }),
};

const restack: DialogSpec = {
  action: "restack",
  fields: [
    {
      kind: "toggle",
      name: "stash",
      label: "Set aside my uncommitted changes and put them back after",
      why: "They go back exactly as they are. Without this, a level with uncommitted changes blocks the restack.",
    },
  ],
  heading: (ctx) => heading(ctx.feature?.name ?? ctx.repo.project.name, `Restack ${ctx.feature?.name ?? "the stack"}`),
  initial: (ctx) => ({ feature: ctx.feature?.name ?? ctx.level?.branch ?? "", stash: true }),
  toInput: (values) => ({ feature: text(values, "feature"), stash: flag(values, "stash") }),
};

const newFeature: DialogSpec = {
  action: "new",
  fields: [
    { kind: "text", name: "feature", label: "Feature", placeholder: "gift cards" },
    { kind: "text", name: "branch", label: "First branch", mono: true, placeholder: "Named after the feature" },
    { kind: "select", name: "from", label: "Start from", options: (ctx) => [{ value: ctx.repo.trunk, label: ctx.repo.trunk }] },
    ENV,
    { kind: "toggle", name: "install", label: "Install dependencies", why: "Runs the repo's package manager in the new folder." },
    { kind: "toggle", name: "open", label: "Open in my editor when ready" },
  ],
  heading: (ctx) => heading(ctx.repo.project.name, "Start a new feature", "Creates the first level of a stack in its own folder."),
  fixed: true,
  initial: (ctx) => ({ feature: "", branch: "", from: ctx.repo.trunk, env: true, install: false, open: true }),
  toInput: (values) => {
    const branch = text(values, "branch").trim();
    return {
      feature: text(values, "feature").trim(),
      ...(branch === "" ? {} : { branch }),
      from: text(values, "from"),
      env: flag(values, "env"),
      install: flag(values, "install"),
      open: flag(values, "open"),
    };
  },
  incomplete: (values) => (text(values, "feature").trim() === "" ? "Name the feature." : null),
};

const addLevel: DialogSpec = {
  action: "add-level",
  fields: [
    { kind: "text", name: "branch", label: "Branch", mono: true, placeholder: "feat/next-part" },
    {
      kind: "select",
      name: "on",
      label: "On top of",
      options: (ctx) => deepestFirst(ctx.feature).map((level) => ({ value: level.branch, label: level.number === null ? level.branch : `${level.number} ${level.branch}` })),
    },
    ENV,
  ],
  heading: (ctx) => heading(ctx.feature?.name ?? ctx.repo.project.name, `Add a level to ${ctx.feature?.name ?? "the stack"}`, "A new branch on top of an existing level, in the next numbered folder."),
  fixed: true,
  initial: (ctx) => ({ feature: ctx.feature?.name ?? "", branch: "", on: ctx.level?.branch ?? deepestFirst(ctx.feature)[0]?.branch ?? "", env: true }),
  toInput: (values) => ({ feature: text(values, "feature"), branch: text(values, "branch").trim(), on: text(values, "on"), env: flag(values, "env") }),
  incomplete: (values) => (text(values, "branch").trim() === "" ? "Name the branch." : null),
};

const copyEnv: DialogSpec = {
  action: "copy-env",
  fields: [],
  heading: (ctx) => heading(ctx.feature?.name ?? ctx.repo.project.name, "Copy env files"),
  initial: (ctx) => ({ worktree: ctx.worktree ?? "" }),
  toInput: (values) => ({ worktree: text(values, "worktree") }),
};

const remove: DialogSpec = {
  action: "remove",
  fields: [],
  heading: (ctx) => heading(ctx.feature?.name ?? ctx.repo.project.name, `Clean up ${ctx.level?.branch ?? "the worktree"}`),
  initial: (ctx) => ({ worktree: ctx.worktree ?? "", rescue: true }),
  toInput: (values) => ({ worktree: text(values, "worktree"), rescue: flag(values, "rescue") }),
};

const forget: DialogSpec = {
  action: "forget",
  fields: [],
  heading: (ctx) => {
    const branch = ctx.level?.branch ?? ctx.branch;
    if (ctx.worktree !== null && ctx.worktree !== "") {
      return heading(ctx.feature?.name ?? ctx.repo.project.name, branch === null ? "Forget the worktree" : `Forget ${branch}`, "Drops git's record of a folder that is already gone. The branch stays.");
    }
    return heading(ctx.repo.project.name, "Forget gone worktrees", "Drops git's record of each folder that is already gone. Branches stay.");
  },
  initial: (ctx) => ({
    worktree: ctx.worktree ?? "",
    force: ctx.level?.findings.some((finding) => finding.rule === "prunable" && finding.severity === "loses-work") ?? false,
  }),
  toInput: (values) => {
    const worktree = text(values, "worktree");
    if (worktree === "") return { all: true };
    return flag(values, "force") ? { worktree, force: true } : { worktree };
  },
};

const cleanup: DialogSpec = {
  action: "cleanup",
  fields: [{ kind: "picks", name: "paths", label: "Worktrees" }],
  heading: (ctx) => heading(ctx.repo.project.name, "Clean up worktrees"),
  initial: () => ({}),
  toInput: (values) => (Array.isArray(values["paths"]) ? { paths: values["paths"] } : {}),
};

/**
 * Every action's dialog. A cleanup starts with what grove picks by default, every worktree that is safe; once a pick
 * changes, it sends exactly the picked paths. A new feature leaves an empty branch out, so grove names it after the
 * feature; a restack sets uncommitted changes aside unless that is turned off.
 */
export const DIALOGS: Record<ActionName, DialogSpec> = {
  restore,
  ack,
  restack,
  new: newFeature,
  "add-level": addLevel,
  "copy-env": copyEnv,
  remove,
  cleanup,
  forget,
};
