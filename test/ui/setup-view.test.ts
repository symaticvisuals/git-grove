import { expect, test } from "vitest";
import type { GuardState } from "../../src/core/guard-install/guard-install.types.js";
import type { WireProject } from "../../src/server/wire/wire.types.js";
import { GUARD_DISMISSED_KEY, SETUP_SEEN_KEY } from "../../ui/src/storage-keys.js";
import { guardStatusTarget } from "../../ui/src/guard-status-target.js";
import { mainView } from "../../ui/src/render/main-view.js";
import { setupView } from "../../ui/src/render/setup-view.js";
import { sidebar } from "../../ui/src/render/sidebar.js";
import { initialState, type Load, reduce } from "../../ui/src/state.js";
import { project } from "./wire-fixtures.js";

const CMDS = ["claude plugin marketplace add symaticvisuals/git-grove", "claude plugin install git-grove@git-grove"];

function guard(overrides: Partial<GuardState> = {}): Load<GuardState> {
  const data: GuardState = {
    status: "absent",
    plugin: false,
    hookCommand: false,
    ephemeral: false,
    phase: "absent",
    done: false,
    installCommands: CMDS,
    settingsPath: "/h/.claude/settings.json",
    command: "x",
    hooksDisabled: false,
    refusal: null,
    ...overrides,
  };
  return { status: "ready", data, stale: false };
}

type Projects = Load<WireProject[]>;
const none: Projects = { status: "ready", data: [], stale: false };
const one: Projects = { status: "ready", data: [project()], stale: false };
const text = (projects: Projects = none, g: Load<GuardState> | null = guard(), next = "#/"): string => setupView(projects, g, next).text;
const ticks = (out: string): number => out.split('class="step done"').length - 1;

test("the page has a title and the three steps", () => {
  const out = text();
  expect(out).toContain("Getting started");
  expect(out).toContain("Watch a repo");
  expect(out).toContain("Protect worktrees from Claude Code");
  expect(out).toContain("Keep grove running");
});

test("step 1 shows git grove ui, ticked only once a repo is watched", () => {
  expect(text(none)).toContain("git grove ui");
  expect(ticks(text(none))).toBe(0);
  expect(ticks(text(one))).toBe(1);
  expect(ticks(text({ status: "loading" }))).toBe(0);
});

test("step 2 shows both commands and no remove button when absent", () => {
  const out = text(none, guard());
  for (const command of CMDS) expect(out).toContain(command);
  expect(out).not.toContain("Remove the old hook");
  expect(ticks(out)).toBe(0);
});

test.each(["hook", "plugin-and-hook"] as const)("step 2 offers to remove the old hook in %s", (phase) => {
  const out = text(none, guard({ phase }));
  expect(out).toContain("Remove the old hook…");
  expect(out).toContain('data-ui="guard-open" data-change="uninstall"');
});

test("step 2 is ticked when the guard is done", () => {
  expect(ticks(text(none, guard({ phase: "plugin", done: true })))).toBe(1);
});

test("step 2 still renders while the guard is unknown", () => {
  expect(text(none, null)).toContain("Protect worktrees from Claude Code");
});

test("step 3 always shows the service command and never ticks", () => {
  expect(text(one, guard({ phase: "plugin", done: true }))).toContain("git grove service status");
  expect(ticks(text(one, guard({ phase: "plugin", done: true })))).toBe(2);
});

test("the footer link goes to next, escaped", () => {
  expect(text(none, guard(), "#/r/3")).toContain('href="#/r/3"');
  expect(text(none, guard(), '#/"><b>x')).not.toContain("<b>x");
});

test("the main view and sidebar route to the setup page", () => {
  const state = reduce(initialState({ view: "setup" }, "1.0.0"), { type: "setup-next", next: "#/r/3" });
  expect(mainView(state, 0).text).toContain("Getting started");
  expect(mainView(state, 0).text).toContain('href="#/r/3"');
  const side = sidebar({ route: state.route, projects: one, repo: null, live: "up", now: 0, notify: "default", guard: null }).text;
  expect(side).toContain('href="#/setup"');
});

test("the guard status button goes to setup unless an old hook can be removed", () => {
  expect(guardStatusTarget("plugin")).toBe("setup");
  expect(guardStatusTarget("absent")).toBe("setup");
  expect(guardStatusTarget("hook")).toBe("uninstall");
  expect(guardStatusTarget("plugin-and-hook")).toBe("uninstall");
  expect(guardStatusTarget(null)).toBe("setup");
});

test("storage keys", () => {
  expect(SETUP_SEEN_KEY).toBe("grove.setupSeen");
  expect(GUARD_DISMISSED_KEY).toBe("grove.guardCardDismissed.v2");
});
