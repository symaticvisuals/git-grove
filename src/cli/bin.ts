#!/usr/bin/env node
import "./quiet-sqlite-warning.js";

try {
  // Loaded after the warning hook: main.js reaches node:sqlite, which a static import would load first.
  const { run } = await import("./main.js");
  process.exitCode = await run(process.argv.slice(2), {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    cwd: process.cwd(),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`git-grove: unexpected error: ${message.split("\n")[0] ?? message}\n`);
  process.exitCode = 1;
}
