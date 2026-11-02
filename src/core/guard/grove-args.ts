import { basename } from "node:path";
import type { ShellWord } from "./shell-line.types.js";

const RUNNERS = new Set(["npx", "bunx"]);
const DLX_RUNNERS = new Set(["pnpm", "yarn"]);
const RUNNER_VALUES = new Set(["-p", "--package", "-c", "--call"]);
const PACKAGE = /^(@deepanshugoel\/)?git-grove(@[^/]+)?$/;
const BIN = /(^|\/)git-grove\/dist\/cli\/bin\.js$/;

/**
 * The arguments a command gives git grove when it runs the CLI itself: `git-grove …`, the package through `npx`,
 * `bunx`, `pnpm dlx` or `yarn dlx`, or `node` on a `git-grove/dist/cli/bin.js`. Null for any other command;
 * `git grove …` is a git subcommand and is read there.
 */
export function groveArgs(words: readonly ShellWord[]): ShellWord[] | null {
  const [name, ...rest] = words;
  if (name === undefined) return null;
  const program = basename(name.text);
  if (program === "git-grove") return rest;
  if (program === "node") {
    const script = rest.findIndex((word) => !word.text.startsWith("-"));
    const path = rest[script];
    return path !== undefined && BIN.test(path.text) ? rest.slice(script + 1) : null;
  }
  const args = RUNNERS.has(program) ? rest : DLX_RUNNERS.has(program) && rest[0]?.text === "dlx" ? rest.slice(1) : null;
  if (args === null) return null;
  let at = 0;
  for (let option = args[at]?.text; option?.startsWith("-") === true; option = args[at]?.text) at += RUNNER_VALUES.has(option) ? 2 : 1;
  const pkg = args[at];
  return pkg !== undefined && PACKAGE.test(pkg.text) ? args.slice(at + 1) : null;
}
