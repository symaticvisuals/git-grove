#!/usr/bin/env node
import "./quiet-sqlite-warning.js";

const argv = process.argv.slice(2);

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? message;
}

if (argv[0] === "guard") {
  let code = 0;
  try {
    const { runGuard } = await import("./run-guard.js");
    code = await runGuard(argv.slice(1), {
      out: (s) => process.stdout.write(s),
      err: (s) => process.stderr.write(s),
      cwd: process.cwd(),
    });
  } catch (error) {
    process.stderr.write(`git-grove guard: could not check (${firstLine(error)}); allowing\n`);
  }
  process.exitCode = code;
  process.stderr.write("", () => process.exit(code));
} else {
  try {
    // Loaded after the warning hook: main.js reaches node:sqlite, which a static import would load first.
    const { run } = await import("./main.js");
    process.exitCode = await run(argv, {
      out: (s) => process.stdout.write(s),
      err: (s) => process.stderr.write(s),
      cwd: process.cwd(),
    });
  } catch (error) {
    process.stderr.write(`git-grove: unexpected error: ${firstLine(error)}\n`);
    process.exitCode = 1;
  }
}
