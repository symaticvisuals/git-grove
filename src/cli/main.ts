import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { InvalidInputError } from "../core/actions/invalid-input.error.js";
import { requireGitVersion } from "../core/git/require-git-version.js";
import type { CliIo } from "./cli-io.types.js";
import { ackCommand } from "./commands/ack.js";
import { checkCommand } from "./commands/check.js";
import { pinsCommand } from "./commands/pins.js";
import { restoreCommand } from "./commands/restore.js";
import { serveCommand } from "./commands/serve.js";
import { serviceCommand } from "./commands/service.js";
import { statusCommand } from "./commands/status.js";
import { type UiDeps, uiCommand } from "./commands/ui.js";
import { describeError } from "../core/describe-error.js";
import { packageVersion } from "./package-version.js";
import { realUiDeps } from "./real-ui-deps.js";
import { runActionCommand } from "./run-action.js";

type Parsed = {
  values: {
    version?: boolean;
    help?: boolean;
    json?: boolean;
    stash?: boolean;
    "dry-run"?: boolean;
    branch?: string;
    from?: string;
    on?: string;
    "skip-env"?: boolean;
    install?: boolean;
    open?: boolean;
    rescue?: boolean;
    port?: string;
  };
  positionals: string[];
};

type Flags = {
  json: boolean;
  stash: boolean;
  dryRun: boolean;
  branch: string | undefined;
  from: string | undefined;
  on: string | undefined;
  skipEnv: boolean;
  install: boolean;
  open: boolean;
  rescue: boolean;
  port: string | undefined;
};

type Command = (io: CliIo) => Promise<number>;

const USAGE = `Usage: git grove [<command>] [options]

  ui                                open the dashboard at this worktree's feature,
                                    starting git grove first; the default command
  status [--json]                   what needs you, then one line per worktree
  restore <branch> [<pin-ref>]      move a branch back to a pin
  ack <branch>                      mark a branch's rewrite or deletion as intended
  pins list [<branch>]              list pins, newest first
  check remove <worktree> [--json]  exit 0 when safe to remove, 3 when not
  restack <feature> [--stash]       move each level of a stack onto its parent;
          [--dry-run] [--json]        --stash sets uncommitted changes aside
  stack plan <feature> [--json]     show what restack would do, changing nothing
  new <feature> [--branch <b>]      start a feature: level 01 on the trunk, in
          [--from <trunk>]            .worktrees/<feature>/01-<branch>
          [--skip-env] [--install] [--open] [--dry-run] [--json]
  add-level <feature> <branch>      add the next level, on the deepest one
          [--on <parent-branch>]      or on --on's branch; same options as new
          [--skip-env] [--install] [--open] [--dry-run] [--json]
  rm <worktree> [--rescue]          remove a worktree's folder when nothing would
          [--dry-run] [--json]        be lost, keeping its branch; --rescue first
                                    copies ignored files only it has into main
  serve [--port <n>]                run the dashboard server in the foreground,
                                    on port 47683 or the next free one
  service install|uninstall|status  the login service that keeps the dashboard
                                    server running (launchd or systemd)
`;

const COMMANDS = new Set(["ui", "status", "restore", "ack", "pins", "check", "restack", "stack", "new", "add-level", "rm", "serve", "service"]);

function parsePort(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const port = Number(text);
  if (!/^\d{1,5}$/.test(text) || port > 65535) throw new InvalidInputError("--port must be a whole number from 0 to 65535");
  return port;
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
      branch: { type: "string" },
      from: { type: "string" },
      on: { type: "string" },
      "skip-env": { type: "boolean" },
      install: { type: "boolean" },
      open: { type: "boolean" },
      rescue: { type: "boolean" },
      port: { type: "string" },
    },
  });
}

function isServiceSubcommand(name: string | undefined): name is "install" | "uninstall" | "status" {
  return name === "install" || name === "uninstall" || name === "status";
}

function route(positionals: string[], flags: Flags, deps: () => UiDeps): Command | null {
  const { json, stash, dryRun } = flags;
  const [name, first, second, extra] = positionals;
  const creating = flags.branch !== undefined || flags.from !== undefined || flags.on !== undefined || flags.skipEnv || flags.install || flags.open;
  const options = { dryRun, json };
  const level = { env: !flags.skipEnv, install: flags.install, open: flags.open };
  if (flags.rescue && name !== "rm") return null;
  if (flags.port !== undefined && name !== "serve") return null;
  if (name === "new") {
    return first !== undefined && second === undefined && !stash && flags.on === undefined
      ? (io) => runActionCommand(io, "new", { feature: first, branch: flags.branch, from: flags.from, ...level }, options)
      : null;
  }
  if (name === "add-level") {
    return first !== undefined && second !== undefined && extra === undefined && !stash && flags.branch === undefined && flags.from === undefined
      ? (io) => runActionCommand(io, "add-level", { feature: first, branch: second, on: flags.on, ...level }, options)
      : null;
  }
  if (creating) return null;
  if (name === "rm") {
    return first !== undefined && second === undefined && !stash
      ? (io) => runActionCommand(io, "remove", { worktree: resolve(io.cwd, first), rescue: flags.rescue }, { dryRun, json })
      : null;
  }
  if (name === "restack") {
    return first !== undefined && second === undefined
      ? (io) => runActionCommand(io, "restack", { feature: first, stash }, { dryRun, json })
      : null;
  }
  if (stash || dryRun) return null;
  if (name === undefined || name === "ui") return first === undefined && !json ? (io) => uiCommand(io, deps()) : null;
  if (name === "service") {
    return isServiceSubcommand(first) && second === undefined && !json ? (io) => serviceCommand(io, first, deps()) : null;
  }
  if (name === "serve") return first === undefined && !json ? (io) => serveCommand(io, { port: parsePort(flags.port) }) : null;
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
 * Runs the CLI and resolves to the process exit code; no command at all runs `ui`. `deps` gives `ui` and `service`
 * the login service, the browser and the bin, made only when one of them runs.
 * Errors a person can act on become one line on stderr and exit 1; anything else is rethrown.
 */
export async function run(argv: string[], io: CliIo, deps: () => UiDeps = realUiDeps): Promise<number> {
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

  const { values } = args;
  const command = route(args.positionals, {
    json: values.json === true,
    stash: values.stash === true,
    dryRun: values["dry-run"] === true,
    branch: values.branch,
    from: values.from,
    on: values.on,
    skipEnv: values["skip-env"] === true,
    install: values.install === true,
    open: values.open === true,
    rescue: values.rescue === true,
    port: values.port,
  }, deps);
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
