import type { GroveConfig } from "../config/read-config.js";

/**
 * The command that opens `path` in the editor or the terminal, to run in `cwd`. A configured command gets `path`
 * appended; the defaults are `code <path>`, `open -a Terminal <path>` on macOS and `x-terminal-emulator` started in
 * `path` elsewhere.
 */
export function appCommand(
  app: "editor" | "terminal",
  path: string,
  config: GroveConfig,
  platform: NodeJS.Platform,
): { argv: string[]; cwd: string } {
  const configured = config[app];
  if (configured !== null) return { argv: [...configured, path], cwd: path };
  if (app === "editor") return { argv: ["code", path], cwd: path };
  if (platform === "darwin") return { argv: ["open", "-a", "Terminal", path], cwd: path };
  return { argv: ["x-terminal-emulator"], cwd: path };
}
