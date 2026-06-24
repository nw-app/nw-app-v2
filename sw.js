const CACHE_VERSION = "nwapp-v145";
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
  "./logo.svg?v=4",
  "./icon-192.png?v=2",
  "./icon-512.png?v=2",
  "./manifest.webmanifest",
];

let __nwMessaging = null;
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");
  importScripts("./js/firebase-config.js");
  try { firebase.initializeApp(self.FIREBASE_CONFIG || {}); } catch {}
  try { __nwMessaging = firebase.messaging(); } catch {}
} catch {}

try {
  if (__nwMessaging && typeof __nwMessaging.onBackgroundMessage === "function") {
    __nwMessaging.onBackgroundMessage(async (payload) => {
      const data = (payload && payload.data) ? payload.data : {};
      const callId = String(data.callId || "").trim();
      const community = String(data.community || "").trim();
      const toRole = String(data.toRole || "").trim();
      const url = String(data.url || "").trim() || "./";
      const title = String(data.title || "來電").trim() || "來電";
      const body = String(data.body || "").trim();
      const autoOpen = String(data.autoOpen || "").trim() === "1";

      const tag = callId ? `intercom_${callId}` : "intercom_call";
      const options = {
        body,
        icon: "./icon-192.png?v=2",
        badge: "./icon-192.png?v=2",
        tag,
        renotify: true,
        requireInteraction: true,
        vibrate: [120, 80, 120, 80, 220],
        data: {
          type: "intercom",
          callId,
          community,
          toRole,
          url,
        },
      };

      try {
        const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        list.forEach((client) => {
          try { client.postMessage({ type: "INTERCOM_PUSH", callId, community, toRole, url }); } catch {}
        });
        const first = list && list[0] ? list[0] : null;
        if (first) {
          try { await first.focus(); } catch {}
        } else if (autoOpen && url) {
          try { await self.clients.openWindow(url); } catch {}
        }
      } catch {}

      try { await self.registration.showNotification(title, options); } catch {}
    });
  }
} catch {}

self.addEventListener("notificationclick", (event) => {
  try {
    const n = event.notification;
    const d = n && n.data ? n.data : {};
    const url = String(d.url || "./").trim() || "./";
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        const same = list.find((c) => c && typeof c.url === "string" && c.url.includes(self.location.origin));
        if (same) {
          try { same.postMessage({ type: "INTERCOM_OPEN", url, callId: String(d.callId || "") }); } catch {}
          return same.focus();
        }
        return self.clients.openWindow(url);
      })
    );
  } catch {}
});

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
