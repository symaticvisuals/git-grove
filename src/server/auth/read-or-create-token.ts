import { randomBytes, randomUUID } from "node:crypto";
import { link, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TOKEN = /^[0-9a-f]{64}$/;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readToken(path: string): Promise<string | null> {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  });
  if (text === null) return null;
  if (!TOKEN.test(text.trim())) throw new Error(`${path} does not hold a grove token; delete it and start again`);
  return text.trim();
}

async function create(path: string, token: string): Promise<boolean> {
  const temp = `${path}.${process.pid}.${randomUUID()}`;
  await writeFile(temp, token, { flag: "wx", mode: 0o600 });
  try {
    await link(temp, path);
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false;
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

/**
 * Reads `<home>/token`, first creating it when missing as 32 random bytes in hex with mode 0600. The token is written
 * whole to a `wx` temp file and linked into place, so callers racing to create it all get the one that won.
 * Throws when the file holds anything but a token.
 */
export async function readOrCreateToken(home: string): Promise<string> {
  const path = join(home, "token");
  const existing = await readToken(path);
  if (existing !== null) return existing;
  const token = randomBytes(32).toString("hex");
  if (await create(path, token)) return token;
  const winner = await readToken(path);
  if (winner === null) throw new Error(`${path} vanished while it was being created`);
  return winner;
}
