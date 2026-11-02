import type { ServiceKind } from "./service-manager.js";

/** The Node and the git grove bin an installed login service runs. */
export type InstalledProgram = { node: string; bin: string };

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };

function fromPlist(text: string): string[] | null {
  const array = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1];
  if (array === undefined) return null;
  return [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => (match[1] ?? "").replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity));
}

function fromUnit(text: string): string[] | null {
  const line = text.split("\n").find((candidate) => candidate.startsWith("ExecStart="));
  if (line === undefined) return null;
  const words = [...line.slice("ExecStart=".length).matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  return words.map((match) => (match[1] ?? "").replace(/\\(.)/g, "$1").replaceAll("$$", "$").replaceAll("%%", "%"));
}

/**
 * Reads which Node and bin a launchd agent (`launchdPlist`) or systemd unit (`systemdUnit`) grove wrote runs, undoing
 * its escaping. Null for a file that does not hold both.
 */
export function installedProgram(kind: ServiceKind, text: string): InstalledProgram | null {
  const args = kind === "launchd" ? fromPlist(text) : fromUnit(text);
  const [node, bin] = args ?? [];
  return node === undefined || bin === undefined || node === "" || bin === "" ? null : { node, bin };
}
