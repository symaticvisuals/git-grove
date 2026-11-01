import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { GitVersionError } from "../core/git/git-version.error.js";
import { requireGitVersion } from "../core/git/require-git-version.js";

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
}

const USAGE = "Usage: git grove <command> [options]\n";

function packageVersion(): string {
  const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };
  return pkg.version;
}

/**
 * Runs the CLI and resolves to the process exit code.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { version: { type: "boolean" }, help: { type: "boolean", short: "h" } },
  });

  if (values.version) {
    io.out(`git-grove ${packageVersion()}\n`);
    return 0;
  }

  try {
    await requireGitVersion([2, 38]);
  } catch (error) {
    if (error instanceof GitVersionError) {
      io.err(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  if (values.help) {
    io.out(USAGE);
    return 0;
  }

  io.err(positionals.length > 0 ? `Unknown command: ${positionals[0]}\n${USAGE}` : USAGE);
  return 1;
}
