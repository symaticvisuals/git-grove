import { InvalidInputError } from "../../core/actions/invalid-input.error.js";
import { HttpError } from "./http.error.js";

export type HandlerResult = { status: number; body: unknown };

/**
 * Runs a route and turns a thrown HttpError into its status, an InvalidInputError into 400, and anything else into
 * a 500 `{ error: "internal error" }`, logged to stderr with `label`.
 */
export async function runHandler(call: () => Promise<HandlerResult>, label: string): Promise<HandlerResult> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, body: { error: error.message } };
    if (error instanceof InvalidInputError) return { status: 400, body: { error: error.reason } };
    process.stderr.write(`git-grove: ${label}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return { status: 500, body: { error: "internal error" } };
  }
}
