# The Claude Code plugin, and a simple getting-started page

## Why

The agent guard is installed today by grove writing a `PreToolUse` hook into Claude Code's user `settings.json`, after
a review. Agents learn how to behave around it from a note the user pastes into `CLAUDE.md` by hand. A new user has to
find both in the README.

Claude Code plugins bundle hooks and skills, and Claude Code installs, enables, updates and removes them itself. Moving
the guard into a plugin, together with a skill that teaches agents how to work with grove, does three things:

- grove stops editing Claude Code's files;
- the guidance loads when an agent is about to touch worktrees, instead of sitting in every session;
- setup becomes two commands to copy.

The onboarding stays a short guide. The effort goes into the plugin.

## Goals

- This repository is also a Claude Code marketplace with one plugin, `git-grove`, holding the guard hook and a
  `git-grove` skill. Users install it with:
  ```sh
  claude plugin marketplace add symaticvisuals/git-grove
  claude plugin install git-grove@git-grove
  ```
- The plugin's hook finds the installed grove without relying on `PATH`.
- Grove can tell whether the plugin is enabled and whether an old `settings.json` hook is still there. Only one of the
  two runs the guard.
- The dashboard's guard card, `git grove ui` and `git grove install-guard` point to the plugin.
- The settings-file code from PR #4 is kept only to remove an old hook, after the same review.
- A "Getting started" page lists three steps: watch a repo, install the plugin, keep grove running. It opens once on
  first visit and stays in the sidebar.

## Non-goals

- Writing the hook into `settings.json`. Grove no longer installs it there.
- Publishing to the official Claude Code marketplace.
- Server routes, status checks or writes for the getting-started page beyond what the dashboard already loads.
- Supporting `claude --bare` or `--safe-mode`. Both skip plugins, so the guard is off there; the README says so.

## Anti-goals: it has failed if…

- The guard runs twice for one command, once from the plugin and once from an old settings hook, without the user
  being offered the fix.
- A missing or broken grove blocks every Bash command an agent runs. The hook fails open, as the guard does today.
- The plugin's hook runs a grove that a `PATH` change picked by accident, when grove recorded the one to run.
- Removing the old hook writes anything the user did not review.

## Behaviour

### The marketplace and the plugin

- The repo root gets `.claude-plugin/marketplace.json`:
  - name `git-grove`;
  - owner `symaticvisuals`;
  - one entry, `git-grove`, with source `./plugin`.
- `plugin/` holds:
  - `.claude-plugin/plugin.json`: name `git-grove`, a description, and `version` equal to the npm package's version.
    A test checks that the two match. With the version pinned, users get an update only on a release, not on every
    commit. *(my call)*
  - `hooks/hooks.json`: one `PreToolUse` group with matcher `Bash`. It runs `"${CLAUDE_PLUGIN_ROOT}"/hooks/guard.sh`
    with `timeout: 10`. The guard keeps its own 3 s deadline inside.
  - `hooks/guard.sh`: POSIX `sh`, described below.
  - `skills/git-grove/SKILL.md`, described below.
- The npm package keeps shipping only `dist`. The plugin comes from the git repository.

### How the hook finds grove

- Grove writes `hook-command` in its home folder (`$GIT_GROVE_HOME` or `~/.git-grove`) with two lines:
  - the Node to run, picked by the same stable-path logic the installer uses today (`stable-node-path.ts`);
  - the absolute path of `dist/cli/bin.js`.
- It writes the file:
  - when `git grove ui` runs;
  - when the server starts;
  - through a temp file and a rename, mode 0600;
  - only when the content would change.
- It doesn't write the file when run from an `npx`, `pnpm dlx`, `bunx` or `yarn dlx` cache, which the installer already
  refuses (`isEphemeralBin`). Then the hook falls back to `PATH`.
- `guard.sh`:
  1. It reads `${GIT_GROVE_HOME:-$HOME/.git-grove}/hook-command`. If both paths exist, it runs
     `exec "$node" "$bin" guard --claude`, stdin passed through.
  2. Otherwise, if `git-grove` is on `PATH`, it runs `exec git-grove guard --claude`.
  3. Otherwise, it prints `git grove guard: git grove is not installed or has not run yet; run git grove ui` to stderr
     and exits 0, allowing the command.
- The guard's exit codes are unchanged: 2 blocks with the reason on stderr, 0 allows.

### The skill

- `skills/git-grove/SKILL.md` has `name: git-grove` and a description that triggers on: removing worktrees, `rm -r` of
  folders that hold worktrees, deleting branches, rebasing or restacking stacked branches, force pushes, and a command
  git grove blocked.
- The body is the README's agent note, expanded into short sections:
  - before removing a worktree, run `git grove check remove <path>`;
  - to remove one that holds ignored files, run `git grove rm --rescue <path>`;
  - when the guard blocks a command, do not work around it. Tell the user what it said, and run the command it gives
    when there is one;
  - keep uncommitted changes with `git stash` on its own before a discarding command, as the guard's message says;
  - pins: what they are, and that `git grove restore` brings a branch tip back;
  - never run `git grove ack`, `git grove pins prune` or `git grove rm --force`, which are people-only.
- No other files in the skill.

### What grove knows about the guard

- `readGuardStatus` gains one fact, read from the settings file it already parses: whether `enabledPlugins` has
  `"git-grove@git-grove": true`.
- The guard's state becomes one of these:

  | State | Meaning |
  |---|---|
  | `plugin` | The plugin is enabled and no old hook is present. Done. |
  | `plugin-and-hook` | The plugin is enabled and an old hook is still in `settings.json`. |
  | `hook` | Only the old hook. It still works, including when stale. |
  | `absent` | Neither. |

- The current `GuardStatus` stays as it is and keeps describing the old hook: `installed`, `stale`, `absent` or
  `unreadable`. `GuardState` gains three fields next to it, and the four states above are derived from them:
  - `plugin`: enabled in user settings;
  - `hookCommand`: grove has a usable `hook-command`, meaning the file exists and both paths in it exist;
  - `ephemeral`: this server runs from an `npx` cache. *(my call: no rewrite of the status type)*
- The guard counts as done, for the card and the getting-started tick, only when all of these hold:
  - the plugin is enabled;
  - Claude Code's hooks are on (`disableAllHooks` turns off plugin hooks too);
  - `hook-command` is usable.

  Otherwise the card shows the reason. *(my call)*
  - Hooks off: the existing hooks-off note.
  - No usable `hook-command`: "The plugin's hook can't find git grove yet. Run `git grove ui` once." When grove runs
    from an `npx` cache, the note becomes "Install git grove for the plugin to run it:
    `npm i -g @deepanshugoel/git-grove`".
- When `settings.json` cannot be read, grove can't tell whether the plugin is enabled. The card shows the two install
  commands and the existing unreadable-settings line. *(my call)*
- The plugin is only detected when enabled in that user settings file. A plugin enabled only in a project's settings
  shows as `absent`, and the card still offers the commands. *(my call: grove reads user settings only)*

### The guard card, `ui` and `install-guard`

- `absent`: the card is "Protect worktrees from Claude Code". It shows the two install commands, each with Copy, and
  "Not now".
- `hook`: the card is "Switch the agent guard to the Claude Code plugin". It shows the two install commands and, after
  them, "Then remove the old hook…".
- `plugin-and-hook`: the card is "The agent guard runs twice", with "Remove the old hook…".
- "Remove the old hook…" opens the existing uninstall review unchanged: plan, review, run once, receipt.
- `plugin`: no card.
- The `install` change is removed from `POST /api/guard/plans`, along with its planning code and the Install… dialog
  path. `uninstall` stays.
- `git grove install-guard` prints the two plugin commands. It still writes nothing. From an `npx` cache it also prints
  the install line above and exits 1, as it does today.
- `git grove ui` prints one line with the two commands on every run while the guard isn't done. That includes the
  `hook` state of people upgrading from PR #4, whose service is already installed. The line no longer sits inside
  the first service install. *(my call: one line, and installing the plugin silences it)*

### The getting-started page

- The page is at `#/setup`, with a "Getting started" item in the sidebar.
- On a browser's first visit it opens instead of the address that was opened, then goes on to that address when the
  user clicks "Go to the dashboard" at the bottom. "First visit" is remembered in `localStorage`, like the guard card's
  "Not now". A port change may show it once more, which is accepted.
- It has three steps, each a title, one or two lines, and a command with Copy:

  1. **Watch a repo.** `git grove ui` inside a repository you work in. A tick shows when grove watches at least one,
     taken from the projects list the dashboard already loads.
  2. **Protect worktrees from Claude Code.** The two plugin commands. A tick shows when the guard state is `plugin`.
     In `hook` or `plugin-and-hook` it adds the card's "Remove the old hook…".
  3. **Keep grove running.** "`git grove ui` installs a login service so grove watches after you close this tab. If it
     could not, run `git grove service status` to see why." No tick and no status check.

- Nothing on the page is stored except "seen".

### README

- The Agents section leads with the plugin:
  - the install commands;
  - what the hook and the skill do;
  - that `--bare` and `--safe-mode` skip plugins;
  - how to remove the old hook if PR #4's installer put one in.
- The `CLAUDE.md` note is replaced by a pointer to the skill.

## Constraints

- No new runtime dependencies. `guard.sh` is POSIX `sh` with no `jq`, `node -e` or other helpers.
- The guard binary and its exit codes do not change.
- Every write to a Claude Code file stays behind the existing review. The only one left is removing the old hook.
- Tests:
  - `guard.sh`, run with a fake `hook-command`, a fake `PATH` and neither, checking stdin pass-through and exit codes;
  - writing `hook-command`: content, mode, skipped from an `npx` cache, unchanged content not rewritten;
  - plugin detection and the four states;
  - the card and `install-guard` output for each state;
  - the getting-started page's first-visit gate and its ticks;
  - the plugin and npm versions matching;
  - `hooks.json` pointing at a file that exists and is executable.

## Left to the builder

- Module names, and how `hook-command` writing is shared between `ui` and the server.
- The skill's exact wording within the points above, and its description's exact trigger phrases.
- Removing now-unused install code and tests, as long as uninstall keeps every safety check it has.
- Styling of the getting-started page within the dashboard's existing look.
