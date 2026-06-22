(function () {
  "use strict";

  const footer = document.querySelector("footer.parcel-ft");
  if (!footer) return;

  const pageKey = (() => {
    const p = String(location.pathname || "").split("?")[0].split("#")[0];
    const file = p.split("/").filter(Boolean).pop() || "";
    return file || "";
  })();

  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig || typeof firebase === "undefined") return;

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}

  const auth = firebase.auth();
  const db = firebase.firestore();
  try {
    db.settings({
      experimentalAutoDetectLongPolling: true,
      experimentalForceLongPolling: true,
      useFetchStreams: false,
      ignoreUndefinedProperties: true,
    });
  } catch {}

  function normalizeText(v) {
    return String(v || "").trim();
  }

  async function resolveCommunityId() {
    const keyFromUrl = (() => {
      try {
        const urlParams = new URLSearchParams(location.search);
        return normalizeText(urlParams.get("c"));
      } catch {
        return "";
      }
    })();
    const saved = (() => {
      try {
        return normalizeText(localStorage.getItem("csp_active_community_v1"));
      } catch {
        return "";
      }
    })();
    const key = keyFromUrl || saved;
    if (key) {
      try {
        const byIdSnap = await db.collection("communities").where("id", "==", key).limit(1).get();
        const byId = byIdSnap && byIdSnap.docs && byIdSnap.docs[0] ? byIdSnap.docs[0] : null;
        if (byId && byId.exists) {
          const v = byId.data() || {};
          const cid = normalizeText(v.id || byId.id);
          if (cid) {
            try { localStorage.setItem("csp_active_community_v1", cid); } catch {}
            return cid;
          }
        }
      } catch {}
      try {
        const byUserSnap = await db.collection("communities").where("username", "==", key).limit(1).get();
        const byUser = byUserSnap && byUserSnap.docs && byUserSnap.docs[0] ? byUserSnap.docs[0] : null;
        if (byUser && byUser.exists) {
          const v = byUser.data() || {};
          const cid = normalizeText(v.id || byUser.id);
          if (cid) {
            try { localStorage.setItem("csp_active_community_v1", cid); } catch {}
            return cid;
          }
        }
      } catch {}
      return key;
    }

    const user = auth.currentUser;
    if (user && user.uid) {
      try {
        const udoc = await db.collection("users").doc(String(user.uid)).get();
        const udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
        const cid = normalizeText(udata.community);
        if (cid) return cid;
      } catch {}
    }
    return "default";
  }

  function normalizeItems(images) {
    const out = [];
    (Array.isArray(images) ? images : []).forEach((it) => {
      const o = it && typeof it === "object" ? it : {};
      const src = normalizeText(o.data) || normalizeText(o.url);
      if (!src) return;
      const link = normalizeText(o.link);
      out.push({ src, link });
    });
    return out;
  }

  function renderCarousel(items, intervalSec) {
    const wrap = document.createElement("div");
    wrap.className = "ads-footer";
    wrap.setAttribute("role", "button");
    wrap.setAttribute("tabindex", "0");
    wrap.innerHTML = `
      <div class="ads-footer-track">
        <img alt="" />
      </div>
    `.trim();
    footer.innerHTML = "";
    footer.classList.add("has-ads");
    footer.appendChild(wrap);

    const img = wrap.querySelector("img");
    if (!img) return;

    let idx = 0;
    let currentLink = "";
    const apply = () => {
      const item = items[idx] || null;
      img.src = item ? item.src : "";
      currentLink = item ? String(item.link || "") : "";
      const clickable = Boolean(currentLink);
      wrap.classList.toggle("is-clickable", clickable);
      wrap.setAttribute("aria-label", clickable ? "廣告（點擊另開新視窗）" : "廣告");
    };
    apply();

    if (!wrap._boundAdsClick) {
      wrap._boundAdsClick = true;
      const openLink = () => {
        if (!currentLink) return;
        const w = window.open(currentLink, "_blank", "noopener,noreferrer");
        try { if (w) w.opener = null; } catch {}
      };
      wrap.addEventListener("click", (e) => {
        e.preventDefault();
        openLink();
      });
      wrap.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openLink();
        }
      });
    }

    const sec = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 3;
    const ms = Math.max(800, Math.min(60000, Math.round(sec * 1000)));

    let timer = window.setInterval(() => {
      if (!items.length) return;
      const next = (idx + 1) % items.length;
      img.classList.add("is-fading");
      window.setTimeout(() => {
        idx = next;
        apply();
        img.classList.remove("is-fading");
      }, 220);
    }, ms);

    window.addEventListener("beforeunload", () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
    });
  }

  async function boot() {
    if (!pageKey) return;
    const cid = await resolveCommunityId();
    const cfgDoc = await db.collection("communities").doc(String(cid)).collection("settings").doc("app_config").get();
    const cfg = cfgDoc && cfgDoc.exists ? (cfgDoc.data() || {}) : {};
    const adsFooter = cfg && cfg.adsFooter && typeof cfg.adsFooter === "object" ? cfg.adsFooter : {};
    const pages = adsFooter && typeof adsFooter.pages === "object" && adsFooter.pages ? adsFooter.pages : {};
    const pickFallbackCfg = () => {
      if (!pages || typeof pages !== "object") return null;
      const direct = pageKey && pages[pageKey] ? pages[pageKey] : null;
      if (direct) return direct;
      const allKey = pages["*"] || pages["all"] || null;
      if (allKey) return allKey;
      const preferredOrder = ["facility.html", "parcel.html", "bulletin-community.html", "bulletin-finance.html", "bulletin-meeting.html", "bulletin-repair.html"];
      for (const k of preferredOrder) {
        if (pages[k]) return pages[k];
      }
      const keys = Object.keys(pages || {});
      for (const k of keys) {
        if (pages[k]) return pages[k];
      }
      return null;
    };
    const pageCfg = pickFallbackCfg();
    if (!pageCfg) return;
    const items = normalizeItems(pageCfg.images);
    if (!items.length) return;
    const intervalSec = parseInt(pageCfg.intervalSec, 10);
    renderCarousel(items, intervalSec);
  }

  auth.onAuthStateChanged(() => {
    boot().catch(() => {});
  });
})();
