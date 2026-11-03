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
const NPX = "This git grove runs from a package runner's cache (npx, pnpm dlx, bunx, yarn dlx), which may be cleared under the hook; install it first: npm i -g @deepanshugoel/git-grove";

function guard(overrides: Partial<GuardState> = {}): GuardState {
  return { status: "absent", settingsPath: PATH, command: COMMAND, hooksDisabled: false, refusal: null, ...overrides };
}

function ready(state: GuardState): Load<GuardState> {
  return { status: "ready", data: state, stale: false };
}

function guardPlan(overrides: Partial<GuardPlan> = {}): GuardPlan {
  return {
    change: "install",
    title: "Install the agent guard",
    summary: "Claude Code checks each Bash command with grove before it runs, and stops one that would lose work.",
    confirm: "Install",
    settingsPath: PATH,
    backupPath: `${PATH}.grove-backup`,
    adds: JSON.stringify({ matcher: "Bash", hooks: [{ type: "command", command: COMMAND, timeout: 10 }] }, null, 2),
    removes: [],
    lines: ["Your other settings and hooks are kept.", "Claude Code reloads this file when it changes, so running sessions normally pick the hook up; new sessions always do."],
    warnings: [],
    blockers: [],
    readAt: 1_000,
    ...overrides,
  };
}

function receipt(overrides: Partial<GuardReceipt> = {}): GuardReceipt {
  return { change: "install", updated: false, ok: true, refused: false, title: "Installed the agent guard", lines: [`Wrote ${PATH}`], undo: "uninstall", at: 2_000, ...overrides };
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

function opened(change: "install" | "uninstall" = "install"): State {
  return reduce(home(), { type: "guard-open", change });
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

test("the card shows while the guard is absent or stale, and hides once it is installed or put off with Not now", () => {
  const absent = plain(guardCard(ready(guard()), null).text);
  expect(absent).toContain("Protect worktrees from Claude Code");
  expect(absent).toContain("Claude Code checks with grove before it runs git worktree remove, rm -r or reset --hard, and stops when work would be lost.");
  expect(absent).toContain("A new session is told this agent is bounded by the guard.");
  expect(absent).toContain("Not now");
  expect(absent).toContain("Install…");
  expect(guardCard(ready(guard({ status: "installed" })), null).text).toBe("");
  expect(guardCard(ready(guard()), "absent").text).toBe("");
  expect(guardCard({ status: "loading" }, null).text).toBe("");
  const stale = plain(guardCard(ready(guard({ status: "stale" })), null).text);
  expect(stale).toContain("The agent guard is missing the notice a new session gets, or it points at an old Node or grove path.");
  expect(stale).toContain("Update…");
  expect(stale).not.toContain("Install…");
});

test("the card says when hooks are turned off, and for a file grove will not edit shows the server's refusal, which points to install-guard, with no Install", () => {
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
  expect(plain(guardStatus(ready(guard({ status: "installed" }))).text)).toBe("Agents bounded");
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

test("the palette offers Install agent guard unless it is installed, and Uninstall agent guard while it is in", () => {
  const texts = (status: GuardState["status"]): string[] => paletteItems(home(guard({ status })), "agent guard").map((item) => item.text);
  expect(texts("absent")).toEqual(["Install agent guard"]);
  expect(texts("installed")).toEqual(["Uninstall agent guard"]);
  expect(texts("stale")).toEqual(["Install agent guard", "Uninstall agent guard"]);
  expect(paletteItems(home(), "install agent")[0]).toMatchObject({ kind: "Actions", run: { guard: "install" } });
  expect(paletteItems(initialState({ view: "projects" }, "1.0.0"), "agent guard")).toEqual([]);
});

test("the dialog shows the settings path, the backup, the JSON it adds, that the rest is kept, when Claude Code picks it up, and the reformat note", () => {
  const reformat = "This file is not written as 2-space JSON, so grove rewrites it with 2-space indentation. No setting changes.";
  const state = armed(planned(opened(), { lines: [...guardPlan().lines, reformat] }));
  const dialog = state.guardDialog;
  if (dialog === null) throw new Error("no dialog");
  const parts = guardDialogParts(dialog, 5_000);
  const body = plain(parts.body.text);
  expect(plain(parts.head.text)).toContain("Install the agent guard");
  expect(body).toContain(`Writes ${PATH}`);
  expect(body).toContain(`Keeps the file as it is now in ${PATH}.grove-backup`);
  expect(body).toContain('"matcher": "Bash"');
  expect(body).toContain(COMMAND);
  expect(body).toContain("Your other settings and hooks are kept.");
  expect(body).toContain("Claude Code reloads this file when it changes, so running sessions normally pick the hook up; new sessions always do.");
  expect(body).toContain(reformat);
  const confirm = tagOf(parts.foot.text, 'data-guard="confirm"');
  expect(confirm).toContain('data-plan="g0"');
  expect(confirm).not.toContain("disabled");
  expect(plain(parts.foot.text)).toContain("Install ↵");
  expect(tagOf(guardDialogParts({ ...dialog, armed: null }, 5_000).foot.text, 'data-guard="confirm"')).toContain("disabled");
});

test("an uninstall shows what it removes and confirms with Uninstall; a blocked plan shows why and cannot be confirmed", () => {
  const removed = JSON.stringify({ matcher: "Bash", hooks: [{ type: "command", command: COMMAND }] }, null, 2);
  const uninstall = armed(planned(opened("uninstall"), { change: "uninstall", title: "Uninstall the agent guard", confirm: "Uninstall", adds: null, removes: [removed] })).guardDialog;
  if (uninstall === null) throw new Error("no dialog");
  const parts = guardDialogParts(uninstall, 5_000);
  expect(plain(parts.body.text)).toContain("Removes");
  expect(plain(parts.body.text)).toContain(COMMAND);
  expect(plain(parts.foot.text)).toContain("Uninstall ↵");
  const blocked = armed(planned(opened(), { blockers: [NPX] }));
  const blockedParts = guardDialogParts(blocked.guardDialog ?? uninstall, 5_000);
  expect(plain(blockedParts.body.text)).toContain(NPX);
  expect(tagOf(blockedParts.foot.text, 'data-guard="confirm"')).toContain("disabled");
  expect(confirmed(blocked).guardDialog?.stage).toBe("review");
});

test("opening previews at once, a confirm needs the armed plan, and the receipt lands with Undo, which opens the uninstall for review", () => {
  const open = opened();
  expect(open.guardDialog).toMatchObject({ change: "install", stage: "review", planning: true, plan: null });
  const shown = planned(open);
  expect(confirmed(shown).guardDialog?.stage).toBe("review");
  expect(reduce(armed(shown), { type: "guard-confirm", planId: "other" }).guardDialog?.stage).toBe("review");
  const running = confirmed(armed(shown));
  expect(running.guardDialog?.stage).toBe("run");
  const done = reduce(running, { type: "guard-ran", dialog: running.guardDialog?.id ?? 0, receipt: receipt() });
  expect(done.guardDialog).toMatchObject({ stage: "done", receipt: receipt() });
  if (done.guardDialog === null) throw new Error("no dialog");
  const parts = guardDialogParts(done.guardDialog, 5_000);
  expect(plain(parts.body.text)).toContain("Installed the agent guard");
  expect(parts.foot.text).toContain('data-guard="undo"');
  const undo = reduce(done, { type: "guard-undo" });
  expect(undo.guardDialog).toMatchObject({ change: "uninstall", stage: "review", planning: true });
  expect(undo.guardDialog?.id).not.toBe(done.guardDialog?.id);
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
  expect(reduce(withAction, { type: "guard-open", change: "install" }).guardDialog).toBeNull();
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
  expect(guardCard(stale.guard, stale.guardDismissed).text).toContain("Update…");
  expect(guardCard(stale.guard, stale.guardDismissed).text).toContain('data-status="stale"');
  const again = reduce(stale, { type: "guard-dismiss", status: "stale" });
  expect(guardCard(again.guard, again.guardDismissed).text).toBe("");
});

test("after an update the receipt offers Uninstall, not Undo, and says the old hook is not put back", () => {
  const running = confirmed(armed(planned(opened(), { title: "Update the agent guard" })));
  const done = reduce(running, { type: "guard-ran", dialog: running.guardDialog?.id ?? 0, receipt: receipt({ updated: true, title: "Updated the agent guard" }) });
  if (done.guardDialog === null) throw new Error("no dialog");
  const foot = guardDialogParts(done.guardDialog, 5_000).foot.text;
  const start = foot.indexOf('data-guard="undo"');
  expect(start).toBeGreaterThan(-1);
  expect(plain(foot.slice(foot.indexOf(">", start) + 1, foot.indexOf("</button>", start)))).toBe("Uninstall");
  expect(plain(foot)).not.toContain("Undo");
  expect(plain(foot)).toContain("Uninstall takes the hook out; the old one is not put back.");
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
