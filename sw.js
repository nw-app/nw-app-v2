const CACHE_VERSION = "nwapp-v135";
const PRECACHE = [
  "./",
  "./index.html",
  "./system.html",
  "./admin.html",
  "./member.html",
  "./visitor.html",
  "./css/index.css",
  "./css/system.css",
  "./css/admin.css",
  "./css/member.css",
  "./js/index.js",
  "./js/system.js",
  "./js/admin.js",
  "./js/member.js",
  "./js/visitor.js",
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
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const accept = req.headers.get("accept") || "";
  const isHtml = req.mode === "navigate" || accept.includes("text/html");
  const path = url.pathname || "";
  const cleanPath = (path || "/").replace(/\/+$/, "") || "/";
  if (req.mode === "navigate") {
    if (cleanPath === "/admin" || cleanPath === "/community") {
      const to = new URL("./admin.html", url);
      to.hash = "#community/community-dashboard";
      event.respondWith(Response.redirect(to.toString(), 302));
      return;
    }
    if (cleanPath === "/system") {
      const to = new URL("./system.html", url);
      event.respondWith(Response.redirect(to.toString(), 302));
      return;
    }
    if (cleanPath === "/member" || cleanPath === "/resident") {
      const to = new URL("./member.html", url);
      event.respondWith(Response.redirect(to.toString(), 302));
      return;
    }
  }
  const isCss = path.endsWith(".css") || req.destination === "style";
  const isJs = path.endsWith(".js") || path.endsWith(".mjs") || req.destination === "script";

  event.respondWith(
    (isHtml
      ? fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
            return res;
          })
          .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
      : (isJs || isCss)
        ? caches.match(req).then((cached) => {
            const update = fetch(req)
              .then((res) => {
                const copy = res.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
                return res;
              })
              .catch(() => null);

            if (cached) {
              event.waitUntil(update);
              return cached;
            }
            return update.then((res) => res || new Response("", { status: 504 }));
          })
        : caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req)
              .then((res) => {
                const copy = res.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
                return res;
              })
              .catch(() => null);
          }))
  );
});
