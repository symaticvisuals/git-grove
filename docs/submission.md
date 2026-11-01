# git-grove: submission outline

The video has a 10-minute cap, but the brief's section ranges add up to 12–15 minutes. This plan fits 10:00.

| Section | Brief asks | Planned | Rubric line it serves |
|---|---|---|---|
| Problem framing | 2–3 min | 2:00 | Problem identification |
| System design | 5–6 min | 4:00 (includes 1:30 of live demo) | Technical understanding |
| Tradeoffs | 3–4 min | 2:30 | Scoping, self-awareness |
| Failure modes | 2 min | 1:30 | Self-awareness |

## 1. Problem framing (2:00)

**The moment (40 s).** On a client project I keep 4–10 git worktrees open at once, several with AI coding agents working in them, and features shipped as stacks of small PRs. In two months, three things happened and nothing failed loudly:

- A stack branch went from 16 commits to 1 in a rebase nobody ran on purpose. Tests passed, the code was identical, and a reviewer only found it by reading the reflog.
- An agent's "clean up merged worktrees" pass removed 16 worktrees that were clean, pushed and merged, and deleted gitignored work that existed only inside them.
- A stacking tool was one command away from force-pushing branches from other features, because it saw every branch it had ever touched as one stack.

A fourth, reproduced while designing this: put one stack level's worktree inside another's folder, leave an uncommitted file in the inner one, and a plain `git worktree remove` of the outer one (no `--force`) deletes both. Git only refuses on changed or untracked files, and the inner folder is ignored.

**Why it's hard (60 s).**

1. Nothing fails. Git accepts every one of these operations. The signal is something missing, not an error.
2. The state is scattered: worktrees, refs, reflogs, stack metadata in git config, ignored files, stashes, PRs. No single command shows it.
3. "Clean" lies. `git status` says clean while the only copy of a seed file sits in an ignored folder.
4. Normal work looks like damage. Rebases and amends rewrite history too. Alarm on every rewrite and people stop reading. Telling a rebase from a squash is the real problem.
5. Agents act fast and in parallel, so protection has to sit in the agent's path, before the command runs, not in a report afterwards.

**What it is and isn't (20 s).** Tools like Conductor and Claude Squad help you start parallel work in worktrees. Nothing I found watches whether that work is still intact. git-grove is a seatbelt, not an orchestrator: it watches automatically and acts only when asked.

## 2. System design (4:00)

**Shape (30 s).** Show the architecture diagram: four ways in (watcher, agent guard, CLI, dashboard server), one shared core, two places state lives (pins as git refs; a local SQLite journal). "Every door calls the same core, so the dashboard and the guard can never disagree about what's safe."

**How it decides (1:00).**

- Facts: what git says, in three tiers by cost. About four git processes per scan for the whole repo; per-worktree status only when that worktree changed. That's what makes 100 worktrees cheap.
- Classifier: when a tip moves backwards, pin it first, compare only the branch's own commits, match by patch ID then by author, date and subject, then decide advanced, amended, rebased or rewritten. Show the measured table: rebase, conflict rebase and restack after a squash merge all read "rebased"; a 3-into-1 squash reads "rewritten (3)"; plain `git cherry` would have reported 2 lost changes on the restack.
- Predicates and rules: predicates answer yes or no with reasons; rules turn them into findings with a severity and one action; the guard uses the same predicates.

**Three paths, live (1:30).** On the `git grove demo` repo:

1. Squash a stack level. The dashboard shows "rewritten: 14 changes no longer present" within seconds; `git grove restore` brings them back.
2. Ask a Claude Code agent to clean up merged worktrees. The guard blocks `git worktree remove --force` and tells the agent why; the agent runs `git grove rm --rescue`, and the seed file lands in the main checkout.
3. Walk Projects → Features → the stack tree; point at drift, the parent-merged level, and the activity feed naming which agent session did what.

**Where state lives (30 s).** Git is the truth: everything on screen is recomputed from git on each scan. The database is memory: tip history and guard decisions. Pins are git refs, so deleting grove's database loses nothing.

**Code moment (30 s).** Open one rule file (about 15 lines) and its test. "A new rule shows up in the CLI, the dashboard and the guard at once."

## 3. Tradeoffs (2:30)

Each as: chose X over Y, because Z; I'd change my mind if W. Use the first five on video; the rest go in the README.

| Decision | Instead of | Because | I'd change my mind if |
|---|---|---|---|
| Call the git CLI | a library (isomorphic-git, libgit2 bindings) | behaves exactly like the user's git, worktrees and config included; no native module, so `npx` just works | a full scan passed 1 s at 100 worktrees; then a long-lived `git cat-file --batch` process |
| Pins as git refs | storing old tips in grove's DB | the safety net survives grove's own bugs and a deleted DB | refs grew into the thousands and slowed git; then pack them or expire sooner |
| Own commit range + patch ID + metadata | plain ancestry, or `git cherry` | ancestry alarms on every rebase; `git cherry` alarms on restacks (measured) | "mark as intended" was needed more than a few times a week |
| Watch automatically, act only when asked | auto-restack and auto-clean | every incident was a tool acting on its own | plans ran clean dozens of times; then offer one-click runs for the boring ones |
| Guard fails open | failing closed | a grove bug must never stop an agent's ordinary work | the guard proved reliable; then fail closed for `worktree remove --force` and `push --force` only |
| No background process | a launchd/systemd service | nothing to install or leave running; agent commands keep the journal current through the guard; reflogs cover the rest | people wanted notifications when nothing else is running |
| No network in the guard | fetching remote state | it runs before every agent command and must answer in 200 ms | stale remote data caused a wrong verdict |
| `node:sqlite` | JSON files, or better-sqlite3 | several writers at once need WAL; built in, so no native build | Node's SQLite API changed under us |

## 4. Failure modes (1:30)

Pick four for the video.

| What breaks | What grove does |
|---|---|
| Grove wasn't running when history was rewritten | Reads reflogs on startup, classifies, pins, marks the finding "found later" |
| Grove's database is deleted or corrupt | Nothing is lost: pins are git refs. Grove rebuilds from git and starts a new journal |
| An agent is mid-rebase while grove scans or you click an action | Scans are read-only with `--no-optional-locks`; actions refuse that worktree and say why |
| The guard itself crashes | Allows the command, prints a one-line warning, logs the failure |
| The classifier is wrong (split commits, reworded during a conflict) | Raises a rewrite; you mark it as intended; nothing is changed |
| A plan stops halfway | The worktree shows "rebase in progress" with continue and abort; grove never guesses |
| `gh` missing or rate-limited | PR columns say unavailable or show their age; everything else works |

## 5. The repo reviewers will open

- `README.md`: the problem in four lines, a 30-second GIF of the guard blocking an agent, install (`npx git-grove`), how it works (the diagram), limitations, what's next.
- `docs/superpowers/specs/2026-11-01-git-grove-design.md`: the full design.
- `git grove demo`: lets a reviewer reproduce both incidents in two minutes without a real repo.
- Tests named after behaviour: "a rebase that resolved a conflict is not a rewrite", "a merged worktree with a precious ignored file is not safe to remove".
- Every name and file in fixtures and demo is invented.

## 6. Live round

**Engineer track: "add a small feature while sharing your screen".** Rehearse adding a rule end to end (rule file, test, shows up in CLI and dashboard) in under 10 minutes. Candidates:

- `stale-stash`: a stash older than 7 days on a branch that has since merged.
- `no-upstream`: a branch with commits but no remote after 24 hours.
- A new guard pattern: `git stash drop` / `git stash clear` blocked when the stash holds the only copy of changes.

**"Why X instead of Y?"** Section 3 is the answer sheet.

**Tech-lead track, if that's the one:**

- "The client added a requirement" (say, Windows, or a team-wide view): show where it lands (git adapter paths and process lookup for Windows; a read-only shared view would need the journal to leave the machine, which reopens the privacy decision).
- "The budget is cut in half": the cut line already orders it. Keep the guard, classifier and pins; drop GitHub data, the dashboard's Projects screen, then the dashboard itself in favour of `status --json`.
