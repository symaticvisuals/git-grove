import type { ServiceKind } from "./service-manager.js";

/**
 * The Node and the git grove bin an installed login service runs, the `GIT_GROVE_HOME` it sets (null: none) and the
 * `CLAUDE_CONFIG_DIR` it sets (left out: none).
 */
export type InstalledProgram = { node: string; bin: string; groveHome: string | null; claudeConfigDir?: string };

type Read = { args: string[]; groveHome: string | null; claudeConfigDir: string | null };

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const QUOTED = /"((?:[^"\\]|\\.)*)"/g;

function xmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

function unquoted(word: string): string {
  return word.replace(/\\(.)/g, "$1").replaceAll("%%", "%");
}

function fromPlist(text: string): Read | null {
  const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1];
  if (array === undefined) return null;
  const args = [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => xmlText(match[1] ?? ""));
  const env = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text)?.[1] ?? "";
  const home = /<key>GIT_GROVE_HOME<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(env)?.[1];
  const claude = /<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(env)?.[1];
  return { args, groveHome: home === undefined ? null : xmlText(home), claudeConfigDir: claude === undefined ? null : xmlText(claude) };
}

function fromUnit(text: string): Read | null {
  const lines = text.split("\n");
  const exec = lines.find((line) => line.startsWith("ExecStart="));
  if (exec === undefined) return null;
  const args = [...exec.slice("ExecStart=".length).matchAll(QUOTED)].map((match) => unquoted(match[1] ?? "").replaceAll("$$", "$"));
  const assignments = lines.filter((line) => line.startsWith("Environment=")).flatMap((line) => [...line.matchAll(QUOTED)].map((match) => unquoted(match[1] ?? "")));
  const home = assignments.find((assignment) => assignment.startsWith("GIT_GROVE_HOME="));
  const claude = assignments.find((assignment) => assignment.startsWith("CLAUDE_CONFIG_DIR="));
  return { args, groveHome: home === undefined ? null : home.slice("GIT_GROVE_HOME=".length), claudeConfigDir: claude === undefined ? null : claude.slice("CLAUDE_CONFIG_DIR=".length) };
}

/**
 * Reads which Node and bin a launchd agent (`launchdPlist`) or systemd unit (`systemdUnit`) grove wrote runs, and the
 * `GIT_GROVE_HOME` and `CLAUDE_CONFIG_DIR` it sets, undoing its escaping. Null for a file that does not hold both.
 */
export function installedProgram(kind: ServiceKind, text: string): InstalledProgram | null {
  const read = kind === "launchd" ? fromPlist(text) : fromUnit(text);
  const [node, bin] = read?.args ?? [];
  if (read === null || node === undefined || bin === undefined || node === "" || bin === "") return null;
  return { node, bin, groveHome: read.groveHome, ...(read.claudeConfigDir === null ? {} : { claudeConfigDir: read.claudeConfigDir }) };
}
