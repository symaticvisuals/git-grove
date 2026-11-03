---
name: git-grove
description: Use when removing a git worktree, running rm -r on a folder that holds worktrees, deleting a branch, rebasing or restacking stacked branches, force pushing, or when a command was blocked by git grove's guard.
---

# Working with git grove

This machine runs git grove's agent guard. It reads each Bash command before it runs and blocks the ones that would
lose work. This skill says what to do around it.

## Before removing a worktree

Run `git grove check remove <path>` first. It prints the same verdict the guard uses. Remove the worktree only when the
verdict says it is safe.

## A worktree that holds ignored files

Ignored files (local config, seed data) exist only in that worktree. Use `git grove rm --rescue <path>`: it copies them
into the main worktree, checks the copies, then removes the worktree.

## A worktree whose folder is already gone

When the folder was deleted but git still lists the worktree, use `git grove forget <path>`. It drops git's record and
keeps the branch, and it refuses a folder that is still there.

## When the guard blocks a command

A blocked command exits 2 and prints a reason and a safe alternative. Do not work around it, by another spelling, a
script or another tool. Tell the user what the guard said. If it gives a command to run, run that command.

## Uncommitted changes

`git reset --hard`, `git checkout -f`, `git checkout <paths>` and `git restore <paths>` are blocked while they would
discard uncommitted changes. Keep the changes first: run `git stash` (or `git stash push -- <paths>`) on its own, then
retry. During a merge or rebase, use the `--abort` the message names, or name only the conflicted paths.

## Pins

Before `git rebase`, `git commit --amend`, `git branch -D`, `git push --force` and a `git reset --hard <rev>` that moves
the branch, grove pins the tips they could lose. A pin is a ref that keeps the old commits reachable.
`git grove restore <branch>` moves the branch back to a pin. It lists the branch's newest pins when you do not name one.

## People-only commands

Never run `git grove ack`, `git grove pins prune` or `git grove rm --force`. Those decisions are for people, and the
guard blocks them, also through `npx`, `pnpm dlx`, `bunx` or `node <git-grove>/dist/cli/bin.js`.
