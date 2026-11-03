import { expect, test } from "vitest";
import type { GuardStatus } from "../../../src/core/guard-install/guard-install.types.js";
import { guardPhaseOf } from "../../../src/core/guard-install/guard-phase-of.js";

function phase(pluginEnabled: boolean, status: GuardStatus, hooksDisabled: boolean, hookCommand: boolean) {
  return guardPhaseOf({ reading: { status, pluginEnabled, hooksDisabled, problem: null }, hookCommand });
}

test("the plugin alone, hooks on, with a hook-command, is done", () => {
  expect(phase(true, "absent", false, true)).toEqual({ phase: "plugin", done: true });
});

test("the plugin with hooks turned off is not done", () => {
  expect(phase(true, "absent", true, true)).toEqual({ phase: "plugin", done: false });
});

test("the plugin without a usable hook-command is not done", () => {
  expect(phase(true, "absent", false, false)).toEqual({ phase: "plugin", done: false });
});

test("the plugin with a stale old hook is both, and not done", () => {
  expect(phase(true, "stale", false, true)).toEqual({ phase: "plugin-and-hook", done: false });
  expect(phase(true, "installed", false, true)).toEqual({ phase: "plugin-and-hook", done: false });
});

test("the old hook alone, installed or stale, is hook", () => {
  expect(phase(false, "installed", false, true)).toEqual({ phase: "hook", done: false });
  expect(phase(false, "stale", false, true)).toEqual({ phase: "hook", done: false });
});

test("neither, or an unreadable file, is absent", () => {
  expect(phase(false, "absent", false, true)).toEqual({ phase: "absent", done: false });
  expect(phase(false, "unreadable", false, true)).toEqual({ phase: "absent", done: false });
});
