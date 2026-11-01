#!/usr/bin/env node
import "./quiet-sqlite-warning.js";
import { run } from "./main.js";

process.exitCode = await run(process.argv.slice(2), {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  cwd: process.cwd(),
});
