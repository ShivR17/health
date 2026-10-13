// Service worker. Two jobs: make the app installable, and make it open
// instantly and work with no signal.
//
// The page shell is served from cache first, so opening is instant even on a
// bad connection, and a new version replaces it in the background. Supabase
// and Gemini calls are never cached: stale health data would be worse than no
// data, and a cached write would be a lie.

const VERSION = "v6";
const SHELL = `shell-${VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache live data or the extraction call.
  if (url.hostname.endsWith("supabase.co") ||
      url.hostname.endsWith("googleapis.com")) return;

  // Navigations: cached shell first for an instant open, refreshed behind it.
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match("./index.html").then((hit) => {
        const live = fetch(req)
          .then((res) => {
            caches.open(SHELL).then((c) => c.put("./index.html", res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || live;
      }),
    );
    return;
  }

  // Everything else: cache first, fall back to the network, store what works.
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit)
    ),
  );
});
