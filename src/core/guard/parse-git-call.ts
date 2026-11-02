import { resolve } from "node:path";
import type { ShellWord } from "./shell-line.types.js";

/** A git invocation: the folder it acts in (null when the guard cannot know it), its subcommand and that one's words. */
export type GitCall = { cwd: string | null; subcommand: string; args: ShellWord[] };

const TAKES_VALUE = new Set(["-C", "-c", "--config-env", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--attr-source"]);
const REDIRECTS = ["--git-dir", "--work-tree", "--namespace", "--bare"];

/**
 * Reads the words after `git` up to its subcommand: `-C <dir>` moves the folder, relative to the one before it;
 * `-c k=v`, `--no-pager` and other global options are skipped; `--git-dir`, `--work-tree`, `--namespace` and `--bare`
 * leave the folder unknown. Returns null when no subcommand follows, as in `git --version`.
 */
export function parseGitCall(words: readonly ShellWord[], cwd: string | null): GitCall | null {
  let here = cwd;
  let at = 0;
  for (let word = words[at]; word !== undefined && word.text.startsWith("-"); word = words[at]) {
    const name = word.text.split("=")[0] ?? word.text;
    if (REDIRECTS.includes(name)) here = null;
    if (word.text === "-C") {
      const dir = words[at + 1];
      here = dir === undefined || dir.dynamic || here === null ? null : resolve(here, dir.text);
    }
    at += TAKES_VALUE.has(word.text) ? 2 : 1;
  }
  const subcommand = words[at];
  if (subcommand === undefined) return null;
  return { cwd: subcommand.dynamic ? null : here, subcommand: subcommand.text, args: words.slice(at + 1) };
}
