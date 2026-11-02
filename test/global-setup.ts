import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** Compiles `src` into `dist` once before any suite runs, for the suites that spawn the built bin. */
export default function buildDist(): void {
  execFileSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json"], { cwd: ROOT, stdio: "inherit" });
}
