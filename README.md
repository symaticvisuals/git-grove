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

## The dashboard

```sh
git grove        # the same as: git grove ui
```

`git grove ui` adds the repository you are in, makes sure the dashboard server is running, and opens it in your
browser at the feature of the worktree you are in. Outside a repository it opens the list of repositories. With
`GIT_GROVE_NO_OPEN=1` it prints the address instead of opening it.

The first time, `ui` installs a login service, so the dashboard is there whenever you are logged in:

- macOS: a launchd agent, `~/Library/LaunchAgents/work.grove.server.plist`
- Linux: a systemd user unit, `~/.config/systemd/user/git-grove.service`

The service runs `node <git-grove>/dist/cli/bin.js serve`, starts it again if it fails, and appends its output to
`~/.git-grove/server.log`, which moves to `server.log.1` when the server starts and finds it over 5 MB. `ui` prints
the file it wrote; `git grove service uninstall` unloads it and deletes that file. `npm install` never installs it.
When you update git grove, the next `git grove ui` asks the older server to exit, and the service starts the new
version. When the service runs another copy of git grove, another grove folder, or a Node that is no longer there,
`ui` rewrites it to run this one and says so; run from `npx`, it leaves the service alone and opens its server.

```sh
git grove service install     # write and load the login service
git grove service uninstall   # unload it and delete its file
git grove service status      # whether it is installed and loaded, and where the dashboard runs
git grove serve [--port <n>]  # run the server in this terminal instead, until Ctrl-C
```

Where there is no launchd or systemd user session (a container, or SSH without a user bus), or when git grove runs
from an `npx` cache, `ui` serves in the foreground until Ctrl-C, and `service install` says why and exits 1 without
writing anything.

### As an app

Chrome and Edge offer "Install git grove" in the address bar, which gives the dashboard its own window and dock icon.
"Notify me" in the sidebar turns on system notifications for changes that lose work, while the dashboard is open.

### Security

- The server listens only on `127.0.0.1` and `[::1]`, and answers only a `Host` of `127.0.0.1`, `[::1]` or `localhost` with its port.
- Every API and event request needs the token in `~/.git-grove/token` as an `X-Grove-Token` header. `ui` hands it to the page in the URL's fragment, which is never sent over the network, and the page keeps it in that port's `localStorage`. There is no cookie and no CORS.
- Known limits, accepted on a single-user machine:
  - a program that later listens on a port git grove has served on can read that port's `localStorage`, and with it the token; that is every port grove has served on, up to 20 (47683 to 47702);
  - while the browser opens, the dashboard's address, token included, is briefly visible in the process list to other local users;
  - an installed dashboard app is tied to the port it was installed on, so if git grove moved to another port, run `git grove ui` again;
  - notifications need an open dashboard tab or window.

## Commands

```sh
git grove status [--json]                    # what needs you, then one line per worktree
git grove restore <branch> [<pin-ref>]       # move a branch back to a pin, pinning its current tip first
git grove ack <branch>                       # mark a branch's rewrite or deletion as intended
git grove pins list [<branch>]               # list pins, newest first
git grove check remove <worktree> [--json]   # exit 0 when safe to delete, 3 when not
git grove new <feature> [--branch <b>]       # start a feature: level 01 on the trunk, in .worktrees/<feature>/01-<branch>
git grove add-level <feature> <branch>       # add the next level on the deepest one, or on --on <parent-branch>
git grove restack <feature> [--stash]        # move each level of a stack onto its parent, pinning every tip first
git grove stack plan <feature> [--json]      # show what restack would do, changing nothing
git grove rm <worktree> [--rescue]           # remove a worktree's folder when nothing would be lost, keeping its branch
```

`new` and `add-level` copy the main worktree's env files into the new level (`--skip-env` to skip), and take
`--install` to install dependencies and `--open` to open it in your editor. `rm --rescue` first copies the ignored
files only that worktree has into the main worktree, and checks the copies. `new`, `add-level`, `restack` and `rm`
show their plan and change nothing with `--dry-run`, and print JSON with `--json`.

For example, after an agent squashes `feat/coupon-ui` into one commit:

```sh
git grove status                                   # History rewritten: 3 commits no longer on feat/coupon-ui
git grove restore feat/coupon-ui                   # the three commits are back (or: git grove ack feat/coupon-ui)
git grove check remove .worktrees/old-onboarding   # lists .local/seed.sql and exits 3
git grove rm --rescue .worktrees/old-onboarding    # copies .local/seed.sql into main, then removes the folder
```

`status` journals tip changes from one run to the next, so the first run in a repository only records where every
branch is. Errors print one line on stderr and exit 1; an action blocked by what its plan found exits 3.

## Requirements

- Node.js 24 or newer
- git 2.39 or newer
- a repository with a working tree (bare repositories are not supported yet)
