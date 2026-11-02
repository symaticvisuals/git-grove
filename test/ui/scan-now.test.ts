import { expect, test } from "vitest";
import type { WireProject } from "../../src/server/wire/wire.types.js";
import { ApiError } from "../../ui/src/api.error.js";
import { scanNow } from "../../ui/src/scan-now.js";
import { project } from "./wire-fixtures.js";

function clock(start: number): { now(): number; sleep(ms: number): Promise<void> } {
  let at = start;
  return {
    now: () => at,
    sleep: async (ms) => {
      at += ms;
    },
  };
}

test("Scan now waits for a scan that began after the click and says how many worktrees it took how long", async () => {
  const time = clock(10_000);
  const replies: WireProject[][] = [
    [project({ id: 1, worktrees: 6, scannedAt: 9_000 }), project({ id: 2, worktrees: 3, scannedAt: 1 })],
    [project({ id: 1, worktrees: 6, scannedAt: 10_000 }), project({ id: 2, worktrees: 3, scannedAt: 1 })],
  ];
  const scanned: (number | undefined)[] = [];
  const message = await scanNow({
    api: { scan: async (repo) => void scanned.push(repo), projects: async () => replies.shift() ?? [] },
    repo: 1,
    ...time,
  });
  expect(scanned).toEqual([1]);
  expect(message).toBe("Scanned 6 worktrees in 0.3 s");
});

test("a scan of every repo waits for all of them, counting a repo whose scan failed as done", async () => {
  const time = clock(0);
  const message = await scanNow({
    api: { scan: async () => undefined, projects: async () => [project({ id: 1, worktrees: 1, scannedAt: 5 }), project({ id: 2, worktrees: 2, scannedAt: null, error: "gone" })] },
    repo: undefined,
    ...time,
  });
  expect(message).toBe("Scanned 3 worktrees in 0.0 s");
});

test("a failed scan request throws its one-line error for the toast", async () => {
  const error = await scanNow({
    api: { scan: async () => Promise.reject(new ApiError(0, "git grove isn't running. Start it with git grove ui.")), projects: async () => [] },
    repo: 1,
    ...clock(0),
  }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiError);
  expect(error instanceof ApiError ? error.message : "").toBe("git grove isn't running. Start it with git grove ui.");
});
