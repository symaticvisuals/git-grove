# git-grove: design

Status: draft for review, 2026-11-01.
Mockups: `docs/mockups/dashboard.html` (clickable: Projects → acme-shop → checkout coupons) and `docs/mockups/cli-output.html` (terminal output, shape A).

## 1. Intent

Working with many git worktrees and stacked branches, much of it driven by AI coding agents, loses work silently. The author has hit each of these on a real project:

- A branch's history was rewritten mid-stack (16 commits squashed into 1) and nothing failed. It was found only by reading the reflog later.
- A "clean up merged worktrees" pass, run by an agent, removed 16 worktrees that were clean, pushed and merged, and with `--force` destroyed gitignored files that existed only there (plan ledgers, seed data).
- A stack tool treated every branch it had ever adopted as one tree and was about to force-push other features' branches.
- An open review thread on a lower stack level kept the levels above it blocked, and nothing showed why.

git-grove is a local tool that watches every worktree and stack, records what happens to each branch, refuses or warns before work is lost, and shows all of it on a small live dashboard. It observes automatically and acts only when asked.

This is also a hiring-challenge submission: a public repo plus a 5–10 minute video (problem, design, tradeoffs, failure modes), followed by a live session where the author adds a feature while sharing the screen. The build budget is one day.

### Success looks like

On the demo repo, recorded on video:

1. An agent (or a script) squashes a stack level. Within seconds the dashboard shows "rewritten: 14 changes no longer present", the old tip is pinned, and `git grove restore` brings the 14 commits back.
2. A Claude Code agent is asked to clean up merged worktrees. The guard blocks `git worktree remove --force` with the reason; the agent then runs `git grove rm --rescue` and the precious files land in the main checkout.
3. The dashboard shows three features (two stacks, singles), drift per level, and a live activity feed of what agents and people did.

## 2. Goals, non-goals, anti-goals

Goals
- Zero-config: `npx git-grove` inside any repo works; `npm i -g git-grove` gives `git grove …`.
- Catch history rewrites and classify them so normal agent work (amend, rebase) is not alarming.
- Answer "is this worktree safe to remove?" correctly, including gitignored files.
- Model stacks as named features (trees of branches) and show per-level health.
- A guard that agents hit before destructive git commands.
- A dashboard that shows what is actually happening, live.

Non-goals (v1)
- Spawning or orchestrating agents.
- Hosted service, accounts, multiple users.
- Windows.
- Running restack plans automatically (v1 generates the plan and copies commands; running is a stretch item).
- An MCP server, "agent waiting for input" status, disk usage, running ports/processes per worktree.

Anti-goals: it fails if it technically works but
- it ever loses a commit, including through its own actions or its own bugs;
- it rewrites git state on its own;
- it raises alarms for ordinary agent amends and rebases, so people stop reading them;
- a web page in the user's browser can drive its local server.

## 3. Constraints

- npm package `git-grove` (name checked free on 2026-11-01; `grove` and `grove-cli` are taken). The bin is `git-grove`, so git exposes it as `git grove`.
- TypeScript, strict, no `any`. Node ≥ 24. No native modules: storage uses the built-in `node:sqlite`.
- git ≥ 2.39 (needed for `git merge-tree --write-tree` and `git patch-id --verbatim`). `gh` is optional.
- macOS and Linux.
- Bare repositories, including a bare `.bare` with linked worktrees beside it, are not supported yet: every command prints `git-grove: bare repositories are not supported yet` and exits 1.
- Public repo: every name, branch and file in fixtures, demo and docs is invented. No client code or data.
- Developed with pnpm; published so `npx`/`npm i -g` work.

## 4. Decisions already made (by the author)

- Shape: a CLI plus a small local dashboard.
- Dashboard structure: Projects (every watched repo) → Features of one repo (stacks and single branches, filterable) → one Feature (its stack drawn as a tree, with UI to act on each branch). Follow the mockup.
- Stacks are first-class: a stack is a named feature, its branches form a tree (siblings allowed), and actions are scoped to one stack.
- Plans first: any multi-step change is shown as a plan before anything runs.
- Worktree layout for stacks is **grouped, not nested**: one folder per feature, levels side by side as numbered siblings (`.worktrees/<feature>/01-<branch>`, `02-<branch>`, …). The tree lives in grove's stack model, not in the folders. Nested worktrees made by hand are still detected and protected (6.5).
- Agent guard is in scope, and the dashboard must show what is actually happening (an activity feed of journal events and guard decisions).

## 5. Concepts

| Term | Meaning |
|---|---|
| Repo | A watched git repository (its common git dir). |
| Worktree | Path, HEAD sha, branch or detached, flags: locked, prunable, operation in progress (rebase, merge, cherry-pick, bisect). |
| Trunk | The base branch: `stack.trunk` from git config if set, else the remote's default branch, else `main`. |
| Feature | A named unit of work: either a stack (tree of levels on trunk) or a single branch. |
| Level | A branch in a stack, with its parent branch and fork point. |
| Journal entry | One observed change of a branch tip or a worktree HEAD: time, ref, old sha, new sha, classification. |
| Pin | A ref under `refs/grove/pins/` that keeps an old tip reachable. |
| Alert | Derived from current state plus journal: severity (loses-work, needs-action, waiting-on-review, idle), subject, message, suggested command. |
| Guard decision | A command an agent tried, the verdict (allow, allow-and-pinned, block) and the reason. |
| Activity | The merged, time-ordered stream of journal entries, guard decisions, worktree created/removed and scan errors. |

## 6. Architecture

One per-user Node process, started at login by the OS (6.8), does the watching and serves the dashboard. Every CLI command also works on its own, without that process: it scans on demand and reads and writes the same database. SQLite in WAL mode handles both at once.

```
CLI ─┐                              ┌─ Dashboard (static SPA in the package)
     ├─ Core ───────────────────────┤   REST + SSE on 127.0.0.1, token + Host check
     │   Watcher (fs.watch + 30 s poll)
     │   Scanner (git CLI, read-only)
     │   Classifier (rewrite kinds)
     │   Stack model (git config)
     │   Analyzer (state + journal → alerts)
     │   Guard (agent hook entry point)
     │   Planner / runner (plans; pins first; one lock per repo)
     │   GitHub poller (gh api graphql)  [below the cut line]
     └─ Storage: ~/.git-grove/grove.db (node:sqlite), ~/.git-grove/config.json
        Safety net: pins live in git refs, not in the database
```

### 6.0 Layout and rules of the code
- One published package: `src/core` (git adapter, facts, classifier, rules, runner, storage), `src/cli`, `src/server`, `ui/` built into `dist/ui`. No monorepo.
- The guard is its own bundle entry that never loads the server or UI code. Target: an answer within 200 ms, Node start included.
- The git adapter is the only module that runs git. The runner is the only module that changes git, and it pins before every change.
- Facts, classifier and rules are pure: no git, no disk. Each rule is one file in a registry, and a new rule shows up in the CLI, the dashboard and the guard at once.
- Git is the truth: everything shown is recomputed from git on each scan. `grove.db` keeps only what git forgets (tip history, guard decisions, acknowledgements, settings).
- SQLite runs in WAL mode with a busy timeout, because the dashboard process, CLI commands and several agents' guard calls write at the same time. Journal rows are unique on (repo, branch, old sha, new sha), so a change seen by both the watcher and the guard is recorded once.

### 6.1 Watcher
- `fs.watch` on the common git dir: `refs/` (recursive), `packed-refs`, `worktrees/` (each worktree's `HEAD` and `index`), `logs/`. Debounce 300 ms per repo.
- A safety poll every 30 s per repo.
- New worktrees appear as new entries under `worktrees/` and are picked up by the next scan.

### 6.2 Scanner (per repo, read-only)
Every git call uses `git --no-optional-locks` and never writes the index. Calls per scan:

| Call | When | Gives |
|---|---|---|
| `git worktree list --porcelain` | every scan | paths, HEADs, branches, locked/prunable |
| `git for-each-ref --format=… refs/heads refs/remotes refs/grove/pins` | every scan | every tip, upstream, ahead/behind |
| `git config --get-regexp '^branch\..*\.(stackparent\|stackforkpoint\|grovefeature)$'` and `stack.trunk` | every scan | stack structure |
| `git status --porcelain=v2 --branch` in a worktree | only when that worktree's `HEAD` or `index` mtime changed since the last scan; at most 8 in parallel | changed and untracked files |
| Presence of `rebase-merge/`, `rebase-apply/`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `BISECT_LOG` in the worktree's git dir | every scan (file stats only) | operation in progress |
| `git stash list --format='%gd%x00%gs'` | every scan | stashes, attributed to a branch by the "WIP on <branch>" / "On <branch>" message |

Expensive checks (ignored files, detached-only commits) run only for the safe-to-remove verdict, in the guard, and hourly in the background, and are cached against the worktree's HEAD and index mtime.

### 6.3 Journal and rewrite classification
Branch tips are journaled. A worktree's HEAD is journaled only while it is detached, and only to catch commits that become unreachable.

For every branch whose tip changed since the last recorded value:

1. If old is an ancestor of new (`git merge-base --is-ancestor old new`): **advanced**. Record, no alert.
2. Otherwise pin old at `refs/grove/pins/<branch>/<utc-timestamp>` first, then classify **only the branch's own commits**: old's own range is `<old fork point>..old` and new's is `<new base>..new`, where the base is the stack parent's tip (from 6.4) or the merge-base with trunk. Commits that belonged to the parent are never counted, so restacking after a parent was squash-merged is not a rewrite.
   - Match each old own commit to a new own commit by patch ID (`git patch-id --stable`). When the patch ID differs, match by author, author date and subject; this covers rebases that resolved conflicts.
   - A commit still unmatched is not lost when the base moved and gained a commit with its patch ID (it reached trunk another way, such as a cherry-picked hotfix), or when it is a `fixup!`, `squash!` or `amend!` commit whose target is in the new range and matched only by metadata (its content changed, so the fixup was folded in). A fixup dropped while its target stayed unchanged is lost.
   - The base did not move and the only difference is old's tip commit (matched by metadata only, or unmatched because its message was edited): **amended**. Info only.
   - Otherwise, every old own commit matched: **rebased**. Info only.
   - Any other unmatched commit: **rewritten, N changes no longer present**. Loses-work alert, with `git grove restore <branch> <pin>` (the alert's own pin) as the action. A single dropped commit in the middle counts.
   - Checked on 2026-11-01 with a throwaway repo: rebase onto moved trunk, conflict-resolving rebase and a child restacked after its parent's squash merge all classify as rebased; a 3-into-1 squash classifies as rewritten (3); plain `git cherry new old` wrongly reports the restacked child as 2 changes lost.
3. A branch that disappears: if its tip is not reachable from any other branch, remote or pin, pin it and raise a loses-work alert ("branch deleted with N unique commits").
4. A detached worktree HEAD whose previous commits are no longer reachable from any branch, remote, tag, pin or the HEAD itself: pin them and raise a loses-work alert.

A "rewritten" alert resolves in three ways: `git grove restore`, `git grove ack <branch>` (or "Mark as intended" in the UI) for a deliberate squash, or automatically when the branch's changes reach trunk (6.4's merged test) or the branch is deleted with nothing unique. Acknowledged rewrites are left out of restack plans.
`restore` without a pin ref takes the pin of the branch's newest unresolved alert and resolves only the alerts whose old tip it brings back. An alert resolved by landing on trunk is acknowledged in the journal, so it stays resolved as trunk moves on. The same rewrite seen again (same branch, old and new tip) re-opens its alert; an exact undo of a rewrite is journaled acknowledged and acknowledges that rewrite.

Changes that happened while grove was not running: on startup, read each branch's reflog since the last recorded entry and classify each non-fast-forward step as above, marked "found later". On the first `git grove add` of a repo, the whole reflog (about 90 days) is classified and every past rewrite is pinned, but the result is one info item ("found 7 past rewrites; review them") rather than one red alert each.

Pins older than 30 days whose commits are reachable from a branch or remote are removed by `git grove pins prune`; never automatically.

### 6.4 Stack model
- Read gh-stack's existing keys: `branch.<b>.stackparent`, `branch.<b>.stackforkpoint`, `stack.trunk`. Existing gh-stack stacks therefore appear with no setup.
- A feature is the set of branches connected through `stackparent` to a branch whose parent is trunk. Its name is `branch.<root>.grovefeature` if set, else derived from the root branch name. Stack levels with no worktree are shown as "no worktree".
- A single-branch feature is a branch that has a worktree and is not in a stack. Branches with no worktree and no stack are not features; they are counted, not listed.
- Detached worktrees (agent sandboxes, eval runs) are grouped into one "Detached worktrees" entry per repo, so 64 sandboxes read as one row.
- Trunk for comparisons is `origin/<trunk>` when it exists, else the local trunk. Grove never fetches; screens show "as of last fetch, <age>" from `FETCH_HEAD`'s time.
- `git grove stack adopt <branch> --parent <b> [--feature <name>]` writes the same keys, so gh-stack and grove agree.
- Every command and action that takes a feature touches only that feature's branches.

Per-level health, worst first:

| Health | Rule |
|---|---|
| Rewritten | an unresolved "rewritten" journal entry on this branch |
| Not safe | safe-to-remove would say no and the branch is merged (someone will want to delete it) |
| Parent merged | the parent's changes are already in trunk: `git merge-tree --write-tree <trunk> <parent>` yields trunk's own tree (works for squash merges), or trunk holds a commit whose verbatim patch ID (`git patch-id --verbatim`, whitespace counted) equals the parent's whole diff since the merge base and no later trunk commit carries its exact inverse (a squash merge trunk has since built on, and not reverted), or GitHub says the parent's PR merged; a parent that was only created or fast-forwarded (no commit in its reflog) is not merged |
| Parent moved | `git rev-list --count <forkpoint>..<parent>` > 0 (fork point from config, else merge-base) |
| Blocked | a lower level's PR has an unresolved review thread [needs GitHub] |
| Behind trunk | `git rev-list --count <branch>..<trunk>` > 0 |
| Fine | none of the above |

### 6.4b Predicates, rules and findings
- **Facts** are what git says, with no judgment, in three tiers by cost: tier 1 every scan for the whole repo (worktrees, refs with upstream tracking, stack config, stashes, pins, `FETCH_HEAD` time); tier 2 per worktree only when its `HEAD` or `index` changed (status, operation in progress); tier 3 on demand and hourly, cached by HEAD and index mtime (ignored-file listing, detached-only commits, own commit ranges, merged-into-trunk). Each fact carries when it was read.
- **Predicates** are pure functions over facts that answer one yes/no question with reasons: `safeToRemove(worktree)`, `uniqueCommits(branch)`, `forcePushWouldDrop(branch)`, `parentMerged(level)`, `parentMoved(level)`, `envMissing(worktree)`, `operationInProgress(worktree)`.
- **Rules** turn predicates and journal entries into findings: `{ rule, severity, subject, title, detail, action }`. Severity ladder: loses-work, needs-action, waiting-on-review, idle. A level's health is its worst finding; a feature's is its worst level; "Needs you" is every unacknowledged finding at needs-action or worse, worst first, then newest.
- **The guard** uses the same predicates, not the rules: a command maps to the predicate that says whether it loses work (for example `git worktree remove` → `safeToRemove`). One predicate, two consumers, so the dashboard and the guard cannot disagree.
- A rule is added only if it comes from a real way work gets lost or blocked, can be decided from local facts alone, points to one action, and can be acknowledged when it is wrong.

v1 rules:

| Rule | Subject | Fires when | Severity | Action |
|---|---|---|---|---|
| history-rewritten | branch | an unresolved "rewritten" journal entry | loses-work | `restore <branch> <pin>`, or `ack <branch>` if intended |
| branch-deleted | branch | a deleted branch had unique commits | loses-work | `restore <branch> <pin>`, or `ack <branch>` if intended |
| detached-orphans | worktree | detached commits became unreachable | loses-work | restore from pin as a branch |
| unsafe-merged-worktree | worktree | branch merged but `safeToRemove` is false | loses-work | `rm --rescue` |
| nested-worktree | worktree | another worktree lives inside its folder | needs-action | move the inner one out with `git worktree move`, by hand |
| operation-in-progress | worktree | rebase, merge, cherry-pick or bisect underway | needs-action | continue or abort, by hand |
| parent-merged | level | `parentMerged` | needs-action | re-base onto trunk |
| parent-moved | level | `parentMoved` | needs-action | restack plan |
| env-missing | worktree | `envMissing` | needs-action | copy from main |
| prunable | worktree | folder gone | needs-action; loses-work when its detached HEAD holds commits no ref reaches | prune, by hand; for the detached case, including when its commits cannot be counted, `git branch rescue/<folder> <sha>` first |
| blocked-by-thread | level | a lower level's PR has an open thread [GitHub] | waiting-on-review | open the thread |
| idle | worktree | no change for 14 days | idle | review for cleanup |

### 6.5 Safe-to-remove verdict
A worktree is not safe to remove if any of these hold (each is reported with details):

- uncommitted changes or untracked, non-ignored files;
- commits on its branch not on its upstream and not merged into trunk (merged as defined in 6.4);
- detached HEAD with commits reachable only from it: `git rev-list HEAD --not --branches --remotes --tags` is non-empty;
- **another worktree inside it** (its path starts with this worktree's path), whatever that worktree's own state. Checked on 2026-11-01 with git 2.55: a level-2 worktree nested inside level 1's folder, holding an uncommitted file, was deleted together with that file by a plain `git worktree remove` of level 1, without `--force`, because git only refuses on changed or untracked files and the nested folder was ignored;
- **a git repository of its own inside it** that is not a registered worktree (a `.git` folder or file below its root, in an untracked folder or an ignored one other than the dependency and build folders and the OS and tool junk folders such as `__pycache__/` and `.pytest_cache/`, which are not walked), whatever its files: the folder takes that repository's history with it;
- stash entries attributed to its branch;
- **precious ignored files**: `git ls-files --others --ignored --exclude-standard --directory` in the worktree, minus the default dependency and build folders (`node_modules`, `dist`, `build`, `.next`, `.turbo`, `.venv`, `venv`, `target`, `.cache`, `coverage`) when that folder is itself ignored (a tracked `build/` does not hide a hand-made ignored file in it), OS and tool junk anywhere (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `__pycache__/`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`; `.idea/` stays precious), and the user's `ignore` globs; a remaining file is precious unless a byte-identical file exists at the same relative path in the main worktree, and that path does not lead back into a linked worktree, through a symlink or any other path to the same folder (compared by folder `(dev, ino)`, so a firmlink or bind mount counts).

`git grove rm <worktree>` refuses when not safe. `--rescue` copies precious ignored files into the main worktree at the same relative path (never overwriting: an existing different file is saved as `<name>.from-<worktree>`), then removes the worktree. `--force` removes anyway, but first pins the HEAD, saves uncommitted changes as a pinned stash-like commit, and moves precious ignored files to `~/.git-grove/rescued/<repo>/<worktree>/<timestamp>/`. Nothing is deleted outright.

The same ignored-file listing powers "env files missing": ignored files in the main worktree matching `.env*` that are absent in the worktree. Detached worktrees (agent sandboxes) are not checked.

### 6.6 Agent guard
- `git grove install-guard` adds a Claude Code `PreToolUse` hook (matcher `Bash`) to the user's `~/.claude/settings.json` by default, because Claude Code reads project-local settings from the folder it was started in and an agent started inside a linked worktree would never see a hook written to the main checkout. `--repo` writes the repo's `.claude/settings.local.json` instead. It merges into existing JSON, is idempotent, and `git grove uninstall-guard` removes only its own entry. The builder must confirm the hook schema and stdin fields against the current Claude Code hooks documentation.
- The hook command is the absolute path of the installed `git-grove` binary. `install-guard` refuses when run through `npx` and asks for `npm i -g git-grove`, because resolving through `npx` on every agent command is too slow.
- The guard evaluates any git repo the agent is in, watched or not. A repo it has not seen before is recorded as "seen" so its activity is kept, but is not added to the dashboard until `git grove add`.
- No network in the guard: remote state is the local tracking ref.
- Each guard call also records the repo's branch tips (one `for-each-ref`), so the journal stays current whenever agents are working, even with the dashboard closed.
- `git grove guard --claude` reads the hook's JSON from stdin (the Bash command and the working directory), parses the command (including `&&`, `;`, `cd <dir> &&` prefixes and `git -C <dir>`), and evaluates each git invocation:

| Command | Verdict |
|---|---|
| `git worktree remove [--force]` | block unless the safe-to-remove verdict is yes |
| `rm -rf <path>` where path is or contains a worktree | block unless safe to remove |
| `git branch -D <b>` | block if `<b>` has commits not reachable elsewhere; otherwise pin and allow |
| `git push --force` / `-f` / `--force-with-lease` | compare the tracking ref's own commits with the local branch's using 6.3's matching: block if any would be dropped (a squash or a removed commit); allow a plain rebase, pinning the remote tip first. Config `forcePush: "never"` blocks every force push. |
| `git reset --hard`, `git checkout -- .`, `git restore .`, `git clean -fdx` | block if they would discard uncommitted changes or precious ignored files |
| `git rebase …`, `git commit --amend` | allow, pinning the current tip first |
| `git grove rm --force`, `git grove ack`, `git grove pins prune` | block for agents; these are for people. `git grove rm --rescue` is allowed. |
| any other git command | allow, and log it |
| anything else | allow, not logged |

- Allow: exit 0. Block: exit 2 with the reason and the safe alternative on stderr (for example "2 ignored files exist only in this worktree: …; run `git grove rm --rescue <path>`").
- If grove itself fails (cannot read the repo, crashes): allow, and print a one-line warning on stderr. A grove bug must never stop an agent's ordinary work. (My call; see 10.)
- Every git command the guard sees is written to the activity stream with the session id and worktree from the hook input: blocked, allowed-and-pinned, and plain allowed. A journal entry is attributed to an agent session when that session ran a git command in the same worktree within the 10 seconds before the change; otherwise it reads "outside an agent". This is how the feed shows who did what. Commands are stored locally only.
- `git grove check <remove|push|reset|clean> [target] [--json]` exposes the same evaluation for scripts and other agents. Exit 0 safe, 3 unsafe, 1 error.

### 6.6b Creating features and levels
- `git grove new <feature> [--from <trunk>]` creates branch `<feature>` level 1 at `.worktrees/<feature>/01-<branch>`, records `stackparent = <trunk>`, `stackforkpoint` and `grovefeature`.
- `git grove add-level <feature> <branch> [--on <parent-branch>]` creates the next numbered sibling folder (`02-<branch>`, …) on top of the given parent (default: the feature's highest level), and records the same keys. A sibling level 2 (a tree, not a chain) is `--on` level 1.
- Both copy the main worktree's ignored `.env*` files into the new worktree (never overwriting), and print the install command for the repo's package manager instead of running it.
- The dashboard's "New feature" and "Add a level" buttons run the same commands.
- Folder names are derived once from the branch (`/` becomes `-`), so the path never has to be re-decided.

### 6.7 Plans and actions
- A plan is an ordered list of steps: description, working directory, argv. Shown in full before running; `--json` and "Copy commands" give the exact commands.
- v1 actions that run: pin, `restore` (point a branch back at a pinned tip, after pinning the current tip), `rm --rescue`, copy an env file from main, `stack adopt`. Each first takes a per-repo lock file (`<common git dir>/grove.lock`) and refuses a worktree with an operation in progress.
- Restack plans (pin all tips → restore rewritten levels → `git rebase <parent>` per level, bottom-up, inside each level's worktree → verify commit counts did not shrink → push as merge commits instead of force) are generated in v1 and copied, not run. Running them is a stretch item: it stops at the first non-zero exit and names the worktree.

### 6.8 Local server and dashboard
- **Always on at login.** `git grove service install` writes a launchd agent (`~/Library/LaunchAgents/work.grove.server.plist`, macOS) or a systemd user unit (`~/.config/systemd/user/git-grove.service`, Linux) that runs `git-grove serve` at login and restarts it if it exits. The first `git grove ui` or `git grove setup` installs it, prints what it wrote and how to remove it (`git grove service uninstall`). `npm install` never installs it. Windows stays a non-goal.
- `git grove serve` binds `127.0.0.1:47683` ("grove" on a phone keypad), or the next free port, and records `{ pid, port, version }` in `~/.git-grove/server.json`. Only one runs; a CLI newer than the running server asks it to exit, and the OS restarts it on the new version.
- Every request needs a token (`~/.git-grove/token`, set as a cookie by the URL `git grove ui` opens) and a `Host` of `127.0.0.1:<port>` or `localhost:<port>`; anything else is rejected. `POST` requests also need the token in a header. This stops other web pages and DNS rebinding from calling it.
  - These need no cookie, though the `Host` check still applies: `GET /manifest.webmanifest`, `/sw.js`, `/favicon.svg`, `/icons/*`, the vendored fonts (`/fonts/*`) and `/api/health`, which returns only `{ ok, version, pid }`.
- `git grove ui` opens the dashboard at the feature of the current worktree. `git grove status` ends with the dashboard's address. Without the service, `git grove ui` serves in the foreground until closed.
- The dashboard is an installable web app (manifest and service worker): Chrome and Edge offer "Install git grove", which gives it a window and a dock icon. While it is open it raises system notifications for loses-work findings and guard blocks.
- `GET /api/projects`, `/api/repos/:id/features`, `/api/features/:id`, `/api/activity?repo=…`; `POST /api/plans` (preview) and `POST /api/actions` (run). `GET /events` is Server-Sent Events: a new snapshot digest or activity item after each scan.
- The UI is a prebuilt static bundle inside the package. Screens and visual language follow `docs/mockups/dashboard.html` and `docs/brand/` (spruce ground, resin for pins, Martian Mono and Atkinson Hyperlegible Next, ember/resin/fjord/moss health colours), plus:
  - Projects: an activity strip of the latest events across repos.
  - Feature: an activity list for that feature (journal entries and guard decisions, live).
- Every async surface shows loading, empty and error states.

### 6.9 GitHub [below the cut line]
One `gh api graphql` query per repo per minute, aliased per open branch: PR number, state, base, review decision, `statusCheckRollup` state, unresolved review thread count. Without `gh` or auth, show "PR info unavailable" and keep working. On rate limit, back off and show the age of the last data.

### 6.10 CLI
```
git grove                      # in a repo: add it if new, then open the dashboard
git grove status [--json]
git grove ui
git grove service install | uninstall | status
git grove add <path> | remove-repo <path>
git grove stack list | show <feature> | adopt <branch> --parent <b> [--feature <name>] | plan <feature> [--json]
git grove new <feature> [--from <trunk>]
git grove add-level <feature> <branch> [--on <parent-branch>]
git grove rm <worktree> [--rescue | --force]
git grove restore <branch> [<pin-ref>]
git grove ack <branch>          # mark a branch's rewrite or deletion alerts as intended
git grove pins list | prune
git grove check <remove|push|reset|clean> [target] [--json]
git grove guard --claude        # hook entry point
git grove install-guard [--user] | uninstall-guard [--user]
git grove log [--json]          # activity
git grove demo [<dir>]          # build the synthetic demo repo
```
Every listing command supports `--json`.

### 6.11 Demo repo
`git grove demo` builds `acme-shop` in a temp dir (or `<dir>`): trunk `main`, a 3-level stack with a sibling level 2 (checkout coupons), a stack whose level 1 is merged (search filters), single branches, a worktree with a precious ignored file (`.local/seed.sql`) and a worktree missing `apps/web/.env.local`. It prints the commands that reproduce each incident (a squash rebase on level 2; an agent cleanup). No GitHub remote is needed.

## 7. Failure modes and behaviour

| What goes wrong | What grove does |
|---|---|
| A rewrite happened while grove was off | Found from reflogs on startup, marked "found later"; pinned if the old tip is still in the object store |
| Normal agent amends and rebases | Classified as amended or rebased; no alert |
| Grove's database is deleted or corrupt | No commit is lost (pins are git refs); grove rebuilds state from git and starts a new journal |
| Agent mid-rebase while grove scans | Read-only scan with `--no-optional-locks`; worktree shown as "rebase in progress" |
| User acts while an agent is mid-operation | Action refused for that worktree with the reason |
| Worktree folder deleted by hand | Shown as prunable; never pruned automatically |
| Interrupted plan | The worktree shows "rebase in progress" with continue and abort offered; grove never guesses |
| Guard cannot evaluate | Allows, warns on stderr, logs the failure |
| `gh` missing or rate-limited | PR columns show unavailable or stale with age; everything else works |
| Very large repos, many worktrees | Incremental scans keyed on HEAD and index mtimes; ignored-file listing collapsed by directory and cached |

## 8. Testing

- Unit tests (vitest) against real temporary git repos built per test: rewrite classification (advanced, rebased, amended, rewritten, deleted branch), merged detection including squash merges, safe-to-remove rules including precious ignored files and detached HEAD, guard command parsing and verdicts, stack derivation from git config.
- An integration test that runs `git grove demo`, performs the squash and the cleanup, and asserts the alerts, pins, block and rescue.
- The guard is also checked once by hand with a real Claude Code session for the video.

## 9. Build order and cut line (one day)

| Order | Piece | Hours |
|---|---|---|
| 1 | Package skeleton, scanner, data model, `status --json` | 2 |
| 2 | Journal, rewrite classification, pins, `restore`, reflog catch-up | 2 |
| 3 | Stack model, per-level health, safe-to-remove (including nested worktrees), `rm --rescue`, `check` | 1.5 |
| 3b | `new` and `add-level` with the grouped layout and env copy (cut first if the day runs short) | 0.75 |
| 4 | Guard (`guard --claude`, `install-guard`) and activity stream | 1 |
| 5 | Server (token, SSE) and dashboard: Projects, Features, Feature tree, activity | 3 |
| 6 | `git grove demo` and the integration test | 0.5 |
| — | Cut line. After it, in this order: GitHub data (6.9); running restack plans; MCP server; agent session column; disk and ports; Windows | |

If the day runs short, cut from the bottom of the list above the line only after the cut-line items: keep 1–4 and 6, and reduce 5 to Features and Feature screens.

## 10. Calls I made (not yet confirmed by the author)

- Name `git-grove`, bin `git-grove`, data in `~/.git-grove/`.
- TypeScript on Node ≥ 24 with `node:sqlite`; git called as a CLI rather than through a library.
- The guard fails open (allows) when grove itself errors.
- Pins are created for every non-fast-forward change, not only for alarming ones.
- The server runs always, as a per-user login service the first `git grove ui` installs (author's call, 2026-11-02). Installing it from `npm install` was rejected: install scripts are often skipped and should not change the OS. The dashboard is an installable web app rather than an Electron app, to keep zero runtime dependencies.
- Reusing gh-stack's git config keys for stack structure.
- Rewrite classification looks only at a branch's own commits and falls back to author, date and subject when patch IDs differ (6.3).
- Force pushes are blocked only when they would drop work; `forcePush: "never"` is an option, not the default (6.6).
- `install-guard` writes to the user-level Claude Code settings by default and needs a global install (6.6).
- `rm --force` moves files aside instead of deleting them, and agents can't run it (6.5, 6.6).
- First add of a repo pins past rewrites but reports them as one info item (6.3).
- Single-branch features are branches with a worktree; detached worktrees are grouped (6.4).
- Grove never fetches; freshness is shown from `FETCH_HEAD` (6.4).
- Grove never lazily fetches a partial clone's missing objects (`GIT_NO_LAZY_FETCH=1`); the merged test may leave dangling trees from `merge-tree`, the same each run.
- The guard logs every git command it sees, locally, so activity can say which agent session did what (6.6).

## 11. Left to the builder

- UI framework and build (suggested: Vite + React, CSS taken from the mockup), CLI argument parsing (suggested: `node:util` `parseArgs`, no dependency), SQL schema, exact debounce and poll intervals, port selection, internal module layout, test helper design.

## 12. How the video maps onto this

| Video section | Material |
|---|---|
| Problem framing (2–3 min) | Section 1 incidents, told without naming the client |
| System design (5–6 min) | Section 6 diagram; scan → journal → classify → alert → SSE; the guard path |
| Tradeoffs (3–4 min) | Git CLI over a library; pins in git, not the DB; observe vs act; guard fails open; no daemon; patch-id classification vs plain ancestry |
| Failure modes (2 min) | Section 7 |
