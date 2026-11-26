const CACHE_VERSION = "nwapp-v882";
const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(String(self.location && self.location.hostname || "").trim().toLowerCase());
const PRECACHE = Array.from(new Set([
  "./",
  "./index.html",
  "./system.html",
  "./admin.html",
  "./member.html?v=18",
  "./special-member.html?v=78",
  "./css/special-member.css?v=59",
  "./photo/logo.png",
  "./parking.html?v=8",
  "./parking-view.html?v=11",
  "./facility.html?v=8",
  "./parcel.html?v=8",
  "./vote-member.html?v=2",
  "./callrecord.html",
  "./pdf-viewer.html?v=1",
  "./bulletin-community.html?v=9",
  "./bulletin-finance.html?v=9",
  "./bulletin-meeting.html?v=9",
  "./bulletin-repair.html?v=9",
  "./bulletin-clean.html?v=9",
  "./bulletin-activity.html?v=9",
  "./clean-report.html?v=4",
  "./worker-clean.html?v=34",
  "./worker-manager.html?v=26",
  "./worker-secretary.html?v=26",
  "./worker-electrical.html?v=26",
  "./worker-preservation.html?v=26",
  "./visitor.html",
  "./visitor-history.html?v=5",
  "./visitor-frequent.html?v=3",
  "./fee-notice.html?v=1",
  "./visitor-resident.html?v=8",
  "./live-meeting.html?v=31",
  "./chatphone.html",
  "./qai.html?v=15",
  "./qrcode-scan.html?v=14",
  "./election-count.html?v=17",
  "./checkin-vote-share.html?v=40",
  "./css/parcel.css?v=5",
  "./css/ads-footer.css?v=16",
  "./css/system.css?v=9",
  "./css/admin.css?v=87",
  "./css/member.css?v=10",
  "./css/worker-clean.css?v=65",
  "./js/index.js?v=11",
  "./js/qrcode-generator.js?v=1",
  "./js/special-member.js?v=55",
  "./js/system.js?v=52",
  "./js/admin.js?v=459",
  "./js/admin-clean.js?v=9",
  "./js/admin-duty.js?v=24",
  "./js/finance.js?v=35",
  "./js/fee-notice.js?v=3",
  "./js/member.js?v=82",
  "./js/notify.js?v=1",
  "./js/parking.js?v=32",
  "./js/parking-view.js?v=11",
  "./js/facility.js?v=9",
  "./js/parcel.js?v=20",
  "./js/vote-member.js?v=2",
  "./js/visitor.js?v=17",
  "./js/visitor-history.js?v=6",
  "./js/visitor-frequent.js?v=2",
  "./js/visitor-resident.js?v=10",
  "./js/ads-footer.js?v=16",
  "./js/bulletin-clean.js?v=3",
  "./js/bulletin-activity.js?v=3",
  "./js/bulletin-repair.js?v=6",
  "./js/clean-report.js?v=5",
  "./js/worker-clean.js?v=48",
  "./js/worker-duty.js?v=45",
  "./js/punch-flow.js?v=4",
  "./js/live-shared.js?v=2",
  "./js/activity-shared.js?v=2",
  "./js/live-meeting.js?v=27",
  "./js/pwa.js?v=16",
  "./css/pwa.css?v=5",
  "./css/pwa.css",
  "./js/firebase-config.js",
  "./js/pdf-viewer-launcher.js?v=3",
  "./js/pdf-viewer.js?v=5",
  "./js/bulletin-community.js?v=6",
  "./js/bulletin-finance.js?v=6",
  "./js/bulletin-meeting.js?v=6",
  "./js/bulletin-repair.js?v=6",
  "./logo.svg?v=5",
  "./icon-192.png?v=2",
  "./icon-512.png?v=2",
  "./manifest.webmanifest",
]));

let __nwMessaging = null;
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");
  importScripts("./js/firebase-config.js");
  try { firebase.initializeApp(self.FIREBASE_CONFIG || {}); } catch {}
  try { __nwMessaging = firebase.messaging(); } catch {}
} catch {}

function offlineResponse(status = 504, statusText = "Gateway Timeout") {
  return new Response("", { status, statusText });
}

function resolveAppUrl(raw) {
  const v = String(raw || "").trim() || "./";
  const cleaned = v.startsWith("/") ? v.replace(/^\/+/, "") : v;
  try { return new URL(cleaned, self.registration.scope).toString(); } catch {}
  try { return new URL(cleaned, self.location.href).toString(); } catch {}
  return v;
}

// 對講來電響鈴：App 未開啟時，以重複顯示通知的方式模擬持續響鈴
const NW_RING_TAG_PREFIX = "intercom_call_";
const NW_MISSED_TAG_PREFIX = "intercom_missed_";
const nwRingLoops = new Map();

function stopNwRing(callId) {
  const cid = String(callId || "").trim();
  if (cid) {
    const t = nwRingLoops.get(cid);
    if (t) { try { clearInterval(t); } catch {} }
    nwRingLoops.delete(cid);
    return;
  }
  nwRingLoops.forEach((t) => { try { clearInterval(t); } catch {} });
  nwRingLoops.clear();
}

function closeNwRingNotifications(callId) {
  const cid = String(callId || "").trim();
  try {
    return self.registration.getNotifications().then((list) => {
      (list || []).forEach((n) => {
        const tag = String((n && n.tag) || "");
        if (!tag.startsWith(NW_RING_TAG_PREFIX)) return;
        if (cid && tag !== `${NW_RING_TAG_PREFIX}${cid}`) return;
        try { n.close(); } catch {}
      });
    }).catch(() => {});
  } catch {}
  return Promise.resolve();
}

function startNwRing(callId, title, options) {
  const cid = String(callId || "").trim();
  if (!cid) return;
  stopNwRing(cid);
  let count = 0;
  const timer = setInterval(() => {
    count += 1;
    if (count > 9) { stopNwRing(cid); return; }
    try { self.registration.showNotification(title, options); } catch {}
  }, 6000);
  nwRingLoops.set(cid, timer);
}

try {
  if (__nwMessaging && typeof __nwMessaging.onBackgroundMessage === "function") {
    __nwMessaging.onBackgroundMessage(async (payload) => {
      const data = (payload && payload.data) ? payload.data : {};
      const callId = String(data.callId || "").trim();

      // 對講機來電 / 未接來電
      if (callId) {
        const community = String(data.community || "").trim();
        const toRole = String(data.toRole || "").trim();
        const url = resolveAppUrl(String(data.url || "").trim() || "./");
        const title = String(data.title || "QAi生活網｜來電").trim() || "QAi生活網｜來電";
        const body = String(data.body || "點此開啟QAi生活網接聽/拒接").trim();
        const missed = String(data.missed || "").trim() === "1";

        // 未接來電通知：停止響鈴、關閉響鈴通知，改顯示未接通知（點擊前往通話紀錄）
        if (missed) {
          stopNwRing(callId);
          await closeNwRingNotifications(callId);
          try {
            await self.registration.showNotification(title, {
              body,
              icon: "./logo.svg?v=5",
              badge: "./icon-192.png?v=2",
              tag: `${NW_MISSED_TAG_PREFIX}${callId}`,
              renotify: true,
              requireInteraction: false,
              vibrate: [90, 70, 90],
              data: { type: "intercom-missed", callId, community, toRole, url, missed: true },
            });
          } catch {}
          return;
        }

        const autoOpen = String(data.autoOpen || "").trim() === "1";

        const tag = `${NW_RING_TAG_PREFIX}${callId}`;
        const options = {
          body,
          icon: "./logo.svg?v=5",
          badge: "./icon-192.png?v=2",
          tag,
          renotify: true,
          requireInteraction: true,
          silent: false,
          actions: [
            { action: "answer", title: "接通" },
            { action: "reject", title: "拒接" },
          ],
          vibrate: [400, 200, 400, 200, 400, 200, 400],
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
        startNwRing(callId, title, options);
        return;
      }

      // 住戶端模組推播（包裹郵件、訪客登記、社區園地、公設預約、會議紀錄等）
      const moduleType = String(data.type || "").trim();
      const title = String(data.title || "").trim();
      if (!title) return;
      const body = String(data.body || "").trim();
      const url = resolveAppUrl(String(data.url || "").trim() || "./");
      const refId = String(data.refId || "").trim();
      const community = String(data.community || "").trim();

      const options = {
        body,
        icon: "./logo.svg?v=5",
        badge: "./icon-192.png?v=2",
        tag: `notify_${moduleType || "system"}_${refId || Date.now()}`,
        renotify: true,
        requireInteraction: false,
        vibrate: [100, 60, 100],
        data: { type: "notify", module: moduleType, refId, url, community },
      };

      try {
        const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        list.forEach((client) => {
          try {
            client.postMessage({ type: "NOTIFY_PUSH", module: moduleType, type: moduleType, title, body, url, refId, community });
          } catch {}
        });
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
    if (callId) stopNwRing(callId);
    const action = String(event.action || "").trim();
    const isModuleNotify = String(d.type || "").trim() === "notify";
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
          try {
            if (isModuleNotify) {
              same.postMessage({ type: "NOTIFY_OPEN", url, module: String(d.module || "").trim() });
            } else {
              same.postMessage({ type: "INTERCOM_OPEN", url, callId });
            }
          } catch {}
          return same.focus();
        }
        return self.clients.openWindow(url);
      })
    );
  } catch {}
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    (IS_LOCALHOST
      ? Promise.resolve()
      : caches.open(CACHE_VERSION).then(async (cache) => {
          for (const url of PRECACHE) {
            try {
              await cache.add(url);
            } catch {}
          }
        }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => {
        if (IS_LOCALHOST) return caches.delete(k);
        return k === CACHE_VERSION ? null : caches.delete(k);
      })))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const data = event && event.data ? event.data : null;
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  // App 已接手響鈴（開啟來電畫面/接聽/拒接/結束）→ 停止背景響鈴並關閉響鈴通知
  if (data && data.type === "INTERCOM_RING_STOP") {
    stopNwRing("");
    closeNwRingNotifications("");
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
  if (IS_LOCALHOST) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((cached) => {
        if (cached) return cached;
        if (isHtml) return caches.match("./index.html").then((html) => html || offlineResponse());
        return offlineResponse();
      }))
    );
    return;
  }
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
          .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html").then((html) => html || offlineResponse())))
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
            return update.then((res) => res || offlineResponse());
          })
        : caches.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req)
              .then((res) => {
                const copy = res.clone();
                caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => {});
                return res;
              })
              .catch(() => null)
              .then((res) => res || offlineResponse());
          }))
  );
});
