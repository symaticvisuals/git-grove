import { expect, test } from "vitest";
import { classifyCommand } from "../../../src/core/guard/classify-command.js";
import type { GuardCheck } from "../../../src/core/guard/guard-check.types.js";
import { readSimpleCommands } from "../../../src/core/guard/read-simple-commands.js";

function checks(line: string, cwd = "/repo"): GuardCheck[] {
  const read = readSimpleCommands(line, cwd, "/home/robin");
  if (!read.evaluable) throw new Error(`not evaluable: ${line}`);
  return read.commands.map(classifyCommand);
}

function check(line: string, cwd = "/repo"): GuardCheck {
  const [first] = checks(line, cwd);
  if (first === undefined) throw new Error(`no command: ${line}`);
  return first;
}

function kinds(lines: string[]): string[] {
  return lines.map((line) => check(line).kind);
}

test("git -C sets the folder, relative to the one before it", () => {
  expect(check("git -C sub reset --hard")).toMatchObject({ kind: "discard", cwd: "/repo/sub" });
  expect(check("git -C a -C b reset --hard")).toMatchObject({ kind: "discard", cwd: "/repo/a/b" });
  expect(check("git -C /elsewhere reset --hard")).toMatchObject({ kind: "discard", cwd: "/elsewhere" });
  expect(check("cd .worktrees && git -C x reset --hard")).toMatchObject({ kind: "discard", cwd: "/repo/.worktrees/x" });
});

test("--no-pager, -c k=v and other global options before the subcommand are skipped", () => {
  expect(check("git --no-pager -c core.pager=less -c user.name=x reset --hard HEAD~1")).toMatchObject({
    kind: "discard",
    cwd: "/repo",
    moveTo: "HEAD~1",
  });
  expect(check("git -P --no-optional-locks commit --amend")).toMatchObject({ kind: "pin", pins: [{ kind: "head" }] });
  expect(kinds(["git --version", "git", "git --help"])).toEqual(["none", "none", "none"]);
});

test("a guarded git command whose folder the guard cannot know is unchecked", () => {
  expect(check("git --git-dir=other/.git reset --hard").kind).toBe("unchecked");
  expect(check("git --work-tree other reset --hard").kind).toBe("unchecked");
  expect(check('git -C "$WT" worktree remove x').kind).toBe("unchecked");
  expect(checks("cd - && git reset --hard && git status").map((each) => each.kind)).toEqual(["unchecked", "none"]);
});

test("git worktree remove names its target, with or without --force", () => {
  expect(check("git worktree remove --force .worktrees/x")).toMatchObject({ kind: "worktree-remove", cwd: "/repo", target: ".worktrees/x" });
  expect(check("git worktree remove -f -f x")).toMatchObject({ kind: "worktree-remove", target: "x" });
  expect(kinds(["git worktree list", "git worktree add y", "git worktree remove"])).toEqual(["none", "none", "none"]);
});

test("rm with -r, -R or --recursive in any combination is a recursive removal", () => {
  for (const line of ["rm -rf x", "rm -fr x", "rm -R x", "rm --recursive x", "rm -r -f x", "rm x -rf", "/bin/rm -Rf x"]) {
    expect(check(line), line).toMatchObject({ kind: "recursive-rm", cwd: "/repo" });
  }
  const many = check("rm -rf -- a -b");
  expect(many.kind === "recursive-rm" ? many.paths.map((path) => path.text) : []).toEqual(["a", "-b"]);
  expect(kinds(["rm x", "rm -f x", "rmdir x", "rm -i x"])).toEqual(["none", "none", "none", "none"]);
  expect(check('rm -rf "$DIR"').kind).toBe("unchecked");
});

test("reset --hard, checkout of paths and restore of the worktree discard changes", () => {
  expect(check("git reset --hard")).toMatchObject({ kind: "discard", side: "all", pathspecs: [], moveTo: null });
  expect(check("git checkout -- .")).toMatchObject({ kind: "discard", side: "unstaged", pathspecs: ["."] });
  expect(check("git checkout .")).toMatchObject({ kind: "discard", side: "unstaged", pathspecs: ["."] });
  expect(check("git checkout HEAD -- a.txt b.txt")).toMatchObject({ kind: "discard", side: "all", pathspecs: ["a.txt", "b.txt"] });
  expect(check("git restore src/a.ts")).toMatchObject({ kind: "discard", side: "unstaged", pathspecs: ["src/a.ts"] });
  expect(check("git restore --source=HEAD~2 a")).toMatchObject({ kind: "discard", side: "unstaged", pathspecs: ["a"] });
  expect(check("git restore -SW a")).toMatchObject({ kind: "discard", side: "all", pathspecs: ["a"] });
  expect(check("git restore -s HEAD --staged --worktree -- a")).toMatchObject({ kind: "discard", side: "all", pathspecs: ["a"] });
});

test("restore of the index only, a new branch and other resets are not discards", () => {
  expect(kinds(["git restore --staged x", "git restore -S x", "git checkout -b new main", "git reset HEAD~1", "git reset --soft HEAD~1", "git restore", "git switch main"])).toEqual(
    ["none", "none", "none", "none", "none", "none", "none"],
  );
});

test("checkout or switch with -f, --force or --discard-changes discards every change in the tree", () => {
  for (const line of ["git checkout -f", "git checkout -f HEAD~1", "git checkout --force --detach", "git switch -f --detach HEAD", "git switch --discard-changes --detach HEAD", "git switch -f main"]) {
    expect(check(line), line).toMatchObject({ kind: "discard", side: "all", scope: "tree", pathspecs: [], moveTo: null });
  }
  expect(check("git checkout -f -- a.txt")).toMatchObject({ kind: "discard", scope: "paths", pathspecs: ["a.txt"] });
});

test("a checkout of operands without -- is left for git to tell a commit from a path", () => {
  expect(check("git checkout a.txt")).toMatchObject({ kind: "checkout-operands", cwd: "/repo", operands: ["a.txt"] });
  expect(check("git checkout main")).toMatchObject({ kind: "checkout-operands", operands: ["main"] });
  expect(check("git checkout HEAD a.txt b.txt")).toMatchObject({ kind: "checkout-operands", operands: ["HEAD", "a.txt", "b.txt"] });
  expect(check('git checkout "$BRANCH"').kind).toBe("unchecked");
  expect(check("git checkout").kind).toBe("none");
});

test("git stash is not guarded, and earns no credit for a later discard; stash drop and clear are allowed for now", () => {
  expect(kinds(["git stash", "git stash push -m wip", "git stash -u", "git stash save wip"])).toEqual(["none", "none", "none", "none"]);
  expect(kinds(["git stash drop", "git stash clear", "git stash pop", "git stash list"])).toEqual(["none", "none", "none", "none"]);
});

test("checkout and restore with --ours, --theirs, -m, --merge or --conflict resolve conflicts and are not discards", () => {
  expect(
    kinds([
      "git checkout --theirs -- a.txt",
      "git checkout --ours .",
      "git checkout -m -- a.txt",
      "git checkout --merge a.txt",
      "git checkout --conflict=diff3 -- a.txt",
      "git restore --theirs a.txt",
      "git restore --ours -- a.txt",
      "git restore -m a.txt",
      "git restore --conflict=merge a.txt",
    ]),
  ).toEqual(["none", "none", "none", "none", "none", "none", "none", "none", "none"]);
});

test("path discards are scoped to their paths, and reset --hard to the whole tree", () => {
  expect(check("git checkout -- a.txt")).toMatchObject({ kind: "discard", scope: "paths" });
  expect(check("git restore a.txt")).toMatchObject({ kind: "discard", scope: "paths" });
  expect(check("git reset --hard")).toMatchObject({ kind: "discard", scope: "tree" });
});

test("rebase and amend pin the current tip, or the branch rebase names", () => {
  expect(check("git rebase main")).toMatchObject({ kind: "pin", pins: [{ kind: "head" }] });
  expect(check("git rebase -i --onto main base feat")).toMatchObject({ kind: "pin", pins: [{ kind: "branch", name: "feat" }] });
  expect(check("git commit --amend --no-edit")).toMatchObject({ kind: "pin", pins: [{ kind: "head" }] });
  expect(kinds(["git rebase --continue", "git rebase --abort", "git rebase --skip", "git commit -m x"])).toEqual(["none", "none", "none", "none"]);
});

test("a forced branch delete pins each named branch", () => {
  expect(check("git branch -D feat old")).toMatchObject({
    kind: "pin",
    pins: [
      { kind: "branch", name: "feat" },
      { kind: "branch", name: "old" },
    ],
  });
  expect(check("git branch -d --force feat")).toMatchObject({ kind: "pin", pins: [{ kind: "branch", name: "feat" }] });
  expect(check("git branch -df feat")).toMatchObject({ kind: "pin", pins: [{ kind: "branch", name: "feat" }] });
  expect(kinds(["git branch -d feat", "git branch -D -r origin/feat", "git branch feat"])).toEqual(["none", "none", "none"]);
});

test("a force push pins the branch it pushes: the current one, or the refspec's source", () => {
  expect(check("git push --force origin feat")).toMatchObject({
    kind: "pin",
    pins: [{ kind: "push", source: "feat", remote: "origin", destination: "feat" }],
  });
  expect(check("git push -f")).toMatchObject({ kind: "pin", pins: [{ kind: "push", source: null, remote: null, destination: null }] });
  expect(check("git push --force-with-lease origin HEAD")).toMatchObject({
    kind: "pin",
    pins: [{ kind: "push", source: null, remote: "origin", destination: null }],
  });
  expect(check("git push origin +feat:main")).toMatchObject({
    kind: "pin",
    pins: [{ kind: "push", source: "feat", remote: "origin", destination: "main" }],
  });
  expect(check("git push -uf origin feat").kind).toBe("pin");
  expect(kinds(["git push origin feat", "git push -f origin :feat"])).toEqual(["none", "none"]);
  expect(check("git push --all --force").kind).toBe("unchecked");
});

test("grove's own ack, pins prune and rm --force are for people", () => {
  expect(kinds(["git grove ack feat", "git grove pins prune", "git grove rm --force .worktrees/x", "git-grove ack feat"])).toEqual([
    "people-only",
    "people-only",
    "people-only",
    "people-only",
  ]);
  expect(kinds(["git grove rm --rescue .worktrees/x", "git grove pins list", "git grove status", "git grove rm .worktrees/x"])).toEqual([
    "none",
    "none",
    "none",
    "none",
  ]);
});

test("grove's people-only commands are seen through npx, pnpm dlx, bunx and node running its bin", () => {
  for (const line of [
    "npx @deepanshugoel/git-grove ack precious",
    "npx -y @deepanshugoel/git-grove@0.2.0 pins prune",
    "npx git-grove ack feat",
    "pnpm dlx @deepanshugoel/git-grove rm --force .worktrees/x",
    "bunx git-grove ack feat",
    "node /usr/local/lib/node_modules/@deepanshugoel/git-grove/dist/cli/bin.js ack feat",
    "node --no-warnings ~/src/git-grove/dist/cli/bin.js pins prune",
  ]) {
    expect(check(line).kind, line).toBe("people-only");
  }
  expect(kinds(["npx @deepanshugoel/git-grove status", "npx prettier --write .", "node scripts/build.mjs ack", "pnpm dlx git-grove rm --rescue x"])).toEqual(["none", "none", "none", "none"]);
});

test("anything else is not guarded", () => {
  expect(kinds(["ls -la", "git status", "git log --oneline", "npm test", "git clean -fdx"])).toEqual(["none", "none", "none", "none", "none"]);
});
