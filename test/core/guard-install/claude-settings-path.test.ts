import { userInfo } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { claudeSettingsPath } from "../../../src/core/guard-install/claude-settings-path.js";
import { realClaudeSettingsPath } from "../../../src/core/guard-install/real-claude-settings-path.js";
import { writeSettingsFile } from "../../../src/core/guard-install/write-settings-file.js";

test("the settings file is under CLAUDE_CONFIG_DIR when it is set, else under <home>/.claude", () => {
  expect(claudeSettingsPath({}, "/Users/robin")).toBe(join("/Users/robin", ".claude", "settings.json"));
  expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "" }, "/Users/robin")).toBe(join("/Users/robin", ".claude", "settings.json"));
  expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "/Users/robin/.claude-work" }, "/Users/robin")).toBe("/Users/robin/.claude-work/settings.json");
});

test("a CLAUDE_CONFIG_DIR starting with ~, or relative, is taken from the home folder, not the current one", () => {
  expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "~/.claude-work" }, "/Users/robin")).toBe("/Users/robin/.claude-work/settings.json");
  expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: "~" }, "/Users/robin")).toBe("/Users/robin/settings.json");
  expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: ".claude-work" }, "/Users/robin")).toBe("/Users/robin/.claude-work/settings.json");
});

test("under vitest the real settings path throws, so no test can reach the real ~/.claude", () => {
  expect(process.env["VITEST"]).toBeDefined();
  expect(() => realClaudeSettingsPath()).toThrow(/refuses to run under vitest/);
});

test("under vitest a write into the real ~/.claude is refused before the file is even read", async () => {
  const real = join(userInfo().homedir, ".claude", "settings.json");
  await expect(writeSettingsFile({ path: real, saw: "never", text: "{}\n" })).rejects.toThrow(/refuses to write the real ~\/\.claude under vitest/);
});
