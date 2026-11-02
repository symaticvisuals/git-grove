/**
 * One word of a shell command after quote removal. `dynamic` when it holds an expansion the guard cannot resolve
 * (`$VAR`, `${VAR}`, `$1`); `glob` when it holds an unquoted `*`, `?`, `[` or `{`.
 */
export type ShellWord = { text: string; dynamic: boolean; glob: boolean };

/** A simple command's words, or the start or end of a `( … )` subshell. */
export type ShellItem = { kind: "words"; words: ShellWord[] } | { kind: "open" } | { kind: "close" };

/** A command line split into items; `substitution` when it holds `$(`, a backtick or `<(`, where reading stopped. */
export type ShellLine = { items: ShellItem[]; substitution: boolean };

/** A simple command and the folder it runs in, null when a `cd` the guard cannot follow came before it. */
export type SimpleCommand = { words: ShellWord[]; cwd: string | null };

/** The simple commands of a line, or `evaluable: false` when it hides commands from the guard. */
export type CommandLine = { evaluable: true; commands: SimpleCommand[] } | { evaluable: false };
