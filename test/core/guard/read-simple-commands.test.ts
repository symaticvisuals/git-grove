import { expect, test } from "vitest";
import { readSimpleCommands } from "../../../src/core/guard/read-simple-commands.js";
import type { SimpleCommand } from "../../../src/core/guard/shell-line.types.js";

const HOME = "/home/robin";

function commands(line: string, cwd = "/repo"): SimpleCommand[] {
  const read = readSimpleCommands(line, cwd, HOME);
  if (!read.evaluable) throw new Error(`not evaluable: ${line}`);
  return read.commands;
}

function argvs(line: string, cwd = "/repo"): string[][] {
  return commands(line, cwd).map((command) => command.words.map((word) => word.text));
}

function cwds(line: string, cwd = "/repo"): (string | null)[] {
  return commands(line, cwd).map((command) => command.cwd);
}

test("&&, ;, ||, |, & and newlines each end a command", () => {
  expect(argvs("git status && git log; ls || pwd | wc -l\necho hi & echo bye")).toEqual([
    ["git", "status"],
    ["git", "log"],
    ["ls"],
    ["pwd"],
    ["wc", "-l"],
    ["echo", "hi"],
    ["echo", "bye"],
  ]);
});

test("separators inside quotes stay part of the word", () => {
  expect(argvs(`git commit -m "fix: a && b; c | d" && git push`)).toEqual([
    ["git", "commit", "-m", "fix: a && b; c | d"],
    ["git", "push"],
  ]);
  expect(argvs(`git commit -m 'one;two'`)).toEqual([["git", "commit", "-m", "one;two"]]);
});

test("single quotes, double quotes and backslashes read as the shell reads them", () => {
  expect(argvs(`echo 'it'\\''s' "a \\"b\\" \\$c \\x" my\\ folder ''`)).toEqual([["echo", "it's", 'a "b" $c \\x', "my folder", ""]]);
  expect(argvs("git status \\\n  --short")).toEqual([["git", "status", "--short"]]);
});

test("leading VAR=value assignments and env are stripped", () => {
  expect(argvs(`FOO=1 BAR="a b" git reset --hard`)).toEqual([["git", "reset", "--hard"]]);
  expect(argvs("env GIT_EDITOR=true git rebase main")).toEqual([["git", "rebase", "main"]]);
  expect(argvs("FOO=1")).toEqual([]);
});

test("shell keywords before a command are stripped", () => {
  expect(argvs("if git diff --quiet; then git reset --hard; fi")).toEqual([
    ["git", "diff", "--quiet"],
    ["git", "reset", "--hard"],
  ]);
  expect(argvs("{ git status; }")).toEqual([["git", "status"]]);
});

test("cd changes the folder of the commands after it", () => {
  expect(cwds("cd .worktrees && rm -rf x; ls")).toEqual(["/repo/.worktrees", "/repo/.worktrees"]);
  expect(cwds("cd /tmp; ls")).toEqual(["/tmp"]);
  expect(cwds("cd .. && git status", "/repo/.worktrees/a")).toEqual(["/repo/.worktrees"]);
  expect(cwds("cd ../b && cd ../.. && git status", "/repo/.worktrees/a")).toEqual(["/repo"]);
  expect(cwds("cd -P sub && git status")).toEqual(["/repo/sub"]);
});

test("cd alone, cd ~ and $HOME lead home", () => {
  expect(cwds("cd && ls")).toEqual([HOME]);
  expect(cwds("cd ~ && ls")).toEqual([HOME]);
  expect(cwds("cd ~/code && ls")).toEqual([`${HOME}/code`]);
  expect(cwds("cd $HOME/code && ls")).toEqual([`${HOME}/code`]);
  expect(cwds('cd "${HOME}" && ls')).toEqual([HOME]);
});

test("a cd the guard cannot follow leaves the folder unknown", () => {
  expect(cwds("cd - && git status")).toEqual([null]);
  expect(cwds('cd "$WORKTREE" && git status')).toEqual([null]);
  expect(cwds("popd && git status")).toEqual([null]);
});

test("a cd inside parentheses ends with the subshell", () => {
  expect(cwds("(cd sub && git status) && git log")).toEqual(["/repo/sub", "/repo"]);
  expect(cwds("(cd /tmp) && rm -rf .worktrees/x")).toEqual(["/repo"]);
});

test("comments, redirections and here-document bodies are not commands", () => {
  expect(argvs("git status # && git reset --hard")).toEqual([["git", "status"]]);
  expect(argvs("git status > out.txt 2>&1 && rm -rf x 2>/dev/null")).toEqual([
    ["git", "status"],
    ["rm", "-rf", "x"],
  ]);
  expect(argvs("git log &> log.txt < /dev/null")).toEqual([["git", "log"]]);
  expect(argvs("cat > notes.md <<'EOF'\ngit reset --hard\nrm -rf .worktrees\nEOF\ngit status")).toEqual([
    ["cat"],
    ["git", "status"],
  ]);
  expect(argvs("cat <<-END\n\tgit reset --hard\n\tEND\nls")).toEqual([["cat"], ["ls"]]);
});

test("a word with an expansion is dynamic and one with an unquoted glob is a glob", () => {
  const [rm] = commands('rm -rf "$DIR" .worktrees/* ".worktrees/*" ~/x');
  expect(rm?.words.map(({ text, dynamic, glob }) => ({ text, dynamic, glob }))).toEqual([
    { text: "rm", dynamic: false, glob: false },
    { text: "-rf", dynamic: false, glob: false },
    { text: "$DIR", dynamic: true, glob: false },
    { text: ".worktrees/*", dynamic: false, glob: true },
    { text: ".worktrees/*", dynamic: false, glob: false },
    { text: `${HOME}/x`, dynamic: false, glob: false },
  ]);
});

test("$(, backticks, eval and bash -c or sh -c with git or rm cannot be evaluated", () => {
  for (const line of [
    "git log $(git merge-base main HEAD)..HEAD",
    "rm -rf `ls -d .worktrees/*`",
    'git commit -m "$(cat msg.txt)"',
    "eval git reset --hard",
    'bash -c "git reset --hard"',
    "sh -c 'rm -rf .worktrees'",
    "bash -lc 'git worktree remove x'",
    "diff <(git show a:f) <(git show b:f)",
    "echo 'git reset --hard' | sh",
  ]) {
    expect(readSimpleCommands(line, "/repo", HOME), line).toEqual({ evaluable: false });
  }
});

test("substitutions and shells without git or rm are evaluated", () => {
  expect(readSimpleCommands("echo $(date) && ls", "/repo", HOME).evaluable).toBe(true);
  expect(argvs("bash -c 'npm test' && ls")).toEqual([["bash", "-c", "npm test"], ["ls"]]);
  expect(argvs("bash scripts/build.sh && git status")).toEqual([
    ["bash", "scripts/build.sh"],
    ["git", "status"],
  ]);
});
