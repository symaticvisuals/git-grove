import { expect, test } from "vitest";
import { launchdPlist } from "../../../src/core/service/launchd-plist.js";
import type { ServiceProgram } from "../../../src/core/service/service-program.types.js";

const PROGRAM: ServiceProgram = {
  node: "/opt/node/bin/node",
  bin: "/opt/grove/dist/cli/bin.js",
  groveHome: null,
  path: "/opt/homebrew/bin:/usr/bin:/bin",
  logFile: "/Users/me/.git-grove/server.log",
};

test("the launchd agent runs node, the bin and serve at load, restarts after a failure and waits 90 s to stop", () => {
  expect(launchdPlist(PROGRAM)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>work.grove.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/node/bin/node</string>
    <string>/opt/grove/dist/cli/bin.js</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ExitTimeOut</key>
  <integer>90</integer>
  <key>StandardOutPath</key>
  <string>/Users/me/.git-grove/server.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/me/.git-grove/server.log</string>
</dict>
</plist>
`);
});

test("the launchd agent carries GIT_GROVE_HOME when set, and escapes every string", () => {
  const plist = launchdPlist({ ...PROGRAM, groveHome: "/tmp/a&b <grove>", bin: `/x/"it's"/bin.js` });
  expect(plist).toContain("<key>GIT_GROVE_HOME</key>\n    <string>/tmp/a&amp;b &lt;grove&gt;</string>");
  expect(plist).toContain("<string>/x/&quot;it&apos;s&quot;/bin.js</string>");
});
