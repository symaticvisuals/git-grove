import { expect, test } from "vitest";
import { compareVersions } from "../../src/cli/compare-versions.js";

test("versions compare part by part as numbers", () => {
  expect(compareVersions("0.1.0", "0.10.0")).toBeLessThan(0);
  expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  expect(compareVersions("0.0.1", "0.1.0")).toBeLessThan(0);
  expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
});

test("a pre-release sorts before its release", () => {
  expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0", "1.0.0-beta.1")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBeLessThan(0);
});

test("a version that is not x.y.z compares equal, so it never triggers a restart", () => {
  expect(compareVersions("dev", "1.0.0")).toBe(0);
  expect(compareVersions("1.0.0", "")).toBe(0);
});
