/* NookMaps service worker (PRD §22: web / PWA). Hand-written, no build step.
 *
 * - Precaches the app shell: "/", "/offline", the manifest, icons, and the
 *   styles and scripts those pages use. The shell is revalidated after
 *   successful navigations (throttled) so it tracks new deployments.
 * - Navigations: network-first; offline, the cached copy of that page if it is
 *   part of the shell, otherwise the /offline page.
 * - Static assets (/_next/static, icons): stale-while-revalidate.
 * - /api/* is never intercepted or cached: those responses are built from the
 *   user's precise location (PRD §21, §26 minimal retention). Cross-origin
 *   requests (map tiles, analytics, Google Maps) are left to the browser too.
 */
const VERSION = "v1";
const SHELL_CACHE = `nookmaps-shell-${VERSION}`;
const STATIC_CACHE = `nookmaps-static-${VERSION}`;
const OFFLINE_URL = "/offline";
const SHELL_PAGES = ["/", OFFLINE_URL];
const SHELL_FILES = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/apple-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];
const MAX_STATIC_ENTRIES = 200;
const SHELL_REFRESH_MS = 60 * 60_000;
let lastShellRefresh = 0;

const isApi = (path) => path === "/api" || path.startsWith("/api/");
const isStatic = (path) =>
  path.startsWith("/_next/static/") || path.startsWith("/icons/") || SHELL_FILES.includes(path);
const cacheable = (res) => res && res.ok && res.type === "basic";

self.addEventListener("install", (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, STATIC_CACHE];
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("nookmaps-") && !keep.includes(k)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url.pathname)) return; // never cache location-specific data

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, url));
  } else if (isStatic(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});

/** Styles and scripts a shell page references, so it renders offline. */
function assetPaths(html) {
  return Array.from(html.matchAll(/\/_next\/static\/[^"'\s)\\]+\.(?:css|js)/g), (m) => m[0]);
}

/**
 * (Re)fetches the shell pages, files and their assets into the shell cache and
 * drops assets the current shell no longer references. Keeps the old shell if
 * anything fails, so a flaky connection never leaves us without one.
 */
async function refreshShell() {
  lastShellRefresh = Date.now();
  const shell = await caches.open(SHELL_CACHE);
  const assets = new Set();
  let pagesOk = 0;
  await Promise.all(
    [...SHELL_PAGES, ...SHELL_FILES].map(async (path) => {
      try {
        const res = await fetch(path, { cache: "no-cache", credentials: "same-origin" });
        if (!cacheable(res)) return;
        if (SHELL_PAGES.includes(path)) {
          assetPaths(await res.clone().text()).forEach((a) => assets.add(a));
          pagesOk++;
        }
        await shell.put(path, res);
      } catch {
        /* keep the previous copy */
      }
    }),
  );
  if (pagesOk !== SHELL_PAGES.length) return;
  await Promise.all(
    [...assets].map(async (a) => {
      if (!(await shell.match(a))) await shell.add(a).catch(() => undefined);
    }),
  );
  for (const req of await shell.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/_next/static/") && !assets.has(path)) await shell.delete(req);
  }
}

async function networkFirst(event, url) {
  try {
    const res = await fetch(event.request);
    if (cacheable(res) && Date.now() - lastShellRefresh > SHELL_REFRESH_MS) {
      event.waitUntil(refreshShell().catch(() => undefined));
    }
    return res;
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    const cached = SHELL_PAGES.includes(url.pathname) ? await shell.match(url.pathname) : undefined;
    return (
      cached ||
      (await shell.match(OFFLINE_URL)) ||
      new Response("You're offline. Reconnect to see what's around you.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached =
    (await cache.match(request)) ||
    (await caches.match(request, { cacheName: SHELL_CACHE, ignoreSearch: true }));
  const network = fetch(request).then((res) => {
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(
        cache
          .put(request, copy)
          .then(() => trim(cache))
          .catch(() => undefined),
      );
    }
    return res;
  });
  if (cached) {
    event.waitUntil(network.catch(() => undefined));
    return cached;
  }
  return network;
}

/** Old hashed bundles pile up across deployments; drop the oldest. */
async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_STATIC_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}
