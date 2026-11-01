import type { IncomingMessage } from "node:http";
import { HttpError } from "./http.error.js";

const LIMIT = 64 * 1024;

function tooLarge(): HttpError {
  return new HttpError(413, "the request body is over 64 KB");
}

/** Reads the request body as JSON: null when empty, 413 past 64 KB, 400 when it does not parse. */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > LIMIT) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk)) throw new HttpError(400, "the request body is not bytes");
    size += chunk.length;
    if (size > LIMIT) throw tooLarge();
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "the request body is not JSON");
  }
}
