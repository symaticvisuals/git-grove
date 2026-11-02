import { describeError } from "../core/describe-error.js";
import { PortsInUseError } from "../server/http/ports-in-use.error.js";
import { ServerUnresponsiveError } from "../server/server-unresponsive.error.js";

/**
 * Turns an error a person can act on into one line for stderr, or returns null for anything else (a bug): the
 * server's PortsInUseError and ServerUnresponsiveError, then whatever `describeError` describes.
 */
export function describeCliError(error: unknown): string | null {
  if (error instanceof PortsInUseError || error instanceof ServerUnresponsiveError) return error.message.split("\n")[0] ?? "";
  return describeError(error);
}
