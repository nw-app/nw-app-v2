const CACHE_VERSION = "nwapp-v289";
const PRECACHE = [
  "./",
  "./index.html",
  "./system.html",
  "./admin.html?v=8",
  "./member.html?v=11",
  "./parking.html?v=8",
  "./facility.html?v=8",
  "./parcel.html?v=8",
  "./callrecord.html",
  "./pdf-viewer.html?v=1",
  "./bulletin-community.html?v=8",
  "./bulletin-finance.html?v=8",
  "./bulletin-meeting.html?v=8",
  "./bulletin-repair.html?v=8",
  "./bulletin-clean.html?v=8",
  "./bulletin-activity.html?v=8",
  "./visitor.html?v=1",
  "./visitor-resident.html?v=8",
  "./live-meeting.html?v=30",
  "./qai.html?v=15",
  "./css/parcel.css?v=3",
  "./css/ads-footer.css?v=13",
  "./css/system.css?v=5",
  "./css/admin.css",
  "./css/member.css",
  "./js/index.js?v=7",
  "./js/system.js?v=19",
  "./js/admin.js?v=181",
  "./js/member.js?v=36",
  "./js/parking.js?v=30",
  "./js/facility.js?v=7",
  "./js/parcel.js?v=17",
  "./js/visitor.js?v=9",
  "./js/visitor-resident.js?v=5",
  "./js/ads-footer.js?v=14",
  "./js/bulletin-clean.js?v=1",
  "./js/bulletin-activity.js?v=2",
  "./js/bulletin-repair.js?v=4",
  "./js/live-meeting.js?v=24",
  "./js/pwa.js?v=6",
  "./css/pwa.css",
  "./js/firebase-config.js",
  "./js/pdf-viewer-launcher.js?v=3",
  "./js/pdf-viewer.js?v=3",
  "./js/bulletin-community.js?v=4",
  "./js/bulletin-finance.js?v=4",
  "./js/bulletin-meeting.js?v=4",
  "./js/bulletin-repair.js?v=4",
  "./logo.svg?v=5",
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

function resolveAppUrl(raw) {
  const v = String(raw || "").trim() || "./";
  const cleaned = v.startsWith("/") ? v.replace(/^\/+/, "") : v;
  try { return new URL(cleaned, self.registration.scope).toString(); } catch {}
  try { return new URL(cleaned, self.location.href).toString(); } catch {}
  return v;
}

try {
  if (__nwMessaging && typeof __nwMessaging.onBackgroundMessage === "function") {
    __nwMessaging.onBackgroundMessage(async (payload) => {
      const data = (payload && payload.data) ? payload.data : {};
      const callId = String(data.callId || "").trim();
      const community = String(data.community || "").trim();
      const toRole = String(data.toRole || "").trim();
      const url = resolveAppUrl(String(data.url || "").trim() || "./");
      const title = String(data.title || "生活網｜來電").trim() || "生活網｜來電";
      const body = String(data.body || "點此開啟生活網接聽/拒接").trim();
      const autoOpen = String(data.autoOpen || "").trim() === "1";

      const tag = callId ? `intercom_${callId}` : "intercom_call";
      const options = {
        body,
        icon: "./icon-192.png?v=2",
        badge: "./icon-192.png?v=2",
        tag,
        renotify: true,
        requireInteraction: true,
        actions: [
          { action: "answer", title: "接通" },
          { action: "reject", title: "拒接" },
        ],
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
    const baseUrl = resolveAppUrl(String(d.url || "./").trim() || "./");
    const callId = String(d.callId || "").trim();
    const action = String(event.action || "").trim();
    let url = baseUrl;
    try {
      const u = new URL(baseUrl, self.registration.scope);
      if (callId) u.searchParams.set("call", callId);
      if (action === "reject") u.searchParams.set("action", "reject");
      url = u.toString();
    } catch {}
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        const same = list.find((c) => c && typeof c.url === "string" && c.url.includes(self.location.origin));
        if (same) {
          try { same.postMessage({ type: "INTERCOM_OPEN", url, callId }); } catch {}
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
