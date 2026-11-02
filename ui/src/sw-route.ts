/** How the service worker answers a request: `page` is network first with the cached page behind it, `shell` is cache first. */
export type SwRoute = "page" | "shell" | null;

/**
 * Picks how the service worker answers a request to `origin`: null (the network, untouched) for anything but a GET
 * of this origin, for `/api`, `/api/*` and `/events` whatever the mode, and for a navigation to any path but `/`;
 * `page` for a navigation to `/`; `shell` for every other GET.
 */
export function swRoute(request: { method: string; url: string; mode: string }, origin: string): SwRoute {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== "GET" || url.origin !== origin) return null;
  if (path === "/events" || path === "/api" || path.startsWith("/api/")) return null;
  if (request.mode === "navigate") return path === "/" ? "page" : null;
  return "shell";
}
