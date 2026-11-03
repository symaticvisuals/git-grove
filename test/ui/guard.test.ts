import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { GuardPlan, GuardReceipt, GuardState } from "../../src/core/guard-install/guard-install.types.js";
import { focusAfterClose } from "../../ui/src/focus-after-close.js";
import { landmarkAfterCard } from "../../ui/src/landmark-after-card.js";
import { paletteItems } from "../../ui/src/palette/palette-items.js";
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
    title: "Uninstall the agent guard",
    summary: "Takes grove's hook out of Claude Code's settings.",
    confirm: "Uninstall",
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
  return { change: "uninstall", ok: true, refused: false, title: "Uninstalled the agent guard", lines: [`Wrote ${PATH}`], undo: null, at: 2_000, ...overrides };
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

test("the card shows while the guard is absent or stale, offers no Install, and hides once it is installed or put off with Not now", () => {
  const card = guardCard(ready(guard()), null).text;
  const absent = plain(card);
  expect(absent).toContain("Protect worktrees from Claude Code");
  expect(absent).toContain("Claude Code checks with grove before it runs git worktree remove, rm -r or reset --hard, and stops when work would be lost.");
  expect(absent).toContain("Not now");
  expect(absent).not.toContain("Install…");
  expect(card).not.toContain('data-ui="guard-open"');
  expect(guardCard(ready(guard({ status: "installed" })), null).text).toBe("");
  expect(guardCard(ready(guard()), "absent").text).toBe("");
  expect(guardCard({ status: "loading" }, null).text).toBe("");
  const stale = plain(guardCard(ready(guard({ status: "stale" })), null).text);
  expect(stale).toContain("The agent guard points at an old Node or grove path.");
  expect(stale).not.toContain("Update…");
});

test("the card says when hooks are turned off, and for a file grove will not edit shows the server's refusal", () => {
  expect(plain(guardCard(ready(guard({ hooksDisabled: true })), null).text)).toContain(
    `Hooks are turned off in ${PATH}: it sets disableAllHooks to true, so the guard will not run unless a project turns hooks back on.`,
  );
  const refusal = `grove will not edit ${PATH}: it is not valid JSON (Unexpected token '/'). To add the hook yourself, run git grove install-guard.`;
  const unreadable = guardCard(ready(guard({ status: "unreadable", refusal })), null).text;
  expect(plain(unreadable)).toContain(refusal);
  expect(unreadable).not.toContain('data-ui="guard-open"');
  const readOnly = guardCard(ready(guard({ refusal: `grove will not edit ${PATH}: it is read-only. To add the hook yourself, run git grove install-guard.` })), null).text;
  expect(plain(readOnly)).toContain("it is read-only.");
  expect(readOnly).not.toContain('data-ui="guard-open"');
  const npx = guardCard(ready(guard({ refusal: NPX })), null).text;
  expect(plain(npx)).toContain(NPX);
  expect(npx).not.toContain('data-ui="guard-open"');
});

test("the card sits at the top of the projects view only", () => {
  const state = home();
  expect(mainView(state, 5_000).text).toContain('class="guard-card"');
  expect(mainView(reduce(state, { type: "guard-dismiss", status: "absent" }), 5_000).text).not.toContain('class="guard-card"');
  expect(mainView({ ...state, route: { view: "pins" } }, 5_000).text).not.toContain('class="guard-card"');
});

test("the header status says on or off, quietly, and opens the dialog", () => {
  expect(plain(guardStatus(ready(guard({ status: "installed" }))).text)).toBe("Agent guard on");
  expect(guardStatus(ready(guard({ status: "installed" }))).text).toContain('class="guard-state on"');
  expect(guardStatus(ready(guard({ status: "installed" }))).text).toContain('data-ui="guard"');
  expect(plain(guardStatus(ready(guard({ status: "installed", hooksDisabled: true }))).text)).toBe("Agent guard on, hooks off");
  expect(plain(guardStatus(ready(guard())).text)).toBe("Agent guard off");
  expect(plain(guardStatus(ready(guard({ status: "stale" }))).text)).toBe("Agent guard out of date");
  expect(plain(guardStatus(ready(guard({ status: "unreadable" }))).text)).toBe("Agent guard unknown");
  expect(guardStatus(null).text).toBe("");
  const side = sidebar({ route: { view: "projects" }, projects: { status: "ready", data: [], stale: false }, repo: null, live: "up", now: 0, guard: ready(guard()) }).text;
  expect(plain(side)).toContain("Agent guard off");
});

test("the palette offers no Install agent guard, and Uninstall agent guard while grove's old hook is in", () => {
  const texts = (status: GuardState["status"]): string[] => paletteItems(home(guard({ status })), "agent guard").map((item) => item.text);
  expect(texts("absent")).toEqual([]);
  expect(texts("installed")).toEqual(["Uninstall agent guard"]);
  expect(texts("stale")).toEqual(["Uninstall agent guard"]);
  expect(paletteItems(home(guard({ status: "installed" })), "uninstall agent")[0]).toMatchObject({ kind: "Actions", run: { guard: "uninstall" } });
  expect(paletteItems(initialState({ view: "projects" }, "1.0.0"), "agent guard")).toEqual([]);
});

test("the dialog shows the settings path, the backup, the JSON it removes, that the rest is kept, when Claude Code drops it, and the reformat note", () => {
  const reformat = "This file is not written as 2-space JSON, so grove rewrites it with 2-space indentation. No setting changes.";
  const waiting = opened().guardDialog;
  if (waiting === null) throw new Error("no dialog");
  expect(plain(guardDialogParts(waiting, 5_000).head.text)).toContain("Uninstall the agent guard");
  expect(plain(guardDialogParts(waiting, 5_000).foot.text)).toContain("Uninstall ↵");
  const state = armed(planned(opened(), { lines: [...guardPlan().lines, reformat] }));
  const dialog = state.guardDialog;
  if (dialog === null) throw new Error("no dialog");
  const parts = guardDialogParts(dialog, 5_000);
  const body = plain(parts.body.text);
  expect(plain(parts.head.text)).toContain("Uninstall the agent guard");
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
  expect(plain(parts.foot.text)).toContain("Uninstall ↵");
  expect(tagOf(guardDialogParts({ ...dialog, armed: null }, 5_000).foot.text, 'data-guard="confirm"')).toContain("disabled");
});

test("a blocked plan shows why and cannot be confirmed", () => {
  const blocked = armed(planned(opened(), { removes: [], blockers: ["The agent guard is not installed."] }));
  if (blocked.guardDialog === null) throw new Error("no dialog");
  const parts = guardDialogParts(blocked.guardDialog, 5_000);
  expect(plain(parts.body.text)).toContain("The agent guard is not installed.");
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
  expect(plain(parts.body.text)).toContain("Uninstalled the agent guard");
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
  expect(run(home(), { type: "guard-dismiss", status: "absent" }, { type: "route", route: { view: "pins" } }, { type: "route", route: { view: "projects" } }).guardDismissed).toBe("absent");
  expect(reduce(opened(), { type: "guard-close" }).guardDialog).toBeNull();
});

test("the guard's state reloads with the project list every 30 s while live, so a hand edit shows", () => {
  const live = run(home(), { type: "live", state: "up" }, { type: "loaded", key: "projects", result: { slice: "projects", data: [] } }, { type: "tick", now: 1_000 });
  expect(reduce(live, { type: "tick", now: 20_000 }).guard).toMatchObject({ stale: false });
  expect(reduce(live, { type: "tick", now: 31_000 }).guard).toMatchObject({ status: "ready", stale: true });
});

test("Not now is kept per status, so a guard that later goes stale shows the card once more", () => {
  const dismissed = reduce(home(), { type: "guard-dismiss", status: "absent" });
  expect(guardCard(dismissed.guard, dismissed.guardDismissed).text).toBe("");
  const stale = reduce(dismissed, { type: "loaded", key: "guard", result: { slice: "guard", data: guard({ status: "stale" }) } });
  expect(guardCard(stale.guard, stale.guardDismissed).text).toContain("The agent guard points at an old Node or grove path.");
  expect(guardCard(stale.guard, stale.guardDismissed).text).toContain('data-status="stale"');
  const again = reduce(stale, { type: "guard-dismiss", status: "stale" });
  expect(guardCard(again.guard, again.guardDismissed).text).toBe("");
});

test("closing the guard dialog gives focus back to its opener, else to the sidebar's guard status; Not now moves it to the list", () => {
  expect(focusAfterClose("guard", "guard:install")).toEqual(["guard:install", "side:guard"]);
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
