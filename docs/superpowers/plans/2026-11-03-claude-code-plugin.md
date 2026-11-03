# Claude Code Plugin and Getting Started Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the agent guard and a `git-grove` skill as a Claude Code plugin from this repo. Stop writing the hook
into `settings.json`, except to remove an old one. Add a three-step Getting started page.

**Architecture:**
- The repo root becomes a Claude Code marketplace, with the plugin in `plugin/`. Its `PreToolUse` hook is a POSIX
  `guard.sh` that runs the grove recorded in `<grove home>/hook-command`.
- `git grove ui` and the server write that file.
- The server's `GuardState` gains the plugin facts and a derived `phase`/`done`. The CLI uses the same derivation.
- The UI's guard card, sidebar label and the new `#/setup` page all read from `phase`/`done`.

**Tech Stack:** TypeScript 7, Node 24, vitest 5, vanilla-TS UI (`html` tag, `SafeHtml`), POSIX `sh`.

**Spec:** `docs/superpowers/specs/2026-11-03-onboarding-welcome-design.md`

## Global Constraints

- Plugin and marketplace names: both `git-grove`. The plugin is `git-grove@git-grove`. The marketplace owner is
  `symaticvisuals`. The plugin source is `./plugin`.
- Install commands, verbatim, in this order:
  - `claude plugin marketplace add symaticvisuals/git-grove`
  - `claude plugin install git-grove@git-grove`
- `plugin/.claude-plugin/plugin.json` `version` equals `package.json` `version` (now `0.2.0`).
- `hooks.json`: one `PreToolUse` group, matcher `Bash`, `"type": "command"`,
  `"command": "\"${CLAUDE_PLUGIN_ROOT}\"/hooks/guard.sh"`, `"timeout": 10`.
- `hook-command` file: `<grove home>/hook-command`. Line 1 is the Node, line 2 is the absolute `dist/cli/bin.js`. Mode
  0600. Written through a temp file and a rename, and only when the content changes. Never written for an ephemeral bin
  (`isEphemeralBin`).
- The `guard.sh` not-found message, verbatim, to stderr, then exit 0:
  `git grove guard: git grove is not installed or has not run yet; run git grove ui`
- No new runtime dependencies. `guard.sh` uses no `jq`, `node -e` or other helpers.
- The guard binary (`git grove guard --claude`) and its exit codes do not change.
- The UI imports only types from `src/`. Anything the UI needs (commands, phase) comes over `GET /api/guard`.
- Style: one exported function per file, JSDoc on exports in the codebase's voice, comments sparing, no `any`.
- Package manager: `pnpm`. Tests: `pnpm vitest run <path>`. Types: `pnpm typecheck`.

## Review Focus

1. **`hook-command` points at a Node or bin that was since removed** (Node upgrade, `npm uninstall`). `guard.sh` must
   fall back to `PATH`, then to the not-found message, and never exit non-zero. The test is in Task 1.
2. **Hook stdin with a large command (≥ 64 KB) or non-ASCII text.** `guard.sh` must pass stdin through byte-for-byte
   with `exec`. The test is in Task 1.
3. **`HOME` with spaces, and `GIT_GROVE_HOME` set.** `guard.sh` must quote every path and use `GIT_GROVE_HOME` when
   set. The test is in Task 1.
4. **`settings.json` has `enabledPlugins` but `"git-grove@git-grove": false`, or a non-object `enabledPlugins`.** It
   must read as not enabled, never unreadable. The test is in Task 3.
5. **A user upgrading from PR #4 whose old hook is `stale`** (an old Node path). The phase must be `hook`, and the card
   must offer the plugin commands and "Remove the old hook…", never Update…. The test is in Task 5.

---

### Task 1: The plugin package (marketplace, manifest, hook, skill)

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugin/.claude-plugin/plugin.json`
- Create: `plugin/hooks/hooks.json`
- Create: `plugin/hooks/guard.sh` (mode 0755, committed with the executable bit)
- Create: `plugin/skills/git-grove/SKILL.md`
- Test: `test/plugin/plugin-package.test.ts`
- Test: `test/plugin/guard-sh.test.ts`

**Interfaces:**
- Produces: the hook-command file format (two lines, Node then bin), consumed by Task 2. Also the plugin id
  `git-grove@git-grove`, consumed by Task 3.

- [ ] **Step 1: Write the failing package tests** in `test/plugin/plugin-package.test.ts`:
  - `test("the marketplace lists one plugin, git-grove, from ./plugin")`: parses `.claude-plugin/marketplace.json` and
    expects `name` `"git-grove"`, `owner.name` `"symaticvisuals"`, and `plugins` equal to
    `[{ name: "git-grove", source: "./plugin", description: expect.any(String) }]`.
  - `test("the plugin's version is the npm package's")`: `plugin.json` `version` equals `package.json` `version`, and
    `name` is `"git-grove"`.
  - `test("the hook runs guard.sh on Bash with a 10 s timeout")`: `hooks.json` deep-equals the constraint's shape.
    `plugin/hooks/guard.sh` exists and `(mode & 0o111) !== 0`.
  - `test("the skill is named git-grove and its description names what it is for")`: the frontmatter has
    `name: git-grove`, and the description contains `worktree`, `branch` and `blocked`. The body contains
    `git grove check remove`, `git grove rm --rescue`, `git grove restore`, and each of `git grove ack`,
    `git grove pins prune` and `git grove rm --force` under a "never" line.

- [ ] **Step 2: Write the failing `guard.sh` tests** in `test/plugin/guard-sh.test.ts`.
  - Setup: each test spawns `sh plugin/hooks/guard.sh` with a controlled env (`HOME`, `GIT_GROVE_HOME`, `PATH`) and
    stdin. The test's `fakeNode` is a script that echoes its argv on stdout and copies stdin to a file.
  - `test("it runs the recorded node and bin with guard --claude and passes stdin through")`: `hook-command` names the
    fake node and an existing fake `bin.js`. Expect the argv echo `<bin> guard --claude` and stdin copied byte-for-byte.
    Use a 70 000-byte stdin with `é` and a newline in it. Expect the fake's exit code to pass through: the fake exits
    2, so the result is 2.
  - `test("a recorded node that is gone falls back to git-grove on PATH")`: `hook-command` points at a missing node.
    `PATH` holds a fake `git-grove` echoing its argv. Expect `guard --claude`.
  - `test("with nothing recorded and nothing on PATH it allows, saying why")`: exit 0, stderr equals the constraint's
    message plus `\n`, stdout empty.
  - `test("GIT_GROVE_HOME and a HOME with spaces are honoured")`: `HOME=/tmp/x/a b`, with `hook-command` under
    `GIT_GROVE_HOME`. Expect it found.

- [ ] **Step 3: Run both test files and confirm they fail** (missing files).
  Run: `pnpm vitest run test/plugin`. Expected: FAIL (ENOENT).

- [ ] **Step 4: Create the five plugin files.**
  - `marketplace.json`: `name`, `owner: { name: "symaticvisuals" }`, and one plugin entry with a one-line
    description.
  - `plugin.json`: `name`, `version` `"0.2.0"`, `description`, `homepage`
    `https://github.com/symaticvisuals/git-grove`, `license` `"MIT"`.
  - `guard.sh`, in this order:
    1. `home="${GIT_GROVE_HOME:-$HOME/.git-grove}"`.
    2. If `$home/hook-command` is readable, read the two lines with `{ IFS= read -r node; IFS= read -r bin; }`. If
       `[ -x "$node" ] && [ -f "$bin" ]`, run `exec "$node" "$bin" guard --claude`.
    3. If `command -v git-grove >/dev/null 2>&1`, run `exec git-grove guard --claude`.
    4. Print the message, then `exit 0`.
  - `SKILL.md`: frontmatter `name` and a `description` per the spec's trigger list. The body follows the spec's six
    points as short sections, starting from the README's agent note.

- [ ] **Step 5: Run the tests and confirm they pass.** Run: `pnpm vitest run test/plugin`. Expected: PASS.

- [ ] **Step 6: Commit.**
  ```bash
  git add .claude-plugin plugin test/plugin
  git commit -m "feat(plugin): a Claude Code plugin with the agent guard hook and a git-grove skill"
  ```

### Task 2: Record the grove the hook runs (`hook-command`)

**Files:**
- Create: `src/core/guard-install/hook-command.ts`
- Modify: `src/server/guard/guard-setup.types.ts`: `GuardSetup` gains `home: string`.
- Modify: `src/cli/real-guard-setup.ts`: return `home: groveHome()`.
- Modify: `src/server/start-server.ts`: after `writeServerFile`, when `options.guard` is set, call
  `writeHookCommand(home, setup.node, setup.bin)`. Ignore its errors, but write one line to stderr.
- Modify: `src/cli/commands/ui.ts`: at the start of `uiCommand`, call
  `writeHookCommand(home, stableNodePath(), deps.bin)`. The `UiDeps` that tests build may inject `node?: string`.
- Test: `test/core/guard-install/hook-command.test.ts`
- Test: `test/server/start-server.test.ts`, one new test
- Test: `test/cli/ui-command.test.ts`, one new test

**Interfaces:**
- Produces:
  - `hookCommandPath(home: string): string`
  - `writeHookCommand(home: string, node: string, bin: string): Promise<"written" | "unchanged" | "ephemeral">`
  - `readHookCommand(home: string): Promise<{ node: string; bin: string } | null>`: null when the file is missing,
    malformed, or either path no longer exists.

- [ ] **Step 1: Write the failing tests** in `hook-command.test.ts`:
  - `writes node and bin as two lines, mode 0600`: expects `"written"`, the text `${node}\n${bin}\n`, and
    `stat.mode & 0o777` equal to `0o600`.
  - `the same content again is "unchanged" and keeps the file's mtime`.
  - `an npx-cache bin writes nothing and answers "ephemeral"`: the bin path contains `/_npx/`, and the file is absent.
  - `readHookCommand is null when either path is gone, or the file has fewer than two lines`.
  - The start-server test expects `<home>/hook-command` to exist after start when `guard` is given.
  - The ui-command test expects the file written with the injected node and bin.

- [ ] **Step 2: Run them and confirm they fail.**
  Run: `pnpm vitest run test/core/guard-install/hook-command.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `hook-command.ts`.**
  - Write through a temp file in `home` with `wx` and mode 0600, then `rename`, the same pattern as
    `write-server-file.ts`.
  - Before writing, compare against the current text.
  - Then wire the call into `start-server.ts` and `ui.ts` as listed above.

- [ ] **Step 4: Run the three test files and `pnpm typecheck`, and confirm both pass.**

- [ ] **Step 5: Commit.**
  ```bash
  git commit -am "feat(guard): record the grove the plugin's hook runs, in hook-command"
  ```

### Task 3: The guard's phase: plugin, old hook, both, or neither

**Files:**
- Modify: `src/core/guard-install/guard-install.types.ts`:
  - `GuardReading` gains `pluginEnabled: boolean`.
  - Add `export type GuardPhase = "plugin" | "plugin-and-hook" | "hook" | "absent"`.
  - `GuardState` gains `plugin: boolean; hookCommand: boolean; ephemeral: boolean; phase: GuardPhase; done: boolean;
    installCommands: string[]`.
- Modify: `src/core/guard-install/read-guard-status.ts`: set `pluginEnabled` to
  `isJsonObject(settings["enabledPlugins"]) && settings["enabledPlugins"]["git-grove@git-grove"] === true`. Set it to
  false when the file is unreadable.
- Create: `src/core/guard-install/plugin-commands.ts`:
  - `export const PLUGIN_ID = "git-grove@git-grove"`
  - `export const PLUGIN_INSTALL: readonly string[]`, the two commands verbatim.
- Create: `src/core/guard-install/guard-phase-of.ts`:
  - `guardPhaseOf(input: { reading: GuardReading; hookCommand: boolean }): { phase: GuardPhase; done: boolean }`
  - The old hook is present when `status` is `installed` or `stale`.
  - `phase` is `plugin-and-hook` when the plugin is enabled and the old hook is present, `plugin` when only the
    plugin is enabled, `hook` when only the old hook is present, and `absent` otherwise.
  - `done` is `phase === "plugin" && !reading.hooksDisabled && hookCommand`.
- Modify: `src/server/guard/guard-installer.ts`:
  - `state()` fills the new fields: `hookCommand` from `readHookCommand(setup.home) !== null`, `ephemeral` from
    `isEphemeralBin(setup.bin)`, `installCommands` from `[...PLUGIN_INSTALL]`, and `phase`/`done` from
    `guardPhaseOf`.
  - `refusal` keeps its current meaning: an ephemeral server, or a settings file grove won't edit.
- Modify: `src/cli/real-ui-deps.ts`: `guardStatus` becomes `guardDone: () => Promise<boolean>`, using
  `guardPhaseOf({ reading, hookCommand: !isEphemeralBin(binPath()) })`. `ui` has just written the file in Task 2.
- Test: `test/core/guard-install/read-guard-status.test.ts`, new cases
- Test: `test/core/guard-install/guard-phase-of.test.ts`
- Test: `test/server/guard-api.test.ts`, new cases

**Interfaces:**
- Consumes: `readHookCommand(home)` (Task 2), and the plugin id (Task 1).
- Produces: `GuardPhase`, the new `GuardState` fields, `guardPhaseOf`, and `PLUGIN_INSTALL`, for Tasks 4–6.

- [ ] **Step 1: Write the failing tests.**
  - `read-guard-status`:
    - `{"enabledPlugins":{"git-grove@git-grove":true}}` reads `pluginEnabled: true`.
    - `false`, a missing key, `"enabledPlugins": []` and `"enabledPlugins": "x"` each read `false` with status
      `absent`, never `unreadable`.
  - `guard-phase-of`, one test per row:

    | Plugin | Old hook | Hooks off | hookCommand | Result |
    |---|---|---|---|---|
    | on | `absent` | off | true | `plugin`, done |
    | on | `absent` | on | true | `plugin`, not done |
    | on | `absent` | off | false | `plugin`, not done |
    | on | `stale` | off | true | `plugin-and-hook`, not done |
    | off | `installed` | off | true | `hook` |
    | off | `stale` | off | true | `hook` |
    | off | `absent` | off | true | `absent` |
    | off | `unreadable` | off | true | `absent` |

  - `guard-api`: `GET /api/guard` with a temp settings file enabling the plugin and a temp home holding a valid
    `hook-command` answers `phase: "plugin", done: true`, with `installCommands` equal to the two commands.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement the type changes, `plugin-commands.ts`, `guard-phase-of.ts`, the `read-guard-status` field
  and the `state()` fields.**

- [ ] **Step 4: Run `pnpm vitest run test/core/guard-install test/server/guard-api.test.ts` and `pnpm typecheck`, and
  confirm they pass.** Fix any test fixtures that build a `GuardState` by hand, adding the new fields.

- [ ] **Step 5: Commit.**
  ```bash
  git commit -am "feat(guard): tell the plugin from the old settings hook, and when the guard is really on"
  ```

### Task 4: Grove stops installing the settings hook; it only removes one

**Files:**
- Modify: `src/core/guard-install/guard-install.types.ts`:
  - `GuardChange` becomes `"uninstall"`.
  - `GuardReceipt.undo` becomes `null` (type `null`).
- Delete: `src/core/guard-install/plan-guard-install.ts` and `test/core/guard-install/plan-guard-install.test.ts`.
  Delete any helpers left unused afterwards. `pnpm typecheck` reports them, for example `guard-hook-group.ts` if
  nothing else imports it.
- Modify: `src/core/guard-install/prepare-guard-change.ts`: uninstall only. Drop the `install` entries of
  `PICKUP`/`ADVICE` and the `refusal` input if it is now unused.
- Modify: `src/server/api/guard-routes.ts`. `POST /api/guard/plans`:
  - accepts only `{ change: "uninstall" }`;
  - answers `{ change: "install" }` with 400 and
    `the agent guard installs as a Claude Code plugin: claude plugin marketplace add symaticvisuals/git-grove, then claude plugin install git-grove@git-grove`.
- Modify: `src/cli/commands/install-guard.ts`. `installGuardCommand(io, where)`:
  - it prints exactly these lines:
    ```text
    Install the agent guard as a Claude Code plugin:

      claude plugin marketplace add symaticvisuals/git-grove
      claude plugin install git-grove@git-grove

    git grove changed no file. Run git grove ui once so the plugin's hook can find git grove.
    ```
  - it returns 0;
  - from an ephemeral bin it also prints the `ephemeralRefusal` line to stderr and returns 1.
- Modify: `src/cli/commands/ui.ts`:
  - delete `OFFER_GUARD` and its call inside `startService`;
  - after the server is found or started, when `deps.guardDone` exists and resolves false, print one line:
    `Protect your worktrees from Claude Code: claude plugin marketplace add symaticvisuals/git-grove, then claude plugin install git-grove@git-grove`
  - print it on every run.
- Test: `test/cli/install-guard.test.ts` (rewrite)
- Test: `test/cli/ui-command.test.ts` (update the guard cases)
- Test: `test/server/guard-api.test.ts`, the install rejection
- Test: `test/core/guard-install/run-guard-change.test.ts`, drop the install cases

**Interfaces:**
- Consumes: `PLUGIN_INSTALL` (Task 3), and `guardDone` (Task 3).
- Produces: `GuardChange = "uninstall"`, used by Task 5's UI.

- [ ] **Step 1: Update the tests first.**
  - `install-guard`: the exact stdout above, and exit 0. The ephemeral case exits 1 with the refusal on stderr.
  - `ui-command`:
    - `guardDone` false: the line is printed when a server is already running.
    - `guardDone` true: no line.
  - `guard-api`: an install plan answers 400 with that message. The uninstall plan and run still pass unchanged.

- [ ] **Step 2: Run them and confirm the new cases fail.**

- [ ] **Step 3: Make the changes above.** Then run `pnpm typecheck` and delete what it reports as unused.

- [ ] **Step 4: Run `pnpm vitest run test/cli test/server test/core/guard-install`, and confirm it passes.**

- [ ] **Step 5: Commit.**
  ```bash
  git commit -am "feat(guard): point install at the Claude Code plugin; grove only removes an old settings hook"
  ```

### Task 5: The guard card and sidebar label by phase

**Files:**
- Modify: `ui/src/render/guard-card.ts`. `guardCard(guard, dismissed)`, where `dismissed: GuardPhase | null`.
  Nothing renders when `done`, when the phase was dismissed, or while loading. Otherwise:

  | Phase | Title | Body | Buttons |
  |---|---|---|---|
  | `absent` | "Protect worktrees from Claude Code" | the existing `BODY`, then each of `installCommands` as a command row with Copy | "Not now" |
  | `hook` | "Switch the agent guard to the Claude Code plugin" | the install commands | "Then remove the old hook…", which opens the `uninstall` dialog; "Not now" |
  | `plugin-and-hook` | "The agent guard runs twice" | "The plugin and an old hook in settings.json both run it." | "Remove the old hook…" |
  | `plugin`, not done | "Finish the agent guard" | the reason, below | none |

  Every card also keeps today's notes: `state.refusal`, when set, as a `gc-note`. That covers an unreadable or read-only
  `settings.json`, which reads as `absent`.

  The not-done reasons for `plugin`:
  - when `hooksDisabled`: the existing hooks-off note;
  - when `!hookCommand` and `ephemeral`:
    `Install git grove for the plugin to run it: npm i -g @deepanshugoel/git-grove`;
  - when `!hookCommand` otherwise: `The plugin's hook can't find git grove yet. Run git grove ui once.`

- Create: `ui/src/render/command-row.ts`:
  - `commandRow(command: string, key: string): SafeHtml` renders
    `<div class="cmd"><code>…</code><button class="btn" data-ui="copy" data-copy="…" data-key="…">Copy</button></div>`.
  - `ui/src/main.ts` handles `data-ui="copy"` with `navigator.clipboard.writeText` and the existing toast ("Copied").
- Modify: `ui/src/render/guard-status.ts`. `label(state)`:
  - `done`: "Agent guard on";
  - `plugin-and-hook`: "Agent guard runs twice";
  - `hook`: "Agent guard: old hook";
  - `plugin`, not done: "Agent guard not running";
  - `absent`: "Agent guard off".
  - The `.on` class only when `done`.
- Modify: `ui/src/is-guard-status.ts` → `isGuardPhase(value: unknown): value is GuardPhase`. Update the
  `guard-dismiss` action, the reducer and the `GUARD_DISMISSED` storage in `main.ts` to store a phase. An old stored
  status is ignored.
- Modify: `ui/src/main.ts:359`. The sidebar's guard button opens the uninstall dialog only when the phase is `hook` or
  `plugin-and-hook`. Otherwise it scrolls the card into view.
- Modify: `ui/src/render/guard-dialog-parts.ts`: drop the `install` branches.
- Test: `test/ui/guard.test.ts`

**Interfaces:**
- Consumes: the `GuardState` fields from Task 3.
- Produces: `commandRow(command, key)`, used by Task 6.

- [ ] **Step 1: Write the failing UI tests** in `test/ui/guard.test.ts`, one per row and reason above. Each asserts
  the title, that every command in `installCommands` appears, the buttons present, and that none says "Install…" or
  "Update…". Add Review Focus #5: old hook `stale` with plugin off renders the `hook` card. Also:
  - the label for each phase;
  - `isGuardPhase("installed")` is false.
- [ ] **Step 2: Run `pnpm vitest run test/ui/guard.test.ts` and confirm it fails.**
- [ ] **Step 3: Implement the card, `commandRow`, the label, the copy handler, and `isGuardPhase` with its dismissal
  wiring.** Add styles for `.cmd` in `ui/styles.css`: mono, `--bg` background, `--line` border, flex row.
- [ ] **Step 4: Run `pnpm vitest run test/ui` and `pnpm typecheck`, and confirm both pass.**
- [ ] **Step 5: Commit.**
  ```bash
  git commit -am "feat(ui): the guard card offers the plugin and removing an old hook"
  ```

### Task 6: The Getting started page

**Files:**
- Modify: `ui/src/parse-route.ts`: add `{ view: "setup" }` for `#/setup`, and `routeHash` back to `#/setup`.
- Create: `ui/src/render/setup-view.ts`:
  - `setupView(projects: Load<WireProject[]>, guard: Load<GuardState> | null, next: string): SafeHtml`
  - The title is "Getting started", then the three steps from the spec, verbatim.
  - Step 1 ticks when the projects list is loaded and non-empty. Its command is `git grove ui`.
  - Step 2 ticks when `guard.data.done`. Its commands are `installCommands`, each a `commandRow`. In `hook` and
    `plugin-and-hook` it adds the "Remove the old hook…" button from Task 5.
  - Step 3 has no tick, and its command is `git grove service status`.
  - The footer link is "Go to the dashboard", with `href` equal to `next`.
- Modify: `ui/src/render/main-view.ts`: route `setup` → `setupView`.
- Modify: `ui/src/render/sidebar.ts`: add `nav("#/setup", route.view === "setup", ICONS.<existing check or logo>,
  "Getting started")` after Pins.
- Modify: `ui/src/main.ts`:
  - On boot, when `storage()?.getItem("grove.setupSeen")` is null:
    1. set it to `"1"`;
    2. remember `location.hash || "#/"` as `next`;
    3. replace the location with `#/setup`.
  - `next` stays in state for the footer link. Visiting `#/setup` later uses `#/` as `next`.
- Test: `test/ui/parse-route.test.ts`, the new route
- Test: `test/ui/setup-view.test.ts`

**Interfaces:**
- Consumes: `commandRow` (Task 5), and `GuardState.done`/`installCommands`/`phase` (Task 3).

- [ ] **Step 1: Write the failing tests.**
  - `parseRoute("#/setup")` returns `{ view: "setup" }`, and it round-trips through `routeHash`.
  - `setupView`:
    - with no projects, step 1 is not ticked and shows `git grove ui`;
    - with one project, it is ticked;
    - with `done: false, phase: "absent"`, step 2 shows both commands and no remove button;
    - with `phase: "hook"`, step 2 has "Remove the old hook…";
    - with `done: true`, step 2 is ticked;
    - step 3 always shows `git grove service status`;
    - the footer `href` equals `next`, and a `next` of `#/r/3` is escaped and kept.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement the route, the view, the sidebar item and the first-visit gate.** Reuse `.guard-card`-like
  spacing, with new styles kept to a `.setup` block in `ui/styles.css`.
- [ ] **Step 4: Run `pnpm vitest run test/ui` and `pnpm typecheck`, and confirm both pass.** Then build and open the
  dashboard on the demo:
  ```bash
  pnpm build && pnpm demo
  ```
  Clear `localStorage` and check that the first load shows Getting started, and that "Go to the dashboard" returns to
  the opened address.
- [ ] **Step 5: Commit.**
  ```bash
  git commit -am "feat(ui): a Getting started page with the three steps, shown once"
  ```

### Task 7: README

**Files:**
- Modify: `README.md`, the Agents section, the Commands block (`install-guard` comment) and the "Not yet" list, if it
  mentions the settings installer.

- [ ] **Step 1: Rewrite Agents to lead with the plugin.**
  - The two commands, in an `sh` block.
  - What the hook and the skill each do.
  - "Run `git grove ui` once so the hook can find git grove (`~/.git-grove/hook-command`)."
  - `--bare` and `--safe-mode` skip plugins, so the guard is off there.
  - Upgrading from 0.2.0: the dashboard offers "Remove the old hook…" so the guard runs once.
  - Replace the `CLAUDE.md` note block with one sentence pointing to the plugin's `git-grove` skill.
- [ ] **Step 2: Check that the whole suite passes and the docs mention no removed command.**
  ```bash
  pnpm typecheck && pnpm vitest run && grep -n "Install…\|Update…" README.md
  ```
  Expected: tests pass, and the grep prints nothing.
- [ ] **Step 3: Commit.**
  ```bash
  git commit -am "docs: install the agent guard as a Claude Code plugin; the skill replaces the CLAUDE.md note"
  ```
