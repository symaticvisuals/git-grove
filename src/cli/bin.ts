#!/usr/bin/env node
import "./quiet-sqlite-warning.js";

// Loaded after the warning hook: main.js reaches node:sqlite, which a static import would load first.
const { run } = await import("./main.js");

process.exitCode = await run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  cwd: process.cwd(),
});
