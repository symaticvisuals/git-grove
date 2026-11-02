import { InvalidInputError } from "../actions/invalid-input.error.js";
import type { ServiceProgram } from "./service-program.types.js";

function checked(text: string): string {
  if (/[\n\r\0]/.test(text)) throw new InvalidInputError(`a path for the login service holds a line break: ${JSON.stringify(text)}`);
  return text.replaceAll("%", "%%");
}

function quoted(text: string): string {
  return `"${checked(text).replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/**
 * The systemd user unit that runs `<node> <bin> serve` at login: restarted 5 s after a non-zero exit with no start
 * limit, given 90 s to stop, with stdout and stderr appended to the log file. Throws InvalidInputError for a path
 * holding a line break, which a unit file cannot carry.
 */
export function systemdUnit(program: ServiceProgram): string {
  const exec = [program.node, program.bin].map((arg) => quoted(arg).replaceAll("$", "$$$$"));
  const env = [
    `PATH=${program.path}`,
    ...(program.groveHome === null ? [] : [`GIT_GROVE_HOME=${program.groveHome}`]),
    ...(program.claudeConfigDir === undefined ? [] : [`CLAUDE_CONFIG_DIR=${program.claudeConfigDir}`]),
  ];
  const log = checked(program.logFile);
  return [
    "[Unit]",
    "Description=git grove dashboard server",
    "StartLimitIntervalSec=0",
    "",
    "[Service]",
    `ExecStart=${exec.join(" ")} serve`,
    ...env.map((assignment) => `Environment=${quoted(assignment)}`),
    "Restart=on-failure",
    "RestartSec=5",
    "TimeoutStopSec=90",
    `StandardOutput=append:${log}`,
    `StandardError=append:${log}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
