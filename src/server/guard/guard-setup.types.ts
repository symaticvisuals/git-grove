/** Where the agent guard's hook runs from, the Claude Code settings file it goes into, and the grove home it records its command in, all absolute paths. */
export type GuardSetup = { node: string; bin: string; settingsPath: string; home: string };
