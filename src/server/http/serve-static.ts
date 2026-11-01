import { readFile, realpath, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";
import { send } from "./send.js";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

function segmentsOf(path: string): string[] | null {
  if (path === "/") return ["index.html"];
  const segments: string[] = [];
  for (const raw of path.slice(1).split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === "" || segment === "." || segment === ".." || /[/\\\0]/.test(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

async function fileInside(root: string, segments: string[]): Promise<string | null> {
  try {
    const real = await realpath(join(root, ...segments));
    return real.startsWith(root + sep) && (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Serves a file from `uiDir` for a GET or HEAD of `path` (still percent-encoded), or 404. A path that would leave
 * `uiDir`, by its segments or through a symlink, is 404. `/` and `/index.html` serve `index.html` with
 * `%GROVE_TOKEN%` and `%GROVE_VERSION%` replaced, HTML-escaped, and the content security policy.
 */
export async function serveStatic(
  res: ServerResponse,
  options: { uiDir: string; path: string; page: { token: string; version: string } },
): Promise<void> {
  const segments = segmentsOf(options.path);
  const root = await realpath(options.uiDir).catch(() => null);
  const file = segments === null || root === null ? null : await fileInside(root, segments);
  if (segments === null || file === null) {
    send(res, 404, { error: "not found" });
    return;
  }
  if (segments.length === 1 && segments[0] === "index.html") {
    const html = (await readFile(file, "utf8"))
      .replaceAll("%GROVE_TOKEN%", escapeHtml(options.page.token))
      .replaceAll("%GROVE_VERSION%", escapeHtml(options.page.version));
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[".html"],
      "content-length": Buffer.byteLength(html),
      "content-security-policy": CONTENT_SECURITY_POLICY,
    });
    res.end(html);
    return;
  }
  const bytes = await readFile(file);
  const type = CONTENT_TYPES[extname(segments.at(-1) ?? "")] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "content-length": bytes.length });
  res.end(bytes);
}
