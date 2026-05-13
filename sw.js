const CACHE_VERSION = "nwapp-v12";
const PRECACHE = [
  "./",
  "./index.html",
  "./system.html",
  "./admin.html",
  "./member.html",
  "./css/index.css",
  "./css/system.css",
  "./css/admin.css",
  "./css/member.css",
  "./js/index.js",
  "./js/system.js",
  "./js/admin.js",
  "./js/member.js",
  "./js/pwa.js",
  "./css/pwa.css",
  "./js/firebase-config.js",
  "./logo.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k === CACHE_VERSION ? null : caches.delete(k))))).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isHtml = req.mode === "navigate" || accept.includes("text/html");

  event.respondWith(
    (isHtml
      ? fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
      : caches.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
              return res;
            })
            .catch(() => caches.match("./index.html"));
        }))
  );
});
