import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");
const readJson = (path: string): unknown => JSON.parse(read(path));

describe("the Claude Code plugin package", () => {
  test("the marketplace lists one plugin, git-grove, from ./plugin", () => {
    expect(readJson(".claude-plugin/marketplace.json")).toMatchObject({
      name: "git-grove",
      owner: { name: "symaticvisuals" },
      plugins: [{ name: "git-grove", source: "./plugin", description: expect.any(String) }],
    });
    const parsed = readJson(".claude-plugin/marketplace.json") as { plugins: unknown[] };
    expect(parsed.plugins).toHaveLength(1);
  });

  test("the plugin's version is the npm package's", () => {
    const plugin = readJson("plugin/.claude-plugin/plugin.json") as { name: string; version: string };
    const pkg = readJson("package.json") as { version: string };
    expect(plugin.name).toBe("git-grove");
    expect(plugin.version).toBe(pkg.version);
  });

  test("the hook runs guard.sh on Bash with a 10 s timeout", () => {
    expect(readJson("plugin/hooks/hooks.json")).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/hooks/guard.sh', timeout: 10 },
            ],
          },
        ],
      },
    });
    const mode = statSync(resolve(root, "plugin/hooks/guard.sh")).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  test("the skill is named git-grove and its description names what it is for", () => {
    const text = read("plugin/skills/git-grove/SKILL.md");
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
    expect(match).not.toBeNull();
    const front = match?.[1] ?? "";
    const body = match?.[2] ?? "";
    expect(front).toMatch(/^name: git-grove$/m);
    const description = /^description: (.*)$/m.exec(front)?.[1] ?? "";
    for (const word of ["worktree", "branch", "blocked"]) expect(description).toContain(word);
    for (const command of ["git grove check remove", "git grove rm --rescue", "git grove restore"]) {
      expect(body).toContain(command);
    }
    const never = body.split("\n").find((line) => /\bnever\b/i.test(line)) ?? "";
    for (const command of ["git grove ack", "git grove pins prune", "git grove rm --force"]) {
      expect(never).toContain(command);
    }
  });
});
