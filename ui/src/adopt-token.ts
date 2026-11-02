export type TokenDeps = {
  hash: string;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** Whether git grove answers one guarded request made with `token`. */
  verify(token: string): Promise<boolean>;
  replaceHash(hash: string): void;
};

const TOKEN_KEY = "grove.token";
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/**
 * The token the page should use. A fragment `#token=<64 hex>[&route=<path>]` (as `git grove ui` opens it) is always
 * replaced by `#<route>`, or `#/`; its token is stored only when it has that exact shape and git grove accepts it,
 * so a link that plants a bad token cannot sign the page out. Otherwise the stored token stands, or null.
 */
export async function adoptToken(deps: TokenDeps): Promise<string | null> {
  const stored = deps.storage.getItem(TOKEN_KEY);
  if (deps.hash === "" || deps.hash === "#" || deps.hash.startsWith("#/")) return stored;
  const params = new URLSearchParams(deps.hash.slice(1));
  const given = params.get("token");
  if (given === null) return stored;
  const route = params.get("route");
  deps.replaceHash(route !== null && route.startsWith("/") ? `#${route}` : "#/");
  if (!TOKEN_SHAPE.test(given) || given === stored) return stored;
  if (!(await deps.verify(given))) return stored;
  deps.storage.setItem(TOKEN_KEY, given);
  return given;
}
