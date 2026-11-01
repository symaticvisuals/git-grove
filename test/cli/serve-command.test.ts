import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { serveCommand } from "../../src/cli/commands/serve.js";
import { run } from "../../src/cli/main.js";
import { readServerFile } from "../../src/server/read-server-file.js";
import type { ServerInfo } from "../../src/server/server-info.types.js";
import { startServer } from "../../src/server/start-server.js";

const savedHome = process.env["GIT_GROVE_HOME"];
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "git-grove-serve-"));
  process.env["GIT_GROVE_HOME"] = home;
});
afterEach(async () => {
  if (savedHome === undefined) delete process.env["GIT_GROVE_HOME"];
  else process.env["GIT_GROVE_HOME"] = savedHome;
  await rm(home, { recursive: true, force: true });
});

async function waitForServer(): Promise<ServerInfo> {
  for (let tries = 0; tries < 200; tries++) {
    const info = readServerFile(home);
    if (info !== null) return info;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("server.json never appeared");
}

function io(): { out: string[]; err: string[]; io: { out: (s: string) => void; err: (s: string) => void; cwd: string } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s), cwd: home } };
}

test("serveCommand --port 0 exits 75 after /api/shutdown", async () => {
  const cli = io();
  const exited = run(["serve", "--port", "0"], cli.io);
  const info = await waitForServer();
  const token = await readFile(join(home, "token"), "utf8");
  const res = await fetch(`http://127.0.0.1:${info.port}/api/shutdown`, {
    method: "POST",
    headers: { cookie: `grove_token=${token}`, "x-grove-token": token, "content-type": "application/json" },
  });
  expect(res.status).toBe(202);
  expect(await exited).toBe(75);
  expect(cli.out.join("")).toContain(`http://127.0.0.1:${info.port}/`);
  expect(cli.out.join("")).not.toContain(token);
  expect(existsSync(join(home, "server.json"))).toBe(false);
});

test("serve says where the running server is and exits 0", async () => {
  const running = await startServer({ port: 0, home, version: "1" });
  try {
    const cli = io();
    expect(await serveCommand(cli.io, { port: 0 })).toBe(0);
    expect(cli.out.join("")).toBe(`already running at http://127.0.0.1:${running.port}/\n`);
  } finally {
    await running.close();
  }
});

test.each([["abc"], ["-1"], ["65536"], ["1.5"]])("serve --port %s is refused", async (port) => {
  const cli = io();
  expect(await run(["serve", "--port", port], cli.io)).toBe(1);
  expect(cli.err.join("")).toContain("--port");
  expect(existsSync(join(home, "server.json"))).toBe(false);
});

test("--port belongs to serve alone", async () => {
  const cli = io();
  expect(await run(["status", "--port", "1"], cli.io)).toBe(1);
  expect(cli.err.join("")).toContain("Usage: git grove");
});
