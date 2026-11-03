import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const guard = resolve(import.meta.dirname, "../../plugin/hooks/guard.sh");
const message = "git grove guard: git grove is not installed or has not run yet; run git grove ui";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "guard-sh-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function script(path: string, body: string): string {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function run(env: Record<string, string>, input: string, args: string[] = []) {
  return spawnSync("/bin/sh", [guard, ...args], {
    env,
    input,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

describe("plugin/hooks/guard.sh", () => {
  test("it runs the recorded node and bin with guard --claude and passes stdin through", () => {
    const home = join(dir, "home");
    mkdirSync(home);
    const copy = join(dir, "stdin.copy");
    const fakeNode = script(join(dir, "fake-node"), `echo "$@"\ncat > "${copy}"\nexit 2`);
    const bin = join(dir, "bin.js");
    writeFileSync(bin, "");
    writeFileSync(join(home, "hook-command"), `${fakeNode}\n${bin}\n`);
    const input = `${"é".repeat(34_999)}\n\n`;
    expect(Buffer.byteLength(input)).toBe(70_000);

    const result = run({ HOME: dir, GIT_GROVE_HOME: home, PATH: "/usr/bin:/bin" }, input);

    expect(result.stdout).toBe(`${bin} guard --claude\n`);
    expect(readFileSync(copy, "utf8")).toBe(input);
    expect(result.status).toBe(2);
  });

  test("a recorded node that is gone falls back to git-grove on PATH", () => {
    const home = join(dir, "home");
    const pathDir = join(dir, "path");
    mkdirSync(home);
    mkdirSync(pathDir);
    const bin = join(dir, "bin.js");
    writeFileSync(bin, "");
    writeFileSync(join(home, "hook-command"), `${join(dir, "missing-node")}\n${bin}\n`);
    script(join(pathDir, "git-grove"), 'echo "$@"');

    const result = run({ HOME: dir, GIT_GROVE_HOME: home, PATH: `${pathDir}:/usr/bin:/bin` }, "{}");

    expect(result.stdout).toBe("guard --claude\n");
    expect(result.status).toBe(0);
  });

  test("a recorded node that is a directory falls back to git-grove on PATH", () => {
    const home = join(dir, "home");
    const pathDir = join(dir, "path");
    const folder = join(dir, "node-folder");
    mkdirSync(home);
    mkdirSync(pathDir);
    mkdirSync(folder);
    const bin = join(dir, "bin.js");
    writeFileSync(bin, "");
    writeFileSync(join(home, "hook-command"), `${folder}\n${bin}\n`);
    script(join(pathDir, "git-grove"), 'echo "$@"');

    const result = run({ HOME: dir, GIT_GROVE_HOME: home, PATH: `${pathDir}:/usr/bin:/bin` }, "{}");

    expect(result.stdout).toBe("guard --claude\n");
    expect(result.status).toBe(0);
  });

  test("with nothing recorded and nothing on PATH it allows, saying why", () => {
    const result = run({ HOME: dir, GIT_GROVE_HOME: join(dir, "none"), PATH: "/usr/bin:/bin" }, "{}");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe(`${message}\n`);
    expect(result.stdout).toBe("");
  });

  test("GIT_GROVE_HOME and a HOME with spaces are honoured", () => {
    const spaced = join(dir, "a b");
    const home = join(dir, "grove home");
    mkdirSync(spaced);
    mkdirSync(home);
    const fakeNode = script(join(dir, "fake node"), 'echo "$@"');
    const bin = join(dir, "bin.js");
    writeFileSync(bin, "");
    writeFileSync(join(home, "hook-command"), `${fakeNode}\n${bin}\n`);

    const viaHome = run({ HOME: spaced, GIT_GROVE_HOME: home, PATH: "/usr/bin:/bin" }, "{}");
    expect(viaHome.stdout).toBe(`${bin} guard --claude\n`);

    mkdirSync(join(spaced, ".git-grove"));
    writeFileSync(join(spaced, ".git-grove", "hook-command"), `${fakeNode}\n${bin}\n`);
    const viaDefault = run({ HOME: spaced, PATH: "/usr/bin:/bin" }, "{}");
    expect(viaDefault.stdout).toBe(`${bin} guard --claude\n`);
  });

  test("with --announce it runs the recorded grove's guard --announce", () => {
    const home = join(dir, "home");
    mkdirSync(home);
    const fakeNode = script(join(dir, "fake-node"), 'echo "$@"');
    const bin = join(dir, "bin.js");
    writeFileSync(bin, "");
    writeFileSync(join(home, "hook-command"), `${fakeNode}\n${bin}\n`);

    const result = run({ HOME: dir, GIT_GROVE_HOME: home, PATH: "/usr/bin:/bin" }, "{}", ["--announce"]);

    expect(result.stdout).toBe(`${bin} guard --announce\n`);
    expect(result.status).toBe(0);
  });

  test("with --announce and no grove it says nothing and exits 0", () => {
    const result = run({ HOME: dir, PATH: "/usr/bin:/bin" }, "{}", ["--announce"]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
