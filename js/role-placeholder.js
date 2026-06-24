(() => {
  const PAGE_META = {
    "ead.html": {
      role: "board",
      label: "看板",
      title: "看板系統",
      desc: "社區看板頁面功能開發中，後續將提供社區公告、輪播與資訊展示。",
    },
    "tad.html": {
      role: "table",
      label: "桌板",
      title: "桌板系統",
      desc: "社區桌板頁面功能開發中，後續將提供桌面資訊、快捷操作與互動內容。",
    },
    "shop.html": {
      role: "shop",
      label: "商店",
      title: "商店系統",
      desc: "社區商店頁面功能開發中，後續將提供商品、優惠與訂購服務。",
    },
  };

  const pageName = String(location.pathname || "").split("/").pop().toLowerCase();
  const meta = PAGE_META[pageName] || PAGE_META["ead.html"];
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig || typeof firebase === "undefined") return;

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}

  const auth = firebase.auth();
  const db = typeof firebase.firestore === "function" ? firebase.firestore() : null;
  if (db) {
    try {
      db.settings({
        experimentalAutoDetectLongPolling: true,
        experimentalForceLongPolling: true,
        useFetchStreams: false,
        ignoreUndefinedProperties: true,
      });
    } catch {}
  }

  const titleEl = document.getElementById("rolePageTitle");
  const descEl = document.getElementById("rolePageDesc");
  const badgeEl = document.getElementById("rolePageBadge");
  const pageTitleEl = document.getElementById("rolePageDocTitle");
  const communitySubEl = document.getElementById("communityNameSub");

  if (titleEl) titleEl.textContent = meta.title;
  if (descEl) descEl.textContent = meta.desc;
  if (badgeEl) badgeEl.textContent = meta.label;
  if (pageTitleEl) pageTitleEl.textContent = meta.title;
  try {
    document.title = `${meta.label}｜社區系統`;
  } catch {}

  async function resolveCommunityName(user) {
    const params = new URLSearchParams(location.search);
    const rawKey = String(
      params.get("c") ||
      sessionStorage.getItem("csp_last_cid") ||
      localStorage.getItem("csp_active_community_v1") ||
      ""
    ).trim();
    if (!db || !rawKey || rawKey === "default") return meta.label;
    try {
      const byId = await db.collection("communities").doc(rawKey).get();
      if (byId && byId.exists) {
        const data = byId.data() || {};
        return String(data.name || rawKey).trim() || meta.label;
      }
    } catch {}
    try {
      const snap = await db.collection("communities").where("username", "==", rawKey).limit(1).get();
      const doc = snap && snap.docs && snap.docs[0] ? snap.docs[0] : null;
      if (doc && doc.exists) {
        const data = doc.data() || {};
        return String(data.name || rawKey).trim() || meta.label;
      }
    } catch {}
    if (user && db) {
      try {
        const udoc = await db.collection("users").doc(String(user.uid)).get();
        const data = udoc && udoc.exists ? (udoc.data() || {}) : {};
        const cid = String(data.community || "").trim();
        if (cid) {
          const cdoc = await db.collection("communities").doc(cid).get();
          if (cdoc && cdoc.exists) {
            const cdata = cdoc.data() || {};
            return String(cdata.name || cid).trim() || meta.label;
          }
        }
      } catch {}
    }
    return meta.label;
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      location.replace("index.html");
      return;
    }
    try {
      sessionStorage.setItem("csp_role", meta.role);
    } catch {}
    const communityName = await resolveCommunityName(user);
    if (communitySubEl) communitySubEl.textContent = communityName || meta.label;
  });
})();
