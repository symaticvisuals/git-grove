import { basename, resolve } from "node:path";
import type { CommandLine, ShellWord, SimpleCommand } from "./shell-line.types.js";
import { splitShellLine } from "./split-shell-line.js";

type Stripped = { words: ShellWord[]; redirected: boolean };

const PREFIXES = new Set(["if", "then", "elif", "else", "do", "while", "until", "!", "{", "time", "command", "builtin", "exec", "nohup"]);
const CLOSERS = new Set(["}", "fi", "done", "esac"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REDIRECTING = /^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR)=/;
const MENTIONS_GIT_OR_RM = /\b(git|rm)\b/;

function withoutPrefixes(words: readonly ShellWord[]): Stripped {
  let at = 0;
  let redirected = false;
  const assignment = (text: string): boolean => {
    redirected ||= REDIRECTING.test(text);
    return ASSIGNMENT.test(text);
  };
  while (at < words.length) {
    const text = words[at]?.text ?? "";
    if (assignment(text) || PREFIXES.has(text)) at++;
    else if (text === "env") {
      at++;
      while (at < words.length) {
        const option = words[at]?.text ?? "";
        if (option === "-u" || option === "--unset") at += 2;
        else if (option.startsWith("-") || assignment(option)) at++;
        else break;
      }
    } else break;
  }
  return { words: words.slice(at), redirected };
}

function hidesCommands(words: readonly ShellWord[]): boolean {
  const [first, ...rest] = words;
  if (first === undefined) return false;
  if (first.text === "eval") return true;
  if (!SHELLS.has(basename(first.text))) return false;
  const options = rest.filter((word) => word.text.startsWith("-"));
  const readsStdin = options.length === rest.length;
  return readsStdin || options.some((word) => !word.text.startsWith("--") && word.text.includes("c"));
}

function cdTarget(words: readonly ShellWord[], cwd: string | null, home: string): string | null {
  let at = 1;
  while (/^-[LPe@]+$/.test(words[at]?.text ?? "")) at++;
  if (words[at]?.text === "--") at++;
  const operand = words[at];
  if (operand === undefined) return home;
  if (operand.dynamic || operand.glob || operand.text === "-" || cwd === null) return null;
  return resolve(cwd, operand.text);
}

/**
 * Reads a shell command line into its simple commands, each with the folder it runs in: `cwd`, changed by `cd` and
 * `pushd` for the commands after them and restored when a `( … )` subshell ends. A `cd` the guard cannot follow, or a
 * `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` or `GIT_COMMON_DIR` assignment before a command, leaves the folder
 * unknown. Leading assignments, `env` and shell keywords are stripped. A line holding `eval`, or a shell given `-c` or
 * a script on stdin, together with the word `git` or `rm`, is not evaluable, nor is an unreadable one.
 */
export function readSimpleCommands(line: string, cwd: string, home: string): CommandLine {
  const split = splitShellLine(line, home);
  const mentions = MENTIONS_GIT_OR_RM.test(line);
  if (split.unreadable && mentions) return { evaluable: false };

  const commands: SimpleCommand[] = [];
  const outer: (string | null)[] = [];
  let here: string | null = cwd;
  for (const item of split.items) {
    if (item.kind === "open") outer.push(here);
    else if (item.kind === "close") here = outer.length > 0 ? (outer.pop() ?? null) : here;
    else {
      const { words, redirected } = withoutPrefixes(item.words);
      const name = words[0]?.text;
      if (name === undefined || CLOSERS.has(name)) continue;
      if (hidesCommands(words) && mentions) return { evaluable: false };
      if (name === "cd" || name === "pushd") here = cdTarget(words, here, home);
      else if (name === "popd") here = null;
      else commands.push({ words, cwd: redirected ? null : here });
    }
  }
  return { evaluable: true, commands };
}
