# git-grove

On a client project I keep 4–10 git worktrees open, several with AI coding agents in them, and ship features as
stacks of small PRs. In two months three things went wrong, and git reported success each time: a stack branch went
from 16 commits to 1 in a rebase nobody meant to run; an agent's cleanup of merged worktrees deleted ignored files
that existed only there; and a stacking tool came one command away from force-pushing other features' branches.
While designing this I reproduced a fourth: a plain `git worktree remove` of one level deletes a nested level's
uncommitted file with it. git-grove watches every worktree and stack, pins each branch tip it sees replaced, tells a
rebase from a squash, and refuses to remove a worktree that holds the only copy of something. As a Claude Code hook,
it stops an agent's command that would lose work before it runs.

![The dashboard after an agent squashed a stack level: the level reads History rewritten, its three commits are pinned, and a merged worktree is flagged as not safe to remove](docs/screenshots/dashboard-rewrite.png)

## Try it in two minutes

```sh
pnpm install && pnpm build && pnpm demo
```

`scripts/demo.sh` builds a throwaway repository with a three-level stack in a temp folder. It squashes one level the
way an agent might, and leaves a merged worktree holding the only copy of an ignored `.local/seed.sql`. Then
`git grove status` reports both, `git grove check remove` refuses the worktree with exit 3, the agent guard blocks a
`git worktree remove --force` of it with exit 2, and `restore` and `rm --rescue` put things right. The demo uses its
own temp `GIT_GROVE_HOME`, `HOME`, `CLAUDE_CONFIG_DIR` and git config, installs nothing and needs no network. At the
end it prints how to open the dashboard on the same repository, with the same temp folders, so an agent guard
installed there goes into the demo's own Claude Code settings.

## Install

```sh
npm i -g @deepanshugoel/git-grove
git grove status
```

The package installs one command, `git-grove`, which git runs as `git grove`. To try it without installing:

```sh
npx @deepanshugoel/git-grove status
```

From a clone of this repository instead:

```sh
pnpm install && pnpm build && npm link
```

## Agents

AI coding agents run git in many worktrees at once, and the commands that lose work succeed quietly. The agent guard
is a Claude Code `PreToolUse` hook that reads each Bash command before it runs, through `&&`, `;`, `|`, quotes, `cd`,
`git -C`, and the commands inside `$( … )` and backticks (except those inside `${…}`, a `$((…) )` subshell or an
unquoted here-document body, listed under "Not yet"):

- `git worktree remove [--force]` is blocked unless the worktree is safe to remove, whether it is named by path or,
  as git allows, by its folder name alone. That is the verdict `git grove check remove` prints. `rm -r` of a worktree,
  or of a folder holding one, is blocked the same way when the folder belongs to the repository you are in or to the
  one the path is in. A folder that holds the main worktree is always blocked.
- `git reset --hard`, `git checkout -f`, `git switch -f` or `--discard-changes`, `git checkout [<commit>] <paths>`
  (with or without `--`), `git checkout .` and `git restore <paths>` are blocked while there are uncommitted changes
  they would discard. To keep them, run `git stash` (or `git stash push -- <paths>`) on its own first, then retry.
  During a merge, rebase, cherry-pick or revert, a blocked `reset --hard` or `checkout -f` names the `--abort` that
  keeps your own changes instead, and a blocked path discard says to name only the conflicted paths. Git's conflict
  tools, `--ours`, `--theirs`, `-m` and `--conflict`, are allowed on conflicted paths; on other paths they are checked
  like any discard.
- `git grove ack`, `git grove pins prune` and `git grove rm --force` are blocked, because those decisions are for
  people, also when run through `npx`, `pnpm dlx`, `bunx` or `node <git-grove>/dist/cli/bin.js`.
  `git grove rm --rescue` runs.
- `git rebase`, `git commit --amend`, `git branch -D`, `git push --force` and a `git reset --hard <rev>` that moves
  the branch run after grove pins the tips they could lose. For a force push, that is the remote tip it replaces.
- Everything else runs untouched.

A blocked command exits 2. Claude reads the reason and the safe alternative:

```
git grove blocked: .worktrees/old-onboarding is not safe to remove: it holds 1 ignored file that exists only here (.local/seed.sql).
Run: git grove rm --rescue .worktrees/old-onboarding
```

To set it up, install git grove globally and open the dashboard:

```sh
npm i -g @deepanshugoel/git-grove
git grove ui
```

While the guard is not installed, or points at an old Node or grove path, the projects page shows a card, "Protect
worktrees from Claude Code", with Install… and Not now. Not now is remembered in the browser for that state, so a
guard that later goes out of date shows the card once more. Install… opens the same kind of review as every other
dashboard change: the settings file it writes, the backup it keeps, the exact JSON group it adds to
`hooks.PreToolUse`, and that your other settings and hooks are kept. The sidebar says "Agent guard on" or "Agent guard
off" and opens the same dialog, and ⌘K offers "Install agent guard" and "Uninstall agent guard".

grove writes Claude Code's settings only when you confirm a review that shows exactly what changes. It keeps a backup,
and Undo or Uninstall removes only grove's entry:

- It writes your user settings, `~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json` when that variable
  is set, so one install covers every repository. The login service carries `CLAUDE_CONFIG_DIR` from the shell that
  ran `git grove ui`, and `ui` says so when the running server and your shell would use different files. The dialog
  always shows the full path.
- It adds one group of its own, `{ "matcher": "Bash", "hooks": [{ "type": "command", "command": …, "timeout": 10 }] }`,
  and never merges into a `Bash` group of yours. grove's entry is a hook whose command ends in
  `/dist/cli/bin.js guard --claude` or names `git-grove` or `git grove` before `guard --claude`, under any matcher
  that matches Bash (`Bash`, `*`, none, or a list naming it). A stale one is replaced; two become one. Other hooks,
  in the same group or not, are kept.
- It reads the file again when you confirm and refuses if it changed since the review. It writes the new text to a
  temp file in the same folder with the old file's mode (0600 for a new file), checks the file once more, copies the
  old bytes to `settings.json.grove-backup`, and renames the new file into place. The first time grove changes an
  existing file it also keeps it as `settings.json.grove-original`, which it never overwrites. A failure before the
  rename leaves the file and the earlier copies as they were. A symbolic link stays a link.
- The receipt carries Undo, an uninstall planned against the file as it is then, so edits you made since survive.
  After an update the receipt offers Uninstall instead, since the old hook is not worth putting back. Uninstall
  removes grove's hook, and a group, `PreToolUse` list or `hooks` object only when that left it empty.
- Settings files are strict JSON. grove never rewrites one that does not parse, is not an object, or has a `hooks` or
  `hooks.PreToolUse` of the wrong type, nor one that is read-only, starts with a byte-order mark, is a link to a
  missing file, or holds a number it cannot write back exactly: the card and the dialog say grove will not edit it.
  When it does parse but is not laid out as 2-space JSON, the review says grove rewrites it with 2-space indentation.
- Claude Code watches its settings files, so running sessions normally pick the hook up and new sessions always do.
  When your settings set `"disableAllHooks": true`, the hook will not run unless a project turns hooks back on, and
  the card and the dialog say so.

![The projects page with the agent guard card: Protect worktrees from Claude Code, Not now and Install…](docs/screenshots/guard-card.png)

If you would rather paste it yourself, `git grove install-guard` prints the same block and changes no file. Either
way the hook runs `<node> <git-grove>/dist/cli/bin.js guard --claude` by absolute path, so it does not depend on
`PATH`, with a 10 s timeout. The Node it names is the `node` on your `PATH`, or else `/opt/homebrew/bin/node`,
`/usr/local/bin/node` or `/usr/bin/node`, that is the running one, rather than a versioned folder; after you change
Node versions, the card offers Update…, or run `install-guard` again. Both refuse to set it up from an `npx`,
`pnpm dlx`, `bunx` or `yarn dlx` cache, which may be cleared.

The guard fails open. When grove cannot check a command (input it cannot read, a git error, a repository it does not
support, or a check that takes more than 3 s, whose git calls it then stops), it allows the command and prints one
line saying why. A command whose own paths or folder the guard cannot know, because they come from a variable, a
`$( … )`, a glob `cd` or a `GIT_DIR`-style prefix, is allowed with `git grove cannot check this command`, as is a whole
line that runs `eval` or `bash -c` around `git` or `rm`, leaves a `$(` unclosed, or holds a `case` inside a
`$( … )`. Blocks and the pins the guard
takes appear in the dashboard's activity, for repositories grove already knows, the next time it loads the activity.

The guard runs git before you approve the command, so it never lets a repository's own config run anything: its git
calls run with `core.fsmonitor` off and no hooks. A command in a bare repository grove does not watch, such as one a
clone carries inside its files, is allowed unchecked, because its config came with the clone; once grove watches that
repository, its commands are checked like any other.

So that agents know what the guard expects, add this to your `CLAUDE.md`:

```md
## git grove
This machine runs git grove's agent guard. Before removing a worktree, run `git grove check remove <path>`. To remove
one that holds ignored files, use `git grove rm --rescue <path>`. If the guard blocks a command, do not work around
it: tell me what it said. Never run `git grove ack`, `git grove pins prune` or `git grove rm --force`.
```

Known limit: the guard sees only the commands Claude Code runs through its Bash tool. A command inside a script that
Claude runs, a git alias, a wrapper such as `xargs`, `find -exec`, `sudo` or `timeout`, another agent's tool and your
own terminal are not checked. For those, the watcher still pins every branch tip it sees replaced. "Not yet" below
lists the commands the guard reads but does not check yet.

## How it works

```mermaid
flowchart LR
  watcher["Watcher<br/>fs.watch + 30 s poll"]
  cli["CLI<br/>git grove ..."]
  dash["Dashboard<br/>local server + SSE"]
  guard["Agent guard<br/>Claude Code hook"]
  subgraph core["Shared core: src/core"]
    facts["Facts<br/>read-only git"] --> classifier["Classifier<br/>journal of tip changes"] --> rules["Rules<br/>findings"]
    actions["Actions<br/>plan, check, pin, run, receipt"]
  end
  watcher --> core
  cli --> core
  dash --> core
  guard --> core
  core --> pins[("Pins<br/>refs/grove/pins/...")]
  core --> db[("SQLite<br/>journal, acks, activity")]
```

There are four ways in: the watcher inside the dashboard server, the CLI, the dashboard and the agent guard. All of
them call the same core, so the CLI, the dashboard and the guard cannot disagree.

- Facts are what git says, read with `--no-optional-locks`: worktrees, branch tips, gh-stack's stack config,
  stashes, pins and each worktree's status.
- The classifier compares every branch tip with the last one it journaled. A move that is not a fast-forward pins
  the old tip first, then matches the branch's own commits by patch ID, then by author, date and subject, and calls
  the move amended, rebased or rewritten. Only a rewrite alerts.
- Rules turn facts and the journal into findings, worst first. That is "Needs you" in `status` and the dashboard.
- Actions show a plan first. Running one re-checks what the plan read, pins every tip it will move, and returns a
  receipt with an undo where one exists.
- The guard splits a command line into simple commands, decides what each needs checked, and asks the same facts
  and the same removal verdict. `bin.js` loads it on its own, without the server or the dashboard, so a check of
  `ls` costs little more than starting Node, and a worktree removal check on the demo repository about 0.15 to
  0.25 s.

Pins are git refs (`refs/grove/pins/<branch>/<UTC time>`), so they outlive grove's database. The journal,
acknowledgements and activity are in SQLite at `~/.git-grove/grove.db`. Previewed plans live in the server's memory
for 10 minutes. [`docs/submission.md`](docs/submission.md) explains the design and its tradeoffs, and the full spec,
including what was cut, is [`docs/superpowers/specs/2026-11-01-git-grove-design.md`](docs/superpowers/specs/2026-11-01-git-grove-design.md).

## The dashboard

```sh
git grove        # the same as: git grove ui
```

`git grove ui` adds the repository you are in, makes sure the dashboard server is running, and opens it in your
browser at the feature of the worktree you are in. Outside a repository it opens the list of repositories. With
`GIT_GROVE_NO_OPEN=1` it prints the address instead of opening it.

The first time, `ui` installs a login service, so the dashboard is there whenever you are logged in, and, while the
agent guard is not in your Claude Code settings, prints one line pointing to its Install on the dashboard:

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

Every dashboard action that changes git opens a review first: the checks grove ran, what it will also do, and the
exact git commands. The confirm button arms 400 ms after the plan appears, and a held key never confirms. While it
runs you see each step, then a receipt with Undo, which opens the undo as a new review. Installing the agent guard
into Claude Code's settings, the one dashboard change outside git, is reviewed the same way (see Agents).

![The restore review: the branch now and after, the checks, what grove will also do, and the confirm button](docs/screenshots/restore-review.png)

![The restore receipt: each step with its time, Done, and Undo](docs/screenshots/restore-receipt.png)

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
  - notifications need an open dashboard tab or window;
  - the first address `ui` opens carries the token in its fragment, which may stay in the browser's history;
  - `new --install` keeps the repository's lock while dependencies install, so other actions in that repository
    wait and the dashboard pauses its scans of it until the install ends.

## Commands

```sh
git grove status [--json]                    # what needs you, then one line per worktree
git grove restore <branch> [<pin-ref>]       # move a branch back to the pin its alert names, pinning its current tip first
git grove ack <branch>                       # mark a branch's rewrite or deletion as intended
git grove pins list [<branch>]               # list pins, newest first
git grove check remove <worktree> [--json]   # exit 0 when safe to delete, 3 when not
git grove new <feature> [--branch <b>]       # start a feature: level 01 on the trunk, in .worktrees/<feature>/01-<branch>
git grove add-level <feature> <branch>       # add the next level on the deepest one, or on --on <parent-branch>
git grove restack <feature> [--stash]        # move each level of a stack onto its parent, pinning every tip first
git grove stack plan <feature> [--json]      # show what restack would do, changing nothing
git grove rm <worktree> [--rescue]           # remove a worktree's folder when nothing would be lost, keeping its branch
git grove install-guard                      # print the Claude Code hook that runs the agent guard; writes nothing
                                             # (the dashboard installs it after a review)
git grove guard --claude                     # the agent guard itself: reads the hook's JSON, exits 2 to block
```

`new` and `add-level` copy the main worktree's env files into the new level (`--skip-env` to skip), and so does
`copy-env` for a worktree that lacks them. An env file a symlinked folder of the worktree would send elsewhere is never
copied, and the plan says so. `new` and `add-level` take
`--install` to install dependencies and `--open` to open it in your editor. `rm --rescue` first copies the ignored
files only that worktree has into the main worktree, and checks the copies. `restore`, `ack`, `new`, `add-level`,
`restack` and `rm` go through the same core the dashboard uses: each prints its plan, each step and the receipt,
shows the plan and changes nothing with `--dry-run`, and prints JSON with `--json`. With no alert that status still
shows to say which pin you mean, `restore` lists the branch's newest pins and asks you to name one. No command pushes.

For example, after an agent squashes `feat/coupons-ui` into one commit:

```sh
git grove status                                   # History rewritten: 3 commits no longer on feat/coupons-ui
git grove restore feat/coupons-ui                  # the three commits are back (or: git grove ack feat/coupons-ui)
git grove check remove .worktrees/old-onboarding   # lists .local/seed.sql and exits 3
git grove rm --rescue .worktrees/old-onboarding    # copies .local/seed.sql into main, then removes the folder
```

`status` journals tip changes from one run to the next, so the first run in a repository only records where every
branch is. Errors print one line on stderr and exit 1; an action blocked by what its plan found exits 3.

## Not yet

- Parts of the agent guard:
  - comparing a force push with the remote. A force push runs after grove pins the remote tip it replaces; it is
    never blocked for dropping commits, and `forcePush: "never"` does not exist yet;
  - `git clean -fdx`, which runs unchecked;
  - `git stash drop` and `git stash clear`, which run unchecked;
  - logging every command the guard sees. Only blocks and new pins are recorded;
  - saying which agent session made a change in the journal;
  - recording branch tips on each guard call. The watcher and `status` still journal them;
  - writing settings from the terminal. `install-guard` only prints the hook; the dashboard installs it, after a
    review, into user settings only, never a project's `.claude/settings.json`;
  - other agents' hook formats. Only Claude Code's `PreToolUse` hook is read;
  - three places where bash runs a command that the guard does not read: a `$((…) )` subshell, which bash tells from
    arithmetic by its `) )` close; a `$( … )` inside `${…}`, such as `${x:-$(…)}`; and a `$( … )` in the body of an
    unquoted here-document (`<<EOF`);
  - wrappers the guard does not follow, which run whatever they wrap unchecked: `xargs rm -r`, `find … -delete`,
    `find … -exec rm -r`, `sudo`, `timeout` and `nice`;
  - git aliases, including ones defined inline with `git -c alias.x=…`;
  - `git rm -f` and `git rm -r -f` of files with local changes;
  - commands that move or drop refs without a pin: `git branch -f`, `git branch -M`, `git checkout -B`,
    `git switch -C`, `git rebase --update-refs` (which moves other branches of a stack), `git pull --rebase`,
    `git update-ref -d`, `git reflog expire` and `git gc --prune=now`;
  - `rm -r` of a folder holding whole repositories, run from a folder outside them, and `rm -rf .git`, which takes
    the pins with it;
  - pins for a detached HEAD;
  - a custom `GIT_GROVE_HOME`, which the hook does not carry, so such a setup records no guard activity; and guard
    activity reaches an open dashboard on its next load, not live.
- Reflog catch-up. A change made while grove was not running is found at the next scan as one move, from the last tip
  grove saved to the current one, and is pinned and classified like any other. The steps in between are not read
  from the reflog, a branch grove never saw has nothing to compare, and an old tip git has already pruned is
  replaced without an entry. The login service keeps the scanner running, so this was the gap to leave.
- GitHub data: PR state and review threads. "Merged" is decided from git alone. It needs `gh` and rate-limit
  handling, and sat below the spec's cut line.
- A `git grove demo` command. `scripts/demo.sh` does the same from a clone, and a script was quicker to build.
- Windows, which was a non-goal from the start: the login service is launchd or systemd, and nothing has been run
  or tested on Windows.
- Bare repositories, including a bare `.bare` with linked worktrees beside it. Facts are read from a main working
  tree, so every command in a bare repository says it is not supported yet and exits 1.
- A few commands from the spec: `add` and `remove-repo` (today a repository joins the dashboard when you run
  `status` or `ui` in it), `stack adopt`, `pins prune`, `rm --force`, `check push|reset|clean` and `log`.

## Requirements

- Node.js 24 or newer
- git 2.39 or newer
- pnpm, to build from source
- a repository with a working tree (bare repositories are not supported yet)

## License

MIT. See [LICENSE](LICENSE).
