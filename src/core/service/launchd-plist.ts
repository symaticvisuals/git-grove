import { SERVICE_NAMES } from "./service-names.js";
import type { ServiceProgram } from "./service-program.types.js";

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function string(text: string): string {
  return `<string>${text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char)}</string>`;
}

function environment(program: ServiceProgram): string[] {
  const vars: [string, string][] = [["PATH", program.path]];
  if (program.groveHome !== null) vars.push(["GIT_GROVE_HOME", program.groveHome]);
  return vars.flatMap(([key, value]) => [`    <key>${key}</key>`, `    ${string(value)}`]);
}

/**
 * The launchd agent that runs `<node> <bin> serve` at login: started at load, started again after a non-zero exit
 * (KeepAlive SuccessfulExit false), given 90 s to stop, with stdout and stderr appended to the log file.
 */
export function launchdPlist(program: ServiceProgram): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  ${string(SERVICE_NAMES.label)}`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...[program.node, program.bin, "serve"].map((arg) => `    ${string(arg)}`),
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...environment(program),
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ExitTimeOut</key>",
    "  <integer>90</integer>",
    "  <key>StandardOutPath</key>",
    `  ${string(program.logFile)}`,
    "  <key>StandardErrorPath</key>",
    `  ${string(program.logFile)}`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}
