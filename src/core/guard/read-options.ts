import type { ShellWord } from "./shell-line.types.js";

/**
 * A command's arguments sorted into options, operands and the words after `--`. `options` holds each option by name,
 * a short cluster such as `-rf` split into `-r` and `-f`; `values` holds the value of each option that took one.
 */
export type ReadOptions = { options: Set<string>; values: Map<string, ShellWord>; operands: ShellWord[]; afterDashes: ShellWord[] | null };

/**
 * Reads `args` the way git and rm read theirs: an option may come after an operand, `--name=value` and the names in
 * `takesValue` carry a value (`-s HEAD`, `-sHEAD`, `--source HEAD`), and `--` ends the options.
 */
export function readOptions(args: readonly ShellWord[], takesValue: ReadonlySet<string> = new Set()): ReadOptions {
  const read: ReadOptions = { options: new Set(), values: new Map(), operands: [], afterDashes: null };
  for (let at = 0; at < args.length; at++) {
    const word = args[at];
    if (word === undefined) break;
    const { text } = word;
    if (text === "--") {
      read.afterDashes = args.slice(at + 1);
      break;
    }
    if (!text.startsWith("-") || text === "-") {
      read.operands.push(word);
    } else if (text.startsWith("--")) {
      const equals = text.indexOf("=");
      const name = equals === -1 ? text : text.slice(0, equals);
      read.options.add(name);
      if (equals !== -1) read.values.set(name, { ...word, text: text.slice(equals + 1) });
      else if (takesValue.has(name) && args[at + 1] !== undefined) read.values.set(name, args[++at] ?? word);
    } else {
      for (let letter = 1; letter < text.length; letter++) {
        const name = `-${text[letter] ?? ""}`;
        read.options.add(name);
        if (!takesValue.has(name)) continue;
        const attached = text.slice(letter + 1);
        if (attached !== "") read.values.set(name, { ...word, text: attached });
        else if (args[at + 1] !== undefined) read.values.set(name, args[++at] ?? word);
        break;
      }
    }
  }
  return read;
}
