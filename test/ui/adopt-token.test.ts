import { expect, test } from "vitest";
import { adoptToken } from "../../ui/src/adopt-token.js";

const GOOD = "0123456789abcdef".repeat(4);
const OLD = "f".repeat(64);

function harness(stored: string | null, accepts: (token: string) => boolean) {
  const items = new Map<string, string>(stored === null ? [] : [["grove.token", stored]]);
  const hashes: string[] = [];
  const verified: string[] = [];
  return {
    items,
    hashes,
    verified,
    adopt: (hash: string) =>
      adoptToken({
        hash,
        storage: { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) },
        verify: async (token) => {
          verified.push(token);
          return accepts(token);
        },
        replaceHash: (next) => void hashes.push(next),
      }),
  };
}

test("a fragment token that the server accepts is stored and used, and the fragment is stripped", async () => {
  const h = harness(OLD, () => true);
  expect(await h.adopt(`#token=${GOOD}`)).toBe(GOOD);
  expect(h.items.get("grove.token")).toBe(GOOD);
  expect(h.hashes).toEqual(["#/"]);
});

test("a token the server refuses leaves the stored one in place", async () => {
  const h = harness(OLD, () => false);
  expect(await h.adopt(`#token=${GOOD}`)).toBe(OLD);
  expect(h.items.get("grove.token")).toBe(OLD);
  expect(h.verified).toEqual([GOOD]);
  expect(h.hashes).toEqual(["#/"]);
});

test.each([["short", "abc"], ["uppercase", GOOD.toUpperCase()], ["too long", `${GOOD}0`], ["not hex", "g".repeat(64)], ["markup", "<img src=x onerror=alert(1)>"]])(
  "a %s token is ignored without asking the server",
  async (_name, token) => {
    const h = harness(OLD, () => true);
    expect(await h.adopt(`#token=${encodeURIComponent(token)}`)).toBe(OLD);
    expect(h.verified).toEqual([]);
    expect(h.items.get("grove.token")).toBe(OLD);
    expect(h.hashes).toEqual(["#/"]);
  },
);

test("the route after the token is kept", async () => {
  const h = harness(null, () => true);
  expect(await h.adopt(`#token=${GOOD}&route=${encodeURIComponent("/r/2/f/2.YQ")}`)).toBe(GOOD);
  expect(h.hashes).toEqual(["#/r/2/f/2.YQ"]);
});

test("with no token in the fragment, the stored token is used and the hash is left alone", async () => {
  const h = harness(OLD, () => true);
  expect(await h.adopt("#/r/1")).toBe(OLD);
  expect(await harness(null, () => true).adopt("")).toBeNull();
  expect(h.hashes).toEqual([]);
  expect(h.verified).toEqual([]);
});

test.each([
  [`#/r/1&token=${GOOD}`, "#/r/1", GOOD],
  [`#/r/1/f/1.YQ?token=${GOOD}&x=1`, "#/r/1/f/1.YQ", GOOD],
  ["#/r/2/token=junk", "#/r/2", OLD],
  [`#token=${GOOD}&route=${encodeURIComponent(`/r/3?token=${"0".repeat(64)}`)}`, "#/r/3", GOOD],
  ["#/token=x", "#/", OLD],
])("a token anywhere in %s is stripped", async (hash, route, used) => {
  const h = harness(OLD, () => true);
  expect(await h.adopt(hash)).toBe(used);
  expect(h.hashes).toEqual([route]);
});
