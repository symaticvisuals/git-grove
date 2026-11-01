import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { requireGitVersion } from "../core/git/require-git-version.js";
import type { CliIo } from "./cli-io.types.js";
import { ackCommand } from "./commands/ack.js";
import { checkCommand } from "./commands/check.js";
import { pinsCommand } from "./commands/pins.js";
import { restoreCommand } from "./commands/restore.js";
import { statusCommand } from "./commands/status.js";
import { describeError } from "./describe-error.js";
import { runActionCommand } from "./run-action.js";

type Parsed = {
  values: { version?: boolean; help?: boolean; json?: boolean; stash?: boolean; "dry-run"?: boolean };
  positionals: string[];
};

type Flags = { json: boolean; stash: boolean; dryRun: boolean };

type Command = (io: CliIo) => Promise<number>;

const USAGE = `Usage: git grove <command> [options]

  status [--json]                   what needs you, then one line per worktree
  restore <branch> [<pin-ref>]      move a branch back to a pin
  ack <branch>                      mark a branch's rewrite or deletion as intended
  pins list [<branch>]              list pins, newest first
  check remove <worktree> [--json]  exit 0 when safe to remove, 3 when not
  restack <feature> [--stash]       move each level of a stack onto its parent;
          [--dry-run] [--json]        --stash sets uncommitted changes aside
  stack plan <feature> [--json]     show what restack would do, changing nothing
`;

const COMMANDS = new Set(["status", "restore", "ack", "pins", "check", "restack", "stack"]);

function hasVersion(value: unknown): value is { version: string } {
  return typeof value === "object" && value !== null && "version" in value && typeof value.version === "string";
}

function packageVersion(): string {
  const pkg: unknown = createRequire(import.meta.url)("../../package.json");
  if (!hasVersion(pkg)) throw new Error("git-grove: package.json has no version");
  return pkg.version;
}

function isParseError(error: unknown): error is TypeError {
  return error instanceof TypeError && "code" in error && typeof error.code === "string" && error.code.startsWith("ERR_PARSE_ARGS_");
}

function parse(argv: string[]): Parsed {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      json: { type: "boolean" },
      stash: { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
  });
}

function route(positionals: string[], { json, stash, dryRun }: Flags): Command | null {
  const [name, first, second, extra] = positionals;
  if (name === "restack") {
    return first !== undefined && second === undefined
      ? (io) => runActionCommand(io, "restack", { feature: first, stash }, { dryRun, json })
      : null;
  }
  if (stash || dryRun) return null;
  if (name === "stack") {
    return first === "plan" && second !== undefined && extra === undefined
      ? (io) => runActionCommand(io, "restack", { feature: second }, { dryRun: true, json })
      : null;
  }
  if (name === "status") return first === undefined ? (io) => statusCommand(io, { json }) : null;
  if (name === "restore") {
    return first !== undefined && extra === undefined && !json ? (io) => restoreCommand(io, first, second) : null;
  }
  if (name === "ack") return first !== undefined && second === undefined && !json ? (io) => ackCommand(io, first) : null;
  if (name === "pins") return first === "list" && extra === undefined && !json ? (io) => pinsCommand(io, second) : null;
  if (name === "check") {
    return first === "remove" && second !== undefined && extra === undefined
      ? (io) => checkCommand(io, second, { json })
      : null;
  }
  return null;
}

/**
 * Runs the CLI and resolves to the process exit code.
 * Errors a person can act on become one line on stderr and exit 1; anything else is rethrown.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  let args: Parsed;
  try {
    args = parse(argv);
  } catch (error) {
    if (!isParseError(error)) throw error;
    io.err(`git-grove: ${error.message.split(". ")[0] ?? error.message}\n${USAGE}`);
    return 1;
  }

  if (args.values.version) {
    io.out(`git-grove ${packageVersion()}\n`);
    return 0;
  }
  if (args.values.help) {
    io.out(USAGE);
    return 0;
  }

  const { json, stash, "dry-run": dryRun } = args.values;
  const command = route(args.positionals, { json: json === true, stash: stash === true, dryRun: dryRun === true });
  if (command === null) {
    const [name] = args.positionals;
    io.err(name !== undefined && !COMMANDS.has(name) ? `Unknown command: ${name}\n${USAGE}` : USAGE);
    return 1;
  }

  try {
    await requireGitVersion([2, 39]);
    return await command(io);
  } catch (error) {
    const line = describeError(error);
    if (line === null) throw error;
    io.err(`${line}\n`);
    return 1;
  }
}
