import { afterEach, beforeEach, expect, test } from "vitest";
import { listPins } from "../../../src/core/runner/list-pins.js";
import { pin } from "../../../src/core/runner/pin.js";
import { RepoLockedError } from "../../../src/core/runner/repo-locked.error.js";
import { withRepoLock } from "../../../src/core/runner/with-repo-lock.js";
import { makeRepo, type TestRepo } from "../../support/make-repo.js";

let repo: TestRepo;
let sha: string;

beforeEach(async () => {
  repo = await makeRepo();
  sha = await repo.commit("f.txt", "a\n", "first");
});
afterEach(() => repo.cleanup());

test("pin names the ref by branch and UTC time, suffixing when taken", async () => {
  const at = new Date(Date.UTC(2026, 10, 1, 23, 19, 42));
  expect(await pin(repo.path, "feat/coupons-ui", sha, at)).toBe("refs/grove/pins/feat/coupons-ui/20261101T231942Z");
  expect(await pin(repo.path, "feat/coupons-ui", sha, at)).toBe("refs/grove/pins/feat/coupons-ui/20261101T231942Z-2");
});

test("listPins returns newest first and filters by branch", async () => {
  await pin(repo.path, "feat/x", sha, new Date(Date.UTC(2026, 10, 1, 1, 0, 0)));
  await pin(repo.path, "feat/x", sha, new Date(Date.UTC(2026, 10, 1, 1, 0, 0)));
  await pin(repo.path, "feat/x", sha, new Date(Date.UTC(2026, 10, 1, 2, 0, 0)));
  await pin(repo.path, "other", sha, new Date(Date.UTC(2026, 10, 1, 3, 0, 0)));
  const pins = await listPins(repo.path, "feat/x");
  expect(pins.map((entry) => entry.ref)).toEqual([
    "refs/grove/pins/feat/x/20261101T020000Z",
    "refs/grove/pins/feat/x/20261101T010000Z-2",
    "refs/grove/pins/feat/x/20261101T010000Z",
  ]);
  expect(pins[0]).toMatchObject({ sha, branch: "feat/x", at: "20261101T020000Z" });
  expect(await listPins(repo.path)).toHaveLength(4);
});

test("a second withRepoLock rejects while the first runs, and the lock is removed after", async () => {
  const commonDir = `${repo.path}/.git`;
  await withRepoLock(commonDir, async () => {
    await expect(withRepoLock(commonDir, async () => 1)).rejects.toBeInstanceOf(RepoLockedError);
  });
  expect(await withRepoLock(commonDir, async () => 2)).toBe(2);
});
