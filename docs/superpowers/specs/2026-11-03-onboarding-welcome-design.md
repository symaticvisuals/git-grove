# Onboarding: the welcome page

## Why

Someone who has just run `npm i -g @deepanshugoel/git-grove` and `git grove ui` lands on a Projects list and, at most,
one card offering the agent guard. Two other parts of being covered are only in the README: the login service that
keeps grove watching after the tab closes, and the note that tells agents how to behave around the guard. The welcome
page walks a new user through every step, one at a time, so they know exactly what to do and when they are done.

## Goals

- On first open, the dashboard shows a welcome page instead of Projects, with four steps:
  1. **Watching your repos**
  2. **Protect worktrees from Claude Code** (the agent guard)
  3. **Keep watching after you close this tab** (the login service)
  4. **Tell your agents about grove** (the `CLAUDE.md` note)
- Each step shows whether it is done by reading the real state, not just a click.
- The page stays until every step is done or skipped, or the user picks "Skip setup".
- That answer is remembered per machine, in grove's home folder.
- A "Setup" item in the sidebar reopens the page at any time. It shows a dot while a step is still open.

## Non-goals

- A tour of the dashboard, tooltips, or coach marks.
- Changing the Projects list, the guard card, or `git grove ui`'s own output.
- Installing the login service from the dashboard. `git grove ui` already does that on first run, so step 3 reports its
  status and, when it is missing, gives the command.
- Removing the `CLAUDE.md` note from the dashboard.

## Anti-goals: it has failed if…

- Grove writes a file the user did not review first. The `CLAUDE.md` note goes through a review exactly like the
  guard's `settings.json` change.
- The page keeps coming back after the user skipped it. That would happen with browser storage, which is per port, and
  grove moves between 20 ports.
- A step shows as done when it isn't, for example a ticked guard that is actually stale.
- It blocks someone who wants to go straight to the dashboard. "Skip setup" is always one click away.

## Behaviour

### When it shows

- Setup is open when at least one step is neither done nor skipped, and the user has not chosen "Skip setup".
- While setup is open, the first page load shows the welcome page, whatever address was opened. That includes the
  `#/r/<id>/…` deep link `git grove ui` opens inside a repo. The browser keeps the address it was opened at.
- When the user finishes or skips setup, the dashboard goes on to that address, or to Projects when it was `#/`.
- Moving around the dashboard after that first load never brings the page back in the same visit. This is a gate in
  the UI's routing; `git grove ui` does not change.
- `#/setup` always shows the page, from the sidebar's "Setup" item.
- People upgrading from 0.2.0 have no `setup.json`, so they see the page once too, with the steps they have already
  done ticked. There is no migration.
- The sidebar dot shows while any step is neither done nor skipped, even after "Skip setup". A guard that later goes
  stale brings the dot back without bringing the page back; the guard card on Projects warns about it too. *(my call)*

### The page

- It uses layout B from the mockups:
  - a title ("Welcome to git grove") and one line on what grove does;
  - the four steps as a numbered list, with the current step expanded and the others collapsed to their title and one
    line.
- The current step is the first one that is neither done nor skipped.
- A done step shows a tick and a short summary.
- A skipped step shows "Skipped" and an "Undo skip" link.
- Each open step has its action button and a "Skip" link.
- "Skip setup, go to the dashboard →" is at the bottom.
- When the last step is done or skipped, the page says "You're set up", with a button to go to Projects.

### Step 1: Watching your repos

- **Done when** grove watches at least one repository.
- **Done shows** each watched repo's name, folder, and worktree count.
- **Open shows**, for example when the dashboard was opened by the login service outside any repo: "Run this inside a
  repository you work in:", the command `git grove ui` with a Copy button, and a note that the page updates on its own
  once grove sees the repo.
- **Done or open,** a line explains how to add another repo: run `git grove ui` inside it.
- No Skip: without a repo, grove watches nothing.

### Step 2: Protect worktrees from Claude Code

- Done when the guard is installed and up to date, and Claude Code's hooks are on: `status === "installed"` and not
  `hooksDisabled`. *(my call: a guard that never runs is not done)*
- Open: the guard card's text and its button, "Install…", or "Update…" when stale. The button opens the existing guard
  review dialog. The step does not get its own install path.
- When grove refuses to install, the refusal text is shown and the button is left out, as on the guard card today.
  Cases: an `npx` cache, or an unreadable or read-only settings file.
- When the settings file turns hooks off (`disableAllHooks`), the step shows the guard card's note about it and keeps
  the button, as the card does.
- While the step is open, the guard card on Projects behaves as it does now. Skipping the step is not "Not now" on the
  card: each keeps its own answer. *(builder's call)*

### Step 3: Keep watching after you close this tab

- Done when the login service is installed and loaded (launchd) or running (systemd).
- Open: one of these, by cause.
  - **Not installed:** "Pins only happen while grove runs.", the command `git grove service install` with a Copy button,
    and a "Check again" button.
  - **Running from an npx cache:** "This git grove runs from an npx cache, so it installs no login service. Install it
    first:", and the command `npm i -g @deepanshugoel/git-grove` with a Copy button.
  - **No launchd or systemd user session:** "This machine has no login service manager, so run `git grove serve` when
    you want grove watching." The step is skippable and offers no button.
  - **Installed but drifted:** the same line `git grove service status` prints for it, for example "it runs another
    copy of git grove". Then the command `git grove ui`, which repairs it, with a Copy button. Drift is measured
    against the copy of grove, the Node, the grove folder and the `CLAUDE_CONFIG_DIR` the dashboard server itself runs
    with, so a server the service started is never drifted. *(my call)*
  - **Installed but not running:** "The login service is installed, but this dashboard was started another way, so the
    service waits. It takes over at your next login." No command. This counts as done: the service is in place.
    *(my call)*
- A new read-only route reports this state. The dashboard never installs the service.

### Step 4: Tell your agents about grove

- The note is the `## git grove` section the README already gives, as one constant shared by the README check and the
  server.
- The file is the `CLAUDE.md` in the folder that holds the Claude Code settings file the guard installs into, so it
  follows `CLAUDE_CONFIG_DIR` exactly as the guard does. That is `~/.claude/CLAUDE.md` by default.
- Done when that file, or a file it imports, has a line that is exactly `## git grove`. Imports are `CLAUDE.md` lines of
  the form `@<path>` (a `~/` or relative path), followed one level deep, as Claude Code reads them. A user-wide
  `CLAUDE.md` is often only an import of another file, so this stops grove adding a second copy. *(my call)*
- The step waits for step 2. Until the guard step is done, it shows "Install the agent guard first: this note tells
  agents how to work with it." and no button, because the note says the guard runs. Skipping step 2 leaves step 4
  waiting, and step 4 can be skipped on its own. *(my call)*
- Open: one sentence on what the note does, the note itself in a code block with a Copy button, and "Add to
  CLAUDE.md…".
- "Add to CLAUDE.md…" opens a review, the same dialog shell as the guard's:
  - the file path;
  - whether the file exists;
  - the exact text that will be appended;
  - the note "Nothing already in the file changes.";
  - a confirm button that arms 400 ms after the plan appears, like every other review.
- The write follows the safety rules of the guard's `settings.json` write:
  - it is planned against the file as read, and refused when the file changed since;
  - it writes through a temp file and a rename, keeping the file's mode and any symlink;
  - it is refused when the file is read-only, is not a regular file, or the folder can't be written;
  - when grove refuses to install from here (an `npx` cache), the step offers only Copy.
- The text is appended at the end, after one blank line. It creates the file, mode 0644, when there is none. A file that
  already has the heading is never written.
- The receipt says what was written and that removing the `## git grove` section by hand undoes it.

### Remembering

- Grove's home folder (`$GIT_GROVE_HOME` or `~/.git-grove`) gets `setup.json`:
  `{ "skippedSteps": ["service"], "dismissedAt": 1793686435768 }`.
- Only skips and "Skip setup" are stored. Whether a step is done is always read live.
- An unreadable or malformed file is treated as empty and rewritten on the next change.
- The server writes `setup.json` through a temp file and a rename, mode 0600, like grove's other files there.

### API (shape; names are the builder's call)

- `GET /api/setup` returns each step's state and the stored skips and dismissal, in one response:
  - `repos`: the watched repos;
  - `guard`: the same `GuardState` as `/api/guard`;
  - `service`: `{ kind, installed, running, problem }`;
  - `agentNote`: `{ path, present, refusal }`.
- `POST /api/setup` takes `{ skip?: step, unskip?: step, dismiss?: boolean }` and returns the new state.
- `POST /api/setup/agent-note/plans` and `POST /api/setup/agent-note/actions` mirror the guard's plan and run pair, with
  their own plan cache, so a plan runs once by id.
- All of these sit behind the existing gate: the token, a same-origin request and a JSON body.

## Constraints

- Vanilla TypeScript UI, through the existing `html` tag and `SafeHtml`. No new runtime dependencies.
- Every new server route goes through `checkRequest`. Writes outside git, like the guard and `CLAUDE.md`, take no repo
  lock.
- The dashboard's existing look: the colours in `ui/styles.css`, the same buttons, and the same dialog shell as reviews.
- Every string reads like the rest of the dashboard: plain, short, no exclamation marks.
- Tests: the server routes (state, skip, plan and run of the note, its refusals), the `CLAUDE.md` writer (append,
  create, already present, changed since planned, read-only, symlink kept), and the UI reducer and render for each step
  state.

## Left to the builder

- Module and file names, how the step state is computed, and how the reducer models it.
- Exact copy beyond what is quoted above.
- Whether the "Check again" button polls once or the page reuses the existing live events for repos and guard state.
- The icon for the sidebar item.
