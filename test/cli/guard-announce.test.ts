import { expect, test } from "vitest";
import { runGuard } from "../../src/cli/run-guard.js";
import { BOUND_NOTICE } from "../../src/core/guard/bound-notice.js";

test("guard --announce tells a new session this agent is bounded, without reading stdin", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runGuard(["--announce"], { out: (line) => out.push(line), err: (line) => err.push(line), cwd: "/" });
  expect(code).toBe(0);
  expect(err).toEqual([]);
  expect(JSON.parse(out.join(""))).toEqual({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: BOUND_NOTICE },
  });
});
