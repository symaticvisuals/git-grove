import { expect, test } from "vitest";
import { installedProgram } from "../../../src/core/service/installed-program.js";
import { launchdPlist } from "../../../src/core/service/launchd-plist.js";
import type { ServiceProgram } from "../../../src/core/service/service-program.types.js";
import { systemdUnit } from "../../../src/core/service/systemd-unit.js";

const PROGRAM: ServiceProgram = {
  node: "/opt/node/bin/node",
  bin: "/opt/grove/dist/cli/bin.js",
  groveHome: null,
  path: "/usr/bin:/bin",
  logFile: "/Users/me/.git-grove/server.log",
};

const ODD: ServiceProgram = { ...PROGRAM, node: `/a b/"n'o&d<e>"/50%/node`, bin: '/x/\\$HOME/"it"/bin.js' };

test("the node and bin a written agent or unit runs are read back exactly", () => {
  for (const program of [PROGRAM, ODD]) {
    expect(installedProgram("launchd", launchdPlist(program))).toEqual({ node: program.node, bin: program.bin });
    expect(installedProgram("systemd", systemdUnit(program))).toEqual({ node: program.node, bin: program.bin });
  }
});

test("a file that is not one grove wrote gives null", () => {
  expect(installedProgram("launchd", "<plist><dict></dict></plist>")).toBeNull();
  expect(installedProgram("launchd", "<key>ProgramArguments</key><array><string>/only/node</string></array>")).toBeNull();
  expect(installedProgram("systemd", "[Service]\nExecStart=/usr/bin/env node bin.js serve\n")).toBeNull();
  expect(installedProgram("systemd", "")).toBeNull();
});
