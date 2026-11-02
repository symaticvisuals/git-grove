/**
 * What a login service runs: `<node> <bin> serve`, with `PATH` and, when set, `GIT_GROVE_HOME` and
 * `CLAUDE_CONFIG_DIR` (`claudeConfigDir`, left out when unset) in its environment, and its output appended to
 * `logFile`. Every path is absolute.
 */
export type ServiceProgram = { node: string; bin: string; groveHome: string | null; path: string; logFile: string; claudeConfigDir?: string };
