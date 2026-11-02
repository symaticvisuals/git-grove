/**
 * git grove's service worker: keeps this version's shell (page, script, styles, fonts, icons, manifest) cached, never
 * touches `/api/*` or `/events`, loads `/` from the network first and every other file from the cache first.
 */
import { swRoute } from "./sw-route.js";

declare const self: ServiceWorkerGlobalScope;
declare const __GROVE_VERSION__: string;

const VERSION = __GROVE_VERSION__;
const CACHE = `grove-${VERSION}`;
const SHELL = [
  "/",
  `/app.js?v=${VERSION}`,
  `/styles.css?v=${VERSION}`,
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/fonts/atkinson-hyperlegible-next.woff2",
  "/fonts/martian-mono.woff2",
];

async function page(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) await (await caches.open(CACHE)).put("/", response.clone());
    return response;
  } catch {
    return (await (await caches.open(CACHE)).match("/")) ?? Response.error();
  }
}

async function shell(request: Request): Promise<Response> {
  return (await (await caches.open(CACHE)).match(request)) ?? fetch(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("grove-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const route = swRoute(event.request, self.location.origin);
  if (route === "page") event.respondWith(page(event.request));
  if (route === "shell") event.respondWith(shell(event.request));
});
