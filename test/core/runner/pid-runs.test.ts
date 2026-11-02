import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, test } from "vitest";
import { pidRuns } from "../../../src/core/runner/pid-runs.js";

test("pidRuns is true for a running process and false once it has exited", async () => {
  expect(pidRuns(process.pid)).toBe(true);
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid ?? 0;
  await once(child, "exit");
  expect(pidRuns(pid)).toBe(false);
});
