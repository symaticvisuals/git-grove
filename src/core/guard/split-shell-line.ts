import type { ShellItem, ShellLine, ShellWord } from "./shell-line.types.js";

type Draft = { text: string; dynamic: boolean; glob: boolean; quoted: boolean };
type Target = { heredoc: false } | { heredoc: true; stripTabs: boolean };
type Heredoc = { delimiter: string; stripTabs: boolean };

const NAME_START = /^[A-Za-z_]$/;
const NAME_PART = /^[A-Za-z0-9_]$/;
const SPECIAL_PARAMETER = /^[@*#?$!0-9-]$/;
const GLOB = new Set(["*", "?", "[", "{"]);
const BLANK = new Set([" ", "\t"]);
const WORD_END = new Set(["", " ", "\t", "\n", ";", "&", "|", "(", ")", "<", ">"]);
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\"]);

/**
 * Splits a shell command line into simple commands' words, on `&&`, `||`, `;`, `|`, `&` and newlines outside quotes,
 * keeping `(` and `)` as subshell markers. Quotes, backslashes, comments, redirections and here-document bodies are
 * read as a POSIX shell reads them; `~` and `$HOME` expand to `home`, and any other parameter marks its word dynamic.
 * Reading stops at `$(`, a backtick or a process substitution, and the result says so.
 */
export function splitShellLine(line: string, home: string): ShellLine {
  const items: ShellItem[] = [];
  const heredocs: Heredoc[] = [];
  let words: ShellWord[] = [];
  let draft: Draft | null = null;
  let target: Target | null = null;
  let substitution = false;
  let i = 0;

  const open = (): Draft => (draft ??= { text: "", dynamic: false, glob: false, quoted: false });

  const endWord = (): void => {
    const done = draft;
    draft = null;
    if (done === null) return;
    if (target === null) words.push({ text: done.text, dynamic: done.dynamic, glob: done.glob });
    else if (target.heredoc) heredocs.push({ delimiter: done.text, stripTabs: target.stripTabs });
    target = null;
  };

  const endCommand = (): void => {
    endWord();
    target = null;
    if (words.length > 0) items.push({ kind: "words", words });
    words = [];
  };

  const skipHeredocBodies = (from: number): number => {
    let at = from;
    for (const { delimiter, stripTabs } of heredocs) {
      while (at < line.length) {
        const newline = line.indexOf("\n", at);
        const end = newline === -1 ? line.length : newline;
        const text = line.slice(at, end);
        at = end + 1;
        if ((stripTabs ? text.replace(/^\t+/, "") : text) === delimiter) break;
      }
    }
    heredocs.length = 0;
    return Math.min(at, line.length);
  };

  const dollar = (at: number, inDoubleQuotes: boolean): number => {
    const next = line[at + 1] ?? "";
    const word = open();
    if (next === "(") {
      substitution = true;
      return line.length;
    }
    if (next === "{") {
      const close = line.indexOf("}", at + 2);
      const end = close === -1 ? line.length : close;
      if (line.slice(at + 2, end) === "HOME") word.text += home;
      else {
        word.text += line.slice(at, end + 1);
        word.dynamic = true;
      }
      return end + 1;
    }
    if (NAME_START.test(next)) {
      let end = at + 1;
      while (end < line.length && NAME_PART.test(line[end] ?? "")) end++;
      const name = line.slice(at + 1, end);
      if (name === "HOME") word.text += home;
      else {
        word.text += `$${name}`;
        word.dynamic = true;
      }
      return end;
    }
    if (SPECIAL_PARAMETER.test(next)) {
      word.text += `$${next}`;
      word.dynamic = true;
      return at + 2;
    }
    if (next === "'" && !inDoubleQuotes) {
      const close = line.indexOf("'", at + 2);
      const end = close === -1 ? line.length : close;
      word.text += line.slice(at + 2, end);
      word.dynamic = true;
      word.quoted = true;
      return end + 1;
    }
    if (next === '"' && !inDoubleQuotes) return at + 1;
    word.text += "$";
    return at + 1;
  };

  const doubleQuoted = (from: number): number => {
    const word = open();
    word.quoted = true;
    let at = from;
    while (at < line.length && !substitution) {
      const c = line[at] ?? "";
      if (c === '"') return at + 1;
      if (c === "\\") {
        const next = line[at + 1] ?? "";
        if (next !== "\n") word.text += DOUBLE_QUOTE_ESCAPES.has(next) ? next : `\\${next}`;
        at += 2;
      } else if (c === "$") {
        at = dollar(at, true);
      } else if (c === "`") {
        substitution = true;
      } else {
        word.text += c;
        at++;
      }
    }
    return at;
  };

  const duplicate = (from: number): number => {
    let at = from;
    while (/^[0-9-]$/.test(line[at] ?? "")) at++;
    if (at === from) target = { heredoc: false };
    return at;
  };

  const redirect = (at: number): number => {
    const fd = draft;
    if (fd !== null && !fd.quoted && /^\d+$/.test(fd.text)) draft = null;
    else endWord();
    const [c, next, after] = [line[at], line[at + 1], line[at + 2]];
    if (next === "(" && c !== "&") {
      substitution = true;
      return line.length;
    }
    if ((c === ">" || c === "<") && next === "&") return duplicate(at + 2);
    if (c === "<" && next === "<" && after !== "<") {
      const stripTabs = after === "-";
      target = { heredoc: true, stripTabs };
      return at + (stripTabs ? 3 : 2);
    }
    target = { heredoc: false };
    if (c === "&") return at + (after === ">" ? 3 : 2);
    if (c === "<" && next === "<") return at + 3;
    if (next === ">" || next === "|" || (c === "<" && next === ">")) return at + 2;
    return at + 1;
  };

  while (i < line.length && !substitution) {
    const c = line[i] ?? "";
    const next = line[i + 1] ?? "";
    if (c === "\\") {
      if (next !== "\n") {
        const word = open();
        word.text += next;
        word.quoted = true;
      }
      i += 2;
    } else if (c === "'") {
      const close = line.indexOf("'", i + 1);
      const end = close === -1 ? line.length : close;
      const word = open();
      word.text += line.slice(i + 1, end);
      word.quoted = true;
      i = end + 1;
    } else if (c === '"') {
      i = doubleQuoted(i + 1);
    } else if (c === "$") {
      i = dollar(i, false);
    } else if (c === "`") {
      substitution = true;
    } else if (BLANK.has(c)) {
      endWord();
      i++;
    } else if (c === "\n") {
      endCommand();
      i = skipHeredocBodies(i + 1);
    } else if (c === "#" && draft === null) {
      const newline = line.indexOf("\n", i);
      i = newline === -1 ? line.length : newline;
    } else if (c === ";" || c === "|" || (c === "&" && next !== ">")) {
      endCommand();
      i += next === c || (c === "|" && next === "&") ? 2 : 1;
    } else if (c === "(" || c === ")") {
      endCommand();
      items.push({ kind: c === "(" ? "open" : "close" });
      i++;
    } else if (c === "<" || c === ">" || c === "&") {
      i = redirect(i);
    } else {
      const fresh = draft === null;
      const word = open();
      if (c === "~" && fresh && WORD_END.has(next === "/" ? "" : next)) word.text += home;
      else {
        if (c === "~" && fresh) word.dynamic = true;
        if (GLOB.has(c)) word.glob = true;
        word.text += c;
      }
      i++;
    }
  }
  if (!substitution) endCommand();
  return { items, substitution };
}
