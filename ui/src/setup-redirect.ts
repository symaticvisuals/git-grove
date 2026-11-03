/**
 * Where a first visit goes on from the Getting started page: the address it opened, or the dashboard when that was
 * none or the setup page itself. Null once the page has been seen, when nothing redirects.
 */
export function setupRedirect(seen: boolean, hash: string): string | null {
  if (seen) return null;
  return hash === "" || hash === "#/setup" ? "#/" : hash;
}
