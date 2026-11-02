export type TokenDeps = {
  hash: string;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** Whether git grove answers one guarded request made with `token`. */
  verify(token: string): Promise<boolean>;
  replaceHash(hash: string): void;
};

const TOKEN_KEY = "grove.token";
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;
const TOKEN_ANYWHERE = /token=([^&?#/]*)/;

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function routeOnly(hash: string): string {
  const at = hash.search(/[?&]|token=/);
  const route = (at === -1 ? hash : hash.slice(0, at)).replace(/\/+$/, "");
  return route.startsWith("#/") && route.length > 2 ? route : "#/";
}

/**
 * The token the page should use. Any `token=` in the hash is removed, wherever it sits: `#token=<t>&route=<path>`
 * (as `git grove ui` opens it) becomes `#<path>` or `#/`, and a route with a token after it keeps only the route.
 * The token is stored only when it is exactly 64 lowercase hex and git grove accepts it, so a link that plants a bad
 * token cannot sign the page out. Otherwise the stored token stands, or null.
 */
export async function adoptToken(deps: TokenDeps): Promise<string | null> {
  const stored = deps.storage.getItem(TOKEN_KEY);
  const { hash } = deps;
  if (!hash.includes("token=")) return stored;
  let given: string | null;
  if (hash.startsWith("#/")) {
    const match = TOKEN_ANYWHERE.exec(hash);
    given = match === null ? null : decoded(match[1] ?? "");
    deps.replaceHash(routeOnly(hash));
  } else {
    const params = new URLSearchParams(hash.slice(1));
    given = params.get("token");
    const route = params.get("route");
    deps.replaceHash(route !== null && route.startsWith("/") ? routeOnly(`#${route}`) : "#/");
  }
  if (given === null || !TOKEN_SHAPE.test(given) || given === stored) return stored;
  if (!(await deps.verify(given))) return stored;
  deps.storage.setItem(TOKEN_KEY, given);
  return given;
}
