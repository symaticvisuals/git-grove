import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOut = join(root, "dist", "ui");
const { values } = parseArgs({ options: { out: { type: "string" } } });
const out = resolve(values.out ?? defaultOut);
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

if (out === defaultOut) await rm(out, { recursive: true, force: true });
else if ((await readdir(out).catch(() => [])).length > 0) throw new Error(`build-ui: ${out} is not empty; give an empty or new folder`);

await mkdir(out, { recursive: true });
await build({
  entryPoints: { app: join(root, "ui", "src", "main.ts") },
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: "linked",
  legalComments: "none",
  define: { __GROVE_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});
await cp(join(root, "ui", "index.html"), join(out, "index.html"));
await cp(join(root, "ui", "styles.css"), join(out, "styles.css"));
await cp(join(root, "ui", "public"), out, { recursive: true });
