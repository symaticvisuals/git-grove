import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { expect, test } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");
const STATIC = /\b(?:import|export)\s[^"';]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

type Graph = { files: Set<string>; builtins: Set<string> };

function sourceOf(from: string, specifier: string): string {
  return resolve(dirname(from), specifier).replace(/\.js$/, ".ts");
}

/** Every source file `entry` reaches through static imports, and the `node:` modules they import. */
async function staticGraph(entry: string): Promise<Graph> {
  const graph: Graph = { files: new Set(), builtins: new Set() };
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (graph.files.has(file)) continue;
    graph.files.add(file);
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(STATIC)) {
      if (/^\s*import\s+type\b|^\s*export\s+type\b/.test(match[0])) continue;
      const specifier = match[1] ?? match[2] ?? "";
      if (specifier.startsWith(".")) queue.push(sourceOf(file, specifier));
      else graph.builtins.add(specifier);
    }
  }
  return graph;
}

test("the guard's entry never reaches the server, the dashboard or the CLI's main dispatch", async () => {
  const graph = await staticGraph(join(SRC, "cli", "run-guard.ts"));
  const files = [...graph.files].map((file) => relative(ROOT, file));
  expect(files.length).toBeGreaterThan(20);
  expect(files.filter((file) => file.startsWith("src/server/") || file.startsWith("ui/") || file === "src/cli/main.ts")).toEqual([]);
  expect([...graph.builtins].filter((name) => name === "node:sqlite" || name === "node:http")).toEqual([]);
});

test("bin.ts reaches the guard and main only through dynamic imports", async () => {
  const bin = await readFile(join(SRC, "cli", "bin.ts"), "utf8");
  const dynamic = [...bin.matchAll(DYNAMIC)].map((match) => match[1]);
  expect(dynamic).toEqual(expect.arrayContaining(["./run-guard.js", "./main.js"]));
  expect((await staticGraph(join(SRC, "cli", "bin.ts"))).files.size).toBe(2);
});
