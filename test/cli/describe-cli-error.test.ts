import { expect, test } from "vitest";
import { describeCliError } from "../../src/cli/describe-cli-error.js";
import { InvalidInputError } from "../../src/core/actions/invalid-input.error.js";
import { describeError } from "../../src/core/describe-error.js";
import { PortsInUseError } from "../../src/server/http/ports-in-use.error.js";
import { ServerUnresponsiveError } from "../../src/server/server-unresponsive.error.js";

test("the CLI describes the server's port and lock errors, which core no longer knows", () => {
  const ports = new PortsInUseError(47683, 47702);
  const silent = new ServerUnresponsiveError(42, "/home/.git-grove/server.lock", "it has written no server.json");
  expect(describeCliError(ports)).toBe("git-grove: ports 47683 to 47702 are all in use");
  expect(describeCliError(silent)).toMatch(/^git-grove: process 42 holds the server lock, but it has written no server\.json; /);
  expect(describeError(ports)).toBeNull();
  expect(describeError(silent)).toBeNull();
});

test("everything else goes to core's describeError", () => {
  expect(describeCliError(new InvalidInputError("no pin found for feat"))).toBe("git-grove: no pin found for feat");
  expect(describeCliError(new Error("a bug"))).toBeNull();
});
