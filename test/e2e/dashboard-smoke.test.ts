import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { type RunningServer, startServer } from "../../src/server/start-server.js";
import { serverRequest } from "../support/server-request.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

let out: string;
let home: string;
let server: RunningServer;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "git-grove-ui-build-"));
  home = await mkdtemp(join(tmpdir(), "git-grove-smoke-"));
  await promisify(execFile)(process.execPath, [join(ROOT, "scripts", "build-ui.mjs"), "--out", out], { cwd: ROOT });
  server = await startServer({ port: 0, home, uiDir: out, version: "0.0.0-smoke" });
}, 120_000);

afterAll(async () => {
  await server?.close();
  await rm(out, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

function get(path: string, token?: string) {
  return serverRequest(server.port, { path, headers: token === undefined ? {} : { "x-grove-token": token } });
}

test("/ needs no token and carries the version meta and /app.js, with no inline script or style", async () => {
  const page = await get("/");
  expect(page.status).toBe(200);
  expect(page.body).toContain('<meta name="grove-version" content="0.0.0-smoke">');
  expect(page.body).toContain('src="/app.js"');
  expect(page.body).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  expect(page.body).not.toMatch(/\sstyle=/);
  expect(page.body).not.toContain("fonts.googleapis");
  const csp = String(page.headers["content-security-policy"]);
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("style-src 'self'");
});

test("/app.js is text/javascript, and the styles and both fonts are served", async () => {
  const app = await get("/app.js");
  expect(app.status).toBe(200);
  expect(app.headers["content-type"]).toContain("text/javascript");
  expect(app.body).not.toMatch(/\sstyle=/);
  expect(app.body).not.toContain("EventSource");
  const styles = await get("/styles.css");
  expect(styles.status).toBe(200);
  expect(styles.body).toContain("/fonts/martian-mono.woff2");
  expect(styles.body).not.toContain("fonts.googleapis");
  for (const font of ["martian-mono.woff2", "atkinson-hyperlegible-next.woff2"]) {
    const reply = await get(`/fonts/${font}`);
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("font/woff2");
  }
  expect((await get("/fonts/OFL.txt")).body).toContain("SIL Open Font License");
});

test("/api/projects is 401 without the header and a 200 array with it", async () => {
  expect((await get("/api/projects")).status).toBe(401);
  const reply = await get("/api/projects", server.token);
  expect(reply.status).toBe(200);
  expect(Array.isArray(JSON.parse(reply.body))).toBe(true);
});

test("POST /api/scan is 401 without the header and 202 with it", async () => {
  const post = (headers: Record<string, string>) =>
    serverRequest(server.port, { method: "POST", path: "/api/scan", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  expect((await post({})).status).toBe(401);
  expect((await post({ "x-grove-token": server.token })).status).toBe(202);
});

test("the bundle has a linked source map and carries no token", async () => {
  const bundle = await readFile(join(out, "app.js"), "utf8");
  expect(bundle).toContain("sourceMappingURL=app.js.map");
  expect(bundle).not.toContain(server.token);
  expect((await get("/app.js.map")).status).toBe(200);
});

test("the build empties dist/ui first, and refuses a custom folder that is not empty", async () => {
  const run = (args: string[]) => promisify(execFile)(process.execPath, [join(ROOT, "scripts", "build-ui.mjs"), ...args], { cwd: ROOT });
  const stale = join(ROOT, "dist", "ui", "stale-from-an-old-build.js");
  await mkdir(join(ROOT, "dist", "ui"), { recursive: true });
  await writeFile(stale, "old");
  await run([]);
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(join(ROOT, "dist", "ui", "app.js"))).toBe(true);
  const used = await mkdtemp(join(tmpdir(), "git-grove-ui-used-"));
  await writeFile(join(used, "keep.txt"), "mine");
  await expect(run(["--out", used])).rejects.toThrow(/not empty/);
  expect(await readFile(join(used, "keep.txt"), "utf8")).toBe("mine");
  await rm(used, { recursive: true, force: true });
});
