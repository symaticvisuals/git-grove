import { expect, test } from "vitest";
import { realServiceHost } from "../../../src/core/service/service-host.js";

test("the real service host refuses to exist under vitest, so no test can reach launchctl or systemctl", () => {
  expect(process.env["VITEST"]).toBeDefined();
  expect(() => realServiceHost()).toThrow("realServiceHost refuses to run under vitest; give the code under test a fake ServiceHost");
});
