import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "git-grove-config-"));
const globalConfig = join(dir, "gitconfig");
writeFileSync(globalConfig, "");

process.env["GIT_CONFIG_GLOBAL"] = globalConfig;
process.env["GIT_CONFIG_NOSYSTEM"] = "1";

afterAll(() => rmSync(dir, { recursive: true, force: true }));
