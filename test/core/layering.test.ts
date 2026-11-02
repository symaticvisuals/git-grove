import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CORE = join(ROOT, "src", "core");
const FORBIDDEN = [join(ROOT, "src", "server"), join(ROOT, "src", "cli"), join(ROOT, "ui")];
const SPECIFIERS = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".ts")).map((entry) => join(entry.parentPath, entry.name));
}

function crosses(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(file), specifier);
  return FORBIDDEN.some((layer) => target === layer || target.startsWith(`${layer}/`));
}

test("src/core never imports from src/server, src/cli or ui/", async () => {
  const files = await sources(CORE);
  expect(files.length).toBeGreaterThan(100);
  const offending: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const [, specifier = ""] of text.matchAll(SPECIFIERS)) {
      if (crosses(file, specifier)) offending.push(`${relative(ROOT, file)} imports ${specifier}`);
    }
  }
  expect(offending).toEqual([]);
});

test("the layering check catches an import that climbs into the server", () => {
  expect(crosses(join(CORE, "describe-error.ts"), "../server/http/ports-in-use.error.js")).toBe(true);
  expect(crosses(join(CORE, "actions", "x.ts"), "../../cli/main.js")).toBe(true);
  expect(crosses(join(CORE, "actions", "x.ts"), "../../../ui/src/api.js")).toBe(true);
  expect(crosses(join(CORE, "actions", "x.ts"), "../git/run-git.js")).toBe(false);
  expect(crosses(join(CORE, "actions", "x.ts"), "node:fs")).toBe(false);
});
