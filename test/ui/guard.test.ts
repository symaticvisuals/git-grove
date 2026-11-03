import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { GuardPlan, GuardReceipt, GuardState } from "../../src/core/guard-install/guard-install.types.js";
import { focusAfterClose } from "../../ui/src/focus-after-close.js";
import { landmarkAfterCard } from "../../ui/src/landmark-after-card.js";
import { paletteItems } from "../../ui/src/palette/palette-items.js";
import { isGuardPhase } from "../../ui/src/is-guard-phase.js";
import { guardCard } from "../../ui/src/render/guard-card.js";
import { guardDialogParts } from "../../ui/src/render/guard-dialog-parts.js";
import { guardStatus } from "../../ui/src/render/guard-status.js";
import { mainView } from "../../ui/src/render/main-view.js";
import { sidebar } from "../../ui/src/render/sidebar.js";
import { sliceRequests } from "../../ui/src/slice-requests.js";
import { initialState, type Load, reduce, type State, type UiAction } from "../../ui/src/state.js";
import { feature, level, repoView } from "./wire-fixtures.js";

const PATH = "/Users/robin/.claude/settings.json";
const COMMAND = "/opt/homebrew/bin/node /opt/grove/dist/cli/bin.js guard --claude";
const REMOVED = JSON.stringify({ matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 10 }] }, null, 2);
const NPX = "This git grove runs from a package runner's cache (npx, pnpm dlx, bunx, yarn dlx), which may be cleared under the hook; install it first: npm i -g @deepanshugoel/git-grove";

function guard(overrides: Partial<GuardState> = {}): GuardState {
  return {
    status: "absent",
    plugin: false,
    hookCommand: false,
    ephemeral: false,
    phase: "absent",
    done: false,
    installCommands: [],
    settingsPath: PATH,
    command: COMMAND,
    hooksDisabled: false,
    refusal: null,
    ...overrides,
  };
}

function ready(state: GuardState): Load<GuardState> {
  return { status: "ready", data: state, stale: false };
}

function guardPlan(overrides: Partial<GuardPlan> = {}): GuardPlan {
  return {
    change: "uninstall",
    title: "Remove the old hook",
    summary: "Takes grove's hook out of Claude Code's settings.",
    confirm: "Remove",
    settingsPath: PATH,
    backupPath: `${PATH}.grove-backup`,
    adds: null,
    removes: [REMOVED],
    lines: ["Your other settings and hooks are kept.", "Claude Code reloads this file when it changes, so running sessions normally drop the hook; new sessions always do."],
    warnings: [],
    blockers: [],
    readAt: 1_000,
    ...overrides,
  };
}

function receipt(overrides: Partial<GuardReceipt> = {}): GuardReceipt {
  return { change: "uninstall", ok: true, refused: false, title: "Removed the old hook", lines: [`Wrote ${PATH}`], undo: null, at: 2_000, ...overrides };
}

function plain(text: string): string {
  return text.replace(/<[^>]+>/g, "").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

function tagOf(text: string, marker: string): string {
  return [...text.matchAll(/<[a-z]+\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(marker)) ?? "";
}

function run(state: State, ...actions: UiAction[]): State {
  return actions.reduce(reduce, state);
}

function home(status: GuardState = guard()): State {
  return reduce(initialState({ view: "projects" }, "1.0.0"), { type: "loaded", key: "guard", result: { slice: "guard", data: status } });
}

function opened(): State {
  return reduce(home(), { type: "guard-open", change: "uninstall" });
}

function planned(state: State, overrides: Partial<GuardPlan> = {}): State {
  const dialog = state.guardDialog;
  if (dialog === null) throw new Error("no guard dialog");
  return reduce(state, { type: "guard-planned", dialog: dialog.id, revision: dialog.revision, planId: `g${dialog.revision}`, plan: guardPlan(overrides) });
}

function armed(state: State): State {
  return reduce(state, { type: "guard-armed", dialog: state.guardDialog?.id ?? 0, planId: state.guardDialog?.planId ?? "" });
}

function confirmed(state: State): State {
  return reduce(state, { type: "guard-confirm", planId: state.guardDialog?.planId ?? "" });
}

test("the guard's state is loaded on every route", () => {
  for (const route of [{ view: "projects" }, { view: "pins" }, { view: "repo", repo: 1, pick: null }] as const) {
    expect(sliceRequests(initialState(route, "1.0.0")).guard?.key).toBe("guard");
  }
  expect(home().guard).toEqual(ready(guard()));
});

const CMDS = ["claude plugin marketplace add symaticvisuals/git-grove", "claude plugin install git-grove@git-grove"];

test("absent: the card protects worktrees, lists each install command with Copy, and offers only Not now", () => {
  const card = guardCard(ready(guard({ installCommands: CMDS })), null).text;
  const text = plain(card);
  expect(text).toContain("Protect worktrees from Claude Code");
  expect(text).toContain("Claude Code checks with grove before it runs git worktree remove, rm -r or reset --hard, and stops when work would be lost.");
  for (const command of CMDS) expect(card).toContain(`data-copy="${command}"`);
  expect(card.match(/data-ui="copy"/g)).toHaveLength(2);
  expect(text).toContain("Not now");
  expect(card).toContain('data-phase="absent"');
  expect(card).not.toContain('data-ui="guard-open"');
  expect(text).not.toContain("Install…");
  expect(text).not.toContain("Update…");
});

test("hook: the card offers the plugin commands, then removing the old hook, and Not now", () => {
  const card = guardCard(ready(guard({ status: "installed", phase: "hook", installCommands: CMDS })), null).text;
  expect(plain(card)).toContain("Switch the agent guard to the Claude Code plugin");
  for (const command of CMDS) expect(card).toContain(`data-copy="${command}"`);
  expect(tagOf(card, 'data-ui="guard-open"')).toContain('data-change="uninstall"');
  expect(plain(card)).toContain("Then remove the old hook…");
  expect(plain(card)).toContain("Not now");
  expect(plain(card)).not.toContain("Install…");
});

test("a stale old hook with the plugin off is the hook card", () => {
  const card = plain(guardCard(ready(guard({ status: "stale", phase: "hook", installCommands: CMDS })), null).text);
  expect(card).toContain("Switch the agent guard to the Claude Code plugin");
  expect(card).not.toContain("Update…");
});

test("plugin-and-hook: the card says the guard runs twice and offers Remove the old hook only", () => {
  const card = guardCard(ready(guard({ status: "installed", plugin: true, phase: "plugin-and-hook", installCommands: CMDS })), null).text;
  expect(plain(card)).toContain("The agent guard runs twice");
  expect(plain(card)).toContain("The plugin and an old hook in settings.json both run it.");
  expect(tagOf(card, 'data-ui="guard-open"')).toContain('data-change="uninstall"');
  expect(plain(card)).toContain("Remove the old hook…");
  expect(plain(card)).not.toContain("Not now");
  expect(card).not.toContain('data-ui="copy"');
});

test("plugin, not done: the card says why, with no buttons", () => {
  const base = { plugin: true, phase: "plugin", done: false } as const;
  const off = guardCard(ready(guard({ ...base, hookCommand: true, hooksDisabled: true })), null).text;
  expect(plain(off)).toContain("Finish the agent guard");
  expect(plain(off)).toContain(`Hooks are turned off in ${PATH}`);
  const ephemeral = guardCard(ready(guard({ ...base, ephemeral: true })), null).text;
  expect(plain(ephemeral)).toContain("Install git grove for the plugin to run it: npm i -g @deepanshugoel/git-grove");
  const missing = guardCard(ready(guard({ ...base })), null).text;
  expect(plain(missing)).toContain("The plugin's hook can't find git grove yet. Run git grove ui once.");
  for (const card of [off, ephemeral, missing]) expect(card).not.toContain("<button");
});

test("the card is empty when done, loading, or put off for that phase; a refusal is kept as a note", () => {
  expect(guardCard(ready(guard({ plugin: true, phase: "plugin", done: true, hookCommand: true })), null).text).toBe("");
  expect(guardCard(ready(guard({ installCommands: CMDS })), "absent").text).toBe("");
  expect(guardCard(ready(guard({ phase: "hook", installCommands: CMDS })), "absent").text).not.toBe("");
  expect(guardCard({ status: "loading" }, null).text).toBe("");
  const refusal = `grove will not edit ${PATH}: it is not valid JSON (Unexpected token '/'). To remove the old hook yourself, edit that file by hand.`;
  const unreadable = guardCard(ready(guard({ status: "unreadable", refusal })), null).text;
  expect(plain(unreadable)).toContain(refusal);
  expect(plain(guardCard(ready(guard({ refusal: NPX })), null).text)).toContain(NPX);
});

test("a command is escaped in the row and its Copy button", () => {
  const card = guardCard(ready(guard({ installCommands: ['x"><script>'] })), null).text;
  expect(card).not.toContain("<script>");
  expect(card).toContain('data-copy="x&quot;&gt;&lt;script&gt;"');
});

test("isGuardPhase accepts the four phases and not an old status", () => {
  for (const phase of ["plugin", "plugin-and-hook", "hook", "absent"]) expect(isGuardPhase(phase)).toBe(true);
  for (const old of ["installed", "stale", "unreadable", 3, null]) expect(isGuardPhase(old)).toBe(false);
});

test("the card sits at the top of the projects view only", () => {
  const state = home();
  expect(mainView(state, 5_000).text).toContain('class="guard-card"');
  expect(mainView(reduce(state, { type: "guard-dismiss", phase: "absent" }), 5_000).text).not.toContain('class="guard-card"');
  expect(mainView({ ...state, route: { view: "pins" } }, 5_000).text).not.toContain('class="guard-card"');
});

test("the sidebar status names the phase quietly, and is lit only when the guard is done", () => {
  const on = guardStatus(ready(guard({ plugin: true, phase: "plugin", done: true, hookCommand: true }))).text;
  expect(plain(on)).toBe("Agent guard on");
  expect(on).toContain('class="guard-state on"');
  expect(on).toContain('data-ui="guard"');
  const labels: [Partial<GuardState>, string][] = [
    [{ phase: "plugin-and-hook" }, "Agent guard runs twice"],
    [{ phase: "hook" }, "Agent guard: old hook"],
    [{ phase: "plugin" }, "Agent guard not running"],
    [{ phase: "absent" }, "Agent guard off"],
  ];
  for (const [overrides, text] of labels) {
    const html = guardStatus(ready(guard(overrides))).text;
    expect(plain(html)).toBe(text);
    expect(html).not.toContain("guard-state on");
  }
  expect(guardStatus(null).text).toBe("");
  const side = sidebar({ route: { view: "projects" }, projects: { status: "ready", data: [], stale: false }, repo: null, live: "up", now: 0, guard: ready(guard()) }).text;
  expect(plain(side)).toContain("Agent guard off");
});

test("the palette offers no Install agent guard, and Remove the old hook while grove's old hook is in", () => {
  const texts = (status: GuardState["status"]): string[] => paletteItems(home(guard({ status })), "old hook").map((item) => item.text);
  expect(texts("absent")).toEqual([]);
  expect(texts("installed")).toEqual(["Remove the old hook"]);
  expect(texts("stale")).toEqual(["Remove the old hook"]);
  expect(paletteItems(home(guard({ status: "installed" })), "remove the old")[0]).toMatchObject({ kind: "Actions", run: { guard: "uninstall" } });
  expect(paletteItems(home(guard()), "agent guard")).toEqual([]);
  expect(paletteItems(initialState({ view: "projects" }, "1.0.0"), "old hook")).toEqual([]);
});

test("the dialog shows the settings path, the backup, the JSON it removes, that the rest is kept, when Claude Code drops it, and the reformat note", () => {
  const reformat = "This file is not written as 2-space JSON, so grove rewrites it with 2-space indentation. No setting changes.";
  const waiting = opened().guardDialog;
  if (waiting === null) throw new Error("no dialog");
  expect(plain(guardDialogParts(waiting, 5_000).head.text)).toContain("Remove the old hook");
  expect(plain(guardDialogParts(waiting, 5_000).foot.text)).toContain("Remove ↵");
  const state = armed(planned(opened(), { lines: [...guardPlan().lines, reformat] }));
  const dialog = state.guardDialog;
  if (dialog === null) throw new Error("no dialog");
  const parts = guardDialogParts(dialog, 5_000);
  const body = plain(parts.body.text);
  expect(plain(parts.head.text)).toContain("Remove the old hook");
  expect(body).toContain(`Writes ${PATH}`);
  expect(body).toContain(`Keeps the file as it is now in ${PATH}.grove-backup`);
  expect(body).toContain("Removes");
  expect(body).not.toContain("Adds to hooks.PreToolUse");
  expect(body).toContain(COMMAND);
  expect(body).toContain("Your other settings and hooks are kept.");
  expect(body).toContain("Claude Code reloads this file when it changes, so running sessions normally drop the hook; new sessions always do.");
  expect(body).toContain(reformat);
  const confirm = tagOf(parts.foot.text, 'data-guard="confirm"');
  expect(confirm).toContain('data-plan="g0"');
  expect(confirm).not.toContain("disabled");
  expect(plain(parts.foot.text)).toContain("Remove ↵");
  expect(tagOf(guardDialogParts({ ...dialog, armed: null }, 5_000).foot.text, 'data-guard="confirm"')).toContain("disabled");
});

test("a plan's warning shows above the file it writes", () => {
  const warning = "The Claude Code plugin isn't enabled, so removing this hook leaves no agent guard until you install it.";
  const dialog = armed(planned(opened(), { warnings: [warning] })).guardDialog;
  if (dialog === null) throw new Error("no dialog");
  const body = plain(guardDialogParts(dialog, 5_000).body.text);
  expect(body).toContain(warning);
  expect(body).not.toContain("Hooks are turned off");
  expect(body.indexOf(warning)).toBeLessThan(body.indexOf(`Writes ${PATH}`));
});

test("a blocked plan shows why and cannot be confirmed", () => {
  const blocked = armed(planned(opened(), { removes: [], blockers: ["There is no old hook in this file."] }));
  if (blocked.guardDialog === null) throw new Error("no dialog");
  const parts = guardDialogParts(blocked.guardDialog, 5_000);
  expect(plain(parts.body.text)).toContain("There is no old hook in this file.");
  expect(tagOf(parts.foot.text, 'data-guard="confirm"')).toContain("disabled");
  expect(confirmed(blocked).guardDialog?.stage).toBe("review");
});

test("opening previews at once, a confirm needs the armed plan, and the receipt lands with no Undo", () => {
  const open = opened();
  expect(open.guardDialog).toMatchObject({ change: "uninstall", stage: "review", planning: true, plan: null });
  const shown = planned(open);
  expect(confirmed(shown).guardDialog?.stage).toBe("review");
  expect(reduce(armed(shown), { type: "guard-confirm", planId: "other" }).guardDialog?.stage).toBe("review");
  const running = confirmed(armed(shown));
  expect(running.guardDialog?.stage).toBe("run");
  const done = reduce(running, { type: "guard-ran", dialog: running.guardDialog?.id ?? 0, receipt: receipt() });
  expect(done.guardDialog).toMatchObject({ stage: "done", receipt: receipt() });
  if (done.guardDialog === null) throw new Error("no dialog");
  const parts = guardDialogParts(done.guardDialog, 5_000);
  expect(plain(parts.body.text)).toContain("Removed the old hook");
  expect(parts.foot.text).not.toContain('data-guard="undo"');
  expect(plain(parts.foot.text)).not.toContain("Undo");
  expect(plain(parts.foot.text)).toContain("Your other settings and hooks were kept.");
});

test("a receipt for a change that was not made says nothing was written and offers Preview again", () => {
  const running = confirmed(armed(planned(opened())));
  const done = reduce(running, { type: "guard-ran", dialog: running.guardDialog?.id ?? 0, receipt: receipt({ ok: false, refused: true, title: "Changed since you looked" }) });
  if (done.guardDialog === null) throw new Error("no dialog");
  const foot = guardDialogParts(done.guardDialog, 5_000).foot.text;
  expect(plain(foot)).toContain("Nothing was written.");
  expect(foot).toContain('data-guard="again"');
  expect(reduce(done, { type: "guard-again" }).guardDialog).toMatchObject({ stage: "review", planning: true });
});

test("an expired plan is previewed again with a notice; another failure goes back to the review with why", () => {
  const running = confirmed(armed(planned(opened())));
  const id = running.guardDialog?.id ?? 0;
  const expired = reduce(running, { type: "guard-run-failed", dialog: id, status: 410, message: "This preview expired; preview it again" });
  expect(expired.guardDialog).toMatchObject({ stage: "review", planning: true, revision: 1, notice: expect.stringContaining("expired") });
  const refused = reduce(running, { type: "guard-run-failed", dialog: id, status: 409, message: "This plan already ran" });
  expect(refused.guardDialog).toMatchObject({ stage: "review", error: "This plan already ran", planId: null });
  expect(reduce(refused, { type: "guard-again" }).guardDialog).toMatchObject({ planning: true, revision: 1, error: null });
});

test("the guard dialog does not open over an action dialog, the palette does not open over it, and Not now is kept", () => {
  const view = repoView({ features: [feature({ levels: [level()] })] });
  const withAction = reduce(home(), { type: "dialog-open", action: "new", ctx: { repo: view, feature: null, level: null, branch: null, targets: null, worktree: null } });
  expect(reduce(withAction, { type: "guard-open", change: "uninstall" }).guardDialog).toBeNull();
  expect(reduce(opened(), { type: "palette-open" }).palette).toBeNull();
  expect(run(home(), { type: "guard-dismiss", phase: "absent" }, { type: "route", route: { view: "pins" } }, { type: "route", route: { view: "projects" } }).guardDismissed).toBe("absent");
  expect(reduce(opened(), { type: "guard-close" }).guardDialog).toBeNull();
});

test("the guard's state reloads with the project list every 30 s while live, so a hand edit shows", () => {
  const live = run(home(), { type: "live", state: "up" }, { type: "loaded", key: "projects", result: { slice: "projects", data: [] } }, { type: "tick", now: 1_000 });
  expect(reduce(live, { type: "tick", now: 20_000 }).guard).toMatchObject({ stale: false });
  expect(reduce(live, { type: "tick", now: 31_000 }).guard).toMatchObject({ status: "ready", stale: true });
});

test("Not now is kept per phase, so a guard that later changes phase shows the card once more", () => {
  const withCommands = (overrides: Partial<GuardState>) => guard({ installCommands: CMDS, ...overrides });
  const dismissed = reduce(home(withCommands({})), { type: "guard-dismiss", phase: "absent" });
  expect(guardCard(dismissed.guard, dismissed.guardDismissed).text).toBe("");
  const hook = reduce(dismissed, { type: "loaded", key: "guard", result: { slice: "guard", data: withCommands({ status: "installed", phase: "hook" }) } });
  expect(guardCard(hook.guard, hook.guardDismissed).text).toContain('data-phase="hook"');
  const again = reduce(hook, { type: "guard-dismiss", phase: "hook" });
  expect(guardCard(again.guard, again.guardDismissed).text).toBe("");
});

test("closing the guard dialog gives focus back to its opener, else to the sidebar's guard status; Not now moves it to the list", () => {
  expect(focusAfterClose("guard", "guard:uninstall")).toEqual(["guard:uninstall", "side:guard"]);
  expect(focusAfterClose("guard", null)).toEqual(["side:guard"]);
  expect(focusAfterClose("dialog", "row:#/r/1")).toEqual(["row:#/r/1"]);
  expect(landmarkAfterCard(["row:#/r/1", "row:#/r/2"])).toBe("row:#/r/1");
  expect(landmarkAfterCard([])).toBe("bar:scan");
});

test("a dialog's footer sticks to the bottom of the dialog, so confirm is on screen however long the review is", async () => {
  const css = await readFile(join(import.meta.dirname, "..", "..", "ui", "styles.css"), "utf8");
  const rule = /\.dlg footer\{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toContain("position:sticky");
  expect(rule).toContain("bottom:0");
  expect(rule).toContain("background:var(--raise)");
});
