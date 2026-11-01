# git-grove

git-grove watches the worktrees and stacked branches of a repository and tells you when work is about to be lost:
a branch whose history was rewritten, a merged worktree that still holds files found nowhere else.
It pins every old tip it sees replaced, so a squash or a bad reset can be undone.

## Install

Run it once without installing:

```sh
npx git-grove status
```

Or install it globally, after which git picks it up as `git grove`:

```sh
npm i -g git-grove
git grove status
```

## Commands

```sh
git grove status [--json]                    # what needs you, then one line per worktree
git grove restore <branch> [<pin-ref>]       # move a branch back to a pin, pinning its current tip first
git grove pins list [<branch>]               # list pins, newest first
git grove check remove <worktree> [--json]   # exit 0 when safe to delete, 3 when not
```

For example, after an agent squashes `feat/coupon-ui` into one commit:

```sh
git grove status                                   # History rewritten: 3 commit(s) no longer on feat/coupon-ui
git grove restore feat/coupon-ui                   # the three commits are back
git grove check remove .worktrees/old-onboarding   # lists .local/seed.sql and exits 3
```

`status` journals tip changes from one run to the next, so the first run in a repository only records where every
branch is. Errors print one line on stderr and exit 1.

## Requirements

- Node.js 24 or newer
- git 2.38 or newer
