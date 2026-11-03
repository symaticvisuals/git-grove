import { expect, test } from "vitest";
import { setupRedirect } from "../../ui/src/setup-redirect.js";

test("a first visit remembers the address it opened, the dashboard for none or the setup page itself", () => {
  expect(setupRedirect(false, "")).toBe("#/");
  expect(setupRedirect(false, "#/setup")).toBe("#/");
  expect(setupRedirect(false, "#/r/3")).toBe("#/r/3");
});

test("a page that has seen setup is not redirected", () => {
  expect(setupRedirect(true, "")).toBeNull();
  expect(setupRedirect(true, "#/r/3")).toBeNull();
});
