import { basename } from "node:path";
import { shellWord } from "../actions/shell-word.js";
import type { DiscardScope, DiscardSide, GuardCheck, PinRequest } from "./guard-check.types.js";
import { groveArgs } from "./grove-args.js";
import { type GitCall, parseGitCall } from "./parse-git-call.js";
import { readOptions } from "./read-options.js";
import type { ShellWord, SimpleCommand } from "./shell-line.types.js";

type At = (build: (cwd: string) => GuardCheck) => GuardCheck;

const NONE: GuardCheck = { kind: "none" };
const UNCHECKED: GuardCheck = { kind: "unchecked" };
const HEAD: PinRequest = { kind: "head" };
const SHOWN_LENGTH = 120;
const REBASE_CONTROLS = ["--continue", "--abort", "--skip", "--quit", "--edit-todo", "--show-current-patch"];
const CONFLICT_TOOLS = ["--ours", "--theirs", "-m", "--merge", "--conflict"];

const ACK = "git grove ack marks a rewrite or a deleted branch as intended, and that is for a person to decide. Tell the user what you found instead.";
const PRUNE = "git grove pins prune deletes pins, which may hold the only copy of some commits, and that is for a person to decide. Ask the user to run it.";

function shown(words: readonly ShellWord[]): string {
  const text = words.map((word) => shellWord(word.text)).join(" ");
  return text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH - 1)}…` : text;
}

function anyDynamic(words: readonly ShellWord[]): boolean {
  return words.some((word) => word.dynamic);
}

function hasAny(options: ReadonlySet<string>, names: readonly string[]): boolean {
  return names.some((name) => options.has(name));
}

function texts(words: readonly ShellWord[]): string[] {
  return words.map((word) => word.text);
}

function peopleOnly(cwd: string | null, verb: string, why: string): GuardCheck {
  return { kind: "people-only", cwd, verb, message: `git grove blocked: ${why}` };
}

function grove(args: readonly ShellWord[], cwd: string | null): GuardCheck {
  const [command, ...rest] = args;
  if (command?.text === "ack") return peopleOnly(cwd, "git grove ack", ACK);
  if (command?.text === "pins" && rest[0]?.text === "prune") return peopleOnly(cwd, "git grove pins prune", PRUNE);
  if (command?.text !== "rm") return NONE;
  const read = readOptions(rest);
  if (!hasAny(read.options, ["--force", "-f"])) return NONE;
  const path = read.operands[0]?.text;
  const rescue = path === undefined ? "git grove rm --rescue <worktree>" : `git grove rm --rescue ${shellWord(path)}`;
  return peopleOnly(
    cwd,
    "git grove rm --force",
    `git grove rm --force removes a worktree that holds work, and that is for a person to decide. To keep its ignored files and remove it, run: ${rescue}`,
  );
}

function recursiveRm(args: readonly ShellWord[], cwd: string | null, text: string): GuardCheck {
  const read = readOptions(args);
  if (!hasAny(read.options, ["-r", "-R", "--recursive"])) return NONE;
  const paths = [...read.operands, ...(read.afterDashes ?? [])];
  if (paths.length === 0) return NONE;
  if (cwd === null || anyDynamic(paths)) return UNCHECKED;
  return { kind: "recursive-rm", cwd, verb: "rm -r", text, paths };
}

type Discard = { verb: string; text: string; side: DiscardSide; scope: DiscardScope; pathspecs: readonly ShellWord[]; moveTo?: ShellWord };

function discard(at: At, { verb, text, side, scope, pathspecs, moveTo }: Discard): GuardCheck {
  if (anyDynamic(pathspecs) || moveTo?.dynamic) return UNCHECKED;
  return at((cwd) => ({ kind: "discard", cwd, verb, text, side, scope, pathspecs: texts(pathspecs), moveTo: moveTo?.text ?? null }));
}

function discardTree(at: At, verb: string, text: string): GuardCheck {
  return discard(at, { verb, text, side: "all", scope: "tree", pathspecs: [] });
}

function pin(at: At, verb: string, text: string, names: readonly ShellWord[], pins: PinRequest[]): GuardCheck {
  if (anyDynamic(names)) return UNCHECKED;
  return at((cwd) => ({ kind: "pin", cwd, verb, text, pins }));
}

function checkout(at: At, args: readonly ShellWord[], text: string): GuardCheck {
  const read = readOptions(args, new Set(["-b", "-B", "--orphan"]));
  if (hasAny(read.options, [...CONFLICT_TOOLS, "-b", "-B", "--orphan", "-p", "--patch"])) return NONE;
  const verb = "git checkout";
  const fromFile = read.options.has("--pathspec-from-file");
  if (read.afterDashes !== null || fromFile) {
    const pathspecs = read.afterDashes ?? [];
    if (pathspecs.length === 0 && !fromFile) return NONE;
    return discard(at, { verb, text, side: read.operands.length > 0 ? "all" : "unstaged", scope: "paths", pathspecs });
  }
  if (hasAny(read.options, ["-f", "--force"])) return discardTree(at, verb, text);
  if (read.options.has("--detach") || read.operands.length === 0) return NONE;
  if (read.operands.some((word) => word.text === ".")) {
    const [first, ...rest] = read.operands;
    const fromTree = first !== undefined && first.text !== "." && rest.length > 0;
    return discard(at, { verb, text, side: fromTree ? "all" : "unstaged", scope: "paths", pathspecs: fromTree ? rest : read.operands });
  }
  if (anyDynamic(read.operands)) return UNCHECKED;
  const operands = texts(read.operands);
  return at((cwd) => ({ kind: "checkout-operands", cwd, verb, text, operands }));
}

function restore(at: At, args: readonly ShellWord[], text: string): GuardCheck {
  const read = readOptions(args, new Set(["-s", "--source"]));
  if (hasAny(read.options, [...CONFLICT_TOOLS, "-p", "--patch"])) return NONE;
  const staged = hasAny(read.options, ["-S", "--staged"]);
  if (staged && !hasAny(read.options, ["-W", "--worktree"])) return NONE;
  const pathspecs = [...read.operands, ...(read.afterDashes ?? [])];
  if (pathspecs.length === 0 && !read.options.has("--pathspec-from-file")) return NONE;
  return discard(at, { verb: "git restore", text, side: staged ? "all" : "unstaged", scope: "paths", pathspecs });
}

function rebase(at: At, args: readonly ShellWord[], text: string): GuardCheck {
  const read = readOptions(args, new Set(["--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec"]));
  if (hasAny(read.options, REBASE_CONTROLS)) return NONE;
  const branch = read.options.has("--root") ? read.operands[0] : read.operands[1];
  return pin(at, "git rebase", text, branch === undefined ? [] : [branch], [branch === undefined ? HEAD : { kind: "branch", name: branch.text }]);
}

function branchDelete(at: At, args: readonly ShellWord[], text: string): GuardCheck {
  const read = readOptions(args);
  const { options } = read;
  const forced = options.has("-D") || (hasAny(options, ["-d", "--delete"]) && hasAny(options, ["-f", "--force"]));
  if (!forced || hasAny(options, ["-r", "--remotes"])) return NONE;
  const names = [...read.operands, ...(read.afterDashes ?? [])];
  if (names.length === 0) return NONE;
  return pin(at, "git branch -D", text, names, names.map((name) => ({ kind: "branch", name: name.text })));
}

function forcePush(at: At, args: readonly ShellWord[], text: string): GuardCheck {
  const read = readOptions(args, new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]));
  const [remote, ...refspecs] = read.operands;
  const forced = hasAny(read.options, ["-f", "--force", "--force-with-lease"]) || refspecs.some((refspec) => refspec.text.startsWith("+"));
  if (!forced) return NONE;
  if (hasAny(read.options, ["--all", "--mirror", "--branches"]) || anyDynamic(read.operands)) return UNCHECKED;
  const pins: PinRequest[] = [];
  if (refspecs.length === 0) pins.push({ kind: "push", source: null, remote: remote?.text ?? null, destination: null });
  for (const refspec of refspecs) {
    const spec = refspec.text.replace(/^\+/, "");
    const colon = spec.indexOf(":");
    const source = colon === -1 ? spec : spec.slice(0, colon);
    if (source === "") continue;
    const local = source === "HEAD" ? null : source;
    pins.push({ kind: "push", source: local, remote: remote?.text ?? null, destination: colon === -1 ? local : spec.slice(colon + 1) });
  }
  return pins.length === 0 ? NONE : pin(at, "git push --force", text, [], pins);
}

function git(call: GitCall, text: string): GuardCheck {
  const at: At = (build) => (call.cwd === null ? UNCHECKED : build(call.cwd));
  const { args } = call;
  switch (call.subcommand) {
    case "grove":
      return grove(args, call.cwd);
    case "worktree": {
      if (args[0]?.text !== "remove") return NONE;
      const read = readOptions(args.slice(1));
      const target = [...read.operands, ...(read.afterDashes ?? [])][0];
      if (target === undefined) return NONE;
      if (target.dynamic) return UNCHECKED;
      return at((cwd) => ({ kind: "worktree-remove", cwd, verb: "git worktree remove", text, target: target.text }));
    }
    case "reset": {
      const read = readOptions(args);
      const moveTo = read.operands[0];
      return read.options.has("--hard") ? discard(at, { verb: "git reset --hard", text, side: "all", scope: "tree", pathspecs: [], ...(moveTo === undefined ? {} : { moveTo }) }) : NONE;
    }
    case "checkout":
      return checkout(at, args, text);
    case "restore":
      return restore(at, args, text);
    case "switch": {
      const forced = hasAny(readOptions(args, new Set(["-c", "-C", "--orphan"])).options, ["-f", "--force", "--discard-changes"]);
      return forced ? discardTree(at, "git switch", text) : NONE;
    }
    case "rebase":
      return rebase(at, args, text);
    case "commit":
      return readOptions(args).options.has("--amend") ? pin(at, "git commit --amend", text, [], [HEAD]) : NONE;
    case "branch":
      return branchDelete(at, args, text);
    case "push":
      return forcePush(at, args, text);
    default:
      return NONE;
  }
}

/**
 * Decides what one simple command needs checked before it runs, from its words alone: a worktree removal, a
 * recursive `rm`, a command that discards uncommitted changes, a `checkout` whose operands git must sort into a
 * commit and paths, one whose tips should be pinned first, or one of grove's own commands that only a person may
 * run, however git grove is started. A guarded command whose folder or arguments the guard cannot know is `unchecked`.
 */
export function classifyCommand(command: SimpleCommand): GuardCheck {
  const [name, ...rest] = command.words;
  if (name === undefined) return NONE;
  const program = basename(name.text);
  if (program === "rm") return recursiveRm(rest, command.cwd, shown(command.words));
  const direct = groveArgs(command.words);
  if (direct !== null) return grove(direct, command.cwd);
  if (program !== "git") return NONE;
  const call = parseGitCall(rest, command.cwd);
  return call === null ? NONE : git(call, shown(command.words));
}
