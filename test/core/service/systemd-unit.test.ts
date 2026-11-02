import { expect, test } from "vitest";
import { InvalidInputError } from "../../../src/core/actions/invalid-input.error.js";
import type { ServiceProgram } from "../../../src/core/service/service-program.types.js";
import { systemdUnit } from "../../../src/core/service/systemd-unit.js";

const PROGRAM: ServiceProgram = {
  node: "/opt/node/bin/node",
  bin: "/opt/grove/dist/cli/bin.js",
  groveHome: null,
  path: "/opt/homebrew/bin:/usr/bin:/bin",
  logFile: "/Users/me/.git-grove/server.log",
};

test("the systemd unit restarts after a failure every 5 s without a start limit, waits 90 s to stop and starts at login", () => {
  expect(systemdUnit(PROGRAM)).toBe(`[Unit]
Description=git grove dashboard server
StartLimitIntervalSec=0

[Service]
ExecStart="/opt/node/bin/node" "/opt/grove/dist/cli/bin.js" serve
Environment="PATH=/opt/homebrew/bin:/usr/bin:/bin"
Restart=on-failure
RestartSec=5
TimeoutStopSec=90
StandardOutput=append:/Users/me/.git-grove/server.log
StandardError=append:/Users/me/.git-grove/server.log

[Install]
WantedBy=default.target
`);
});

test("the systemd unit carries GIT_GROVE_HOME when set, and escapes quotes, backslashes, specifiers and variables", () => {
  const unit = systemdUnit({ ...PROGRAM, groveHome: "/home/me/50%", bin: '/home/me/"odd"\\$HOME/bin.js' });
  expect(unit).toContain('ExecStart="/opt/node/bin/node" "/home/me/\\"odd\\"\\\\$$HOME/bin.js" serve');
  expect(unit).toContain('Environment="GIT_GROVE_HOME=/home/me/50%%"');
});

test("a path with a line break is refused rather than written into a unit", () => {
  expect(() => systemdUnit({ ...PROGRAM, bin: "/a\nExecStartPre=/bin/evil" })).toThrow(InvalidInputError);
});
