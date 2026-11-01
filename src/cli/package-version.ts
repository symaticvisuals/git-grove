import { createRequire } from "node:module";

function hasVersion(value: unknown): value is { version: string } {
  return typeof value === "object" && value !== null && "version" in value && typeof value.version === "string";
}

/** The version in git-grove's own package.json. */
export function packageVersion(): string {
  const pkg: unknown = createRequire(import.meta.url)("../../package.json");
  if (!hasVersion(pkg)) throw new Error("git-grove: package.json has no version");
  return pkg.version;
}
