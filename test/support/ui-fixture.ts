import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type UiFixture = { dir: string; cleanup: () => Promise<void> };

const INDEX = `<!doctype html>
<html>
<head>
<meta name="grove-version" content="%GROVE_VERSION%">
<script type="module" src="/app.js"></script>
</head>
<body></body>
</html>
`;

const FILES: Record<string, string> = {
  "index.html": INDEX,
  "app.js": "export {};\n",
  "other.html": "<!doctype html><title>other</title>\n",
  "manifest.webmanifest": '{ "name": "git grove", "display": "standalone" }\n',
  "sw.js": "self.addEventListener('fetch', () => {});\n",
  "favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  "icons/icon-192.png": "png",
  "fonts/mono.woff2": "woff2",
};

/** Writes a throwaway `uiDir`: an `index.html` holding the `%GROVE_VERSION%` placeholder, a second page, and the public assets. */
export async function uiFixture(): Promise<UiFixture> {
  const root = await mkdtemp(join(tmpdir(), "git-grove-ui-"));
  const dir = join(root, "ui");
  for (const [name, text] of Object.entries(FILES)) {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, text);
  }
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}
