import { createServer, type Server } from "node:http";
import { afterEach, expect, test } from "vitest";
import { listenOnLoopback } from "../../src/server/http/listen-on-loopback.js";

let opened: Server[] = [];

afterEach(async () => {
  await Promise.all(opened.map((server) => new Promise((resolve) => server.close(resolve))));
  opened = [];
});

test("an address this machine does not have (as ::1 is with IPv6 off) is skipped, keeping 127.0.0.1", async () => {
  const listening = await listenOnLoopback(() => createServer(), 0, "192.0.2.1");
  opened = listening.servers;
  expect(listening.servers).toHaveLength(1);
  expect(listening.port).toBeGreaterThan(0);
  const address = listening.servers[0]?.address();
  expect(typeof address === "object" && address !== null ? address.address : null).toBe("127.0.0.1");
});
