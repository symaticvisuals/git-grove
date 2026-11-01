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

test("concurrent pins at the same time each get their own ref", async () => {
  const at = new Date(Date.UTC(2026, 10, 1, 4, 0, 0));
  const refs = await Promise.all([1, 2, 3].map(() => pin(repo.path, "feat/race", sha, at)));
  expect(new Set(refs).size).toBe(3);
  expect((await listPins(repo.path, "feat/race")).map((entry) => entry.ref).sort()).toEqual([...refs].sort());
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

test("listPins orders by time then numeric suffix across branches", async () => {
  const t1 = new Date(Date.UTC(2026, 10, 1, 1, 0, 0));
  const t2 = new Date(Date.UTC(2026, 10, 1, 2, 0, 0));
  for (let i = 0; i < 10; i++) await pin(repo.path, "a", sha, t2);
  await pin(repo.path, "z", sha, t1);
  await pin(repo.path, "z", sha, t2);
  const refs = (await listPins(repo.path)).map((entry) => entry.ref);
  expect(refs.slice(0, 3)).toEqual([
    "refs/grove/pins/a/20261101T020000Z-10",
    "refs/grove/pins/a/20261101T020000Z-9",
    "refs/grove/pins/a/20261101T020000Z-8",
  ]);
  expect(refs.indexOf("refs/grove/pins/z/20261101T020000Z")).toBeLessThan(refs.indexOf("refs/grove/pins/z/20261101T010000Z"));
  expect(refs.at(-1)).toBe("refs/grove/pins/z/20261101T010000Z");
});
