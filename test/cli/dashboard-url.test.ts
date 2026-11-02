import { expect, test } from "vitest";
import { dashboardUrl } from "../../src/cli/dashboard-url.js";
import { adoptToken } from "../../ui/src/adopt-token.js";

const TOKEN = "ab".repeat(32);

test("a feature, a repo and nothing give the three fragment forms", () => {
  expect(dashboardUrl(47683, TOKEN, { repoId: 3, featureId: "3.ZmVhdA" })).toBe(`http://127.0.0.1:47683/#token=${TOKEN}&route=%2Fr%2F3%2Ff%2F3.ZmVhdA`);
  expect(dashboardUrl(47683, TOKEN, { repoId: 3, featureId: null })).toBe(`http://127.0.0.1:47683/#token=${TOKEN}&route=%2Fr%2F3`);
  expect(dashboardUrl(47684, TOKEN, null)).toBe(`http://127.0.0.1:47684/#token=${TOKEN}&route=%2F`);
});

test("the page reads the token and the route back out of the fragment", async () => {
  const replaced: string[] = [];
  const stored = new Map<string, string>();
  const url = new URL(dashboardUrl(47683, TOKEN, { repoId: 3, featureId: "3.ZmVhdA" }));
  const token = await adoptToken({
    hash: url.hash,
    storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => void stored.set(key, value) },
    verify: async (given) => given === TOKEN,
    replaceHash: (hash) => void replaced.push(hash),
  });
  expect(token).toBe(TOKEN);
  expect(replaced).toEqual(["#/r/3/f/3.ZmVhdA"]);
});
