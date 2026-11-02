import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "git-grove-config-"));
const globalConfig = join(dir, "gitconfig");
// A user's own config names who they are; without it git on Linux has no committer for the commits grove rebases.
writeFileSync(globalConfig, "[user]\n\tname = Test Author\n\temail = author@example.com\n");

process.env["GIT_CONFIG_GLOBAL"] = globalConfig;
process.env["GIT_CONFIG_NOSYSTEM"] = "1";

afterAll(() => rmSync(dir, { recursive: true, force: true }));
