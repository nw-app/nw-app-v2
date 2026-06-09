(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  const auth = firebase.auth();
  const db = firebase.firestore();
  const FieldValue = firebase.firestore.FieldValue;
  try {
    db.settings({
      experimentalAutoDetectLongPolling: true,
      experimentalForceLongPolling: true,
      useFetchStreams: false,
      ignoreUndefinedProperties: true,
    });
  } catch {}

  const STORAGE_CONFIG = "csp_config_v1";
  const STORAGE_ACCOUNTS = "csp_accounts_v1";
  const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";
  const STORAGE_ADMIN_ORDER_PREFIX = "csp_admin_module_order_v1:";

  const state = {
    communities: [],
    config: null,
    unsubConfig: null,
    unsubVisitors: null,
    unsubResidents: null,
    unsubPendingBadge: null,
    creatorLabelByUid: new Map(),
    creatorFetches: new Map(),
  };

  const pad2 = (n) => String(n).padStart(2, "0");

  const moduleCatalog = [
    { id: "parcel", name: "包裹郵件", desc: "登記到貨、通知住戶、領取簽收", badge: "常用", page: "#community/parcel" },
    { id: "visitor", name: "訪客登記", desc: "到訪資訊、車牌、進出時間管理", badge: "安全", page: "#community/visitor" },
    { id: "residents", name: "住戶造冊", desc: "住戶/承租/車位/聯絡方式彙整", badge: "資料", page: "#community/residents" },
    { id: "facility", name: "設施預約", desc: "時段控管、名額與審核流程", badge: "熱門", page: "#community/facility" },
    { id: "bulletin", name: "公告系統", desc: "分類公告、置頂、閱讀回覆", badge: "通知", page: "#community/bulletin" },
    { id: "parking", name: "綠色停車", desc: "電動車/節能車位管理與登記", badge: "綠能", page: "#community/parking" },
    { id: "company-support", name: "公司支援", desc: "回報需求、聯絡紀錄與處理進度（示意）", badge: "支援", page: "#community/company-support" },
    { id: "meter-reading", name: "抄表紀錄", desc: "水電瓦斯抄表、拍照與歷史紀錄（示意）", badge: "抄表", page: "#community/meter-reading" },
    { id: "finance", name: "收支報表", desc: "收入/支出彙總、分類與月份查詢（示意）", badge: "財務", page: "#community/finance" },
    { id: "checkin-vote", name: "報到投票", desc: "活動報到、投票與統計結果（示意）", badge: "活動", page: "#community/checkin-vote" },
    { id: "assignments", name: "交辦事項", desc: "派工、追蹤進度、回報與結案（示意）", badge: "待辦", page: "#community/assignments" },
    { id: "duty", name: "勤務管理", desc: "排班、值勤紀錄與交接（示意）", badge: "管理", page: "#community/duty" },
    { id: "care", name: "關懷救護", desc: "緊急聯絡、救護資訊與關懷通報（示意）", badge: "關懷", page: "#community/care" },
    { id: "life", name: "生活服務", desc: "管家/修繕/代收代送與便民服務（示意）", badge: "服務", page: "#community/life" },
  ];

  const toastEl = document.getElementById("toast");
  const contentEl = document.getElementById("content");
  const subnavEl = document.getElementById("subnav");
  const roleSelectEl = document.getElementById("roleSelect");
  const btnSignOut = document.getElementById("btnSignOut");
  const globalSearchEl = document.getElementById("globalSearch");
  const loginInfoEl = document.getElementById("loginInfo");

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.clearTimeout(toastEl._t);
    toastEl._t = window.setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  function avatarHtml(r) {
    const name = String(r.displayName || r.name || r.email || "U").trim();
    const initial = name.slice(0, 1).toUpperCase() || "U";
    const url = String(r.avatarDataUrl || "").trim();
    if (url) return `<img class="avatar-sm avatar-img" alt="" src="${url}">`;
    return `<span class="avatar-fallback" aria-hidden="true">${initial}</span>`;
  }

  function loadAccounts() {
    return { communities: state.communities, residents: [] };
  }

  function readUrlCommunityKey() {
    try {
      const params = new URLSearchParams(location.search);
      return String(params.get("c") || "").trim();
    } catch {
      return "";
    }
  }

  function setHeaderCommunityText(text) {
    const subEl = document.getElementById("communityNameSub");
    if (!subEl) return;
    const t = String(text || "").trim();
    subEl.textContent = t && t !== "default" ? t : "";
  }

  async function ensureUrlCommunityKey(user) {
    const existing = readUrlCommunityKey();
    if (existing) return existing;

    try {
      const fromSession = String(sessionStorage.getItem("csp_last_cid") || "").trim();
      if (fromSession) {
        const u = new URL(location.href);
        u.searchParams.set("c", fromSession);
        history.replaceState(null, "", u.toString());
        return fromSession;
      }
    } catch {}

    if (!user) return "";
    try {
      const udoc = await db.collection("users").doc(String(user.uid)).get();
      const udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
      const cid = String(udata.community || "").trim();
      if (!cid || cid === "default") return "";
      const cdoc = await db.collection("communities").doc(cid).get();
      const cdata = cdoc && cdoc.exists ? (cdoc.data() || {}) : {};
      const code = String(cdata.username || "").trim();
      const key = code || cid;
      if (!key) return "";
      try { sessionStorage.setItem("csp_last_cid", key); } catch {}
      const u = new URL(location.href);
      u.searchParams.set("c", key);
      history.replaceState(null, "", u.toString());
      return key;
    } catch {
      return "";
    }
  }

  function resolveActiveCommunityId() {
    const accounts = loadAccounts();
    const list = accounts && Array.isArray(accounts.communities) ? accounts.communities : [];
    
    try {
      const urlCidRaw = readUrlCommunityKey();
      const urlCid = urlCidRaw.toLowerCase();
      if (urlCid) {
        const found = list.find((x) => x && (String(x.id || "").trim().toLowerCase() === urlCid || String(x.username || "").trim().toLowerCase() === urlCid));
        if (found && found.id) {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, found.id);
          return found.id;
        }
      }
    } catch {}

    const saved = localStorage.getItem(STORAGE_ACTIVE_COMMUNITY);
    const first = list.find((x) => x && x.enabled)?.id || list[0]?.id || "";
    if (saved && list.some((x) => x && x.id === saved)) return saved;
    if (first) {
      localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, first);
      return first;
    }
    return "default";
  }

  function configDocRef(communityId) {
    return db.collection("communities").doc(String(communityId || "default")).collection("settings").doc("app_config");
  }

  function loadConfig(communityId) {
    return state.config && typeof state.config === "object" ? state.config : null;
  }

  function getButtonConfig(moduleId) {
    const communityId = resolveActiveCommunityId();
    const cfg = loadConfig(communityId);
    const v = cfg && cfg.communityButtons ? cfg.communityButtons[moduleId] : null;
    if (!v) return { enabled: true, url: `#community/${moduleId}` };
    return { enabled: v.enabled !== false, url: String(v.url || "").trim() || `#community/${moduleId}` };
  }

  function refreshLoginInfo(user) {
    if (!user) return;
    const accounts = loadAccounts();
    const cid = resolveActiveCommunityId();
    const c = accounts.communities.find((x) => x && x.id === cid) || null;
    const urlC = readUrlCommunityKey();
    const cname = c ? String(c.name || "").trim() : "";
    if (loginInfoEl) loginInfoEl.textContent = `已登入：${user.email || "（未知）"}｜${cname}`;
    setHeaderCommunityText(cname);
  }

  function ensureConfigSubscription() {
    if (state.unsubConfig) {
      try { state.unsubConfig(); } catch {}
      state.unsubConfig = null;
    }
    const cid = resolveActiveCommunityId();
    try {
      state.unsubConfig = configDocRef(cid).onSnapshot(
        (doc) => {
          state.config = doc && doc.exists ? (doc.data() || null) : null;
          if (handleHashRoute()) {
            renderFooterNav();
            updateFooterActiveNav();
            return;
          }
          renderDashboard();
        },
        () => {
          state.config = null;
          if (handleHashRoute()) {
            renderFooterNav();
            updateFooterActiveNav();
            return;
          }
          renderDashboard();
        }
      );
    } catch {
      state.config = null;
      if (handleHashRoute()) return;
      renderDashboard();
    }
  }

  function ensureCommunitiesSubscription(user) {
    db.collection("communities").get().then((snap) => {
      state.communities = snap.docs.map((d) => {
        const v = d.data() || {};
        return {
          id: String(v.id || d.id),
          name: String(v.name || ""),
          username: String(v.username || ""),
          enabled: v.enabled !== false,
        };
      });
      refreshLoginInfo(user);
      ensureConfigSubscription();
      if (handleHashRoute()) return;
      renderDashboard();
    }).catch(() => {
      state.communities = [];
      refreshLoginInfo(user);
      ensureConfigSubscription();
      if (handleHashRoute()) return;
      renderDashboard();
    });
  }

  function resolveUrl(moduleId) {
    const cfg = getButtonConfig(moduleId);
    if (!cfg.enabled) return { enabled: false, url: "" };
    const u = cfg.url;
    if (u.startsWith("#community/")) {
      return { enabled: true, url: u };
    }
    if (u.startsWith("#")) {
      return { enabled: true, url: u };
    }
    return { enabled: true, url: u };
  }

  function loadModuleOrder(communityId) {
    const cid = String(communityId || "default");
    try {
      const raw = localStorage.getItem(`${STORAGE_ADMIN_ORDER_PREFIX}${cid}`) || "";
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.map((x) => String(x || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function loadConfigModuleOrder(communityId) {
    const cid = String(communityId || "default");
    const cfg = loadConfig(cid);
    const raw = cfg && Array.isArray(cfg.communityButtonsOrder) ? cfg.communityButtonsOrder : [];
    return Array.isArray(raw) ? raw.map((x) => String(x || "").trim()).filter(Boolean) : [];
  }

  function saveModuleOrder(communityId, ids) {
    const cid = String(communityId || "default");
    const list = Array.isArray(ids) ? ids.map((x) => String(x || "").trim()).filter(Boolean) : [];
    try {
      localStorage.setItem(`${STORAGE_ADMIN_ORDER_PREFIX}${cid}`, JSON.stringify(list));
    } catch {}
    try {
      configDocRef(cid).set(
        { communityButtonsOrder: list, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      ).catch(() => {});
    } catch {}
  }

  function orderedModules() {
    const cid = resolveActiveCommunityId();
    const order = loadConfigModuleOrder(cid);
    const fallbackOrder = order.length ? [] : loadModuleOrder(cid);
    const map = new Map(moduleCatalog.map((m) => [String(m.id), m]));
    const used = new Set();
    const out = [];
    const isEnabled = (moduleId) => {
      try {
        const cfg = getButtonConfig(moduleId);
        return cfg && cfg.enabled !== false;
      } catch {
        return true;
      }
    };
    for (const id of (order.length ? order : fallbackOrder)) {
      const key = String(id || "").trim();
      if (!key || used.has(key)) continue;
      const m = map.get(key);
      if (!m) continue;
      if (!isEnabled(key)) continue;
      used.add(key);
      out.push(m);
    }
    for (const m of moduleCatalog) {
      const key = String(m.id);
      if (used.has(key)) continue;
      if (!isEnabled(key)) continue;
      used.add(key);
      out.push(m);
    }
    return out;
  }

  function iconSvg(id) {
    if (id === "parcel") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 8.5 12 13 3 8.5 12 4l9 4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M21 8.5V17a2 2 0 0 1-1.1 1.8L12 22l-7.9-3.2A2 2 0 0 1 3 17V8.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 13v9" stroke="currentColor" stroke-width="1.7"/></svg>`;
    if (id === "visitor") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" stroke-width="1.7"/><path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "residents") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="1.7"/><path d="M16.5 11a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z" stroke="currentColor" stroke-width="1.7"/><path d="M3.8 20a6.2 6.2 0 0 1 10.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M14.4 20a5.2 5.2 0 0 1 6.2 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "facility") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4v2M17 4v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M5 7.5h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6 6.5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 11.2h.01M12 11.2h.01M15 11.2h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>`;
    if (id === "bulletin") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 11.2V8.8A2.3 2.3 0 0 1 6.8 6.5h2.9l7.2-2.7a.9.9 0 0 1 1.2.8v14.8a.9.9 0 0 1-1.2.8l-7.2-2.7H6.8A2.3 2.3 0 0 1 4.5 15v-2.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M20.2 9.2a4.2 4.2 0 0 1 0 5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6.8 17.5v2.2a1.8 1.8 0 0 0 3.6 0v-1.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "company-support") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 3.5V8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 16v4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M3.5 12H8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16 12h4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "meter-reading") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 20h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 10l1.6-1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8.5 16.5h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "finance") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19.5h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.2 18.8V11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 18.8V8.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16.8 18.8V13.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.2 10.3 10 7.8l2.6 2.4L16.8 6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (id === "checkin-vote") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10.5 10 13.5 17 6.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 4.5h11A2 2 0 0 1 19.5 6.5v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    if (id === "assignments") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6.5h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 11h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 15.5h5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.2 4.5h5.6a1 1 0 0 1 1 1V7H8.2V5.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    if (id === "duty") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.2c4.8 0 8.7-3.9 8.7-8.7S16.8 3.8 12 3.8 3.3 7.7 3.3 12.5 7.2 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.6v5.1l3.2 1.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (id === "care") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.2c4.8 0 8.7-3.9 8.7-8.7S16.8 3.8 12 3.8 3.3 7.7 3.3 12.5 7.2 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.6v9.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.1 12.5h9.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "life") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z" stroke="currentColor" stroke-width="1.7"/><path d="M7 12.2a5 5 0 0 1 10 0v2.1l1.2 1.4H5.8L7 14.3v-2.1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10.2 18.2a1.8 1.8 0 0 0 3.6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M5 19.2h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "parking") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 16.5 7.4 11.8A2.5 2.5 0 0 1 9.8 10h4.4a2.5 2.5 0 0 1 2.4 1.8L18 16.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 16.5h12v2a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 18.5v-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.2 10.4 9.2 7.8A2 2 0 0 1 11.1 6.5h1.8a2 2 0 0 1 1.9 1.3l1 2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9 18.2h.01M15 18.2h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>`;
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.5c5.247 0 9.5-4.253 9.5-9.5S17.247 2.5 12 2.5 2.5 6.753 2.5 12 6.753 21.5 12 21.5Z" stroke="currentColor" stroke-width="1.7" opacity="0.9"/></svg>`;
  }

  function homeSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 20v-9.5Z" stroke="currentColor" stroke-width="1.7"/><path d="M9 21v-7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7" stroke="currentColor" stroke-width="1.7"/></svg>`;
  }

  function renderFooterNav() {
    const nav = document.querySelector(".frame-ft .nav");
    if (!nav) return;

    const mods = orderedModules();
    const items = [
      { id: "community-dashboard", label: "總覽", url: "#community/community-dashboard", icon: homeSvg() },
      ...mods.map((m) => {
        const cfg = resolveUrl(m.id);
        const url = cfg && cfg.enabled && cfg.url ? cfg.url : `#community/${m.id}`;
        const label =
          m.id === "residents" ? "住戶" :
          m.id === "facility" ? "預約" :
          m.id === "bulletin" ? "公告" :
          m.id === "parking" ? "停車" :
          m.id === "company-support" ? "支援" :
          m.id === "meter-reading" ? "抄表" :
          m.id === "finance" ? "收支" :
          m.id === "checkin-vote" ? "投票" :
          m.id === "assignments" ? "交辦" :
          m.id === "duty" ? "勤務" :
          m.id === "care" ? "救護" :
          m.id === "life" ? "生活" :
          m.id === "visitor" ? "訪客" :
          m.id === "parcel" ? "包裹" :
          String(m.name || "").trim().slice(0, 2) || String(m.id);
        return { id: String(m.id), label, url, icon: iconSvg(m.id) };
      }),
    ];

    nav.innerHTML = items.map((x) => `
      <a href="${String(x.url)}" data-nav="${String(x.id)}">
        ${x.icon}
        ${x.id === "parcel" ? `<span class="nav-badge" id="badgeNavParcel" hidden>0</span>` : ""}
        ${x.id === "residents" ? `<span class="nav-badge" id="badgeNavResidents" hidden>0</span>` : ""}
        ${x.id === "visitor" ? `<span class="nav-badge" id="badgeNavVisitor" hidden>0</span>` : ""}
        <span class="label">${String(x.label)}</span>
      </a>
    `.trim()).join("");
    ensureParcelPendingCountSubscription(resolveActiveCommunityId());
    ensureResidentsPendingCountSubscription(resolveActiveCommunityId());
    ensureVisitorsPendingCountSubscription(resolveActiveCommunityId());
  }

  function normalizeText(v) {
    return String(v || "").trim();
  }

  function inferUserName(user) {
    const u = user || {};
    const dn = String(u.displayName || "").trim();
    if (dn) return dn;
    const email = String(u.email || "").trim();
    if (email && email.includes("@")) return String(email.split("@")[0] || "").trim() || email;
    return email || "—";
  }

  function inferUserAccount80(user) {
    const u = user || {};
    const email = String(u.email || "").trim();
    if (email && email.includes("@")) return String(email.split("@")[0] || "").trim() || email;
    return email || "—";
  }

  function normalizeRoleText(input) {
    const r = String(input || "").trim().toLowerCase();
    if (r === "admin" || r === "系統管理員" || r === "系統管理者" || r === "系統") return "admin";
    if (r === "community" || r === "社區") return "community";
    if (r === "resident" || r === "住戶") return "resident";
    return "";
  }

  function creatorLabelFromUserData(data) {
    const d = data && typeof data === "object" ? data : {};
    const role = normalizeRoleText(d.role);
    if (role === "admin") return "系統管理員";
    if (role === "community") {
      const category = String(d.category || "").trim();
      return category || "社區";
    }
    if (role === "resident") {
      const houseNo = String(d.houseNo || d.unit || "").trim();
      return houseNo || "—";
    }
    return "—";
  }

  async function getCreatorLabel80(uid) {
    const id = String(uid || "").trim();
    if (!id) return "";
    if (state.creatorLabelByUid.has(id)) return String(state.creatorLabelByUid.get(id) || "");
    if (state.creatorFetches.has(id)) {
      try {
        const v = await state.creatorFetches.get(id);
        return String(v || "");
      } catch {
        return "";
      }
    }
    const p = db.collection("users").doc(id).get().then((doc) => {
      const data = doc && doc.exists ? (doc.data() || {}) : null;
      const label = creatorLabelFromUserData(data);
      try { state.creatorLabelByUid.set(id, label); } catch {}
      return label;
    }).catch(() => "");
    state.creatorFetches.set(id, p);
    try {
      const label = await p;
      return String(label || "");
    } finally {
      try { state.creatorFetches.delete(id); } catch {}
    }
  }

  function formatKeepText80(keep) {
    const k = keep && typeof keep === "object" ? keep : {};
    const cert = k.certificate && typeof k.certificate === "object" ? k.certificate : {};
    const cash = k.cash && typeof k.cash === "object" ? k.cash : {};
    const parts = [];
    if (cert.enabled) parts.push(String(cert.type || "證件").trim() || "證件");
    if (k.businessCard) parts.push("名片");
    if (cash.enabled) {
      const amt = Number(cash.amount);
      const text = Number.isFinite(amt) && amt > 0 ? `現金${Math.floor(amt)}` : "現金";
      parts.push(text);
    }
    if (k.key) parts.push("鑰匙");
    return parts.length ? parts.join("、") : "無";
  }

  function escapeHtml(input) {
    return String(input || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stopVisitorsSubscription() {
    if (state.unsubVisitors) {
      try { state.unsubVisitors(); } catch {}
      state.unsubVisitors = null;
    }
  }

  function ensureModal(id, className, width) {
    let modal = document.getElementById(id);
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal " + (className || "");
    modal.id = id;
    modal.hidden = true;
    if (width) {
      modal.style.setProperty("--modal-width", width);
    }
    document.body.appendChild(modal);
    return modal;
  }

  async function openPendingVisitorsModal80({ communityId, communityName }) {
    const modal = ensureModal("pendingVisitorsModal", "modal-pending-visitors", "80%");
    let detachList = () => {};
    const detach = bindModalClose(modal, () => {
      detachList();
    });

    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="pendingVisitorsTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="pendingVisitorsTitle">待審核訪客 - ${communityName || "社區"}</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="status" id="pendingVisitorStatus" hidden></div>
          <div class="pending-list" id="pendingVisitorList"></div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();

    const listEl = modal.querySelector("#pendingVisitorList");
    const stEl = modal.querySelector("#pendingVisitorStatus");

    const setStatus = (msg, isError) => {
      if (!stEl) return;
      const t = String(msg || "").trim();
      stEl.textContent = t;
      stEl.hidden = !t;
      stEl.classList.toggle("error", Boolean(isError));
    };

    const renderList = (list) => {
      if (!listEl) return;
      if (!list.length) {
        listEl.innerHTML = `<div class="status">目前沒有待審核的訪客。</div>`;
        return;
      }

      listEl.innerHTML = list.map(v => {
        const id = String(v.id || "");
        const name = String(v.name || "—");
        const unit = String(v.unit || "—");
        const phone = String(v.phone || "—");
        const purpose = String(v.purpose || "—");
        const createdAt = v.createdAt ? (v.createdAt.toDate ? v.createdAt.toDate() : new Date(v.createdAt)) : null;
        const createdText = createdAt ? `${createdAt.getFullYear()}-${pad2(createdAt.getMonth()+1)}-${pad2(createdAt.getDate())} ${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}` : "—";

        return `
          <div class="pending-item" data-id="${id}">
            <div class="pending-info">
              <div class="pending-name">${escapeHtml(name)} <span class="tag yellow">待審核</span></div>
              <div class="pending-sub">戶號：${escapeHtml(unit)}｜手機：${escapeHtml(phone)}</div>
              <div class="pending-sub">事由：${escapeHtml(purpose)}</div>
              <div class="pending-created">建立時間：${escapeHtml(createdText)}</div>
            </div>
            <div class="pending-actions">
              <button class="btn btn-primary btn-sm" type="button" data-approve title="核准授權">核准</button>
              <button class="btn btn-sm danger" type="button" data-reject title="刪除紀錄">刪除</button>
            </div>
          </div>
        `.trim();
      }).join("");

      // 綁定事件
      listEl.querySelectorAll(".pending-item").forEach(item => {
        const id = item.getAttribute("data-id");
        const v = list.find(x => x.id === id);
        if (!v) return;

        item.querySelector("[data-approve]").onclick = async () => {
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "核准訪客",
            message: `是否核准「${v.name}」的訪客登記並核發訪客證？`,
            okText: "核准",
            cancelText: "取消"
          }) : Promise.resolve(confirm("是否核准？")));

          if (ok) {
            try {
              await db.collection("communities").doc(communityId).collection("visitors").doc(id).update({
                status: "approved",
                passAuthorized: true,
                updatedAt: FieldValue.serverTimestamp()
              });
              toast("訪客已核准");
            } catch (err) {
              toast("操作失敗：" + err.message);
            }
          }
        };

        item.querySelector("[data-reject]").onclick = async () => {
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "刪除申請",
            message: `是否刪除「${v.name}」的訪客登記紀錄？`,
            okText: "確認刪除",
            cancelText: "取消",
            danger: true
          }) : Promise.resolve(confirm("是否刪除？")));

          if (ok) {
            try {
              await db.collection("communities").doc(communityId).collection("visitors").doc(id).delete();
              toast("已刪除紀錄");
            } catch (err) {
              toast("操作失敗：" + err.message);
            }
          }
        };
      });
    };

    setStatus("讀取中...", false);
    detachList = db.collection("communities").doc(communityId).collection("visitors")
      .where("status", "==", "pending")
      .onSnapshot((snap) => {
        const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        list.sort((a, b) => {
          const tA = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : a.createdAt) : 0;
          const tB = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : b.createdAt) : 0;
          return tB - tA;
        });
        setStatus("", false);
        renderList(list);
      }, (err) => {
        setStatus("讀取失敗：" + err.message, true);
      });

    modal.hidden = false;
  }

  function stopResidentsSubscription() {
     if (state.unsubResidents) {
       try { state.unsubResidents(); } catch {}
       state.unsubResidents = null;
     }
   }

  function stopParcelsSubscription() {
    if (_unsubParcels) {
      try { _unsubParcels(); } catch {}
      _unsubParcels = null;
    }
  }

  let _unsubResidentsPendingCount = null;
  let _residentsPendingCountCid = null;
  let _lastResidentsPendingCount = 0;
  function stopResidentsPendingCountSubscription() {
    if (_unsubResidentsPendingCount) {
      try { _unsubResidentsPendingCount(); } catch {}
      _unsubResidentsPendingCount = null;
    }
    _residentsPendingCountCid = null;
    _lastResidentsPendingCount = 0;
  }
  function updateResidentsPendingBadges(count) {
    const n = Number.isFinite(Number(count)) ? Number(count) : 0;
    _lastResidentsPendingCount = n;
    const subnavBadge = document.getElementById("pendingBadge");
    if (subnavBadge) {
      subnavBadge.textContent = String(n);
      subnavBadge.hidden = n === 0;
    }
    const navBadge = document.getElementById("badgeNavResidents");
    if (navBadge) {
      navBadge.textContent = String(n);
      navBadge.hidden = n === 0;
    }
  }
  function ensureResidentsPendingCountSubscription(cid) {
    const communityId = String(cid || "").trim();
    if (!communityId) return;
    if (_residentsPendingCountCid === communityId && _unsubResidentsPendingCount) {
      updateResidentsPendingBadges(_lastResidentsPendingCount);
      return;
    }
    stopResidentsPendingCountSubscription();
    _residentsPendingCountCid = communityId;
    try {
      _unsubResidentsPendingCount = db
        .collection("users")
        .where("community", "==", communityId)
        .where("role", "==", "resident")
        .where("status", "==", "pending")
        .onSnapshot((snap) => {
          updateResidentsPendingBadges(snap && typeof snap.size === "number" ? snap.size : 0);
        }, () => {});
    } catch {
      stopResidentsPendingCountSubscription();
    }
  }

  let _unsubVisitorsPendingCount = null;
  let _visitorsPendingCountCid = null;
  let _lastVisitorsPendingCount = 0;
  function stopVisitorsPendingCountSubscription() {
    if (_unsubVisitorsPendingCount) {
      try { _unsubVisitorsPendingCount(); } catch {}
      _unsubVisitorsPendingCount = null;
    }
    _visitorsPendingCountCid = null;
    _lastVisitorsPendingCount = 0;
  }
  function updateVisitorsPendingBadges(count) {
    const n = Number.isFinite(Number(count)) ? Number(count) : 0;
    _lastVisitorsPendingCount = n;
    const subnavBadge = document.getElementById("pendingVisitorsBadge");
    if (subnavBadge) {
      subnavBadge.textContent = String(n);
      subnavBadge.hidden = n === 0;
    }
    const navBadge = document.getElementById("badgeNavVisitor");
    if (navBadge) {
      navBadge.textContent = String(n);
      navBadge.hidden = n === 0;
    }
  }
  function ensureVisitorsPendingCountSubscription(cid) {
    const communityId = String(cid || "").trim();
    if (!communityId) return;
    if (_visitorsPendingCountCid === communityId && _unsubVisitorsPendingCount) {
      updateVisitorsPendingBadges(_lastVisitorsPendingCount);
      return;
    }
    stopVisitorsPendingCountSubscription();
    _visitorsPendingCountCid = communityId;
    try {
      _unsubVisitorsPendingCount = db
        .collection("communities")
        .doc(communityId)
        .collection("visitors")
        .where("status", "==", "pending")
        .onSnapshot((snap) => {
          updateVisitorsPendingBadges(snap && typeof snap.size === "number" ? snap.size : 0);
        }, () => {});
    } catch {
      stopVisitorsPendingCountSubscription();
    }
  }

  let _unsubParcelPendingCount = null;
  let _parcelPendingCountCid = null;
  let _lastParcelPendingCount = 0;
  function stopParcelPendingCountSubscription() {
    if (_unsubParcelPendingCount) {
      try { _unsubParcelPendingCount(); } catch {}
      _unsubParcelPendingCount = null;
    }
    _parcelPendingCountCid = null;
    _lastParcelPendingCount = 0;
  }
  function updateParcelPendingBadges(count) {
    const n = Number.isFinite(Number(count)) ? Number(count) : 0;
    _lastParcelPendingCount = n;
    const subnavBadge = document.getElementById("parcelPendingBadge");
    if (subnavBadge) {
      subnavBadge.textContent = String(n);
      subnavBadge.hidden = n === 0;
    }
    const navBadge = document.getElementById("badgeNavParcel");
    if (navBadge) {
      navBadge.textContent = String(n);
      navBadge.hidden = n === 0;
    }
  }
  function ensureParcelPendingCountSubscription(cid) {
    const communityId = String(cid || "").trim();
    if (!communityId) return;
    if (_parcelPendingCountCid === communityId && _unsubParcelPendingCount) {
      updateParcelPendingBadges(_lastParcelPendingCount);
      return;
    }
    stopParcelPendingCountSubscription();
    _parcelPendingCountCid = communityId;
    try {
      _unsubParcelPendingCount = db
        .collection("communities")
        .doc(communityId)
        .collection("parcels")
        .where("status", "==", "pending")
        .onSnapshot((snap) => {
          updateParcelPendingBadges(snap && typeof snap.size === "number" ? snap.size : 0);
        }, () => {});
    } catch {
      stopParcelPendingCountSubscription();
    }
  }

  function ensureVisitorPassModal() {
    let modal = document.getElementById("visitorPassModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "visitorPassModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="visitorPassModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="visitorPassModalTitle"><span class="pass-community" id="visitorPassCommunity">—</span><span class="pass-title">訪客證</span></h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="visitorPassModalForm">
          <div class="modal-body">
            <div class="pass-grid">
              <div class="pass-qr" id="visitorPassQrWrap"></div>
              <div class="pass-details" id="visitorPassDetails"></div>
            </div>
            <div class="pass-times" id="visitorPassTimes"></div>
            <div class="pass-hint" id="visitorPassHint"></div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" id="btnShareVisitorPassEmail">Email</button>
            <button class="btn" type="button" id="btnShareVisitorPassLine">LINE</button>
            <button class="btn" type="button" data-modal-close="1">關閉</button>
          </div>
        </form>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function ensureVisitorQrModal80() {
    let modal = document.getElementById("visitorQrModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "visitorQrModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="visitorQrModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="visitorQrModalTitle">訪客自填連結</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="visitorQrUrl">頁面網址</label>
            <input id="visitorQrUrl" type="text" autocomplete="off" readonly />
          </div>
          <div class="visitor-qr-box">
            <div class="visitor-qr-img" id="visitorQrImgWrap"></div>
          </div>
          <div class="status" id="visitorQrStatus" hidden></div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" id="btnOpenVisitorQrUrl">開啟</button>
          <button class="btn" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function openVisitorQrModal80({ communityId, communityName }) {
    const modal = ensureVisitorQrModal80();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const titleEl = modal.querySelector("#visitorQrModalTitle");
    const inputEl = modal.querySelector("#visitorQrUrl");
    const imgWrap = modal.querySelector("#visitorQrImgWrap");
    const statusEl = modal.querySelector("#visitorQrStatus");
    const btnOpen = modal.querySelector("#btnOpenVisitorQrUrl");

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    if (titleEl) titleEl.textContent = `訪客自填連結｜${String(communityName || "").trim() || "—"}`;
    const cid = String(communityId || "default").trim() || "default";
    const key = (() => {
      const byUsername = (Array.isArray(state.communities) ? state.communities : []).find((x) => x && String(x.id || "") === cid) || null;
      return String((byUsername && byUsername.username) || cid).trim() || cid;
    })();
    const publicBase = (() => {
      const host = String(location.hostname || "").trim().toLowerCase();
      const isLocal =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.startsWith("192.168.") ||
        host.startsWith("10.") ||
        host.startsWith("172.16.") ||
        host.startsWith("172.17.") ||
        host.startsWith("172.18.") ||
        host.startsWith("172.19.") ||
        host.startsWith("172.2") ||
        host.startsWith("172.3");
      if (isLocal) return "https://nw-app.github.io/nw-app-v2/";

      const origin = location.origin.endsWith("/") ? location.origin.slice(0, -1) : location.origin;
      const pathParts = location.pathname.split("/");
      pathParts.pop();
      const basePath = pathParts.join("/");
      return `${origin}${basePath}/`;
    })();

    const renderQr = () => {
      const url = String(inputEl ? inputEl.value : "").trim();
      if (!imgWrap) return;
      imgWrap.innerHTML = "";
      if (!url) {
        imgWrap.innerHTML = `<div class="status">尚未設定頁面網址。</div>`;
        return;
      }
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = "點擊開啟網址";
      const img = document.createElement("img");
      img.alt = "QR Code";
      img.src = qrSrc;
      img.decoding = "async";
      img.loading = "eager";
      img.addEventListener("error", () => {
        try { imgWrap.innerHTML = `<div class="status error">QR code 產生失敗</div>`; } catch {}
      });
      a.appendChild(img);
      imgWrap.appendChild(a);
    };
    const toHex = (bytes) => Array.from(bytes || []).map((b) => b.toString(16).padStart(2, "0")).join("");
    const genToken = () => {
      try {
        const buf = new Uint8Array(16);
        (crypto && crypto.getRandomValues ? crypto.getRandomValues(buf) : buf);
        return toHex(buf);
      } catch {
        return `${Date.now()}${Math.random()}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32).padEnd(32, "0");
      }
    };
    const ensurePublicToken = async () => {
      try {
        const ref = db.collection("communities").doc(cid).collection("secrets").doc("visitor_public");
        const snap = await ref.get();
        const existing = snap && snap.exists ? String((snap.data() || {}).token || "").trim() : "";
        if (existing.length >= 16) return existing;
        const next = genToken();
        await ref.set({ token: next }, { merge: true });
        return next;
      } catch {
        return "";
      }
    };

    const u = new URL("visitor.html", publicBase);
    u.searchParams.set("c", key);
    const fixedUrl = u.toString();
    if (inputEl) inputEl.value = fixedUrl;
    renderQr();
    setStatus("提示：此網址為固定產生（依社區）。", false);

    const onOpen = () => {
      const url = String(inputEl ? inputEl.value : "").trim();
      if (!url) return;
      try { window.open(url, "_blank", "noopener,noreferrer"); } catch { location.href = url; }
    };

    if (btnOpen) btnOpen.addEventListener("click", onOpen);
    const oldDetach = detach;
    detach = () => {
      try { if (btnOpen) btnOpen.removeEventListener("click", onOpen); } catch {}
      oldDetach();
    };

    modal.hidden = false;
    requestAnimationFrame(() => {
      if (inputEl && inputEl.focus) inputEl.focus();
    });
  }

  function ensureVisitorTokenModal80() {
    let modal = document.getElementById("visitorTokenModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "visitorTokenModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="visitorTokenModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="visitorTokenModalTitle">編輯 QR Code</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="visitorTokenInput">QR code 碼</label>
            <input id="visitorTokenInput" type="text" autocomplete="off" />
          </div>
          <div class="visitor-qr-box">
            <div class="visitor-qr-img" id="visitorTokenQrWrap"></div>
          </div>
          <div class="status" id="visitorTokenStatus" hidden></div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" id="btnCopyVisitorToken">複製</button>
          <button class="btn" type="button" id="btnCopyVisitorTokenUrl">複製連結</button>
          <button class="btn btn-primary" type="button" id="btnSaveVisitorToken">儲存</button>
          <button class="btn" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function openVisitorTokenModal80({ cid, communityName, visitorId, qrToken, onSaved }) {
    const modal = ensureVisitorTokenModal80();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const titleEl = modal.querySelector("#visitorTokenModalTitle");
    const inputEl = modal.querySelector("#visitorTokenInput");
    const qrWrap = modal.querySelector("#visitorTokenQrWrap");
    const statusEl = modal.querySelector("#visitorTokenStatus");
    const btnCopy = modal.querySelector("#btnCopyVisitorToken");
    const btnCopyUrl = modal.querySelector("#btnCopyVisitorTokenUrl");
    const btnSave = modal.querySelector("#btnSaveVisitorToken");

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    if (titleEl) titleEl.textContent = `編輯 QR Code｜${String(communityName || "").trim() || "—"}`;
    const vid = String(visitorId || "").trim();
    const tokenDefault = String(qrToken || vid).trim();
    if (inputEl) inputEl.value = tokenDefault;

    const buildDeepLink = (token) => {
      const t = String(token || "").trim();
      return `nwapp://visitor-pass?cid=${encodeURIComponent(String(cid || ""))}&vid=${encodeURIComponent(vid)}&t=${encodeURIComponent(t || vid)}`;
    };

    const renderQr = () => {
      if (!qrWrap) return;
      const token = String(inputEl ? inputEl.value : "").trim();
      qrWrap.innerHTML = "";
      if (!vid) {
        qrWrap.innerHTML = `<div class="status error">缺少訪客 ID</div>`;
        return;
      }
      const deep = buildDeepLink(token);
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(deep)}`;
      const img = document.createElement("img");
      img.alt = "QR Code";
      img.src = qrSrc;
      img.decoding = "async";
      img.loading = "eager";
      img.addEventListener("error", () => {
        try { qrWrap.innerHTML = `<div class="status error">QR code 產生失敗</div>`; } catch {}
      });
      qrWrap.appendChild(img);
    };
    renderQr();
    setStatus("", false);

    if (inputEl && !inputEl._boundVisitorTokenInput) {
      inputEl._boundVisitorTokenInput = true;
      inputEl.addEventListener("input", () => {
        renderQr();
        setStatus("", false);
      });
    }

    const copyText = async (t) => {
      const val = String(t || "").trim();
      if (!val) return;
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(val);
          toast("已複製");
          return;
        }
      } catch {}
      try { window.prompt("複製內容", val); } catch {}
    };

    const onCopy = () => copyText(String(inputEl ? inputEl.value : "").trim());
    const onCopyUrl = () => copyText(buildDeepLink(String(inputEl ? inputEl.value : "").trim()));

    const onSave = async () => {
      const token = String(inputEl ? inputEl.value : "").trim();
      if (!token) {
        setStatus("請輸入 QR code 碼", true);
        return;
      }
      if (btnSave) btnSave.disabled = true;
      setStatus("儲存中...", false);
      try {
        await db.collection("communities").doc(String(cid || "default")).collection("visitors").doc(String(vid)).set(
          {
            qrToken: token,
            qrInvalidated: false,
            qrInvalidatedAt: firebase.firestore.FieldValue.delete(),
            qrReissuedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        setStatus("已儲存。", false);
        toast("已儲存");
        if (typeof onSaved === "function") onSaved(token);
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限儲存。" : "儲存失敗，請稍後再試。", true);
      } finally {
        if (btnSave) btnSave.disabled = false;
      }
    };

    if (btnCopy) btnCopy.addEventListener("click", onCopy);
    if (btnCopyUrl) btnCopyUrl.addEventListener("click", onCopyUrl);
    if (btnSave) btnSave.addEventListener("click", onSave);
    const oldDetach = detach;
    detach = () => {
      try { if (btnCopy) btnCopy.removeEventListener("click", onCopy); } catch {}
      try { if (btnCopyUrl) btnCopyUrl.removeEventListener("click", onCopyUrl); } catch {}
      try { if (btnSave) btnSave.removeEventListener("click", onSave); } catch {}
      oldDetach();
    };

    modal.hidden = false;
    requestAnimationFrame(() => {
      if (inputEl && inputEl.focus) inputEl.focus();
    });
  }

  function ensureResidentTokenModal80() {
    let modal = document.getElementById("residentTokenModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "residentTokenModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="residentTokenModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="residentTokenModalTitle">編輯 QR Code</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="residentTokenInput">QR code 碼</label>
            <input id="residentTokenInput" type="text" autocomplete="off" />
          </div>
          <div class="visitor-qr-box">
            <div class="visitor-qr-img" id="residentTokenQrWrap"></div>
          </div>
          <div class="status" id="residentTokenStatus" hidden></div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" id="btnCopyResidentToken">複製</button>
          <button class="btn btn-primary" type="button" id="btnSaveResidentToken">儲存</button>
          <button class="btn" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function openResidentTokenModal80({ communityId, uid, displayName, qrToken, onSaved }) {
    const modal = ensureResidentTokenModal80();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const titleEl = modal.querySelector("#residentTokenModalTitle");
    const inputEl = modal.querySelector("#residentTokenInput");
    const qrWrap = modal.querySelector("#residentTokenQrWrap");
    const statusEl = modal.querySelector("#residentTokenStatus");
    const btnCopy = modal.querySelector("#btnCopyResidentToken");
    const btnSave = modal.querySelector("#btnSaveResidentToken");

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    if (titleEl) titleEl.textContent = `編輯 QR Code｜${String(displayName || "").trim() || "—"}`;
    const id = String(uid || "").trim();
    const defaultToken = "A000ADDT";
    const originalToken = String(qrToken || "").trim();
    if (inputEl) inputEl.value = originalToken || defaultToken;

    const renderQr = () => {
      if (!qrWrap) return;
      const token = String(inputEl ? inputEl.value : "").trim();
      qrWrap.innerHTML = "";
      if (!token) {
        qrWrap.innerHTML = `<div class="status error">請輸入 QR code 碼</div>`;
        return;
      }
      const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(token)}`;
      const img = document.createElement("img");
      img.alt = "QR Code";
      img.src = qrSrc;
      img.decoding = "async";
      img.loading = "eager";
      img.addEventListener("error", () => {
        try { qrWrap.innerHTML = `<div class="status error">QR code 產生失敗</div>`; } catch {}
      });
      qrWrap.appendChild(img);
    };

    renderQr();
    setStatus("", false);

    if (inputEl && !inputEl._boundResidentTokenInput) {
      inputEl._boundResidentTokenInput = true;
      inputEl.addEventListener("input", () => {
        renderQr();
        setStatus("", false);
      });
    }

    const copyText = async (t) => {
      const val = String(t || "").trim();
      if (!val) return;
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(val);
          toast("已複製");
          return;
        }
      } catch {}
      try { window.prompt("複製內容", val); } catch {}
    };

    const onCopy = () => copyText(String(inputEl ? inputEl.value : "").trim());

    const onSave = async () => {
      const token = String(inputEl ? inputEl.value : "").trim();
      if (!token) {
        setStatus("請輸入 QR code 碼", true);
        return;
      }
      if (btnSave) btnSave.disabled = true;
      setStatus("儲存中...", false);
      try {
        if (token !== defaultToken && token !== originalToken) {
          const cid = String(communityId || "").trim() || String(resolveActiveCommunityId() || "").trim() || "default";
          try {
            const dupSnap = await db.collection("users")
              .where("community", "==", cid)
              .where("qrToken", "==", token)
              .get();
            const dup = dupSnap && Array.isArray(dupSnap.docs) ? dupSnap.docs.find((d) => d && String(d.id || "") !== id) : null;
            if (dup) {
              setStatus("此社區 QR code 碼不可重複（A000ADDT 除外）。", true);
              return;
            }
          } catch (err) {
            const code = String(err && err.code ? err.code : "");
            if (code.includes("permission-denied")) {
              setStatus("沒有權限查詢查重。", true);
              return;
            }
            try {
              const allSnap = await db.collection("users").where("community", "==", cid).get();
              const dup = allSnap && Array.isArray(allSnap.docs)
                ? allSnap.docs.find((d) => {
                    if (!d || String(d.id || "") === id) return false;
                    const v = d.data ? (d.data() || {}) : {};
                    return String(v.qrToken || "").trim() === token;
                  })
                : null;
              if (dup) {
                setStatus("此社區 QR code 碼不可重複（A000ADDT 除外）。", true);
                return;
              }
            } catch (err2) {
              const code2 = String(err2 && err2.code ? err2.code : "");
              setStatus(code2.includes("permission-denied") ? "沒有權限查詢查重。" : "查重失敗，請稍後再試。", true);
              return;
            }
          }
        }
        await db.collection("users").doc(String(id)).set(
          {
            qrToken: token,
            qrUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        setStatus("已儲存。", false);
        toast("已儲存");
        if (typeof onSaved === "function") onSaved(token);
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限儲存。" : "儲存失敗，請稍後再試。", true);
      } finally {
        if (btnSave) btnSave.disabled = false;
      }
    };

    if (btnCopy) btnCopy.addEventListener("click", onCopy);
    if (btnSave) btnSave.addEventListener("click", onSave);
    const oldDetach = detach;
    detach = () => {
      try { if (btnCopy) btnCopy.removeEventListener("click", onCopy); } catch {}
      try { if (btnSave) btnSave.removeEventListener("click", onSave); } catch {}
      oldDetach();
    };

    modal.hidden = false;
    requestAnimationFrame(() => {
      if (inputEl && inputEl.focus) inputEl.focus();
    });
  }

  function ensureResidentParkingModal80() {
    const modal = ensureModal("residentParkingModal80", "modal-resident-parking", "80%");
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="residentParkingModalTitle80">
        <div class="modal-hd">
          <h3 class="modal-title" id="residentParkingModalTitle80">車位資訊</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="status" id="residentParkingStatus80" hidden></div>
          <div class="table-wrap">
            <table class="units-table" id="residentParkingTable80">
              <thead>
                <tr>
                  <th style="width: 150px;">車位類型</th>
                  <th style="width: 220px;">車主姓名</th>
                  <th>車位號碼</th>
                  <th style="width: 160px;">操作</th>
                </tr>
              </thead>
              <tbody id="residentParkingTbody80"></tbody>
            </table>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn btn-sm" type="button" id="btnAddParkingRow80">新增</button>
          <button class="btn btn-primary btn-sm" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    return modal;
  }

  async function openResidentParkingModal80({ cid, uid, unit, displayName }) {
    const modal = ensureResidentParkingModal80();
    const titleEl = modal.querySelector("#residentParkingModalTitle80");
    const statusEl = modal.querySelector("#residentParkingStatus80");
    const tbody = modal.querySelector("#residentParkingTbody80");
    const btnAdd = modal.querySelector("#btnAddParkingRow80");

    const residentUid = String(uid || "").trim();
    const communityId = String(cid || "").trim() || String(resolveActiveCommunityId() || "").trim() || "default";
    const residentUnit = String(unit || "").trim();
    const residentName = String(displayName || "").trim();

    if (titleEl) {
      const suffix = [residentUnit, residentName].filter(Boolean).join("｜");
      titleEl.textContent = suffix ? `車位資訊｜${suffix}` : "車位資訊";
    }

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const rowHtml = (row) => {
      const id = String(row.id || "");
      const type = String(row.type || "汽車");
      const ownerName = String(row.ownerName || residentName || "").trim();
      const slotNo = String(row.slotNo || "").trim();
      const isNew = Boolean(row._isNew);
      return `
        <tr data-id="${escapeHtml(id)}" data-new="${isNew ? "1" : "0"}" data-editing="${isNew ? "1" : "0"}">
          <td>
            <select data-field="type" ${isNew ? "" : "disabled"}>
              <option value="汽車" ${type === "汽車" ? "selected" : ""}>汽車</option>
              <option value="機車" ${type === "機車" ? "selected" : ""}>機車</option>
            </select>
          </td>
          <td><input type="text" data-field="ownerName" value="${escapeHtml(ownerName)}" ${isNew ? "" : "disabled"} /></td>
          <td><input type="text" data-field="slotNo" value="${escapeHtml(slotNo)}" ${isNew ? "" : "disabled"} /></td>
          <td style="padding: 10px 12px;">
            <div style="display:flex; gap:8px; justify-content:flex-end;">
              <button class="btn btn-sm btn-primary" type="button" data-action="edit">${isNew ? "新增" : "編輯"}</button>
              <button class="btn btn-sm" type="button" data-action="delete">刪除</button>
            </div>
          </td>
        </tr>
      `.trim();
    };

    let rows = [];
    const render = () => {
      if (!tbody) return;
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="status">尚無車位資料。</div></td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(rowHtml).join("");
    };

    const load = async () => {
      if (!residentUid) {
        setStatus("缺少住戶 UID。", true);
        return;
      }
      setStatus("讀取中...", false);
      try {
        const snap = await db.collection("communities").doc(communityId).collection("parking_residents")
          .where("uid", "==", residentUid)
          .limit(200)
          .get();
        rows = (snap && snap.docs ? snap.docs : []).map((d) => {
          const v = d.data() || {};
          return {
            id: d.id,
            type: String(v.type || "汽車"),
            ownerName: String(v.ownerName || residentName || ""),
            slotNo: String(v.slotNo || ""),
            createdAt: v.createdAt || null,
          };
        });
        render();
        setStatus("", false);
      } catch (e) {
        const code = String(e && e.code ? e.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限讀取車位資料。" : "讀取失敗，請稍後再試。", true);
      }
    };

    const addRow = () => {
      rows.unshift({ id: `__new__${Date.now()}`, type: "汽車", ownerName: residentName || "", slotNo: "", _isNew: true });
      render();
    };

    const getRowEl = (target) => {
      const tr = target && target.closest ? target.closest("tr[data-id]") : null;
      return tr || null;
    };

    const getRowValues = (tr) => {
      const type = String(tr.querySelector('[data-field="type"]')?.value || "汽車").trim() || "汽車";
      const ownerName = String(tr.querySelector('[data-field="ownerName"]')?.value || "").trim();
      const slotNo = String(tr.querySelector('[data-field="slotNo"]')?.value || "").trim();
      return { type, ownerName, slotNo };
    };

    const setRowEditing = (tr, editing) => {
      const on = Boolean(editing);
      tr.setAttribute("data-editing", on ? "1" : "0");
      tr.querySelectorAll("input, select").forEach((el) => {
        el.disabled = !on;
      });
      const editBtn = tr.querySelector('[data-action="edit"]');
      const isNew = tr.getAttribute("data-new") === "1";
      if (editBtn) editBtn.textContent = on ? "儲存" : (isNew ? "新增" : "編輯");
    };

    const saveRow = async (tr) => {
      const isNew = tr.getAttribute("data-new") === "1";
      const rowId = String(tr.getAttribute("data-id") || "");
      const v = getRowValues(tr);
      if (!v.ownerName || !v.slotNo) {
        toast("請填寫車主姓名與車位號碼");
        return;
      }
      try {
        const ref = isNew
          ? db.collection("communities").doc(communityId).collection("parking_residents").doc()
          : db.collection("communities").doc(communityId).collection("parking_residents").doc(rowId);
        const payload = {
          uid: residentUid,
          unit: residentUnit,
          residentName,
          type: v.type,
          ownerName: v.ownerName,
          slotNo: v.slotNo,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (isNew) payload.createdAt = FieldValue.serverTimestamp();
        await ref.set(payload, { merge: true });
        toast(isNew ? "已新增" : "已更新");
        await load();
      } catch (e) {
        const code = String(e && e.code ? e.code : "");
        toast(code.includes("permission-denied") ? "沒有權限儲存。" : "儲存失敗");
      }
    };

    const deleteRow = async (tr) => {
      const isNew = tr.getAttribute("data-new") === "1";
      const rowId = String(tr.getAttribute("data-id") || "");
      if (isNew) {
        rows = rows.filter((x) => String(x.id || "") !== rowId);
        render();
        return;
      }
      const ok = await (window.nwConfirm ? window.nwConfirm({
        title: "刪除車位",
        message: "確認是否刪除此筆資料？",
        okText: "刪除",
        cancelText: "取消",
        danger: true,
      }) : Promise.resolve(confirm("確認是否刪除此筆資料？")));
      if (!ok) return;
      try {
        await db.collection("communities").doc(communityId).collection("parking_residents").doc(rowId).delete();
        toast("已刪除");
        await load();
      } catch (e) {
        const code = String(e && e.code ? e.code : "");
        toast(code.includes("permission-denied") ? "沒有權限刪除。" : "刪除失敗");
      }
    };

    const onClick = async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      const tr = getRowEl(btn);
      if (!tr) return;
      const action = String(btn.getAttribute("data-action") || "");
      if (action === "delete") {
        await deleteRow(tr);
        return;
      }
      if (action === "edit") {
        const editing = tr.getAttribute("data-editing") === "1";
        if (!editing) {
          setRowEditing(tr, true);
          return;
        }
        await saveRow(tr);
        return;
      }
    };

    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    if (btnAdd) btnAdd.onclick = addRow;
    if (tbody) tbody.addEventListener("click", onClick);

    const oldDetach = detach;
    detach = () => {
      try { if (tbody) tbody.removeEventListener("click", onClick); } catch {}
      try { if (btnAdd) btnAdd.onclick = null; } catch {}
      oldDetach();
    };

    modal.hidden = false;
    await load();
  }

  function ensureResidentControlModal80() {
    const modal = ensureModal("residentControlModal80", "modal-resident-control", "80%");
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="residentControlModalTitle80">
        <div class="modal-hd">
          <h3 class="modal-title" id="residentControlModalTitle80">管制</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="status" id="residentControlStatus80" hidden></div>
          <div class="control-grid">
            <div class="control-block">
              <h4>人口管制</h4>
              <div class="control-options">
                <label class="control-option"><input type="checkbox" data-control-pop value="一般戶">一般戶</label>
                <label class="control-option"><input type="checkbox" data-control-pop value="空屋戶">空屋戶</label>
                <label class="control-option"><input type="checkbox" data-control-pop value="承租戶">承租戶</label>
                <label class="control-option"><input type="checkbox" data-control-pop value="關懷戶">關懷戶</label>
              </div>
            </div>
            <div class="control-block">
              <h4>秩序管制</h4>
              <div class="control-options">
                <label class="control-option"><input type="checkbox" data-control-order value="噪音戶">噪音戶</label>
                <label class="control-option"><input type="checkbox" data-control-order value="臭氣戶">臭氣戶</label>
                <label class="control-option"><input type="checkbox" data-control-order value="寵物戶">寵物戶</label>
                <label class="control-option"><input type="checkbox" data-control-order value="違規戶">違規戶</label>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn btn-primary btn-sm" type="button" id="btnSaveResidentControl80">儲存</button>
          <button class="btn btn-sm" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    return modal;
  }

  async function openResidentControlModal80({ cid, uid, unit, displayName }) {
    const modal = ensureResidentControlModal80();
    const titleEl = modal.querySelector("#residentControlModalTitle80");
    const statusEl = modal.querySelector("#residentControlStatus80");
    const btnSave = modal.querySelector("#btnSaveResidentControl80");

    const residentUid = String(uid || "").trim();
    const communityId = String(cid || "").trim() || String(resolveActiveCommunityId() || "").trim() || "default";
    const residentUnit = String(unit || "").trim();
    const residentName = String(displayName || "").trim();

    if (titleEl) {
      const suffix = [residentUnit, residentName].filter(Boolean).join("｜");
      titleEl.textContent = suffix ? `管制｜${suffix}` : "管制";
    }

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const setChecked = (selector, values) => {
      const list = Array.isArray(values) ? values.map((x) => String(x || "").trim()).filter(Boolean) : [];
      modal.querySelectorAll(selector).forEach((el) => {
        const v = String(el.value || "").trim();
        el.checked = list.includes(v);
      });
    };

    const collectChecked = (selector) => {
      const out = [];
      modal.querySelectorAll(selector).forEach((el) => {
        if (el && el.checked) out.push(String(el.value || "").trim());
      });
      return out.filter(Boolean);
    };

    const load = async () => {
      if (!residentUid) {
        setStatus("缺少住戶 UID。", true);
        return;
      }
      setStatus("讀取中...", false);
      try {
        const udoc = await db.collection("users").doc(residentUid).get();
        const udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
        const pop = (udata.control && Array.isArray(udata.control.population) ? udata.control.population : udata.controlPopulation);
        const ord = (udata.control && Array.isArray(udata.control.order) ? udata.control.order : udata.controlOrder);
        setChecked('input[data-control-pop]', pop);
        setChecked('input[data-control-order]', ord);
        setStatus("", false);
      } catch (e) {
        const code = String(e && e.code ? e.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限讀取。" : "讀取失敗，請稍後再試。", true);
      }
    };

    const onSave = async () => {
      if (!residentUid) return;
      if (btnSave) btnSave.disabled = true;
      setStatus("儲存中...", false);
      try {
        const pop = collectChecked('input[data-control-pop]');
        const ord = collectChecked('input[data-control-order]');
        await db.collection("users").doc(residentUid).set({
          community: communityId,
          controlPopulation: pop,
          controlOrder: ord,
          controlUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        toast("已儲存");
        setStatus("已儲存。", false);
      } catch (e) {
        const code = String(e && e.code ? e.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限儲存。" : "儲存失敗，請稍後再試。", true);
      } finally {
        if (btnSave) btnSave.disabled = false;
      }
    };

    let detach = () => {};
    detach = bindModalClose(modal, () => detach());
    if (btnSave) btnSave.addEventListener("click", onSave);
    const oldDetach = detach;
    detach = () => {
      try { if (btnSave) btnSave.removeEventListener("click", onSave); } catch {}
      oldDetach();
    };

    modal.hidden = false;
    await load();
  }

  function toDateAny(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") {
      try { return v.toDate(); } catch {}
    }
    return null;
  }

  async function sendVisitorPassEmail80({ to, subject, html, text, cid, visitorId, communityName }) {
    const emailTo = String(to || "").trim();
    if (!emailTo) return;
    await db.collection("mail").add({
      to: [emailTo],
      message: { subject, text, html },
      meta: {
        type: "visitor-pass",
        cid: String(cid || ""),
        visitorId: String(visitorId || ""),
        communityName: String(communityName || ""),
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  function openVisitorPassModal80({ cid, communityName, visitorId, qrToken, name, unit, purpose, phone, plate, email, partySize, keep, createdAt, createdByName, inAt, outAt, autoSendEmail }) {
    const modal = ensureVisitorPassModal();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const titleEl = modal.querySelector("#visitorPassModalTitle");
    const passTitleEl = modal.querySelector("#visitorPassModalTitle .pass-title");
    const communityEl = modal.querySelector("#visitorPassCommunity");
    const qrWrap = modal.querySelector("#visitorPassQrWrap");
    const detailsEl = modal.querySelector("#visitorPassDetails");
    const timesEl = modal.querySelector("#visitorPassTimes");
    const hintEl = modal.querySelector("#visitorPassHint");

    if (passTitleEl) passTitleEl.textContent = "訪客證";
    else if (titleEl) titleEl.textContent = "訪客證";
    if (communityEl) communityEl.textContent = String(communityName || "—").trim() || "—";

    const inDate = toDateAny(inAt);
    const outDate = toDateAny(outAt);
    const createdDate = toDateAny(createdAt);
    const inText = formatYmdHms(inDate);
    const outText = formatYmdHms(outDate);
    const createdText = formatYmdHms(createdDate);
    modal.dataset.cid = String(cid || "");
    modal.dataset.visitorId = String(visitorId || "");
    modal.dataset.inMs = inDate ? String(inDate.getTime()) : "";
    modal.dataset.outMs = outDate ? String(outDate.getTime()) : "";

    if (timesEl) {
      timesEl.innerHTML = `
        <span class="time-pill in" role="button" tabindex="0" data-time-kind="in" data-visitor-id="${escapeHtml(String(visitorId || ""))}">來訪：${escapeHtml(inText || "—")}</span>
        <span class="time-pill out" role="button" tabindex="0" data-time-kind="out" data-visitor-id="${escapeHtml(String(visitorId || ""))}">離開：${escapeHtml(outText || "—")}</span>
      `.trim();
    }
    const party = Number.isFinite(Number(partySize)) && Number(partySize) >= 1 ? String(Math.floor(Number(partySize))) : "1";
    const keepText = formatKeepText80(keep);
    const rows = [
      ["訪客姓名", name || "—"],
      ["拜訪戶號", unit || "—"],
      ["到訪事由", purpose || "—"],
      ["拜訪人數", party],
      ["手機", phone || "—"],
      ["車牌", plate || "—"],
      ["電子郵件", email || "—"],
      ["留存", keepText || "無"],
      ["建立", createdText || "—"],
      ["建立者", String(createdByName || "").trim() || "—"],
    ];

    if (detailsEl) {
      detailsEl.innerHTML = rows
        .map(([k, v]) => `<div class="pass-row"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`)
        .join("");
    }

    const tok = String(qrToken || visitorId || "").trim();
    const qrData = `nwapp://visitor-pass?cid=${String(cid || "")}&vid=${String(visitorId || "")}&t=${String(tok || String(visitorId || ""))}`;
    const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrData)}`;

    const shareText = [
      `【${String(communityName || "").trim() || "社區"}｜訪客證】`,
      `來訪：${inText || "—"}`,
      `離開：${outText || "—"}`,
      `訪客人數：${party}`,
      `訪客：${name || "—"}`,
      `拜訪戶號：${unit || "—"}`,
      `到訪事由：${purpose || "—"}`,
      `手機：${phone || "—"}`,
      `車牌：${plate || "—"}`,
      `Email：${email || "—"}`,
      "",
      `QR Code：${qrSrc}`,
    ].join("\n");

    if (qrWrap) {
      qrWrap.innerHTML = "";
      const img = document.createElement("img");
      img.alt = "QR Code";
      img.src = qrSrc;
      img.decoding = "async";
      img.loading = "eager";
      img.addEventListener("error", () => {
        try { qrWrap.textContent = "QR code 產生失敗"; } catch {}
      });
      qrWrap.appendChild(img);
    }

    if (hintEl) hintEl.textContent = "請出示此 QR code 作為訪客證。";

    const btnEmail = modal.querySelector("#btnShareVisitorPassEmail");
    const btnLine = modal.querySelector("#btnShareVisitorPassLine");

    if (!modal._timePillBound) {
      modal._timePillBound = true;
      const handle = (target) => {
        const pill = target && target.closest ? target.closest(".time-pill[data-time-kind]") : null;
        if (!pill || !modal.contains(pill)) return;
        const kind = String(pill.getAttribute("data-time-kind") || "").trim() === "out" ? "out" : "in";
        const vid = String(pill.getAttribute("data-visitor-id") || modal.dataset.visitorId || "").trim();
        const ccid = String(modal.dataset.cid || "").trim();
        if (!vid || !ccid) return;
        const ms = kind === "out" ? Number(modal.dataset.outMs || 0) : Number(modal.dataset.inMs || 0);
        const initialDate = Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
        openVisitorTimeModal80({
          cid: ccid,
          visitorId: vid,
          kind,
          initialDate,
          onUpdatedText: (d) => {
            const t = formatYmdHms(d);
            pill.textContent = `${kind === "out" ? "離開" : "來訪"}：${t || "—"}`;
            if (kind === "out") modal.dataset.outMs = d ? String(d.getTime()) : "";
            else modal.dataset.inMs = d ? String(d.getTime()) : "";
          },
        });
      };
      modal.addEventListener("click", (e) => handle(e.target));
      modal.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const pill = e.target && e.target.closest ? e.target.closest(".time-pill[data-time-kind]") : null;
        if (!pill) return;
        e.preventDefault();
        handle(pill);
      });
    }

    const onShareEmail = async (e) => {
      e.preventDefault();
      const to = String(email || "").trim();
      if (!to) return;
      const subject = `訪客證 QR code（${String(name || "訪客")}）`;
      if (btnEmail) btnEmail.disabled = true;
      if (hintEl) hintEl.textContent = "Email 寄送中...";
      try {
        const html = `
          <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,Noto Sans TC,PingFang TC,Microsoft JhengHei,sans-serif;">
            <div style="font-weight:900;font-size:16px;">${escapeHtml(String(communityName || "").trim() || "社區")}｜訪客證</div>
            <div style="margin-top:10px;color:#374151;">
              <div>來訪：${escapeHtml(inText || "—")}</div>
              <div>離開：${escapeHtml(outText || "—")}</div>
              <div>訪客人數：${escapeHtml(party)}</div>
              <div>訪客：${escapeHtml(name || "—")}</div>
              <div>拜訪戶號：${escapeHtml(unit || "—")}</div>
              <div>到訪事由：${escapeHtml(purpose || "—")}</div>
              <div>手機：${escapeHtml(phone || "—")}</div>
              <div>車牌：${escapeHtml(plate || "—")}</div>
            </div>
            <div style="margin-top:14px;">
              <img alt="QR Code" src="${escapeHtml(qrSrc)}" style="width:280px;height:280px;max-width:100%;" />
            </div>
          </div>
        `.trim();
        await sendVisitorPassEmail80({ to, subject, html, text: shareText, cid, visitorId, communityName });
        toast("已送出 Email");
        if (hintEl) hintEl.textContent = "Email 已送出。";
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        toast(code.includes("permission-denied") ? "沒有權限發送 Email" : "Email 寄送失敗");
        if (hintEl) hintEl.textContent = "Email 寄送失敗。";
      } finally {
        if (btnEmail) btnEmail.disabled = !Boolean(String(email || "").trim());
      }
    };

    const onShareLine = async (e) => {
      e.preventDefault();
      const dialog = modal.querySelector(".modal-dialog");
      if (!dialog) return;

      if (btnLine) btnLine.disabled = true;
      const originalText = btnLine.textContent;
      btnLine.textContent = "處理中...";

      try {
        // 使用 html2canvas 捕捉訪客證內容
        // 暫時隱藏按鈕列以免出現在圖片中
        const footer = modal.querySelector(".modal-ft");
        if (footer) footer.style.visibility = "hidden";
        
        const canvas = await html2canvas(dialog, {
          useCORS: true,
          scale: 2,
          backgroundColor: "#ffffff",
          logging: false,
          ignoreElements: (el) => {
            // 忽略關閉按鈕和底部按鈕
            return el.classList.contains("modal-close") || el.classList.contains("modal-ft");
          }
        });

        if (footer) footer.style.visibility = "visible";

        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const file = new File([blob], `訪客證_${communityName || "社區"}.png`, { type: "image/png" });

        if (navigator && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: "訪客證",
            text: `【${String(communityName || "").trim() || "社區"}｜訪客證】\n訪客：${name || "—"}\n戶號：${unit || "—"}`,
            files: [file]
          });
        } else {
          // 不支援檔案分享時，退而求其次分享文字
          const url = `https://social-plugins.line.me/lineit/share?text=${encodeURIComponent(shareText)}`;
          try { window.open(url, "_blank", "noopener,noreferrer"); } catch { location.href = url; }
        }
      } catch (err) {
        console.error("LINE share failed:", err);
        // 出錯時退而求其次分享文字
        const url = `https://social-plugins.line.me/lineit/share?text=${encodeURIComponent(shareText)}`;
        try { window.open(url, "_blank", "noopener,noreferrer"); } catch { location.href = url; }
      } finally {
        if (btnLine) {
          btnLine.disabled = false;
          btnLine.textContent = originalText;
        }
      }
    };

    if (btnLine) btnLine.classList.add("btn-line");
    if (btnEmail) {
      btnEmail.classList.add("btn-email");
      const hasEmail = Boolean(String(email || "").trim());
      btnEmail.disabled = !hasEmail;
      btnEmail.classList.toggle("disabled", !hasEmail);
      btnEmail.setAttribute("aria-disabled", hasEmail ? "false" : "true");
    }

    if (btnEmail) btnEmail.addEventListener("click", onShareEmail);
    if (btnLine) btnLine.addEventListener("click", onShareLine);
    const oldDetach = detach;
    detach = () => {
      try { if (btnEmail) btnEmail.removeEventListener("click", onShareEmail); } catch {}
      try { if (btnLine) btnLine.removeEventListener("click", onShareLine); } catch {}
      oldDetach();
    };

    modal.hidden = false;
    requestAnimationFrame(() => {
      const closeBtn = modal.querySelector(".modal-close");
      if (closeBtn && closeBtn.focus) closeBtn.focus();
    });

    const shouldAuto = Boolean(autoSendEmail) && Boolean(String(email || "").trim());
    if (shouldAuto) {
      if (hintEl) hintEl.textContent = "Email 寄送中...";
      const to = String(email || "").trim();
      const subject = `訪客證 QR code（${String(name || "訪客")}）`;
      const html = `
        <div style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,Noto Sans TC,PingFang TC,Microsoft JhengHei,sans-serif;">
          <div style="font-weight:900;font-size:16px;">${escapeHtml(String(communityName || "").trim() || "社區")}｜訪客證</div>
          <div style="margin-top:10px;color:#374151;">
            <div>來訪：${escapeHtml(inText || "—")}</div>
            <div>離開：${escapeHtml(outText || "—")}</div>
            <div>訪客人數：${escapeHtml(party)}</div>
            <div>訪客：${escapeHtml(name || "—")}</div>
            <div>拜訪戶號：${escapeHtml(unit || "—")}</div>
            <div>到訪事由：${escapeHtml(purpose || "—")}</div>
            <div>手機：${escapeHtml(phone || "—")}</div>
            <div>車牌：${escapeHtml(plate || "—")}</div>
          </div>
          <div style="margin-top:14px;">
            <img alt="QR Code" src="${escapeHtml(qrSrc)}" style="width:280px;height:280px;max-width:100%;" />
          </div>
        </div>
      `.trim();
      Promise.resolve()
        .then(() => sendVisitorPassEmail80({ to, subject, html, text: shareText, cid, visitorId, communityName }))
        .then(() => {
          toast("已送出 Email");
          if (hintEl) hintEl.textContent = "Email 已送出。";
        })
        .catch((err) => {
          const code = String(err && err.code ? err.code : "");
          toast(code.includes("permission-denied") ? "沒有權限發送 Email" : "Email 寄送失敗");
          if (hintEl) hintEl.textContent = "Email 寄送失敗。";
        })
        .finally(() => {
          if (btnEmail) btnEmail.disabled = !Boolean(String(email || "").trim());
        });
    }
  }

  function ensureVisitorScanModal() {
    let modal = document.getElementById("visitorScanModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "visitorScanModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="visitorScanModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="visitorScanModalTitle">掃碼登記</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="visitorScanModalForm">
          <div class="modal-body">
            <div class="scan-stage">
              <video id="visitorScanVideo" class="scan-video" playsinline></video>
              <div class="scan-overlay" aria-hidden="true">
                <div class="scan-frame"></div>
              </div>
            </div>
            <div class="field scan-gun-field">
              <label for="visitorScanGunInput">掃碼槍輸入</label>
              <input id="visitorScanGunInput" type="text" autocomplete="off" inputmode="text" placeholder="請使用掃碼槍掃描（或貼上）後按 Enter" />
            </div>
            <div class="status" id="visitorScanStatus" hidden></div>
            <div class="scan-hint" id="visitorScanHint">請將訪客證 QR code 對準框線。</div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" data-modal-close="1">關閉</button>
          </div>
        </form>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function ensureVisitorTimeModal() {
    let modal = document.getElementById("visitorTimeModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "visitorTimeModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="visitorTimeModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="visitorTimeModalTitle">設定時間</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="visitorTimeModalForm">
          <div class="modal-body">
            <div class="field">
              <label id="visitorTimeLabel" for="visitorTimeInput">時間</label>
              <input id="visitorTimeInput" type="datetime-local" />
            </div>
            <div class="status" id="visitorTimeStatus" hidden></div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" data-modal-close="1">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSaveVisitorTime">儲存</button>
          </div>
        </form>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function openVisitorTimeModal80({ cid, visitorId, kind, initialDate, onApplied, onUpdatedText }) {
    const modal = ensureVisitorTimeModal();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const titleEl = modal.querySelector("#visitorTimeModalTitle");
    const labelEl = modal.querySelector("#visitorTimeLabel");
    const inputEl = modal.querySelector("#visitorTimeInput");
    const statusEl = modal.querySelector("#visitorTimeStatus");
    const submitBtn = modal.querySelector("#btnSaveVisitorTime");

    const toLocalInputValue = (d) => {
      if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return "";
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    };
    const parseLocalInputValue = (v) => {
      const raw = String(v || "").trim();
      if (!raw) return null;
      const d = new Date(raw);
      if (!Number.isFinite(d.getTime())) return null;
      return d;
    };

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const label = kind === "out" ? "離開時間" : "來訪時間";
    if (titleEl) titleEl.textContent = `設定${label}`;
    if (labelEl) labelEl.textContent = label;
    const now = new Date();
    const preset = initialDate instanceof Date && Number.isFinite(initialDate.getTime()) ? initialDate : now;
    if (inputEl) inputEl.value = toLocalInputValue(preset);
    setStatus(`目前：${formatYmdHms(now) || ""}`, false);
    modal.hidden = false;

    const form = modal.querySelector("#visitorTimeModalForm");
    if (form && form._visitorTimeSubmit) {
      try { form.removeEventListener("submit", form._visitorTimeSubmit); } catch {}
      form._visitorTimeSubmit = null;
    }
    const onSubmit = async (e) => {
      e.preventDefault();
      const id = String(visitorId || "").trim();
      const communityId = String(cid || "default").trim() || "default";
      if (!id) return;
      const d = parseLocalInputValue(inputEl ? inputEl.value : "");
      const Timestamp = firebase.firestore.Timestamp;
      const field = kind === "out" ? "outAt" : "inAt";
      const stamp = d ? Timestamp.fromDate(d) : null;
      const payload = { [field]: stamp, updatedAt: FieldValue.serverTimestamp() };
      const localPatch = { [field]: stamp };
      if (kind === "out") {
        payload.qrInvalidated = Boolean(d);
        payload.qrInvalidatedAt = d ? FieldValue.serverTimestamp() : null;
        localPatch.qrInvalidated = Boolean(d);
      }

      if (submitBtn) submitBtn.disabled = true;
      setStatus("儲存中...", false);
      try {
        await db.collection("communities").doc(communityId).collection("visitors").doc(id).set(payload, { merge: true });
        setStatus("", false);
        if (typeof onApplied === "function") onApplied(id, localPatch);
        if (typeof onUpdatedText === "function") onUpdatedText(d);
        modal.hidden = true;
        detach();
      } catch {
        setStatus("儲存失敗，請稍後再試。", true);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    };
    if (form) {
      form._visitorTimeSubmit = onSubmit;
      form.addEventListener("submit", onSubmit);
    }
  }

  function parseVisitorQrText(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const pick = (u) => {
      const cid = String(u.searchParams.get("cid") || "").trim();
      const vid = String(u.searchParams.get("vid") || "").trim();
      const token = String(u.searchParams.get("t") || "").trim();
      if (!cid || !vid) return null;
      return { cid, vid, token };
    };
    try {
      if (raw.startsWith("nwapp://")) {
        const u = new URL(raw);
        return pick(u);
      }
    } catch {}
    try {
      if (raw.includes("visitor-pass?")) {
        const u = new URL(raw.replace(/^nwapp:\/\//, "https://"));
        return pick(u);
      }
    } catch {}
    const mCid = raw.match(/[?&]cid=([^&]+)/i);
    const mVid = raw.match(/[?&]vid=([^&]+)/i);
    const mTok = raw.match(/[?&]t=([^&]+)/i);
    if (!mCid || !mVid) return null;
    const cid = decodeURIComponent(String(mCid[1] || "").trim());
    const vid = decodeURIComponent(String(mVid[1] || "").trim());
    const token = mTok ? decodeURIComponent(String(mTok[1] || "").trim()) : "";
    if (!cid || !vid) return null;
    return { cid, vid, token };
  }

  function formatYmdHms(d) {
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  let _jsQrLoader = null;
  function loadJsQr() {
    if (typeof window.jsQR === "function") return Promise.resolve(window.jsQR);
    if (_jsQrLoader) return _jsQrLoader;
    _jsQrLoader = new Promise((resolve) => {
      const existing = document.querySelector('script[data-jsqr="1"]');
      if (existing) {
        const t = window.setTimeout(() => resolve(typeof window.jsQR === "function" ? window.jsQR : null), 8000);
        existing.addEventListener("load", () => { window.clearTimeout(t); resolve(typeof window.jsQR === "function" ? window.jsQR : null); }, { once: true });
        existing.addEventListener("error", () => { window.clearTimeout(t); resolve(null); }, { once: true });
        return;
      }

      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
      s.async = true;
      s.defer = true;
      s.setAttribute("data-jsqr", "1");
      const t = window.setTimeout(() => resolve(null), 8000);
      s.addEventListener("load", () => { window.clearTimeout(t); resolve(typeof window.jsQR === "function" ? window.jsQR : null); }, { once: true });
      s.addEventListener("error", () => { window.clearTimeout(t); resolve(null); }, { once: true });
      document.head.appendChild(s);
    });
    return _jsQrLoader;
  }

  function openVisitorScanModal80({ cid, onApplied }) {
    const modal = ensureVisitorScanModal();
    const stageEl = modal.querySelector(".scan-stage");
    const video = modal.querySelector("#visitorScanVideo");
    const gunInput = modal.querySelector("#visitorScanGunInput");
    const statusEl = modal.querySelector("#visitorScanStatus");
    const hintEl = modal.querySelector("#visitorScanHint");

    let running = false;
    let stream = null;
    let loopTimer = 0;
    let ignoreUntil = 0;
    let lastValue = "";
    let lastValueAt = 0;

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
      statusEl.classList.remove("scan-result", "scan-in", "scan-out");
    };

    const speak = (text) => {
      const raw = String(text || "").trim();
      if (!raw) return;
      try {
        if (!("speechSynthesis" in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(raw);
        u.lang = "zh-TW";
        window.speechSynthesis.speak(u);
      } catch {}
    };

    const showScanResult = (kind, timeText) => {
      if (!statusEl) return;
      const t = String(timeText || "").trim();
      const label = kind === "out" ? "離開時間" : "來訪時間";
      const colorClass = kind === "out" ? "scan-out" : "scan-in";
      statusEl.hidden = false;
      statusEl.classList.remove("error");
      statusEl.classList.add("scan-result", colorClass);
      statusEl.textContent = `${label}：${t}`;
    };

    const stop = () => {
      running = false;
      if (loopTimer) window.clearTimeout(loopTimer);
      loopTimer = 0;
      try {
        if (video) {
          video.pause();
          video.srcObject = null;
        }
      } catch {}
      try {
        if (stream && stream.getTracks) {
          stream.getTracks().forEach((t) => {
            try { t.stop(); } catch {}
          });
        }
      } catch {}
      stream = null;
    };

    let detach = () => {};
    detach = bindModalClose(modal, () => detach());
    const oldDetach = detach;
    detach = () => {
      stop();
      oldDetach();
    };

    const handleScanText = async (rawValue) => {
      const parsed = parseVisitorQrText(rawValue);
      if (!parsed) {
        setStatus("無法辨識", true);
        speak("無法辨識QR code");
        return;
      }
      if (String(parsed.cid || "") !== String(cid || "")) {
        setStatus("無法辨識", true);
        speak("無法辨識QR code");
        return;
      }
      const vid = String(parsed.vid || "").trim();
      const tokenFromQr = String(parsed.token || "").trim();
      if (!vid) {
        setStatus("無法辨識", true);
        speak("無法辨識QR code");
        return;
      }
      const nowDate = new Date();
      const Timestamp = firebase.firestore.Timestamp;
      try {
        const docRef = db.collection("communities").doc(String(cid || "default")).collection("visitors").doc(String(vid));
        const res = await db.runTransaction(async (tx) => {
          const snap = await tx.get(docRef);
          if (!snap || !snap.exists) return { kind: "missing" };
          const data = snap.data() || {};
          const hasIn = Boolean(data.inAt);
          const hasOut = Boolean(data.outAt);
          const invalidated = Boolean(data.qrInvalidated);
          const expectedToken = String(data.qrToken || vid).trim();
          if (tokenFromQr && expectedToken && tokenFromQr !== expectedToken) return { kind: "missing" };
          if (invalidated || hasOut) return { kind: "invalid" };

          if (!hasIn) {
            const inAt = Timestamp.fromDate(nowDate);
            tx.set(
              docRef,
              {
                inAt,
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            return { kind: "in", inAt };
          }

          const outAt = Timestamp.fromDate(nowDate);
          tx.set(
            docRef,
            {
              outAt,
              qrInvalidated: true,
              qrInvalidatedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          return { kind: "out", outAt };
        });

        if (res.kind === "missing") {
          setStatus("無法辨識", true);
          speak("無法辨識QR code");
          return;
        }
        if (res.kind === "invalid") {
          stop();
          if (stageEl) stageEl.hidden = true;
          setStatus("此 QR code 已失效，不能再重複使用。", true);
          if (hintEl) hintEl.textContent = "請關閉視窗。";
          return;
        }
        if (res.kind === "in") {
          stop();
          if (stageEl) stageEl.hidden = true;
          if (typeof onApplied === "function") onApplied(vid, { inAt: res.inAt });
          const tt = formatYmdHms(nowDate);
          showScanResult("in", tt);
          speak("訪客登記成功，歡迎光臨");
          if (hintEl) hintEl.textContent = "已完成來訪登記。離開時請再次按「掃碼登記」並掃描同一張訪客證。";
          return;
        }
        if (res.kind === "out") {
          stop();
          if (stageEl) stageEl.hidden = true;
          if (typeof onApplied === "function") onApplied(vid, { outAt: res.outAt, qrInvalidated: true });
          const tt = formatYmdHms(nowDate);
          showScanResult("out", tt);
          speak("訪客登記成功，期待您再次光臨");
          if (hintEl) hintEl.textContent = "已完成離開登記。此 QR code 已失效。";
          return;
        }
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限執行此操作。" : "更新失敗，請稍後再試。", true);
      }
    };

    const start = async () => {
      setStatus("", false);
      if (hintEl) hintEl.textContent = "請將訪客證 QR code 對準框線，或使用掃碼槍輸入。";
      if (stageEl) stageEl.hidden = false;

      running = true;

      const schedule = (fn) => {
        loopTimer = window.setTimeout(fn, 180);
      };

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        if (stageEl) stageEl.hidden = true;
        setStatus("相機不可用，可使用掃碼槍輸入。", false);
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!running) return;
        if (video) {
          video.srcObject = stream;
          try { await video.play(); } catch {}
        }
      } catch {
        if (stageEl) stageEl.hidden = true;
        setStatus("無法開啟相機，可使用掃碼槍輸入。", false);
        return;
      }

      const createBarcodeDetector = async () => {
        const Ctor = window.BarcodeDetector;
        if (!Ctor) return null;
        try {
          if (typeof Ctor.getSupportedFormats === "function") {
            const supported = await Ctor.getSupportedFormats();
            if (Array.isArray(supported) && supported.length && !supported.includes("qr_code")) return null;
          }
        } catch {}
        try { return new Ctor({ formats: ["qr_code"] }); } catch {}
        try { return new Ctor(); } catch {}
        return null;
      };

      const detector = await createBarcodeDetector();
      if (detector) {
        const scanOnce = async () => {
          if (!running) return;
          const now = Date.now();
          if (now < ignoreUntil) return schedule(scanOnce);
          try {
            const codes = await detector.detect(video);
            if (Array.isArray(codes) && codes.length) {
              const rawValue = String(codes[0] && codes[0].rawValue ? codes[0].rawValue : "").trim();
              if (rawValue) {
                const isDup = rawValue === lastValue && (now - lastValueAt) < 4000;
                if (!isDup) {
                  lastValue = rawValue;
                  lastValueAt = now;
                  ignoreUntil = now + 2500;
                  await handleScanText(rawValue);
                }
              }
            }
          } catch {}
          schedule(scanOnce);
        };
        return scanOnce();
      }

      const jsqr = await loadJsQr();
      if (typeof jsqr !== "function") {
        setStatus("此瀏覽器不支援 QR code 掃描。", true);
        return;
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const scanOnce = async () => {
        if (!running) return;
        const now = Date.now();
        if (now < ignoreUntil) return schedule(scanOnce);
        try {
          const vw = video && video.videoWidth ? Number(video.videoWidth) : 0;
          const vh = video && video.videoHeight ? Number(video.videoHeight) : 0;
          if (!vw || !vh || !ctx) return schedule(scanOnce);

          const maxW = 640;
          const scale = vw > maxW ? (maxW / vw) : 1;
          const w = Math.max(240, Math.floor(vw * scale));
          const h = Math.max(240, Math.floor(vh * scale));
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsqr(img.data, w, h, { inversionAttempts: "dontInvert" });
          const rawValue = code && code.data ? String(code.data).trim() : "";
          if (rawValue) {
            const isDup = rawValue === lastValue && (now - lastValueAt) < 4000;
            if (!isDup) {
              lastValue = rawValue;
              lastValueAt = now;
              ignoreUntil = now + 2500;
              await handleScanText(rawValue);
            }
          }
        } catch {}
        schedule(scanOnce);
      };
      scanOnce();
    };

    modal.hidden = false;
    requestAnimationFrame(() => {
      if (gunInput && gunInput.focus) gunInput.focus();
    });
    start();

    const onGunKeyDown = (e) => {
      if (!e) return;
      const key = String(e.key || "");
      if (key !== "Enter") return;
      try { e.preventDefault(); } catch {}
      const rawValue = String(gunInput ? gunInput.value : "").trim();
      if (gunInput) gunInput.value = "";
      if (!rawValue) return;
      const now = Date.now();
      if (now < ignoreUntil) return;
      const isDup = rawValue === lastValue && (now - lastValueAt) < 4000;
      if (isDup) return;
      lastValue = rawValue;
      lastValueAt = now;
      ignoreUntil = now + 2500;
      handleScanText(rawValue);
    };

    if (gunInput && !gunInput._scanGunBound) {
      gunInput._scanGunBound = true;
      gunInput.addEventListener("keydown", onGunKeyDown);
      const oldDetach2 = detach;
      detach = () => {
        try { gunInput.removeEventListener("keydown", onGunKeyDown); } catch {}
        oldDetach2();
      };
    }
  }

  function normalizePhoneDigits(input) {
    const raw = String(input || "").trim();
    let digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("886") && digits.length === 12) digits = `0${digits.slice(3)}`;
    return digits;
  }

  const sha256Hex = async (text) => {
    const v = String(text || "");
    const cryptoObj = window.crypto && window.crypto.subtle ? window.crypto : null;
    if (!cryptoObj) return "";
    const data = new TextEncoder().encode(v);
    const hashBuf = await cryptoObj.subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(hashBuf));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  function isResidentRole(role) {
    const r = String(role || "").trim();
    if (!r) return true;
    if (r === "community" || r === "社區") return false;
    if (r === "admin" || r === "系統管理員" || r === "系統管理者" || r === "系統") return false;
    return r === "resident" || r === "住戶" || r === "居民" || r === "住戶帳號";
  }

  function getSecondaryAuth() {
    const fb = window.firebase;
    if (!fb || !firebaseConfig) return null;
    try {
      return fb.app("nwapp-secondary").auth();
    } catch {
      try {
        return fb.initializeApp(firebaseConfig, "nwapp-secondary").auth();
      } catch {
        return null;
      }
    }
  }

  async function createAuthUser(email, password) {
    const a = getSecondaryAuth();
    if (!a) throw new Error("no-secondary-auth");
    const cred = await a.createUserWithEmailAndPassword(String(email || ""), String(password || ""));
    const u = cred && cred.user ? cred.user : null;
    const uid = u && u.uid ? String(u.uid) : "";
    if (!uid) throw new Error("no-uid");
    return { uid, auth: a, user: u };
  }

  async function upsertUserLookup({ phoneNormalized, email, phone, uid, community, communityCode, role }) {
    const key = normalizePhoneDigits(phoneNormalized);
    if (!key) return;
    await db.collection("user_lookup").doc(key).set(
      {
        uid: String(uid || ""),
        email: String(email || ""),
        phone: String(phone || ""),
        phoneNormalized: key,
        community: String(community || ""),
        communityCode: String(communityCode || ""),
        role: String(role || ""),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  function updateFooterActiveNav() {
    renderFooterNav();
    const nav = document.querySelector(".frame-ft .nav");
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll("a[href]"));
    if (!links.length) return;

    let current = String(location.hash || "").trim();
    if (!current || current === "#") current = "#community/community-dashboard";

    const currentRaw = current.replace(/^#/, "");
    const currentParts = currentRaw.split("/");
    if (currentParts[0] !== "community") current = "#community/community-dashboard";
    if (currentParts[1] === "community-dashboard") current = "#community/community-dashboard";
    if (currentParts.length >= 2) current = `#community/${currentParts[1]}`;

    let activeLink = null;
    for (const a of links) {
      const href = String(a.getAttribute("href") || "");
      const i = href.indexOf("#");
      const hrefHash = i >= 0 ? href.slice(i) : "";
      if (!hrefHash) continue;
      if (hrefHash === current) {
        activeLink = a;
        break;
      }
    }
    if (!activeLink && current === "#community/community-dashboard") {
      activeLink = links.find((a) => String(a.getAttribute("href") || "").includes("#community/community-dashboard")) || null;
    }

    links.forEach((a) => a.removeAttribute("aria-current"));
    if (activeLink) activeLink.setAttribute("aria-current", "page");
  }

  function ensureResidentEditorModal() {
    let modal = document.getElementById("residentModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "residentModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="residentModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="residentModalTitle">新增 <span class="community-area-label" id="residentRoleName">住戶</span> 帳號</h3>
          <button class="modal-close" type="button" id="btnCloseResidentModal" aria-label="關閉">×</button>
        </div>
        <form id="residentModalForm">
          <div class="modal-body">
            <div class="image-uploader avatar-uploader" id="residentAvatarUploader" role="button" tabindex="0" aria-label="上傳大頭照">
              <img class="image-preview avatar-preview" id="residentAvatarPreview" alt="" />
              <div class="image-placeholder" id="residentAvatarPlaceholder">上傳大頭照</div>
              <input id="residentAvatarInput" type="file" accept="image/*" hidden />
            </div>
            <div class="field" id="field_r_category">
              <label for="modal_r_category">類別</label>
              <select id="modal_r_category" required>
                <option value="住戶" selected>住戶</option>
                <option value="委員">委員</option>
              </select>
            </div>
            <div class="field" id="field_r_community">
              <label for="modal_r_community">所屬社區</label>
              <div class="input-wrap">
                <select id="modal_r_community" class="has-suffix" required disabled></select>
                <button type="button" class="input-suffix-btn" id="btnUnlockCommunity" title="解鎖變更社區">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                </button>
              </div>
            </div>
            <div class="field" id="field_r_unit">
              <label for="modal_r_unit">戶號</label>
              <div class="input-wrap">
                <input id="modal_r_unit" class="has-suffix" type="text" placeholder="例：A-1203" autocomplete="off" required />
                <span class="input-suffix ok" id="unitMatchBadge" hidden aria-hidden="true" style="display:none;">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 6.5 10 17.5 4 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                  <span>有此戶號</span>
                </span>
              </div>
            </div>
            <div class="field" id="field_r_sub_unit">
              <label for="modal_r_sub_unit">子戶號 (選填)</label>
              <input id="modal_r_sub_unit" type="text" placeholder="例：1" autocomplete="off" />
            </div>
            <div class="field">
              <label for="modal_r_name">姓名</label>
              <input id="modal_r_name" type="text" placeholder="例：林小姐" autocomplete="off" required />
            </div>
            <div class="field">
              <label for="modal_r_email">電子郵件（登入帳號）</label>
              <input id="modal_r_email" type="email" placeholder="例：a1203@example.com" autocomplete="username" required />
            </div>
            <div class="field">
              <label for="modal_r_phone">手機號碼（登入帳號）</label>
              <input id="modal_r_phone" type="tel" placeholder="例：0912345678" autocomplete="tel" required />
            </div>
            <div class="field">
              <label for="modal_r_password">預設密碼（不填則使用手機號碼）</label>
              <input id="modal_r_password" type="text" placeholder="例：0912345678" autocomplete="off" />
            </div>
            <div class="field" id="field_r_address">
              <label for="modal_r_address">地址</label>
              <input id="modal_r_address" type="text" placeholder="例：台北市..." autocomplete="street-address" />
            </div>
            <div class="field" id="field_r_roles">
              <label>住戶角色</label>
              <div class="check-grid" id="modal_r_roles">
                <label class="check"><input type="checkbox" value="區權人" />區權人</label>
                <label class="check"><input type="checkbox" value="區權人家屬" />區權人家屬</label>
                <label class="check"><input type="checkbox" value="承租戶" />承租戶</label>
                <label class="check"><input type="checkbox" value="其他" id="modal_r_role_other_chk" />其他</label>
              </div>
              <input id="modal_r_role_other_text" type="text" placeholder="自定義角色" autocomplete="off" hidden />
            </div>
            <div class="field">
              <label for="modal_r_enabled">狀態</label>
              <select id="modal_r_enabled" required>
                <option value="true" selected>啟用</option>
                <option value="false">停用</option>
              </select>
            </div>
            <div class="status" id="residentModalStatus" hidden></div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" id="btnCancelResidentModal">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSubmitResidentModal">建立</button>
          </div>
        </form>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function ensureUnitsModal() {
    let modal = document.getElementById("unitsModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "unitsModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="unitsModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="unitsModalTitle">戶號資料設定 <span class="unit-modal-count" id="unitsModalCount">總戶數：—</span></h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="unitsForm">
          <div class="modal-body" style="padding: 0;">
            <div class="status" id="unitsStatus" hidden style="margin: 16px;"></div>
            <div class="profile-item" style="margin: 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: #f9fafb; border-bottom: 1px solid var(--border);">
                <div class="profile-label" style="margin-bottom: 0;">戶號資料設定</div>
                <div style="display: flex; gap: 8px;">
                  <button class="btn btn-sm" type="button" id="btnExportUnits">匯出 Excel</button>
                  <button class="btn btn-sm" type="button" id="btnImportUnits">匯入 Excel</button>
                  <input type="file" id="inputImportUnits" accept=".xlsx, .xls, .csv" hidden />
                  <button class="btn btn-sm btn-primary" type="button" id="btnAddUnitRow">+ 新增行</button>
                </div>
              </div>
              
              <div class="units-table-container" style="max-height: 450px; overflow-y: auto;">
                <table class="units-table">
                  <thead>
                    <tr>
                      <th style="width: 180px;">QR code碼</th>
                      <th style="width: 100px;">戶號</th>
                      <th style="width: 180px;">區分所有權人</th>
                      <th>地址</th>
                      <th style="width: 100px;">坪數</th>
                      <th style="width: 120px;">所有權人%</th>
                      <th style="width: 50px;"></th>
                    </tr>
                  </thead>
                  <tbody id="unitsTableBody"></tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" data-modal-close="1">取消</button>
            <button class="btn btn-primary" type="submit">儲存</button>
          </div>
        </form>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function ensurePendingResidentsModal80() {
    let modal = document.getElementById("pendingResidentsModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "pendingResidentsModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog large">
        <div class="modal-hd">
          <h3 class="modal-title">待審核帳號</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="status" id="pendingResidentsStatus" hidden></div>
          <div class="resident-list" id="pendingResidentsList"></div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  async function openPendingResidentsModal80({ communityId }) {
    const modal = ensurePendingResidentsModal80();
    let detach = () => {};
    let detachList = () => {};
    
    detach = bindModalClose(modal, () => {
      detach();
      detachList();
    });

    const listEl = modal.querySelector("#pendingResidentsList");
    const statusEl = modal.querySelector("#pendingResidentsStatus");

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const renderList = (list) => {
      if (!listEl) return;
      if (!list.length) {
        listEl.innerHTML = `<div class="status">目前沒有帳號申請紀錄。</div>`;
        return;
      }

      listEl.innerHTML = list.map((r) => {
        const houseNo = String(r.houseNo || "").trim();
        const phone = String(r.phone || "").trim();
        const email = String(r.email || "").trim();
        const subParts = [houseNo, phone, email].filter(Boolean);
        const isPending = r.status === "pending";
        const statusLabel = isPending ? "待審核" : (r.status === "approved" ? "已核准" : r.status);
        const statusClass = isPending ? "warning" : "success";

        return `
          <div class="resident-item" data-id="${String(r.id || "")}">
            <div class="resident-left">
              <div class="avatar-sm">${avatarHtml(r)}</div>
              <div class="resident-text">
                <div class="resident-name">
                  ${String(r.displayName || "—")}
                  <span class="status-chip ${statusClass}">${statusLabel}</span>
                </div>
                <div class="resident-sub">${subParts.join("｜")}</div>
              </div>
            </div>
            <div class="resident-actions">
              ${isPending ? `
                <button class="btn btn-primary btn-sm" type="button" data-approve title="核准">核准</button>
                <button class="btn btn-sm danger" type="button" data-reject title="刪除">刪除</button>
              ` : `
                <button class="btn btn-sm" type="button" disabled>已處理</button>
              `}
            </div>
          </div>
        `.trim();
      }).join("");

      // 綁定核准/拒絕事件
      listEl.querySelectorAll(".resident-item").forEach(item => {
        const id = item.getAttribute("data-id");
        const r = list.find(x => x.id === id);
        if (!r || r.status !== "pending") return;
        
        item.querySelector("[data-approve]").onclick = async () => {
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "核准帳號",
            message: `是否核准「${r.displayName}」的住戶帳號申請並建立正式登入帳號？`,
            okText: "核准並建立",
            cancelText: "取消"
          }) : Promise.resolve(confirm("是否核准？")));
          
          if (ok) {
            let createdAuth = null;
            try {
              toast("正在建立帳號...");
              const email = String(r.email || "").trim().toLowerCase();
              const phone = normalizePhoneDigits(r.phone);
              // 密碼優先使用申請時填寫的，若無則用手機號碼
              const password = String(r.password || phone).trim();
              
              if (!email || !password) throw new Error("缺少必要的 Email 或密碼資訊");

              // 1. 在 Firebase Auth 建立帳號
              createdAuth = await createAuthUser(email, password);
              const newUid = createdAuth.uid;

              // 2. 將資料轉移至以 UID 為鍵的文件，並更新狀態
              const payload = {
                ...r,
                id: newUid,
                uid: newUid,
                username: email,
                status: "approved",
                enabled: true,
                updatedAt: FieldValue.serverTimestamp()
              };
              delete payload.password; // 不在 Firestore 儲存明文密碼

              // 密碼 Hash 處理 (參考住戶編輯器邏輯)
              if (typeof sha256Hex === "function") {
                payload.passwordHash = await sha256Hex(password);
                payload.passwordHashAlg = "SHA-256";
                payload.passwordUpdatedAt = FieldValue.serverTimestamp();
              }

              await db.collection("users").doc(newUid).set(payload, { merge: true });

              // 3. 更新搜尋索引
              if (typeof upsertUserLookup === "function") {
                const accounts = loadAccounts();
                const c = (accounts.communities || []).find((x) => x && String(x.id || "") === String(communityId || "")) || null;
                const communityCode = c ? String(c.username || "") : "";
                await upsertUserLookup({ 
                  phoneNormalized: phone, 
                  email, 
                  phone, 
                  uid: newUid, 
                  community: communityId, 
                  communityCode, 
                  role: "住戶" 
                });
              }

              // 4. 刪除原本的申請紀錄 (因為已轉移至新 UID 文件)
              if (id !== newUid) {
                await db.collection("users").doc(id).delete();
              }

              toast("帳號核准成功並已建立");
            } catch (err) {
              console.error("Approval error:", err);
              const code = String(err && err.code ? err.code : "");
              const msg =
                code.includes("auth/email-already-in-use") ? "此電子郵件已被使用。" :
                code.includes("auth/weak-password") ? "密碼強度不足。" :
                "核准失敗：" + err.message;
              toast(msg);
            } finally {
              if (createdAuth && createdAuth.auth) {
                try {
                  await createdAuth.auth.signOut();
                } catch {}
              }
            }
          }
        };

        item.querySelector("[data-reject]").onclick = async () => {
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "刪除申請",
            message: `是否刪除「${r.displayName}」的住戶帳號申請紀錄？`,
            okText: "確認刪除",
            cancelText: "取消",
            danger: true
          }) : Promise.resolve(confirm("是否刪除？")));
          
          if (ok) {
            try {
              await db.collection("users").doc(id).delete();
              toast("已刪除申請紀錄");
              // 由於使用了 onSnapshot，不需手動 loadData
            } catch (err) {
              toast("操作失敗：" + err.message);
            }
          }
        };
      });
    };

    setStatus("讀取中...", false);
    detachList = db.collection("users")
      .where("community", "==", communityId)
      .where("role", "==", "resident")
      .where("status", "==", "pending") // 只顯示待審核紀錄
      .onSnapshot((snap) => {
        let list = snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        // 在前端進行排序
        list.sort((a, b) => {
          const tA = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : a.createdAt) : 0;
          const tB = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : b.createdAt) : 0;
          return tB - tA; // 降冪排序 (由新到舊)
        });

        setStatus("", false);
        renderList(list);
      }, (err) => {
        setStatus("讀取失敗：" + err.message, true);
      });

    modal.hidden = false;
  }

  function bindModalClose(modal, onClose) {
    if (!modal) return () => {};
    const close = () => {
      modal.hidden = true;
      if (typeof onClose === "function") onClose();
    };
    const onClick = (e) => {
      const el = e.target && e.target.closest ? e.target.closest("[data-modal-close]") : null;
      if (!el) return;
      e.preventDefault();
      close();
    };
    modal.addEventListener("click", onClick);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      modal.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }

  function renderParcelModule() {
    const cid = resolveActiveCommunityId();
    const communityName = (state.communities.find((c) => c.id === cid) || {}).name || "";
    
    if (subnavEl) {
      subnavEl.innerHTML = `
        <button class="btn btn-sm btn-primary" data-filter="pending">
          <span class="badge-inline" id="parcelPendingBadge" hidden>0</span>
          待領取
        </button>
        <button class="btn btn-sm" data-filter="received">已領取</button>
      `;
      
      subnavEl.querySelectorAll("[data-filter]").forEach(btn => {
        btn.onclick = () => {
          subnavEl.querySelectorAll("[data-filter]").forEach(b => b.classList.remove("btn-primary"));
          btn.classList.add("btn-primary");
          const filter = btn.getAttribute("data-filter");
          renderParcelList(filter, readParcelFilters());
        };
      });
    }

    contentEl.innerHTML = `
      <section class="card parcel-page">
        <div class="card-hd">
          <div class="left">
            <div class="chip" aria-hidden="true">${iconSvg("parcel")}</div>
            <div style="min-width:0;">
              <h2>包裹郵件${communityName ? `｜${escapeHtml(communityName)}` : ""}</h2>
              <p>登記到貨、通知住戶、領取簽收</p>
            </div>
          </div>
          <button class="icon-btn sm" type="button" id="btnCourierConfig" aria-label="物流設定" title="物流設定">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="1.7"></path>
              <path d="M19.2 12a7.2 7.2 0 0 0-.12-1.3l2.05-1.6-2-3.46-2.47 1a7.3 7.3 0 0 0-2.25-1.3L13 2h-4l-.43 3.34a7.3 7.3 0 0 0-2.25 1.3l-2.47-1-2 3.46 2.05 1.6A7.2 7.2 0 0 0 4.8 12c0 .44.04.88.12 1.3l-2.05 1.6 2 3.46 2.47-1a7.3 7.3 0 0 0 2.25 1.3L9 22h4l.43-3.34a7.3 7.3 0 0 0 2.25-1.3l2.47 1 2-3.46-2.05-1.6c.08-.42.12-.86.12-1.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
            </svg>
          </button>
        </div>
        <div class="card-bd">
          <div class="parcel-filter-bar" id="parcelFilterBar">
            <div class="field">
              <label for="parcelFilterDate">日期</label>
              <input id="parcelFilterDate" type="date" />
            </div>
            <div class="field">
              <label for="parcelFilterUnit">戶號</label>
              <input id="parcelFilterUnit" type="text" autocomplete="off" placeholder="例如 A1-1" />
            </div>
            <div class="field">
              <label for="parcelFilterName">姓名</label>
              <input id="parcelFilterName" type="text" autocomplete="off" placeholder="例如 王小明" />
            </div>
            <button class="btn btn-sm" type="button" id="btnParcelFilterClear">清除</button>
            <button class="btn btn-sm danger" type="button" id="btnRegisterParcel">登記包裹</button>
            <button class="icon-btn sm" type="button" id="btnScanResidentParcel" aria-label="掃描住戶 QR Code" title="掃描住戶 QR Code">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 4H5a1 1 0 0 0-1 1v2M17 4h2a1 1 0 0 1 1 1v2M7 20H5a1 1 0 0 1-1-1v-2M17 20h2a1 1 0 0 0 1-1v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M7 9h10M7 12h10M7 15h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
          <div class="parcel-list-container" id="parcelList">
            <div class="status">讀取中...</div>
          </div>
        </div>
      </section>
    `;

    bindParcelFilterBar();

    const btnCourierConfig = document.getElementById("btnCourierConfig");
    if (btnCourierConfig) {
      btnCourierConfig.onclick = () => openCourierConfigModal80({ cid });
    }

    const btnRegister = document.getElementById("btnRegisterParcel");
    if (btnRegister) {
      btnRegister.onclick = () => openParcelModal80({ cid, communityName });
    }

    ensureParcelPendingCountSubscription(cid);
    renderParcelList("pending", readParcelFilters());
  }

  function bindParcelFilterBar() {
    const dateEl = document.getElementById("parcelFilterDate");
    const unitEl = document.getElementById("parcelFilterUnit");
    const nameEl = document.getElementById("parcelFilterName");
    const clearBtn = document.getElementById("btnParcelFilterClear");
    const scanBtn = document.getElementById("btnScanResidentParcel");
    const apply = () => {
      const activeBtn = subnavEl ? subnavEl.querySelector("[data-filter].btn-primary") : null;
      const filter = activeBtn ? String(activeBtn.getAttribute("data-filter") || "pending") : "pending";
      renderParcelList(filter, readParcelFilters());
    };
    const onEnter = (e) => {
      if (!e || e.key !== "Enter") return;
      try { e.preventDefault(); } catch {}
      apply();
    };
    if (dateEl) dateEl.addEventListener("change", apply);
    if (unitEl) {
      unitEl.addEventListener("input", apply);
      unitEl.addEventListener("keydown", onEnter);
    }
    if (nameEl) {
      nameEl.addEventListener("input", apply);
      nameEl.addEventListener("keydown", onEnter);
    }
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (dateEl) dateEl.value = "";
        if (unitEl) unitEl.value = "";
        if (nameEl) nameEl.value = "";
        apply();
      });
    }
    if (scanBtn) {
      scanBtn.addEventListener("click", () => {
        openResidentParcelScanModal80();
      });
    }
  }

  function readParcelFilters() {
    const dateEl = document.getElementById("parcelFilterDate");
    const unitEl = document.getElementById("parcelFilterUnit");
    const nameEl = document.getElementById("parcelFilterName");
    const date = dateEl ? String(dateEl.value || "").trim() : "";
    const unit = unitEl ? String(unitEl.value || "").trim() : "";
    const name = nameEl ? String(nameEl.value || "").trim() : "";
    return { date, unit, name };
  }

  function ymd80(d) {
    const dt = d instanceof Date ? d : new Date();
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  }

  function parseHm80(hm) {
    const s = String(hm || "").trim();
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = Math.max(0, Math.min(23, Number(m[1])));
    const mm = Math.max(0, Math.min(59, Number(m[2])));
    return { hh, mm };
  }

  function makeDateTime80(dateStr, timeStr) {
    const d = String(dateStr || "").trim();
    const t = String(timeStr || "").trim();
    const p = parseHm80(t);
    if (!d || !p) return null;
    const dt = new Date(`${d}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return null;
    dt.setHours(p.hh, p.mm, 0, 0);
    return dt;
  }

  function addMinutes80(d, minutes) {
    const dt = d instanceof Date ? new Date(d.getTime()) : null;
    if (!dt) return null;
    dt.setMinutes(dt.getMinutes() + Number(minutes || 0));
    return dt;
  }

  function formatHm80(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function normalizeFacilityConfig80(v, id) {
    const data = v && typeof v === "object" ? v : {};
    const name = String(data.name || id || "").trim() || "設施";
    const imageDataUrl = String(data.imageDataUrl || data.image || data.imageUrl || "").trim();
    const usageTime = String(data.usageTime || data.usage || "").trim();
    const chargeMethod = String(data.chargeMethod || data.charge || data.pricing || "").trim();
    const orderRaw = Number(data.order);
    const order = Number.isFinite(orderRaw) ? orderRaw : null;
    const slotMinutes = Math.max(15, Math.min(240, Number(data.slotMinutes || data.slot || 60) || 60));
    const openTime = String(data.openTime || "09:00").trim() || "09:00";
    const closeTime = String(data.closeTime || "21:00").trim() || "21:00";
    const capacity = Math.max(1, Math.min(500, Number(data.capacity || data.quota || 1) || 1));
    const requireApproval = Boolean(data.requireApproval !== false);
    const enabled = Boolean(data.enabled !== false);
    const advanceBookingDays = Math.max(1, Math.min(365, Number(data.advanceBookingDays || 30) || 30));
    return { id: String(id || "").trim(), name, imageDataUrl, usageTime, chargeMethod, order, slotMinutes, openTime, closeTime, capacity, requireApproval, enabled, advanceBookingDays };
  }

  async function loadFacilityConfigs80(cid) {
    const communityId = String(cid || "").trim() || "default";
    try {
      const snap = await db.collection("communities").doc(communityId).collection("facility_configs").get();
      const list = (snap && snap.docs ? snap.docs : []).map((d) => normalizeFacilityConfig80(d.data() || {}, d.id));
      list.sort((a, b) => {
        const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : 1e9;
        const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : 1e9;
        return ao - bo || String(a.name || "").localeCompare(String(b.name || "")) || String(a.id || "").localeCompare(String(b.id || ""));
      });
      return list;
    } catch {
      return [];
    }
  }

  async function persistFacilityOrder80(cid, orderedIds) {
    const communityId = String(cid || "").trim() || "default";
    const ids = Array.isArray(orderedIds) ? orderedIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
    if (!ids.length) return false;
    try {
      const batch = db.batch();
      ids.forEach((id, idx) => {
        const ref = db.collection("communities").doc(communityId).collection("facility_configs").doc(id);
        batch.set(ref, { order: idx + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();
      return true;
    } catch {
      return false;
    }
  }

  function facilitySlotList80(dateStr, cfg) {
    const dateKey = String(dateStr || "").trim();
    const c = cfg || {};
    const openP = parseHm80(c.openTime);
    const closeP = parseHm80(c.closeTime);
    const slotMin = Math.max(15, Number(c.slotMinutes || 60) || 60);
    if (!dateKey || !openP || !closeP) return [];
    const startBase = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(startBase.getTime())) return [];
    const open = new Date(startBase.getTime());
    open.setHours(openP.hh, openP.mm, 0, 0);
    const close = new Date(startBase.getTime());
    close.setHours(closeP.hh, closeP.mm, 0, 0);
    if (close.getTime() <= open.getTime()) return [];
    const out = [];
    for (let t = open.getTime(); t + slotMin * 60 * 1000 <= close.getTime(); t += slotMin * 60 * 1000) {
      const s = new Date(t);
      const e = new Date(t + slotMin * 60 * 1000);
      out.push({ startTime: formatHm80(s), endTime: formatHm80(e) });
    }
    return out;
  }

  async function loadReservationsByFacilityDate80({ cid, facilityId, dateKey }) {
    const communityId = String(cid || "").trim() || "default";
    const fid = String(facilityId || "").trim();
    const dk = String(dateKey || "").trim();
    if (!fid || !dk) return [];
    try {
      const snap = await db.collection("communities").doc(communityId).collection("reservations")
        .where("facilityId", "==", fid)
        .where("dateKey", "==", dk)
        .get();
      const list = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
      list.sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")) || String(a.unit || "").localeCompare(String(b.unit || "")));
      return list;
    } catch {
      return [];
    }
  }

  async function loadPendingReservations80({ cid, limit = 50 }) {
    const communityId = String(cid || "").trim() || "default";
    const n = Math.max(1, Math.min(200, Number(limit) || 50));
    try {
      const snap = await db.collection("communities").doc(communityId).collection("reservations")
        .where("status", "==", "pending")
        .orderBy("createdAt", "desc")
        .limit(n)
        .get();
      return (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
    } catch {
      return [];
    }
  }

  function getAdminDisplayName80() {
    const el = document.getElementById("profileNameText");
    const name = el ? String(el.textContent || "").trim() : "";
    if (name) return name;
    const u = auth && auth.currentUser ? auth.currentUser : null;
    const email = u && u.email ? String(u.email) : "";
    return email ? email.split("@")[0] : "—";
  }

  function ensureFacilityConfigModal80() {
    const modal = ensureModal("facilityConfigModal80", "modal-facility-config", "min(980px, 92vw)");
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="facilityConfigModalTitle80">
        <div class="modal-hd">
          <h3 class="modal-title" id="facilityConfigModalTitle80">設施設定</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="facilityConfigForm80">
          <div class="modal-body" style="padding: 0;">
            <div class="status" id="facilityConfigStatus80" hidden style="margin: 16px;"></div>
            <div style="display:flex; justify-content: space-between; align-items:center; padding: 16px; background:#f9fafb; border-bottom:1px solid var(--border);">
              <div class="profile-label" style="margin-bottom:0;">設施清單</div>
              <button class="btn btn-sm btn-primary" type="button" id="btnAddFacilityRow80">+ 新增行</button>
            </div>
            <div class="units-table-container" style="max-height: 520px; overflow-y: auto;">
              <table class="units-table">
                <thead>
                  <tr>
                    <th style="width: 240px;">上傳圖片</th>
                    <th style="width: 190px;">名稱</th>
                    <th style="width: 110px;">開始</th>
                    <th style="width: 110px;">結束</th>
                    <th style="width: 110px;">時段(分)</th>
                    <th style="width: 110px;">名額</th>
                    <th style="width: 200px;">消費方式</th>
                    <th style="width: 110px;">提前預約(天)</th>
                    <th style="width: 110px;">需審核</th>
                    <th style="width: 110px;">啟用</th>
                    <th style="width: 50px;"></th>
                  </tr>
                </thead>
                <tbody id="facilityConfigTbody80"></tbody>
              </table>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" data-modal-close="1">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSaveFacilityConfig80">儲存</button>
          </div>
        </form>
      </div>
    `.trim();
    return modal;
  }

  async function openFacilityConfigModal80({ cid, onSaved }) {
    const communityId = String(cid || "").trim() || "default";
    const modal = ensureFacilityConfigModal80();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const form = modal.querySelector("#facilityConfigForm80");
    const tbody = modal.querySelector("#facilityConfigTbody80");
    const st = modal.querySelector("#facilityConfigStatus80");
    const btnAdd = modal.querySelector("#btnAddFacilityRow80");
    const btnSave = modal.querySelector("#btnSaveFacilityConfig80");

    const setStatus = (msg, isError) => {
      if (!st) return;
      const t = String(msg || "").trim();
      st.textContent = t;
      st.hidden = !t;
      st.classList.toggle("error", Boolean(isError));
    };

    const createRow = (cfg) => {
      const c = cfg || {};
      const tr = document.createElement("tr");
      tr.dataset.id = String(c.id || "");
      const img = String(c.imageDataUrl || "").trim();
      const chargeMethod = String(c.chargeMethod || "").trim();
      const imgStyle = img ? `background-image:url('${img.replace(/'/g, "%27")}');` : "";
      tr.innerHTML = `
        <td style="padding: 10px 12px;">
          <div class="facility-img-cell">
            <div class="facility-img-preview" style="${imgStyle}"></div>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <button class="btn btn-sm" type="button" data-action="upload">上傳</button>
              <input type="file" accept="image/*" class="f-img-file" hidden />
              <input type="hidden" class="f-img-data" value="${escapeHtml(img)}" />
            </div>
          </div>
        </td>
        <td><input type="text" class="f-name" value="${escapeHtml(String(c.name || ""))}" placeholder="名稱" /></td>
        <td><input type="time" class="f-open" value="${escapeHtml(String(c.openTime || "09:00"))}" step="300" /></td>
        <td><input type="time" class="f-close" value="${escapeHtml(String(c.closeTime || "21:00"))}" step="300" /></td>
        <td><input type="number" class="f-slot" value="${escapeHtml(String(c.slotMinutes || 60))}" min="15" step="5" /></td>
        <td><input type="number" class="f-cap" value="${escapeHtml(String(c.capacity || 1))}" min="1" step="1" /></td>
        <td><input type="text" class="f-charge" value="${escapeHtml(chargeMethod)}" placeholder="例如 每小時100元/次" /></td>
        <td><input type="number" class="f-advance" value="${escapeHtml(String(c.advanceBookingDays || 30))}" min="1" max="365" step="1" /></td>
        <td style="padding: 0 12px;"><input type="checkbox" class="f-approve" ${c.requireApproval !== false ? "checked" : ""} /></td>
        <td style="padding: 0 12px;"><input type="checkbox" class="f-enabled" ${c.enabled !== false ? "checked" : ""} /></td>
        <td><div class="remove-row" title="刪除">&times;</div></td>
      `.trim();
      const uploadBtn = tr.querySelector("button[data-action='upload']");
      const uploadInput = tr.querySelector("input.f-img-file");
      const uploadHidden = tr.querySelector("input.f-img-data");
      const uploadPreview = tr.querySelector(".facility-img-preview");
      if (uploadBtn && uploadInput) {
        uploadBtn.onclick = () => uploadInput.click();
        uploadInput.onchange = async () => {
          const file = uploadInput.files && uploadInput.files[0] ? uploadInput.files[0] : null;
          const dataUrl = await fileToImageDataUrl80(file);
          if (uploadHidden) uploadHidden.value = String(dataUrl || "");
          if (uploadPreview) uploadPreview.style.backgroundImage = dataUrl ? `url('${String(dataUrl).replace(/'/g, "%27")}')` : "";
        };
      }
      const rm = tr.querySelector(".remove-row");
      if (rm) {
        rm.onclick = async () => {
          const id = String(tr.dataset.id || "").trim();
          if (id) {
            const ok = await (window.nwConfirm ? window.nwConfirm({
              title: "刪除設施",
              message: "確認是否刪除此設施？",
              okText: "刪除",
              cancelText: "取消",
              danger: true,
            }) : Promise.resolve(confirm("確認是否刪除此設施？")));
            if (!ok) return;
            try {
              await db.collection("communities").doc(communityId).collection("facility_configs").doc(id).delete();
              toast("已刪除");
            } catch {
              toast("刪除失敗");
              return;
            }
          }
          tr.remove();
        };
      }
      return tr;
    };

    setStatus("讀取中...", false);
    modal.hidden = false;
    const list = await loadFacilityConfigs80(communityId);
    if (tbody) {
      tbody.innerHTML = "";
      if (!list.length) tbody.appendChild(createRow(normalizeFacilityConfig80({}, "")));
      else list.forEach((x) => tbody.appendChild(createRow(x)));
    }
    setStatus("", false);

    const onAdd = () => {
      if (!tbody) return;
      const row = createRow(normalizeFacilityConfig80({}, ""));
      tbody.appendChild(row);
      const inp = row.querySelector("input.f-name");
      if (inp && inp.focus) inp.focus();
    };

    const onSubmit = async (e) => {
      e.preventDefault();
      if (!tbody) return;
      if (btnSave) btnSave.disabled = true;
      setStatus("儲存中...", false);
      try {
        const rows = Array.from(tbody.querySelectorAll("tr"));
        const tasks = [];
        for (const tr of rows) {
          const name = String(tr.querySelector(".f-name")?.value || "").trim();
          if (!name) continue;
          const imageDataUrl = String(tr.querySelector(".f-img-data")?.value || "").trim();
          const openTime = String(tr.querySelector(".f-open")?.value || "09:00").trim() || "09:00";
          const closeTime = String(tr.querySelector(".f-close")?.value || "21:00").trim() || "21:00";
          const slotMinutes = Math.max(15, Math.min(240, Number(tr.querySelector(".f-slot")?.value || 60) || 60));
          const capacity = Math.max(1, Math.min(500, Number(tr.querySelector(".f-cap")?.value || 1) || 1));
          const chargeMethod = String(tr.querySelector(".f-charge")?.value || "").trim();
          const advanceBookingDays = Math.max(1, Math.min(365, Number(tr.querySelector(".f-advance")?.value || 30) || 30));
          const requireApproval = Boolean(tr.querySelector(".f-approve")?.checked);
          const enabled = Boolean(tr.querySelector(".f-enabled")?.checked);
          let id = String(tr.dataset.id || "").trim();
          if (!id) {
            id = `f_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
            tr.dataset.id = id;
          }
          tasks.push(db.collection("communities").doc(communityId).collection("facility_configs").doc(id).set({
            name,
            imageDataUrl,
            openTime,
            closeTime,
            slotMinutes,
            capacity,
            chargeMethod,
            advanceBookingDays,
            requireApproval,
            enabled,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true }));
        }
        if (!tasks.length) {
          setStatus("請至少輸入 1 個設施名稱。", true);
          return;
        }
        await Promise.all(tasks);
        setStatus("已儲存。", false);
        toast("已儲存");
        if (typeof onSaved === "function") onSaved();
        modal.hidden = true;
        detach();
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限儲存。" : "儲存失敗，請稍後再試。", true);
      } finally {
        if (btnSave) btnSave.disabled = false;
      }
    };

    if (btnAdd) btnAdd.addEventListener("click", onAdd);
    if (form) form.addEventListener("submit", onSubmit);
    const oldDetach = detach;
    detach = () => {
      try { if (btnAdd) btnAdd.removeEventListener("click", onAdd); } catch {}
      try { if (form) form.removeEventListener("submit", onSubmit); } catch {}
      oldDetach();
    };
  }

  function fileToImageDataUrl80(file) {
    return new Promise((resolve) => {
      if (!file) return resolve("");
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  function ensureFacilityManageModal80() {
    const modal = ensureModal("facilityManageModal80", "modal-facility-manage", "80%");
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="facilityManageModalTitle80">
        <div class="modal-hd">
          <h3 class="modal-title" id="facilityManageModalTitle80">新增設施</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body" style="padding: 0;">
          <div class="status" id="facilityManageStatus80" hidden style="margin: 16px;"></div>
          <div class="units-table-container" style="max-height: 560px; overflow-y: auto;">
            <table class="units-table">
              <thead>
                <tr>
                  <th style="width: 240px;">設施圖片</th>
                  <th style="width: 200px;">設施名稱</th>
                  <th style="width: 180px;">使用時間</th>
                  <th>消費方式</th>
                  <th style="width: 180px;">操作</th>
                </tr>
              </thead>
              <tbody id="facilityManageTbody80"></tbody>
            </table>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn btn-sm" type="button" id="btnAddFacilityRow80">新增</button>
          <button class="btn btn-primary btn-sm" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    return modal;
  }

  async function openFacilityManageModal80({ cid, onSaved }) {
    const communityId = String(cid || "").trim() || "default";
    const modal = ensureFacilityManageModal80();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const st = modal.querySelector("#facilityManageStatus80");
    const tbody = modal.querySelector("#facilityManageTbody80");
    const btnAdd = modal.querySelector("#btnAddFacilityRow80");

    const setStatus = (msg, isError) => {
      if (!st) return;
      const t = String(msg || "").trim();
      st.textContent = t;
      st.hidden = !t;
      st.classList.toggle("error", Boolean(isError));
    };

    let rows = [];

    const rowHtml = (row) => {
      const id = String(row.id || "");
      const isNew = Boolean(row._isNew);
      const editing = Boolean(row._editing);
      const img = String(row.imageDataUrl || "").trim();
      const name = String(row.name || "").trim();
      const usageTime = String(row.usageTime || "").trim();
      const chargeMethod = String(row.chargeMethod || "").trim();
      const imgStyle = img ? `background-image:url('${img.replace(/'/g, "%27")}');` : "";
      return `
        <tr data-id="${escapeHtml(id)}" data-new="${isNew ? "1" : "0"}" data-editing="${editing ? "1" : "0"}">
          <td style="padding: 10px 12px;">
            <div class="facility-img-cell">
              <div class="facility-img-preview" style="${imgStyle}"></div>
              <div style="display:flex; flex-direction:column; gap:8px;">
                <button class="btn btn-sm" type="button" data-action="upload" ${editing ? "" : "disabled"}>上傳</button>
                <input type="file" accept="image/*" data-field="imageFile" hidden />
                <input type="hidden" data-field="imageDataUrl" value="${escapeHtml(img)}" />
              </div>
            </div>
          </td>
          <td><input type="text" data-field="name" value="${escapeHtml(name)}" placeholder="例如 交誼廳" ${editing ? "" : "disabled"} /></td>
          <td><input type="text" data-field="usageTime" value="${escapeHtml(usageTime)}" placeholder="例如 09:00-21:00" ${editing ? "" : "disabled"} /></td>
          <td><input type="text" data-field="chargeMethod" value="${escapeHtml(chargeMethod)}" placeholder="例如 每小時100元/次" ${editing ? "" : "disabled"} /></td>
          <td style="padding: 10px 12px;">
            <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
              <button class="btn btn-sm btn-primary" type="button" data-action="edit">${editing ? "儲存" : "編輯"}</button>
              <button class="btn btn-sm danger" type="button" data-action="delete">刪除</button>
            </div>
          </td>
        </tr>
      `.trim();
    };

    const render = () => {
      if (!tbody) return;
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="status">尚無設施資料。</div></td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(rowHtml).join("");
    };

    const load = async () => {
      setStatus("讀取中...", false);
      rows = await loadFacilityConfigs80(communityId);
      rows = rows.map((r) => ({ ...r, _isNew: false, _editing: false }));
      setStatus("", false);
      render();
    };

    const addRow = () => {
      rows.unshift({
        id: `__new__${Date.now()}`,
        name: "",
        imageDataUrl: "",
        usageTime: "",
        chargeMethod: "",
        slotMinutes: 60,
        openTime: "09:00",
        closeTime: "21:00",
        capacity: 1,
        requireApproval: true,
        enabled: true,
        _isNew: true,
        _editing: true,
      });
      render();
    };

    const getRowEl = (target) => {
      const tr = target && target.closest ? target.closest("tr[data-id]") : null;
      return tr || null;
    };

    const setEditing = (tr, on) => {
      const editing = Boolean(on);
      tr.setAttribute("data-editing", editing ? "1" : "0");
      const inputs = tr.querySelectorAll("input, button[data-action='upload']");
      for (let i = 0; i < inputs.length; i++) {
        const el = inputs[i];
        if (el && el.tagName === "BUTTON") el.disabled = !editing;
        else el.disabled = !editing;
      }
      const editBtn = tr.querySelector("button[data-action='edit']");
      if (editBtn) editBtn.textContent = editing ? "儲存" : "編輯";
    };

    const updateRowImgPreview = (tr, dataUrl) => {
      const preview = tr.querySelector(".facility-img-preview");
      if (preview) {
        preview.style.backgroundImage = dataUrl ? `url('${String(dataUrl).replace(/'/g, "%27")}')` : "";
      }
      const hidden = tr.querySelector("input[data-field='imageDataUrl']");
      if (hidden) hidden.value = String(dataUrl || "");
    };

    const collectRowValues = (tr) => {
      const name = String(tr.querySelector("input[data-field='name']") ? tr.querySelector("input[data-field='name']").value : "").trim();
      const usageTime = String(tr.querySelector("input[data-field='usageTime']") ? tr.querySelector("input[data-field='usageTime']").value : "").trim();
      const chargeMethod = String(tr.querySelector("input[data-field='chargeMethod']") ? tr.querySelector("input[data-field='chargeMethod']").value : "").trim();
      const imageDataUrl = String(tr.querySelector("input[data-field='imageDataUrl']") ? tr.querySelector("input[data-field='imageDataUrl']").value : "").trim();
      return { name, usageTime, chargeMethod, imageDataUrl };
    };

    const saveRow = async (tr) => {
      const isNew = tr.getAttribute("data-new") === "1";
      const rowId = String(tr.getAttribute("data-id") || "").trim();
      const v = collectRowValues(tr);
      if (!v.name) {
        toast("請輸入設施名稱");
        return;
      }
      let id = rowId;
      if (isNew) id = `f_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const payload = {
        name: v.name,
        imageDataUrl: v.imageDataUrl,
        usageTime: v.usageTime,
        chargeMethod: v.chargeMethod,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (isNew) {
        payload.createdAt = FieldValue.serverTimestamp();
        payload.slotMinutes = 60;
        payload.openTime = "09:00";
        payload.closeTime = "21:00";
        payload.capacity = 1;
        payload.requireApproval = true;
        payload.enabled = true;
      }
      setStatus("儲存中...", false);
      try {
        await db.collection("communities").doc(communityId).collection("facility_configs").doc(id).set(payload, { merge: true });
        toast("已儲存");
        if (typeof onSaved === "function") onSaved();
        await load();
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限儲存。" : "儲存失敗，請稍後再試。", true);
      } finally {
        setStatus("", false);
      }
    };

    const deleteRow = async (tr) => {
      const isNew = tr.getAttribute("data-new") === "1";
      const id = String(tr.getAttribute("data-id") || "").trim();
      if (isNew) {
        rows = rows.filter((x) => String(x.id || "") !== id);
        render();
        return;
      }
      const ok = await (window.nwConfirm ? window.nwConfirm({
        title: "刪除設施",
        message: "確認是否刪除此筆資料？",
        okText: "刪除",
        cancelText: "取消",
        danger: true,
      }) : Promise.resolve(confirm("確認是否刪除此筆資料？")));
      if (!ok) return;
      setStatus("刪除中...", false);
      try {
        await db.collection("communities").doc(communityId).collection("facility_configs").doc(id).delete();
        toast("已刪除");
        if (typeof onSaved === "function") onSaved();
        await load();
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限刪除。" : "刪除失敗，請稍後再試。", true);
      } finally {
        setStatus("", false);
      }
    };

    const onTableClick = async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
      if (!btn) return;
      const tr = getRowEl(btn);
      if (!tr) return;
      const action = String(btn.getAttribute("data-action") || "");

      if (action === "upload") {
        const fileInput = tr.querySelector("input[type='file'][data-field='imageFile']");
        if (fileInput) fileInput.click();
        return;
      }
      if (action === "delete") {
        await deleteRow(tr);
        return;
      }
      if (action === "edit") {
        const editing = tr.getAttribute("data-editing") === "1";
        if (!editing) {
          setEditing(tr, true);
          return;
        }
        await saveRow(tr);
        return;
      }
    };

    const onFileChange = async (e) => {
      const input = e.target;
      if (!input || input.type !== "file") return;
      const tr = getRowEl(input);
      if (!tr) return;
      const file = input.files && input.files[0] ? input.files[0] : null;
      input.value = "";
      if (!file) return;
      const dataUrl = await fileToImageDataUrl80(file);
      if (dataUrl) updateRowImgPreview(tr, dataUrl);
    };

    if (btnAdd) btnAdd.addEventListener("click", addRow);
    if (tbody) tbody.addEventListener("click", onTableClick);
    if (tbody) tbody.addEventListener("change", onFileChange);
    const oldDetach = detach;
    detach = () => {
      try { if (btnAdd) btnAdd.removeEventListener("click", addRow); } catch {}
      try { if (tbody) tbody.removeEventListener("click", onTableClick); } catch {}
      try { if (tbody) tbody.removeEventListener("change", onFileChange); } catch {}
      oldDetach();
    };

    modal.hidden = false;
    await load();
  }

  function ensureReservationModal80() {
    const modal = ensureModal("reservationModal80", "modal-reservation", "min(720px, 92vw)");
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="reservationModalTitle80">
        <div class="modal-hd">
          <h3 class="modal-title" id="reservationModalTitle80">新增預約</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="reservationForm80">
          <div class="modal-body">
            <div class="field">
              <label for="r_facility">設施</label>
              <select id="r_facility" required></select>
            </div>
            <div style="display:flex; gap:10px;">
              <div class="field" style="flex:1;">
                <label for="r_date">日期</label>
                <input id="r_date" type="date" required />
              </div>
              <div class="field" style="flex:1;">
                <label for="r_slot">時段</label>
                <select id="r_slot" required></select>
              </div>
            </div>
            <div style="display:flex; gap:10px;">
              <div class="field" style="flex:1;">
                <label for="r_unit">戶號</label>
                <input id="r_unit" type="text" autocomplete="off" placeholder="例如 A1-1" required />
              </div>
              <div class="field" style="flex:1;">
                <label for="r_name">姓名</label>
                <input id="r_name" type="text" autocomplete="off" placeholder="例如 王小明" required />
              </div>
            </div>
            <div class="field">
              <label for="r_note">備註</label>
              <input id="r_note" type="text" autocomplete="off" placeholder="選填" />
            </div>
            <div class="status" id="reservationStatus80" hidden></div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" data-modal-close="1">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSubmitReservation80">建立</button>
          </div>
        </form>
      </div>
    `.trim();
    return modal;
  }

  async function openReservationModal80({ cid, facilities, presetFacilityId, presetDateKey, onSaved }) {
    const communityId = String(cid || "").trim() || "default";
    const list = Array.isArray(facilities) ? facilities : [];
    const modal = ensureReservationModal80();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const form = modal.querySelector("#reservationForm80");
    const st = modal.querySelector("#reservationStatus80");
    const selFacility = modal.querySelector("#r_facility");
    const inputDate = modal.querySelector("#r_date");
    const selSlot = modal.querySelector("#r_slot");
    const inputUnit = modal.querySelector("#r_unit");
    const inputName = modal.querySelector("#r_name");
    const inputNote = modal.querySelector("#r_note");
    const btnSubmit = modal.querySelector("#btnSubmitReservation80");

    const setStatus = (msg, isError) => {
      if (!st) return;
      const t = String(msg || "").trim();
      st.textContent = t;
      st.hidden = !t;
      st.classList.toggle("error", Boolean(isError));
    };

    const fillFacilities = () => {
      if (!selFacility) return;
      selFacility.innerHTML = list.filter((x) => x && x.enabled !== false).map((f) => {
        return `<option value="${escapeHtml(String(f.id || ""))}">${escapeHtml(String(f.name || f.id || ""))}</option>`;
      }).join("");
      const target = String(presetFacilityId || "");
      if (target) selFacility.value = target;
    };

    const fillSlots = () => {
      if (!selFacility || !inputDate || !selSlot) return;
      const fid = String(selFacility.value || "").trim();
      const dateKey = String(inputDate.value || "").trim();
      const cfg = list.find((x) => String(x.id || "") === fid) || null;
      const slots = cfg ? facilitySlotList80(dateKey, cfg) : [];
      selSlot.innerHTML = slots.map((s) => `<option value="${escapeHtml(String(s.startTime || ""))}">${escapeHtml(`${s.startTime} - ${s.endTime}`)}</option>`).join("");
    };

    fillFacilities();
    if (inputDate) inputDate.value = String(presetDateKey || "").trim() || ymd80(new Date());
    fillSlots();
    setStatus("", false);

    const onChange = () => fillSlots();
    if (selFacility) selFacility.addEventListener("change", onChange);
    if (inputDate) inputDate.addEventListener("change", onChange);

    const onSubmit = async (e) => {
      e.preventDefault();
      const fid = selFacility ? String(selFacility.value || "").trim() : "";
      const dateKey = inputDate ? String(inputDate.value || "").trim() : "";
      const startTime = selSlot ? String(selSlot.value || "").trim() : "";
      const unit = inputUnit ? String(inputUnit.value || "").trim() : "";
      const name = inputName ? String(inputName.value || "").trim() : "";
      const note = inputNote ? String(inputNote.value || "").trim() : "";
      const cfg = list.find((x) => String(x.id || "") === fid) || null;
      if (!cfg || !fid) {
        setStatus("請選擇設施。", true);
        return;
      }
      if (!dateKey || !startTime || !unit || !name) {
        setStatus("請完整填寫必填欄位。", true);
        return;
      }
      const slots = facilitySlotList80(dateKey, cfg);
      const s = slots.find((x) => String(x.startTime) === startTime) || null;
      if (!s) {
        setStatus("時段無效。", true);
        return;
      }
      const startAt = makeDateTime80(dateKey, s.startTime);
      const endAt = makeDateTime80(dateKey, s.endTime);
      if (!startAt || !endAt) {
        setStatus("時段日期時間無效。", true);
        return;
      }

      if (btnSubmit) btnSubmit.disabled = true;
      setStatus("建立中...", false);
      try {
        const exist = await loadReservationsByFacilityDate80({ cid: communityId, facilityId: fid, dateKey });
        const used = exist.filter((x) => String(x.startTime || "") === startTime && ["pending", "approved"].includes(String(x.status || "pending"))).length;
        if (used >= Number(cfg.capacity || 1)) {
          setStatus("此時段名額已滿。", true);
          return;
        }

        const u = auth && auth.currentUser ? auth.currentUser : null;
        const createdBy = u ? String(u.uid || "") : "";
        const createdByName = getAdminDisplayName80();
        const status = cfg.requireApproval ? "pending" : "approved";
        const payload = {
          facilityId: fid,
          facilityName: cfg.name,
          dateKey,
          startTime: s.startTime,
          endTime: s.endTime,
          startAt: firebase.firestore.Timestamp.fromDate(startAt),
          endAt: firebase.firestore.Timestamp.fromDate(endAt),
          unit,
          name,
          note,
          status,
          createdBy,
          createdByName,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (status === "approved") {
          payload.approvedAt = FieldValue.serverTimestamp();
          payload.approvedBy = createdBy;
          payload.approvedByName = createdByName;
        }
        await db.collection("communities").doc(communityId).collection("reservations").add(payload);
        toast(status === "pending" ? "已送出待審核" : "已建立預約");
        if (typeof onSaved === "function") onSaved();
        modal.hidden = true;
        detach();
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限建立。" : "建立失敗，請稍後再試。", true);
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
      }
    };

    if (form) form.addEventListener("submit", onSubmit);
    const oldDetach = detach;
    detach = () => {
      try { if (selFacility) selFacility.removeEventListener("change", onChange); } catch {}
      try { if (inputDate) inputDate.removeEventListener("change", onChange); } catch {}
      try { if (form) form.removeEventListener("submit", onSubmit); } catch {}
      oldDetach();
    };

    modal.hidden = false;
  }

  async function updateReservationStatus80({ cid, id, status, extra }) {
    const communityId = String(cid || "").trim() || "default";
    const rid = String(id || "").trim();
    const st = String(status || "").trim();
    if (!rid || !st) return false;
    const u = auth && auth.currentUser ? auth.currentUser : null;
    const by = u ? String(u.uid || "") : "";
    const byName = getAdminDisplayName80();
    const patch = { status: st, updatedAt: FieldValue.serverTimestamp() };
    const e = extra && typeof extra === "object" ? extra : {};
    Object.keys(e).forEach((k) => { patch[k] = e[k]; });
    if (st === "approved") {
      patch.approvedAt = FieldValue.serverTimestamp();
      patch.approvedBy = by;
      patch.approvedByName = byName;
    }
    if (st === "rejected") {
      patch.rejectedAt = FieldValue.serverTimestamp();
      patch.rejectedBy = by;
      patch.rejectedByName = byName;
    }
    if (st === "canceled") {
      patch.canceledAt = FieldValue.serverTimestamp();
      patch.canceledBy = by;
      patch.canceledByName = byName;
    }
    try {
      await db.collection("communities").doc(communityId).collection("reservations").doc(rid).set(patch, { merge: true });
      return true;
    } catch {
      return false;
    }
  }

  async function deleteReservation80({ cid, id }) {
    const communityId = String(cid || "").trim() || "default";
    const rid = String(id || "").trim();
    if (!rid) return false;
    try {
      await db.collection("communities").doc(communityId).collection("reservations").doc(rid).delete();
      return true;
    } catch {
      return false;
    }
  }

  function renderFacilityModule() {
    const cid = resolveActiveCommunityId();
    const communityName = (state.communities.find((c) => c.id === cid) || {}).name || "";
    if (subnavEl) {
      subnavEl.innerHTML = `
        <div id="facilitySubnavButtons80" style="display:flex; gap:0; align-items:center; flex-wrap:nowrap;"></div>
      `.trim();
    }

    contentEl.innerHTML = `
      <section class="card">
        <div class="card-hd">
          <div class="left">
            <div class="chip" aria-hidden="true">${iconSvg("facility")}</div>
            <div style="min-width:0;">
              <h2>設施預約${communityName ? `｜${escapeHtml(communityName)}` : ""}</h2>
              <p>時段控管、名額與審核流程</p>
            </div>
          </div>
          <button class="icon-btn sm" type="button" id="btnFacilityManage80" aria-label="設施設定" title="設施設定">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="1.7"/>
              <path d="M19.2 12a7.2 7.2 0 0 0-.12-1.3l2.05-1.6-2-3.46-2.47 1a7.3 7.3 0 0 0-2.25-1.3L13 2h-4l-.43 3.34a7.3 7.3 0 0 0-2.25 1.3l-2.47-1-2 3.46 2.05 1.6A7.2 7.2 0 0 0 4.8 12c0 .44.04.88.12 1.3l-2.05 1.6 2 3.46 2.47-1a7.3 7.3 0 0 0 2.25 1.3L9 22h4l.43-3.34a7.3 7.3 0 0 0 2.25-1.3l2.47 1 2-3.46-2.05-1.6c.08-.42.12-.86.12-1.3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="card-bd">
          <div class="parcel-filter-bar" id="facilityFilterBar">
            <div class="field">
              <label for="facilitySelect80">設施</label>
              <select id="facilitySelect80"></select>
            </div>
            <div class="field">
              <label for="facilityDate80">日期</label>
              <input id="facilityDate80" type="date" />
            </div>
            <div class="field">
              <label for="facilitySearch80">搜尋</label>
              <input id="facilitySearch80" type="text" autocomplete="off" placeholder="戶號/姓名" />
            </div>
            <button class="btn btn-primary btn-sm" type="button" id="btnFacilityNew80">新增預約</button>
          </div>
          <div class="status" id="facilityStatus80" hidden></div>
          <div class="table-wrap">
            <table class="units-table" id="facilityReservationTable80">
              <thead>
                <tr>
                  <th style="width: 140px;">時段</th>
                  <th style="width: 160px;">戶號</th>
                  <th>姓名</th>
                  <th style="width: 120px;">狀態</th>
                  <th style="width: 160px;">建立</th>
                  <th style="width: 220px;">操作</th>
                </tr>
              </thead>
              <tbody id="facilityReservationTbody80">
                <tr><td colspan="6"><div class="status">讀取中...</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    `;

    const selFacility = document.getElementById("facilitySelect80");
    const inputDate = document.getElementById("facilityDate80");
    const inputSearch = document.getElementById("facilitySearch80");
    const btnManage = document.getElementById("btnFacilityManage80");
    const btnNew = document.getElementById("btnFacilityNew80");
    const subnavButtonsWrap = document.getElementById("facilitySubnavButtons80");
    const statusEl = document.getElementById("facilityStatus80");
    const tbody = document.getElementById("facilityReservationTbody80");

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    let facilities = [];
    let currentReservations = [];
    let pendingReservationsByFacility = {}; // 按设施统计待审核预约
    let totalPendingReservations = 0; // 总待审核数
    let unsubscribePendingListener = null; // 实时监听器取消函数

    // 更新底部导航栏的总数字泡泡
    const updateBottomNavBadge = () => {
      const bottomNav = document.querySelector('.frame-ft nav');
      if (!bottomNav) return;
      
      const facilityLink = bottomNav.querySelector('a[href="#community/facility"]');
      if (!facilityLink) return;
      
      // 移除旧的badge
      const oldBadge = facilityLink.querySelector('.nav-badge');
      if (oldBadge) oldBadge.remove();
      
      // 添加新的badge（如果有数据）
      if (totalPendingReservations > 0) {
        const badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.textContent = String(totalPendingReservations);
        facilityLink.appendChild(badge);
      }
    };

    const fillFacilitySelect = () => {
      if (!selFacility) return;
      const enabled = facilities.filter((f) => f && f.enabled !== false);
      selFacility.innerHTML = enabled.map((f) => `<option value="${escapeHtml(String(f.id || ""))}">${escapeHtml(String(f.name || f.id || ""))}</option>`).join("");
    };

    const renderFacilityButtons = () => {
      if (!subnavButtonsWrap) return;
      const enabled = facilities.filter((f) => f && f.enabled !== false);
      const activeId = selFacility ? String(selFacility.value || "").trim() : "";
      subnavButtonsWrap.innerHTML = enabled.map((f) => {
        const id = String(f.id || "");
        const name = String(f.name || id || "設施");
        const pendingCount = pendingReservationsByFacility[id] || 0;
        const cls = `btn btn-sm ${id === activeId ? "btn-primary" : ""}`;
        return `<button class="${cls}" type="button" data-facility-id="${escapeHtml(id)}" draggable="true">
          ${pendingCount > 0 ? `<span class="badge-inline">${pendingCount}</span>` : ''}
          ${escapeHtml(name)}
        </button>`;
      }).join("");
      
      // 同时更新底部导航
      updateBottomNavBadge();
    };

    const countPendingReservations = () => {
      const stats = {};
      let total = 0;
      currentReservations.forEach(r => {
        if (String(r.status || "pending") === "pending") {
          const fid = String(r.facilityId || "").trim();
          if (fid) {
            stats[fid] = (stats[fid] || 0) + 1;
            total++;
          }
        }
      });
      pendingReservationsByFacility = stats;
      totalPendingReservations = total;
    };

    const renderReservations = () => {
      if (!tbody) return;
      const q = String(inputSearch ? inputSearch.value : "").trim();
      const list = q
        ? currentReservations.filter((r) => {
          const unit = String(r.unit || "");
          const name = String(r.name || "");
          return unit.includes(q) || name.includes(q);
        })
        : currentReservations.slice();

      const fid = selFacility ? String(selFacility.value || "").trim() : "";
      const cfg = facilities.find((f) => String(f.id || "") === fid) || null;
      const cap = cfg ? Number(cfg.capacity || 1) : 1;
      const used = {};
      currentReservations.forEach((r) => {
        const st = String(r.status || "pending");
        if (!["pending", "approved"].includes(st)) return;
        const k = String(r.startTime || "");
        used[k] = (used[k] || 0) + 1;
      });

      if (!facilities.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="status">尚未建立設施，請先到「設施設定」新增。</div></td></tr>`;
        return;
      }
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="status">目前沒有預約資料。</div></td></tr>`;
        return;
      }

      tbody.innerHTML = list.map((r) => {
        const id = String(r.id || "");
        const st = String(r.status || "pending");
        const stText = st === "approved" ? "已核准" : (st === "rejected" ? "已拒絕" : (st === "canceled" ? "已取消" : "待審核"));
        const tagClass = st === "approved" ? "green" : (st === "rejected" ? "red" : (st === "canceled" ? "gray" : "yellow"));
        const createdAt = r.createdAt ? (r.createdAt.toDate ? r.createdAt.toDate() : new Date(r.createdAt)) : null;
        const createdText = createdAt ? `${pad2(createdAt.getMonth() + 1)}/${pad2(createdAt.getDate())} ${pad2(createdAt.getHours())}:${pad2(createdAt.getMinutes())}` : "—";
        const slotUsed = used[String(r.startTime || "")] || 0;
        const capText = cfg ? `${slotUsed}/${cap}` : "";
        const capHint = cfg && slotUsed >= cap && ["pending", "approved"].includes(st) ? `<span class="tag red" style="margin-left:8px;">已滿</span>` : "";

        const actions = st === "pending"
          ? `
              <button class="btn btn-sm btn-primary" type="button" data-action="approve" data-id="${escapeHtml(id)}">核准</button>
              <button class="btn btn-sm danger" type="button" data-action="reject" data-id="${escapeHtml(id)}">拒絕</button>
              <button class="btn btn-sm" type="button" data-action="delete" data-id="${escapeHtml(id)}">刪除</button>
            `
          : `
              ${st === "approved" ? `<button class="btn btn-sm" type="button" data-action="cancel" data-id="${escapeHtml(id)}">取消</button>` : ``}
              <button class="btn btn-sm" type="button" data-action="delete" data-id="${escapeHtml(id)}">刪除</button>
            `;

        return `
          <tr>
            <td style="padding: 10px 12px;">${escapeHtml(`${String(r.startTime || "—")} - ${String(r.endTime || "—")}`)} ${capHint}</td>
            <td style="padding: 10px 12px;">${escapeHtml(String(r.unit || "—"))}</td>
            <td style="padding: 10px 12px;">${escapeHtml(String(r.name || "—"))}</td>
            <td style="padding: 10px 12px;"><span class="tag ${tagClass}">${escapeHtml(stText)}</span>${cfg ? `<span class="muted" style="margin-left:8px;">${escapeHtml(capText)}</span>` : ""}</td>
            <td style="padding: 10px 12px;">${escapeHtml(createdText)}</td>
            <td style="padding: 10px 12px;"><div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">${actions}</div></td>
          </tr>
        `.trim();
      }).join("");
    };

    // 使用 Firestore 实时监听器
    const setupPendingListener = () => {
      // 取消旧的监听器
      if (unsubscribePendingListener) {
        try { unsubscribePendingListener(); } catch {}
      }
      
      try {
        unsubscribePendingListener = db.collection("communities").doc(cid).collection("reservations")
          .where("status", "==", "pending")
          .onSnapshot((snap) => {
            const list = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
            
            // 统计每个设施的待审核数量和总数
            const stats = {};
            let total = 0;
            list.forEach(r => {
              const fid = String(r.facilityId || "").trim();
              if (fid) {
                stats[fid] = (stats[fid] || 0) + 1;
                total++;
              }
            });
            
            pendingReservationsByFacility = stats;
            totalPendingReservations = total;
            
            // 重新渲染按钮和底部导航
            renderFacilityButtons();
          }, () => {
            // 监听器出错时处理
            pendingReservationsByFacility = {};
            totalPendingReservations = 0;
            renderFacilityButtons();
          });
      } catch {
        pendingReservationsByFacility = {};
        totalPendingReservations = 0;
      }
    };

    const refreshReservations = async () => {
      const dateKey = inputDate ? String(inputDate.value || "").trim() : "";
      const fid = selFacility ? String(selFacility.value || "").trim() : "";
      if (!dateKey || !fid) {
        currentReservations = [];
        renderReservations();
        return;
      }
      setStatus("讀取中...", false);
      currentReservations = await loadReservationsByFacilityDate80({ cid, facilityId: fid, dateKey });
      setStatus("", false);
      // 重新渲染表格（数字泡泡由实时监听器处理）
      renderReservations();
    };

    const refreshFacilities = async () => {
      facilities = await loadFacilityConfigs80(cid);
      fillFacilitySelect();
      renderFacilityButtons();
    };

    const init = async () => {
      await refreshFacilities();
      // 设置实时监听器
      setupPendingListener();
      if (inputDate) inputDate.value = ymd80(new Date());
      await refreshReservations();
    };

    const onFilter = () => {
      renderReservations();
    };

    const onDateOrFacility = async () => {
      renderFacilityButtons();
      await refreshReservations();
    };

    const onActionClick = async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button[data-action][data-id]") : null;
      if (!btn) return;
      const id = String(btn.getAttribute("data-id") || "").trim();
      const action = String(btn.getAttribute("data-action") || "").trim();
      if (!id || !action) return;

      if (action === "approve") {
        const ok = await (window.nwConfirm ? window.nwConfirm({
          title: "核准預約",
          message: "是否核准此筆預約？",
          okText: "核准",
          cancelText: "取消",
        }) : Promise.resolve(confirm("是否核准？")));
        if (!ok) return;
        const done = await updateReservationStatus80({ cid, id, status: "approved" });
        if (!done) toast("操作失敗");
        await refreshReservations();
        return;
      }

      if (action === "reject") {
        const ok = await (window.nwConfirm ? window.nwConfirm({
          title: "拒絕預約",
          message: "是否拒絕此筆預約？",
          okText: "拒絕",
          cancelText: "取消",
          danger: true,
        }) : Promise.resolve(confirm("是否拒絕？")));
        if (!ok) return;
        const done = await updateReservationStatus80({ cid, id, status: "rejected" });
        if (!done) toast("操作失敗");
        await refreshReservations();
        return;
      }

      if (action === "cancel") {
        const ok = await (window.nwConfirm ? window.nwConfirm({
          title: "取消預約",
          message: "是否取消此筆預約？",
          okText: "取消預約",
          cancelText: "返回",
          danger: true,
        }) : Promise.resolve(confirm("是否取消？")));
        if (!ok) return;
        const done = await updateReservationStatus80({ cid, id, status: "canceled" });
        if (!done) toast("操作失敗");
        await refreshReservations();
        return;
      }

      if (action === "delete") {
        const ok = await (window.nwConfirm ? window.nwConfirm({
          title: "刪除預約",
          message: "確認是否刪除此筆資料？",
          okText: "刪除",
          cancelText: "取消",
          danger: true,
        }) : Promise.resolve(confirm("確認是否刪除此筆資料？")));
        if (!ok) return;
        const done = await deleteReservation80({ cid, id });
        if (!done) toast("刪除失敗");
        await refreshReservations();
      }
    };

    if (inputSearch) inputSearch.addEventListener("input", onFilter);
    if (inputDate) inputDate.addEventListener("change", onDateOrFacility);
    if (selFacility) selFacility.addEventListener("change", onDateOrFacility);
    if (tbody) tbody.addEventListener("click", onActionClick);
    if (subnavButtonsWrap) {
      let draggingId = "";
      let draggingMoved = false;
      const getEnabledOrderedIdsFromDom = () => {
        return Array.from(subnavButtonsWrap.querySelectorAll("button[data-facility-id]"))
          .map((b) => String(b.getAttribute("data-facility-id") || "").trim())
          .filter(Boolean);
      };
      const syncFacilityOrderFromDom = async () => {
        const enabledIds = getEnabledOrderedIdsFromDom();
        if (!enabledIds.length) return;
        const enabledSet = new Set(enabledIds);
        const rest = facilities.map((f) => String(f && f.id ? f.id : "")).filter(Boolean).filter((id) => !enabledSet.has(id));
        const nextIds = enabledIds.concat(rest);
        const byId = new Map(facilities.map((f) => [String(f && f.id ? f.id : ""), f]));
        facilities = nextIds.map((id) => byId.get(id)).filter(Boolean);
        const keep = selFacility ? String(selFacility.value || "").trim() : "";
        fillFacilitySelect();
        if (selFacility && keep) selFacility.value = keep;
        renderFacilityButtons();
        const ok = await persistFacilityOrder80(cid, nextIds);
        if (!ok) toast("排序儲存失敗");
      };
      subnavButtonsWrap.addEventListener("click", async (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("button[data-facility-id]") : null;
        if (!btn) return;
        if (draggingMoved) return;
        const id = String(btn.getAttribute("data-facility-id") || "").trim();
        if (!id || !selFacility) return;
        selFacility.value = id;
        renderFacilityButtons();
        await refreshReservations();
      });
      subnavButtonsWrap.addEventListener("dragstart", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest("button[data-facility-id]") : null;
        if (!btn) return;
        draggingId = String(btn.getAttribute("data-facility-id") || "").trim();
        draggingMoved = false;
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", draggingId);
        } catch {}
      });
      subnavButtonsWrap.addEventListener("dragover", (e) => {
        if (!draggingId) return;
        const overBtn = e.target && e.target.closest ? e.target.closest("button[data-facility-id]") : null;
        if (!overBtn) return;
        const overId = String(overBtn.getAttribute("data-facility-id") || "").trim();
        if (!overId || overId === draggingId) return;
        e.preventDefault();
        const draggingBtn = subnavButtonsWrap.querySelector(`button[data-facility-id="${CSS.escape(draggingId)}"]`);
        if (!draggingBtn) return;
        const rect = overBtn.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        if (before) subnavButtonsWrap.insertBefore(draggingBtn, overBtn);
        else subnavButtonsWrap.insertBefore(draggingBtn, overBtn.nextSibling);
        draggingMoved = true;
      });
      subnavButtonsWrap.addEventListener("drop", async (e) => {
        if (!draggingId) return;
        e.preventDefault();
        const moved = draggingMoved;
        draggingId = "";
        draggingMoved = false;
        if (moved) await syncFacilityOrderFromDom();
      });
      subnavButtonsWrap.addEventListener("dragend", async () => {
        const moved = draggingMoved;
        draggingId = "";
        draggingMoved = false;
        if (moved) await syncFacilityOrderFromDom();
      });
    }

    if (btnManage) {
      btnManage.addEventListener("click", () => {
        openFacilityConfigModal80({
          cid,
          onSaved: async () => {
            await refreshFacilities();
            await refreshReservations();
          }
        });
      });
    }

    if (btnNew) {
      btnNew.addEventListener("click", () => {
        const fid = selFacility ? String(selFacility.value || "").trim() : "";
        const dateKey = inputDate ? String(inputDate.value || "").trim() : ymd80(new Date());
        openReservationModal80({
          cid,
          facilities,
          presetFacilityId: fid,
          presetDateKey: dateKey,
          onSaved: async () => {
            await refreshReservations();
          },
        });
      });
    }

    if (communityName) {}
    init();
    updateFooterActiveNav();
  }

  function ensureNoticeModal80() {
    const modal = ensureModal("noticeModal80", "modal-notice", "min(520px, 92vw)");
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="noticeModalTitle80">
        <div class="modal-hd">
          <h3 class="modal-title" id="noticeModalTitle80">提示</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="status" id="noticeModalMsg80"></div>
        </div>
        <div class="modal-ft">
          <button class="btn btn-primary" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    return modal;
  }

  function openNotice80(message) {
    const modal = ensureNoticeModal80();
    const detach = bindModalClose(modal, () => detach());
    const msgEl = modal.querySelector("#noticeModalMsg80");
    if (msgEl) msgEl.textContent = String(message || "").trim();
    modal.hidden = false;
  }

  function ensureResidentParcelScanModal80() {
    const modal = ensureModal("residentParcelScanModal80", "modal-resident-parcel-scan", "min(920px, 92vw)");
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="residentParcelScanModalTitle80">
        <div class="modal-hd">
          <h3 class="modal-title" id="residentParcelScanModalTitle80">掃描住戶 QR Code</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="scan-responsive-container">
            <div class="scan-stage">
              <div id="residentParcelScanReader80"></div>
              <div class="scan-overlay">
                <div class="scan-frame"></div>
              </div>
            </div>
            <div class="scan-results-side">
              <div class="field">
                <label for="residentParcelScanInput80">掃碼槍輸入</label>
                <input id="residentParcelScanInput80" type="text" autocomplete="off" placeholder="請掃描住戶 QR code" />
              </div>
              <div class="scan-hint" id="residentParcelScanHint80">可使用相機或掃碼槍掃描住戶 QR code</div>
              <div class="status" id="residentParcelScanStatus80" hidden></div>
              <div id="residentParcelScanResult80" hidden>
                <div class="scan-results-preview" style="margin-top:10px;">
                  <div class="scan-result-item"><span>戶號</span><span id="rpUnit80">—</span></div>
                  <div class="scan-result-item"><span>姓名</span><span id="rpName80">—</span></div>
                </div>
                <div class="scan-hint" style="margin-top:10px;">未領取</div>
                <div class="parcel-grid" id="rpPendingList80"></div>
                <div class="scan-hint" style="margin-top:10px;">已領取</div>
                <div class="parcel-grid" id="rpReceivedList80"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" id="btnResidentParcelRescan80">重新掃描</button>
          <button class="btn btn-primary" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    return modal;
  }

  function normalizeUnitKey80(v) {
    return String(v || "").replace(/\s+/g, "").trim().toUpperCase();
  }

  function unitMatches80(parcelUnit, userUnit) {
    const p = normalizeUnitKey80(parcelUnit);
    const u = normalizeUnitKey80(userUnit);
    if (!p || !u) return false;
    if (p === u) return true;
    return p.startsWith(`${u}-`);
  }

  async function openResidentParcelScanModal80() {
    const modal = ensureResidentParcelScanModal80();
    const statusEl = modal.querySelector("#residentParcelScanStatus80");
    const inputEl = modal.querySelector("#residentParcelScanInput80");
    const resultWrap = modal.querySelector("#residentParcelScanResult80");
    const unitEl = modal.querySelector("#rpUnit80");
    const nameEl = modal.querySelector("#rpName80");
    const pendingEl = modal.querySelector("#rpPendingList80");
    const receivedEl = modal.querySelector("#rpReceivedList80");
    const btnRescan = modal.querySelector("#btnResidentParcelRescan80");

    let scanner = null;
    let busy = false;

    const setStatus = (msg, isError) => {
      const t = String(msg || "").trim();
      if (!statusEl) return;
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const stopScanner = async () => {
      if (!scanner) return;
      try {
        await scanner.stop();
        await scanner.clear();
      } catch {}
      scanner = null;
    };

    let detach = () => {};
    detach = bindModalClose(modal, async () => {
      try {
        if (inputEl && inputEl._rpHandler) {
          inputEl.removeEventListener("keydown", inputEl._rpHandler);
          inputEl._rpHandler = null;
        }
      } catch {}
      try {
        if (btnRescan && btnRescan._rpHandler) {
          btnRescan.removeEventListener("click", btnRescan._rpHandler);
          btnRescan._rpHandler = null;
        }
      } catch {}
      await stopScanner();
      detach();
    });

    const closeNow = async () => {
      try { modal.hidden = true; } catch {}
      try {
        if (inputEl && inputEl._rpHandler) {
          inputEl.removeEventListener("keydown", inputEl._rpHandler);
          inputEl._rpHandler = null;
        }
      } catch {}
      try {
        if (btnRescan && btnRescan._rpHandler) {
          btnRescan.removeEventListener("click", btnRescan._rpHandler);
          btnRescan._rpHandler = null;
        }
      } catch {}
      await stopScanner();
      try { detach(); } catch {}
    };

    const applyScannedToFilters = (unit, name) => {
      const unitInput = document.getElementById("parcelFilterUnit");
      const nameInput = document.getElementById("parcelFilterName");
      if (unitInput) unitInput.value = String(unit || "").trim();
      if (nameInput) nameInput.value = String(name || "").trim();
      const activeBtn = subnavEl ? subnavEl.querySelector("[data-filter].btn-primary") : null;
      const filter = activeBtn ? String(activeBtn.getAttribute("data-filter") || "pending") : "pending";
      renderParcelList(filter, readParcelFilters());
    };

    const renderParcelLine = (p, id) => {
      const company = escapeHtml(p.company || "其他物流");
      const trackNo = escapeHtml(p.trackNo || "—");
      const time = p.createdAt ? (p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : null;
      const timeText = time ? `${pad2(time.getMonth()+1)}/${pad2(time.getDate())} ${pad2(time.getHours())}:${pad2(time.getMinutes())}` : "—";
      return `
        <div class="parcel-card" data-id="${String(id || "")}">
          <div class="parcel-card-hd">
            <div class="parcel-company">${company}</div>
          </div>
          <div class="parcel-card-bd">
            <div class="parcel-info">
              <div class="parcel-track">單號：${trackNo}</div>
              <div class="parcel-time">到貨：${timeText}</div>
            </div>
          </div>
        </div>
      `;
    };

    const clearResult = () => {
      if (unitEl) unitEl.textContent = "—";
      if (nameEl) nameEl.textContent = "—";
      if (pendingEl) pendingEl.innerHTML = "";
      if (receivedEl) receivedEl.innerHTML = "";
      if (resultWrap) resultWrap.hidden = true;
    };

    const processToken = async (rawToken) => {
      if (busy) return;
      const token = String(rawToken || "").trim();
      if (!token) return;
      busy = true;
      setStatus("查詢住戶中...", false);
      clearResult();

      const cid = String(resolveActiveCommunityId() || "").trim() || "default";
      let userDoc = null;
      try {
        const snap = await db.collection("users").where("qrToken", "==", token).limit(1).get();
        userDoc = snap && snap.docs && snap.docs[0] ? snap.docs[0] : null;
      } catch (e) {
        setStatus("查詢失敗，請稍後再試。", true);
        busy = false;
        return;
      }

      if (!userDoc || !userDoc.exists) {
        setStatus("", false);
        await closeNow();
        openNotice80("非本社區住戶");
        busy = false;
        return;
      }

      const udata = userDoc.data() || {};
      const uCommunity = String(udata.community || "").trim();
      if (!uCommunity || uCommunity !== cid) {
        setStatus("", false);
        await closeNow();
        openNotice80("非本社區住戶");
        busy = false;
        return;
      }

      const uUnit = String(udata.houseNo || udata.unit || "").trim();
      const uName = String(udata.displayName || udata.name || "").trim() || inferUserName({ email: udata.email });
      if (unitEl) unitEl.textContent = uUnit || "—";
      if (nameEl) nameEl.textContent = uName || "—";

      setStatus("查詢包裹中...", false);
      let parcelDocs = [];
      try {
        const psnap = await db.collection("communities").doc(cid).collection("parcels").orderBy("createdAt", "desc").limit(200).get();
        parcelDocs = psnap && psnap.docs ? psnap.docs : [];
      } catch (e) {
        setStatus("讀取包裹失敗。", true);
        busy = false;
        return;
      }

      const matched = parcelDocs.map((d) => ({ id: d.id, p: d.data() || {} }))
        .filter((x) => unitMatches80(x.p.unit || x.p.houseNo || "", uUnit) || String(x.p.recipient || "").trim() === uName);

      const pending = matched.filter((x) => String(x.p.status || "pending") !== "received");
      const received = matched.filter((x) => String(x.p.status || "") === "received");

      if (!pending.length && !received.length) {
        setStatus("", false);
        await closeNow();
        openNotice80("目前無包裹");
        busy = false;
        return;
      }

      applyScannedToFilters(uUnit, uName);
      await closeNow();
      busy = false;
    };

    const startScanner = async () => {
      await stopScanner();
      setStatus("啟動相機中...", false);
      clearResult();
      try {
        scanner = new Html5Qrcode("residentParcelScanReader80");
      } catch {
        scanner = null;
      }
      if (!scanner) {
        setStatus("無法啟動相機，請改用掃碼槍輸入。", true);
        return;
      }
      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 20,
            qrbox: (w, h) => {
              const size = Math.min(w, h) * 0.8;
              return { width: size, height: size };
            },
            aspectRatio: 1.0,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
          },
          (decodedText) => {
            const t = String(decodedText || "").trim();
            if (!t) return;
            stopScanner().finally(() => processToken(t));
          },
          () => {}
        );
        setStatus("", false);
      } catch (e) {
        setStatus("相機啟動失敗，請確認已允許相機權限。", true);
      }
    };

    if (inputEl) {
      inputEl.value = "";
      inputEl._rpHandler = (e) => {
        if (!e || e.key !== "Enter") return;
        try { e.preventDefault(); } catch {}
        const v = String(inputEl.value || "").trim();
        inputEl.value = "";
        processToken(v);
      };
      inputEl.addEventListener("keydown", inputEl._rpHandler);
    }

    if (btnRescan) {
      btnRescan._rpHandler = () => startScanner();
      btnRescan.addEventListener("click", btnRescan._rpHandler);
    }

    modal.hidden = false;
    requestAnimationFrame(() => {
      try { if (inputEl && inputEl.focus) inputEl.focus(); } catch {}
    });
    startScanner();
  }

  let _unsubParcels = null;
  function renderParcelList(filter = "all", filters = {}) {
    const cid = resolveActiveCommunityId();
    const listEl = document.getElementById("parcelList");
    if (!listEl) return;

    if (_unsubParcels) {
      _unsubParcels();
      _unsubParcels = null;
    }

    // 為了避免複合索引報錯，改為讀取後在前端過濾
    let query = db.collection("communities").doc(cid).collection("parcels").orderBy("createdAt", "desc").limit(200);
    
    _unsubParcels = query.onSnapshot((snap) => {
      if (snap.empty) {
        listEl.innerHTML = `<div class="status">目前沒有包裹紀錄。</div>`;
        return;
      }

      let docs = snap.docs;
      if (filter !== "all") {
        docs = docs.filter(doc => doc.data().status === filter);
      }

      const f = filters && typeof filters === "object" ? filters : {};
      const fDate = String(f.date || "").trim();
      const fUnit = String(f.unit || "").trim().toLowerCase();
      const fName = String(f.name || "").trim().toLowerCase();
      if (fDate || fUnit || fName) {
        docs = docs.filter((doc) => {
          const p = doc.data() || {};
          const unit = String(p.unit || p.houseNo || "").trim().toLowerCase();
          const name = String(p.recipient || p.name || "").trim().toLowerCase();
          const dt = p.createdAt ? (p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : null;
          const ymd = dt ? `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}` : "";
          if (fDate && ymd !== fDate) return false;
          if (fUnit && !unit.includes(fUnit)) return false;
          if (fName && !name.includes(fName)) return false;
          return true;
        });
      }

      if (docs.length === 0) {
        listEl.innerHTML = `<div class="status">沒有符合條件的包裹。</div>`;
        return;
      }

      listEl.innerHTML = `
        <div class="parcel-grid">
          ${docs.map(doc => {
            const p = doc.data();
            const id = doc.id;
            const statusLabel = p.status === "received" ? "已領取" : "待領取";
            const statusClass = p.status === "received" ? "tag green" : "tag yellow";
            const time = p.createdAt ? (p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : null;
            const timeText = time ? `${pad2(time.getMonth()+1)}/${pad2(time.getDate())} ${pad2(time.getHours())}:${pad2(time.getMinutes())}` : "—";
            const rtime = p.receivedAt ? (p.receivedAt.toDate ? p.receivedAt.toDate() : new Date(p.receivedAt)) : null;
            const rtimeText = rtime ? `${pad2(rtime.getMonth()+1)}/${pad2(rtime.getDate())} ${pad2(rtime.getHours())}:${pad2(rtime.getMinutes())}` : "";
            const receivedLine = (p.status === "received" && rtimeText) ? `<div class="parcel-received">領取：${rtimeText}</div>` : "";
            const handlerAccountRaw = String(p.receivedByAccount || "").trim();
            const handlerNameRaw = String(p.receivedByDisplayName || p.receivedByName || "").trim();
            const handlerAccount = handlerAccountRaw || "";
            const handlerName = handlerNameRaw || handlerAccount;
            const handlerText =
              handlerAccount && handlerName && handlerAccount !== handlerName ? `${handlerAccount}<${handlerName}>` :
              handlerName || handlerAccount;
            const handlerLine = (p.status === "received" && handlerText) ? `<div class="parcel-handler">處理：${escapeHtml(handlerText)}</div>` : "";
            
            return `
              <div class="parcel-card" data-id="${id}">
                <div class="parcel-card-hd">
                  <div class="parcel-company">${escapeHtml(p.company || "其他物流")}</div>
                  <div class="${statusClass}">${statusLabel}</div>
                </div>
                <div class="parcel-card-bd">
                  <div class="parcel-info">
                    <div class="parcel-recipient"><strong>${escapeHtml(p.unit || "—")}</strong> ${escapeHtml(p.recipient || "—")}</div>
                    <div class="parcel-track">單號：${escapeHtml(p.trackNo || "—")}</div>
                    <div class="parcel-type">類型：${escapeHtml(p.type || "一般包裹")}</div>
                    <div class="parcel-time">到貨：${timeText}</div>
                    ${receivedLine}
                    ${handlerLine}
                  </div>
                  <div class="parcel-actions">
                    ${p.status === "pending" ? `
                      <button class="icon-btn primary sm" type="button" data-receive="${id}" aria-label="簽收" title="簽收">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </button>
                    ` : ""}
                    ${p.status === "received" ? `
                      <button class="icon-btn danger sm" type="button" data-delete="${id}" aria-label="刪除" title="刪除">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                          <path d="M10 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                          <path d="M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                          <path d="M6 7l1 14h10l1-14" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                          <path d="M9 7V4h6v3" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                      </button>
                    ` : `
                      <button class="icon-btn sm" type="button" data-detail="${id}" aria-label="詳情" title="詳情">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M12 8.6h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
                          <path d="M11 11.2h1v6.2h-1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                          <path d="M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19Z" stroke="currentColor" stroke-width="2"/>
                        </svg>
                      </button>
                    `}
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;

      listEl.querySelectorAll("[data-receive]").forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-receive");
          receiveParcel(id);
        };
      });

      listEl.querySelectorAll("[data-detail]").forEach(btn => {
        btn.onclick = () => {
          const id = btn.getAttribute("data-detail");
          const p = snap.docs.find(d => d.id === id).data();
          const readOnly = String((p && p.status) || "") === "received";
          openParcelModal80({ cid, parcelId: id, parcelData: p, isEdit: !readOnly });
        };
      });

      listEl.querySelectorAll("[data-delete]").forEach(btn => {
        btn.onclick = async (e) => {
          try { e.stopPropagation(); } catch {}
          const id = String(btn.getAttribute("data-delete") || "").trim();
          if (!id) return;
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "刪除包裹",
            message: "確認是否刪除此筆資料？",
            okText: "刪除",
            cancelText: "取消"
          }) : Promise.resolve(confirm("確認是否刪除此筆資料？")));
          if (!ok) return;
          try {
            await db.collection("communities").doc(cid).collection("parcels").doc(id).delete();
            toast("已刪除");
          } catch (err) {
            toast("刪除失敗：" + (err && err.message ? err.message : "未知錯誤"));
          }
        };
      });
    }, (err) => {
      listEl.innerHTML = `<div class="status error">讀取失敗：${err.message}</div>`;
    });
  }

  async function receiveParcel(id) {
    const cid = resolveActiveCommunityId();
    const ok = await (window.nwConfirm ? window.nwConfirm({
      title: "包裹簽收",
      message: "確認住戶已領取此包裹？",
      okText: "確認簽收",
      cancelText: "取消"
    }) : Promise.resolve(confirm("確認簽收？")));

    if (ok) {
      try {
        const receivedByUid = String((auth.currentUser && auth.currentUser.uid) || "");
        const receivedByAccount = inferUserAccount80(auth.currentUser);
        let receivedByDisplayName = "";
        if (receivedByUid) {
          try {
            const udoc = await db.collection("users").doc(receivedByUid).get();
            const udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
            receivedByDisplayName = String(udata.displayName || udata.name || "").trim();
          } catch {}
        }
        if (!receivedByDisplayName) {
          try {
            const domName = String(document.getElementById("profileNameText")?.textContent || "").trim();
            if (domName && domName !== "—") receivedByDisplayName = domName;
          } catch {}
        }
        if (!receivedByDisplayName) receivedByDisplayName = String((auth.currentUser && auth.currentUser.displayName) || "").trim();
        if (!receivedByDisplayName) receivedByDisplayName = receivedByAccount;
        const receivedByName = receivedByDisplayName;
        await db.collection("communities").doc(cid).collection("parcels").doc(id).update({
          status: "received",
          receivedAt: FieldValue.serverTimestamp(),
          receivedBy: receivedByUid,
          receivedByAccount,
          receivedByName,
          receivedByDisplayName,
          updatedAt: FieldValue.serverTimestamp()
        });
        toast("已完成簽收");
      } catch (err) {
        toast("操作失敗：" + err.message);
      }
    }
  }

  function ensureParcelModal() {
    let modal = document.getElementById("parcelModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "parcelModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="parcelModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="parcelModalTitle">登記包裹</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="parcelModalForm">
          <div class="modal-body">
            <div style="display: flex; gap: 10px; margin-bottom: 16px;">
              <button class="btn btn-primary" type="button" id="btnScanParcel" style="flex: 1;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                掃描辨識
              </button>
            </div>
            <div class="field">
              <label for="p_type">類型</label>
              <select id="p_type">
                <option value="一般包裹">一般包裹</option>
                <option value="常溫包裹">常溫包裹</option>
                <option value="冷藏包裹">冷藏包裹</option>
                <option value="冷凍包裹">冷凍包裹</option>
                <option value="掛號信件">掛號信件</option>
                <option value="託收">託收</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div class="field">
              <label for="p_company">物流公司</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input id="p_company" type="text" placeholder="例：黑貓宅急便" required list="p_company_list" style="flex:1;" />
                <datalist id="p_company_list"></datalist>
              </div>
            </div>
            <div class="field">
              <label for="p_trackNo">物流單號</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input id="p_trackNo" type="text" placeholder="請輸入或掃描單號" required style="flex:1;" />
                <button type="button" id="btnQuickScan" class="icon-btn" style="width:44px;height:44px;border-radius:10px;border:1px solid var(--border);background:#fff;" title="掃描條碼">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><path d="M4 4h2v16H4zM8 4h2v16H8zM12 4h1v16h-1zM16 4h2v16h-2zM20 4h1v16h-1zM4 20h16"></path></svg>
                </button>
              </div>
            </div>
            <div class="field">
              <label for="p_unit">收件戶號</label>
              <div style="display:flex; align-items:center; gap:8px;">
                <input id="p_unit" type="text" placeholder="例：A-1203" required list="p_unit_list" style="flex:1;" />
                <datalist id="p_unit_list"></datalist>
              </div>
            </div>
            <div class="field">
              <label for="p_recipient">收件人姓名</label>
              <input id="p_recipient" type="text" placeholder="例：林小姐" required />
            </div>
            <div class="field">
              <label for="p_address">收件地址 (選填)</label>
              <input id="p_address" type="text" placeholder="物流單上的完整地址" />
            </div>
            <div class="field">
              <label for="p_note">備註</label>
              <input id="p_note" type="text" placeholder="例：冷藏、易碎品" />
            </div>
            <div class="status" id="parcelModalStatus" hidden></div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" id="btnDeleteParcel" hidden>刪除</button>
            <button class="btn" type="button" data-modal-close="1">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSubmitParcel">儲存</button>
          </div>
        </form>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function openParcelModal80({ cid, parcelId, parcelData, isEdit }) {
    const modal = ensureParcelModal();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const form = modal.querySelector("#parcelModalForm");
    const titleEl = modal.querySelector("#parcelModalTitle");
    const statusEl = modal.querySelector("#parcelModalStatus");
    const btnSubmit = modal.querySelector("#btnSubmitParcel");
    const btnScan = modal.querySelector("#btnScanParcel");
    const btnQuickScan = modal.querySelector("#btnQuickScan");
    const btnDelete = modal.querySelector("#btnDeleteParcel");

    const inputCompany = modal.querySelector("#p_company");
    const inputTrackNo = modal.querySelector("#p_trackNo");
    const inputUnit = modal.querySelector("#p_unit");
    const inputRecipient = modal.querySelector("#p_recipient");
    const inputAddress = modal.querySelector("#p_address");
    const inputNote = modal.querySelector("#p_note");
    const inputType = modal.querySelector("#p_type");
    const listCompany = modal.querySelector("#p_company_list");
    const listUnit = modal.querySelector("#p_unit_list");

    const readOnly = Boolean(!isEdit && parcelId);
    if (titleEl) titleEl.textContent = readOnly ? "包裹資訊" : (isEdit ? "編輯包裹" : "登記包裹");
    if (btnSubmit) btnSubmit.textContent = isEdit ? "更新" : "登記";
    if (statusEl) { statusEl.hidden = true; statusEl.textContent = ""; }
    if (btnDelete) btnDelete.hidden = !parcelId;
    if (btnSubmit) btnSubmit.hidden = readOnly;
    if (btnScan) btnScan.hidden = readOnly;
    if (btnQuickScan) btnQuickScan.hidden = readOnly;

    const setFormDisabled = (disabled) => {
      const on = Boolean(disabled);
      modal.querySelectorAll("input, select, textarea").forEach((el) => {
        if (!el) return;
        el.disabled = on;
      });
    };
    setFormDisabled(readOnly);

    if (isEdit && parcelData) {
      inputCompany.value = parcelData.company || "";
      inputTrackNo.value = parcelData.trackNo || "";
      inputUnit.value = parcelData.unit || "";
      inputRecipient.value = parcelData.recipient || "";
      inputAddress.value = parcelData.address || "";
      inputNote.value = parcelData.note || "";
      if (inputType) inputType.value = parcelData.type || "一般包裹";
    } else {
      form.reset();
      if (inputType) inputType.value = "一般包裹";
    }

    // 載入物流清單到 datalist
    const unsubCouriers = db.collection("communities").doc(cid).collection("settings").doc("parcel_config")
      .onSnapshot(doc => {
        let couriers = doc.exists ? (doc.data().couriers || []) : [];
        listCompany.innerHTML = couriers.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
      });

    // 載入戶號清單
    const unsubUnits = db.collection("communities").doc(cid)
      .onSnapshot(doc => {
        const data = doc.data() || {};
        const units = Array.isArray(data.units) ? data.units.map(u => (typeof u === "object" && u !== null) ? u.id || "" : u || "").filter(Boolean) : [];
        listUnit.innerHTML = units.map(u => `<option value="${escapeHtml(u)}"></option>`).join("");
      });

    // 建立姓名與戶號的對應關係
    let residentMap = {};
    const unsubResidents = db.collection("communities").doc(cid).collection("residents")
      .onSnapshot(snap => {
        residentMap = {};
        snap.forEach(doc => {
          const data = doc.data() || {};
          const name = data.displayName || data.name || "";
          const unit = data.unit || "";
          if (name && unit) {
            if (!residentMap[name]) {
              residentMap[name] = [];
            }
            if (!residentMap[name].includes(unit)) {
              residentMap[name].push(unit);
            }
          }
        });
      });

    // 姓名輸入後自動帶入戶號
    if (inputRecipient) {
      inputRecipient.oninput = () => {
        const name = inputRecipient.value.trim();
        if (name && residentMap[name]) {
          if (residentMap[name].length === 1) {
            inputUnit.value = residentMap[name][0];
          }
        }
      };
    }

    // 快速掃描按鈕
    if (btnQuickScan) {
      btnQuickScan.onclick = () => {
        openParcelScanModal80({
          onDetected: (data) => {
            if (data.company) inputCompany.value = data.company;
            if (data.trackNo) inputTrackNo.value = data.trackNo;
            if (data.recipient) inputRecipient.value = data.recipient;
            if (data.address) inputAddress.value = data.address;
            toast("辨識完成");
          }
        });
      };
    }

    if (btnScan) {
      btnScan.onclick = () => {
        openParcelScanModal80({
          onDetected: (data) => {
            if (data.company) inputCompany.value = data.company;
            if (data.trackNo) inputTrackNo.value = data.trackNo;
            if (data.recipient) inputRecipient.value = data.recipient;
            if (data.address) inputAddress.value = data.address;
            toast("辨識完成");
          }
        });
      };
    }

    const oldDetach = detach;
    detach = () => {
      unsubCouriers();
      unsubUnits();
      unsubResidents();
      oldDetach();
    };

    if (btnDelete) {
      btnDelete.onclick = async () => {
        if (!isEdit || !parcelId) return;
        const ok = await (window.nwConfirm ? window.nwConfirm({
          title: "刪除包裹",
          message: "確認是否刪除此筆資料？",
          okText: "刪除",
          cancelText: "取消"
        }) : Promise.resolve(confirm("確認是否刪除此筆資料？")));
        if (!ok) return;
        try {
          await db.collection("communities").doc(cid).collection("parcels").doc(parcelId).delete();
          toast("已刪除");
          modal.hidden = true;
          detach();
        } catch (err) {
          toast("刪除失敗：" + (err && err.message ? err.message : "未知錯誤"));
        }
      };
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      if (readOnly) return;
      const payload = {
        company: inputCompany.value.trim(),
        trackNo: inputTrackNo.value.trim(),
        unit: inputUnit.value.trim(),
        recipient: inputRecipient.value.trim(),
        address: inputAddress.value.trim(),
        note: inputNote.value.trim(),
        type: inputType ? String(inputType.value || "一般包裹").trim() : "一般包裹",
        updatedAt: FieldValue.serverTimestamp()
      };

      if (!isEdit) {
        payload.status = "pending";
        payload.createdAt = FieldValue.serverTimestamp();
      }

      if (btnSubmit) btnSubmit.disabled = true;
      try {
        const ref = isEdit 
          ? db.collection("communities").doc(cid).collection("parcels").doc(parcelId)
          : db.collection("communities").doc(cid).collection("parcels").doc();
        
        await ref.set(payload, { merge: true });
        toast(isEdit ? "更新成功" : "登記成功");
        modal.hidden = true;
        detach();
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = "儲存失敗：" + err.message;
          statusEl.hidden = false;
          statusEl.classList.add("error");
        }
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
      }
    };

    modal.hidden = false;
  }

  function ensureParcelScanModal() {
    let modal = document.getElementById("parcelScanModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "parcelScanModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="parcelScanModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="parcelScanModalTitle">掃描包裹單</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="scan-responsive-container">
            <div class="scan-stage">
              <div id="parcelScanReader"></div>
              <div class="scan-overlay">
                <div class="scan-frame"></div>
              </div>
            </div>
            <div class="scan-results-side">
              <div class="scan-hint" id="parcelScanHint">請對準物流單上的條碼或收件資訊</div>
              <div class="scan-results-preview" id="parcelScanPreview" hidden>
                <div class="scan-result-item"><span>物流公司</span><span id="scanResCompany">—</span></div>
                <div class="scan-result-item"><span>物流單號</span><span id="scanResTrackNo">—</span></div>
                <div class="scan-result-item"><span>收件人</span><span id="scanResRecipient">—</span></div>
                <div class="scan-result-item"><span>收件地址</span><span id="scanResAddress">—</span></div>
              </div>
              <div class="status" id="parcelScanStatus" hidden></div>
            </div>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" id="btnCaptureOCR">捕捉並辨識文字</button>
          <button class="btn btn-primary" type="button" id="btnConfirmScan" disabled>確認套用</button>
        </div>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function openParcelScanModal80({ onDetected }) {
    const modal = ensureParcelScanModal();
    const statusEl = modal.querySelector("#parcelScanStatus");
    const previewEl = modal.querySelector("#parcelScanPreview");
    const btnCapture = modal.querySelector("#btnCaptureOCR");
    const btnConfirm = modal.querySelector("#btnConfirmScan");
    
    const resCompany = modal.querySelector("#scanResCompany");
    const resTrackNo = modal.querySelector("#scanResTrackNo");
    const resRecipient = modal.querySelector("#scanResRecipient");
    const resAddress = modal.querySelector("#scanResAddress");

    let scanner = null;
    let detectedData = { company: "", trackNo: "", recipient: "", address: "" };

    const setStatus = (msg, isError) => {
      statusEl.textContent = msg;
      statusEl.hidden = !msg;
      statusEl.classList.toggle("error", isError);
    };

    const updatePreview = () => {
      resCompany.textContent = detectedData.company || "—";
      resTrackNo.textContent = detectedData.trackNo || "—";
      resRecipient.textContent = detectedData.recipient || "—";
      resAddress.textContent = detectedData.address || "—";
      previewEl.hidden = false;
      btnConfirm.disabled = !(detectedData.company || detectedData.trackNo || detectedData.recipient);
    };

    const stopScanner = async () => {
      if (scanner) {
        try {
          await scanner.stop();
          await scanner.clear();
        } catch {}
        scanner = null;
      }
    };

    let detach = () => {};
    detach = bindModalClose(modal, async () => {
      await stopScanner();
      detach();
    });

    const onScanSuccess = (decodedText) => {
      if (decodedText && decodedText !== detectedData.trackNo) {
        detectedData.trackNo = decodedText;
        toast("偵測到單號：" + decodedText);
        updatePreview();
      }
    };

    const startScanner = async () => {
      detectedData = { company: "", trackNo: "", recipient: "", address: "" };
      updatePreview();
      setStatus("啟動相機中...", false);
      
      scanner = new Html5Qrcode("parcelScanReader");
      
      // 使用高解析度配置與 1:1 比例
      const config = { 
        fps: 20, 
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const size = Math.min(viewfinderWidth, viewfinderHeight) * 0.8;
          return { width: size, height: size };
        },
        aspectRatio: 1.0,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      };

      try {
        // 請求後置鏡頭並指定高解析度
        await scanner.start(
          { facingMode: "environment" }, 
          {
            ...config,
            videoConstraints: {
              facingMode: "environment",
              width: { ideal: 1920 },
              height: { ideal: 1920 },
              aspectRatio: { exact: 1.0 }
            }
          }, 
          onScanSuccess
        );
        setStatus("", false);
      } catch (err) {
        console.error("Camera start error:", err);
        let msg = "相機啟動失敗：";
        if (err.name === "NotAllowedError" || String(err).includes("Permission denied")) {
          msg += "請在瀏覽器設定中「允許」此網站使用相機，並重新開啟。";
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          msg += "找不到相機設備。";
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          msg += "相機可能被其他程式佔用。";
        } else if (!window.isSecureContext) {
          msg += "相機功能僅能在安全連線 (HTTPS 或 localhost) 下運作。";
        } else {
          msg += err.message || err;
        }
        setStatus(msg, true);
      }
    };

    btnCapture.onclick = async () => {
      if (!scanner) return;
      
      btnCapture.disabled = true;
      btnCapture.textContent = "辨識中...";
      setStatus("正在進行高對比辨識，請保持穩定...", false);

      try {
        const video = document.querySelector("#parcelScanReader video");
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        // 捕捉高解析度畫面
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        
        // 簡易影像預處理：提升對比度與灰階以利 OCR
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          // 提升對比：低於 128 變黑，高於 128 變白 (門檻值可調)
          const val = avg < 120 ? 0 : 255;
          data[i] = data[i + 1] = data[i + 2] = val;
        }
        ctx.putImageData(imageData, 0, 0);
        
        // 取得自定義物流清單
        const cid = resolveActiveCommunityId();
        const configDoc = await db.collection("communities").doc(cid).collection("settings").doc("parcel_config").get();
        const customCouriers = configDoc.exists ? (configDoc.data().couriers || []) : [];
        
        // 使用 Tesseract 進行 OCR
        const result = await Tesseract.recognize(canvas, "chi_tra+eng", {
          logger: m => console.log(m)
        });
        
        const text = result.data.text;
        console.log("OCR Result:", text);

        // 簡易解析邏輯
        const baseCompanies = ["黑貓", "宅急便", "宅配通", "新竹物流", "嘉里大榮", "郵政", "順豐", "SF", "FedEx", "DHL", "全家", "7-11", "萊爾富", "OK", "蝦皮"];
        const allCompanies = [...new Set([...baseCompanies, ...customCouriers])];
        
        for (const c of allCompanies) {
          if (text.includes(c)) {
            if (c === "SF") detectedData.company = "順豐速運";
            else if (c.includes("黑貓")) detectedData.company = "黑貓宅急便";
            else if (c === "7-11") detectedData.company = "統一超商";
            else detectedData.company = c;
            break;
          }
        }

        const nameMatch = text.match(/(?:收件人|收人|收)\s*[:：]?\s*([\u4e00-\u9fa5]{2,4})/);
        if (nameMatch) detectedData.recipient = nameMatch[1];

        const addrMatch = text.match(/[\u4e00-\u9fa5]{2,3}(?:市|縣)[\u4e00-\u9fa5]{2,3}(?:區|市|鎮|鄉).+?[0-9]+號/);
        if (addrMatch) detectedData.address = addrMatch[0];

        if (!detectedData.trackNo) {
          const trackMatch = text.match(/[0-9A-Z]{10,20}/);
          if (trackMatch) detectedData.trackNo = trackMatch[0];
        }

        updatePreview();
        setStatus("文字辨識完成", false);
      } catch (err) {
        console.error("OCR Error:", err);
        setStatus("辨識出錯：" + err.message, true);
      } finally {
        btnCapture.disabled = false;
        btnCapture.textContent = "捕捉並辨識文字";
      }
    };

    btnConfirm.onclick = () => {
      if (typeof onDetected === "function") onDetected(detectedData);
      modal.hidden = true;
      stopScanner();
    };

    modal.hidden = false;
    startScanner();
  }

  function ensureCourierConfigModal() {
    let modal = document.getElementById("courierConfigModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "courierConfigModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="courierConfigTitle" style="width: min(800px, 80vw); max-height: 80vh;">
        <div class="modal-hd">
          <h3 class="modal-title" id="courierConfigTitle">物流公司設定</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="courier-add-box" style="display: flex; gap: 10px; margin-bottom: 20px; background: var(--panel-2); padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
            <input type="text" id="newCourierName" placeholder="新增物流名稱 (如: 順豐速運)" style="flex: 1; height: 44px; border-radius: 10px; border: 1px solid var(--border); padding: 0 12px;" />
            <button class="btn btn-primary" id="btnAddCourier">新增</button>
          </div>
          <div class="status" id="courierConfigStatus" hidden></div>
          <div class="courier-list" id="courierList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
            <!-- 物流清單 -->
          </div>
          <div style="margin-top: 24px;">
            <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">預設物流 (點擊可快速加入)：</p>
            <div id="defaultCouriers" style="display: flex; flex-wrap: wrap; gap: 8px;"></div>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  async function openCourierConfigModal80({ cid }) {
    const modal = ensureCourierConfigModal();
    let detach = () => {};
    detach = bindModalClose(modal, () => detach());

    const listEl = modal.querySelector("#courierList");
    const statusEl = modal.querySelector("#courierConfigStatus");
    const newCourierInput = modal.querySelector("#newCourierName");
    const btnAdd = modal.querySelector("#btnAddCourier");
    const defaultBox = modal.querySelector("#defaultCouriers");

    const defaultList = [
      "黑貓宅急便", "新竹物流", "宅配通", "嘉里大榮", "中華郵政", 
      "順豐速運", "FedEx", "DHL", "UPS",
      "全家便利商店", "統一超商 (7-11)", "萊爾富", "OK超商", "蝦皮店到店",
      "圓通速遞", "中通快遞", "申通快遞", "韻達快遞"
    ];

    const setStatus = (msg, isError) => {
      statusEl.textContent = msg;
      statusEl.hidden = !msg;
      statusEl.classList.toggle("error", isError);
    };

    const renderDefaultCouriers = (currentCouriers) => {
      const remaining = defaultList.filter(d => !currentCouriers.includes(d));
      defaultBox.innerHTML = remaining.map(name => 
        `<button class="tag" style="cursor:pointer; border-style: dashed;" data-add-default="${name}">+ ${name}</button>`
      ).join("");
      
      defaultBox.querySelectorAll("[data-add-default]").forEach(btn => {
        btn.onclick = () => {
          const name = btn.getAttribute("data-add-default");
          saveCourier(name, true);
        };
      });
    };

    const saveCourier = async (name, isAdd) => {
      if (!name) return;
      setStatus("儲存中...", false);
      try {
        const docRef = db.collection("communities").doc(cid).collection("settings").doc("parcel_config");
        const doc = await docRef.get();
        let couriers = doc.exists ? (doc.data().couriers || []) : [];
        
        if (isAdd) {
          if (!couriers.includes(name)) couriers.push(name);
        } else {
          couriers = couriers.filter(c => c !== name);
        }
        
        await docRef.set({ couriers, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        newCourierInput.value = "";
        setStatus("", false);
        toast(isAdd ? "已新增" : "已刪除");
      } catch (err) {
        setStatus("操作失敗：" + err.message, true);
      }
    };

    btnAdd.onclick = () => {
      const name = newCourierInput.value.trim();
      if (!name) return toast("請輸入名稱");
      saveCourier(name, true);
    };

    // 監聽物流清單
    const unsub = db.collection("communities").doc(cid).collection("settings").doc("parcel_config")
      .onSnapshot(async doc => {
        let couriers = doc.exists ? (doc.data().couriers || []) : [];
        
        // 若完全沒有資料，則自動初始化預設清單
        if (!doc.exists || couriers.length === 0) {
          couriers = [...defaultList];
          try {
            await db.collection("communities").doc(cid).collection("settings").doc("parcel_config")
              .set({ couriers, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            toast("已自動載入預設物流清單");
          } catch (err) {
            console.error("Initialize couriers error:", err);
          }
        }

        renderDefaultCouriers(couriers);
        
        listEl.innerHTML = couriers.map(name => `
          <div class="courier-item" style="display: flex; justify-content: space-between; align-items: center; background: #fff; border: 1px solid var(--border); padding: 10px 12px; border-radius: 10px;">
            <span style="font-weight: 700; font-size: 14px;">${escapeHtml(name)}</span>
            <button class="icon-btn danger" style="width: 28px; height: 28px;" data-del-courier="${name}">×</button>
          </div>
        `).join("");
        
        listEl.querySelectorAll("[data-del-courier]").forEach(btn => {
          btn.onclick = () => {
            const name = btn.getAttribute("data-del-courier");
            saveCourier(name, false);
          };
        });
      });

    const oldDetach = detach;
    detach = () => { unsub(); oldDetach(); };

    modal.hidden = false;
  }

  function renderResidentsModule() {
    stopResidentsSubscription();
    if (subnavEl) subnavEl.innerHTML = "";
    if (!Array.isArray(state.communities) || state.communities.length === 0) {
      contentEl.innerHTML = `
        <section class="card residents-page">
          <div class="card-hd">
            <div class="left">
              <div class="chip" aria-hidden="true">${iconSvg("residents")}</div>
              <div style="min-width:0;">
                <h2>住戶造冊</h2>
                <p>讀取社區資料中...</p>
              </div>
            </div>
            <span class="tag red">資料</span>
          </div>
          <div class="card-bd">
            <div class="status">讀取中...</div>
          </div>
        </section>
      `.trim();
      updateFooterActiveNav();
      return;
    }
    const cid = resolveActiveCommunityId();
    const accounts = loadAccounts();
    const c = (accounts.communities || []).find((x) => x && String(x.id || "") === String(cid || "")) || null;
    const cname = c ? String(c.name || "").trim() : "";

    if (subnavEl) {
      subnavEl.innerHTML = `
        <button class="btn btn-sm" type="button" id="btnPendingResidents">
          <span class="badge-inline" id="pendingBadge" hidden>0</span>
          待審帳號
        </button>
      `.trim();
      
      // 獲取按鈕引用 (因為剛剛 innerHTML 重置了)
      const pendingBtn = document.getElementById("btnPendingResidents");
      if (pendingBtn) {
        pendingBtn.onclick = () => openPendingResidentsModal80({ communityId: cid });
      }
    }

    contentEl.innerHTML = `
      <section class="card residents-page">
        <div class="card-hd">
          <div class="left">
            <div class="chip" aria-hidden="true">${iconSvg("residents")}</div>
            <div style="min-width:0;">
              <h2>住戶造冊</h2>
              <p>${cname || "—"}</p>
            </div>
          </div>
          <button class="icon-btn sm" type="button" id="btnUnits" aria-label="戶號列表" title="戶號列表">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 7h12M8 12h12M8 17h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="card-bd">
          <div class="resident-toolbar">
            <div class="resident-total" id="residentTotal">
              <div class="unit-total" id="unitTotal">總戶數：—</div>
              <div class="people-total" id="peopleTotal">總人數：—</div>
            </div>
            <div class="search resident-search">
              <input id="residentSearch" type="text" placeholder="搜尋 戶號 / 姓名 / 手機 / Email" autocomplete="off" />
            </div>
            <button class="btn btn-primary btn-sm" type="button" id="btnAddResident">新增帳號</button>
          </div>
          <div class="status" id="residentStatus" hidden></div>
          <div class="resident-list" id="residentList"></div>
        </div>
      </section>
    `.trim();

    const listEl = document.getElementById("residentList");
    const statusEl = document.getElementById("residentStatus");
    const searchEl = document.getElementById("residentSearch");
    const addBtn = document.getElementById("btnAddResident");
    const unitsBtn = document.getElementById("btnUnits");
    const unitTotalEl = document.getElementById("unitTotal");
    const peopleTotalEl = document.getElementById("peopleTotal");

    ensureResidentsPendingCountSubscription(cid);

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    let residents = [];
    let communityUnits = Array.isArray(c && c.units) ? c.units : [];

    const normalizeUnitList = (list) => {
      const raw = Array.isArray(list) ? list : [];
      const uniq = [];
      const seen = new Set();
      for (const x of raw) {
        let v = "";
        if (typeof x === "object" && x !== null) {
          v = String(x.id || "").trim();
        } else {
          v = String(x || "").trim();
        }
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        uniq.push(v);
      }
      return uniq;
    };

    const refreshUnitTotals = () => {
      const unitCount = normalizeUnitList(communityUnits).length;
      if (unitTotalEl) unitTotalEl.textContent = `總戶數：${unitCount}`;
    };

    const renderList = () => {
      const q = String(searchEl ? searchEl.value : "").trim().toLowerCase();
      const filtered = q
        ? residents.filter((r) => {
            const h = String(r.houseNo || "").toLowerCase();
            const n = String(r.displayName || "").toLowerCase();
            const p = String(r.phone || "").toLowerCase();
            const e = String(r.email || "").toLowerCase();
            return h.includes(q) || n.includes(q) || p.includes(q) || e.includes(q);
          })
        : residents;

      if (!listEl) return;
      refreshUnitTotals();
      if (peopleTotalEl) peopleTotalEl.textContent = `總人數：${residents.length}`;
      if (!filtered.length) {
        listEl.innerHTML = `<div class="status">尚無住戶資料。</div>`;
        return;
      }

      listEl.innerHTML = filtered
        .map((r) => {
          const enabled = r.enabled !== false;
          const houseNo = String(r.houseNo || "").trim();
          const subUnit = String(r.subUnit || "").trim();
          const fullUnit = subUnit ? `${houseNo}-${subUnit}` : houseNo;
          const phone = String(r.phone || "").trim();
          const email = String(r.email || "").trim();
          const subParts = [fullUnit, phone, email].filter(Boolean);
          return `
            <div class="resident-item" data-id="${String(r.id || "")}">
              <div class="resident-left">
                <div class="avatar-sm">${avatarHtml(r)}</div>
                <div class="resident-text">
                  <div class="resident-name">${String(r.displayName || "—")}</div>
                  <div class="resident-sub">${subParts.join("｜")}</div>
                </div>
              </div>
              <div class="resident-actions">
                <label class="switch" aria-label="啟用">
                  <input type="checkbox" data-toggle ${enabled ? "checked" : ""} />
                  <span class="slider"></span>
                </label>
                <button class="icon-btn" type="button" data-parking aria-label="車位" title="車位">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M7 4h5.6a4.4 4.4 0 0 1 0 8.8H7V4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M7 12.8V20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M17 20V7.5a3.5 3.5 0 0 1 7 0V20" stroke="currentColor" stroke-width="0" />
                    <path d="M14.5 20h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M14.5 14.5h4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M14.5 11.2h4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M14.5 7.9h4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="icon-btn" type="button" data-control aria-label="管制" title="管制">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 2.5 20 6v6c0 5.2-3.4 9.2-8 9.5C7.4 21.2 4 17.2 4 12V6l8-3.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M9 12h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M12 9v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="icon-btn" type="button" data-qr aria-label="編輯QR code" title="編輯QR code">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4.5 4.5h6v6h-6v-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M13.5 4.5h6v6h-6v-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M4.5 13.5h6v6h-6v-6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M13.5 13.5h2.5v2.5h-2.5v-2.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M16 16h3.5v3.5H16V16Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                  </svg>
                </button>
                <button class="icon-btn" type="button" data-edit aria-label="編輯" title="編輯">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-.2-.2a2 2 0 0 0-2.8 0L5 17v3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="icon-btn danger" type="button" data-delete aria-label="刪除" title="刪除">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 4h6l1 2h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M6 6h12l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          `.trim();
        })
        .join("");
    };

    const loadResidents = async () => {
      setStatus("讀取中...", false);
      try {
        state.unsubResidents = db.collection("users")
          .where("community", "==", String(cid || "default"))
          .onSnapshot((snap) => {
            const list = snap.docs
              .map((d) => {
                const v = d.data() || {};
                return {
                  id: d.id,
                  role: String(v.role || ""),
                  houseNo: String(v.houseNo || v.unit || ""),
                  subUnit: String(v.subUnit || ""),
                  displayName: String(v.displayName || v.name || ""),
                  email: String(v.email || v.username || ""),
                  phone: String(v.phone || ""),
                  enabled: v.enabled !== false,
                  address: String(v.address || ""),
                  avatarDataUrl: String(v.avatarDataUrl || ""),
                  phoneNormalized: String(v.phoneNormalized || ""),
                  status: String(v.status || ""),
                  qrToken: String(v.qrToken || ""),
                };
              })
              .filter((x) => isResidentRole(x.role) && x.status !== "pending");

            list.sort((a, b) => {
              const ah = String(a.houseNo || "");
              const bh = String(b.houseNo || "");
              if (ah !== bh) return ah.localeCompare(bh, "zh-Hant");
              const as = String(a.subUnit || "");
              const bs = String(b.subUnit || "");
              if (as !== bs) return as.localeCompare(bs, "zh-Hant");
              return String(a.displayName || "").localeCompare(String(b.displayName || ""), "zh-Hant");
            });

            residents = list;
            setStatus("", false);
            renderList();
          }, (err) => {
            const code = String(err && err.code ? err.code : "");
            setStatus(code.includes("permission-denied") ? "沒有權限讀取住戶資料。" : "讀取失敗，請稍後再試。", true);
            residents = [];
            renderList();
          });
      } catch (err) {
        setStatus("系統錯誤，請重整頁面。", true);
      }
    };

    const openResidentEditor = (mode, resident) => {
      const modal = ensureResidentEditorModal();
      let detach = () => {};
      detach = bindModalClose(modal, () => detach());
      const titleEl = modal.querySelector("#residentModalTitle");
      const form = modal.querySelector("#residentModalForm");
      const st = modal.querySelector("#residentModalStatus");
      const roleNameEl = modal.querySelector("#residentRoleName");
      const inputCategory = modal.querySelector("#modal_r_category");
      const inputCommunity = modal.querySelector("#modal_r_community");
      const inputUnit = modal.querySelector("#modal_r_unit");
      const inputSubUnit = modal.querySelector("#modal_r_sub_unit");
      const inputName = modal.querySelector("#modal_r_name");
      const inputEmail = modal.querySelector("#modal_r_email");
      const inputPhone = modal.querySelector("#modal_r_phone");
      const inputPassword = modal.querySelector("#modal_r_password");
      const inputAddr = modal.querySelector("#modal_r_address");
      const inputEnabled = modal.querySelector("#modal_r_enabled");
      const unitMatchBadge = modal.querySelector("#unitMatchBadge");
      const avatarUploader = modal.querySelector("#residentAvatarUploader");
      const avatarInput = modal.querySelector("#residentAvatarInput");
      const avatarPreview = modal.querySelector("#residentAvatarPreview");
      const avatarPlaceholder = modal.querySelector("#residentAvatarPlaceholder");
      const rolesWrap = modal.querySelector("#modal_r_roles");
      const roleOtherChk = modal.querySelector("#modal_r_role_other_chk");
      const roleOtherText = modal.querySelector("#modal_r_role_other_text");
      const cancelBtn = modal.querySelector("#btnCancelResidentModal");
      const closeBtn = modal.querySelector("#btnCloseResidentModal");
      const submitBtn = modal.querySelector("#btnSubmitResidentModal");
      const btnUnlockCommunity = modal.querySelector("#btnUnlockCommunity");

      const setModalStatus = (msg, isError) => {
        if (!st) return;
        const t = String(msg || "").trim();
        st.textContent = t;
        st.hidden = !t;
        st.classList.toggle("error", Boolean(isError));
      };

      const isEdit = mode === "edit";
      const data = resident || {};
      if (titleEl && titleEl.childNodes && titleEl.childNodes.length >= 3) {
        titleEl.childNodes[0].nodeValue = isEdit ? "編輯 " : "新增 ";
        titleEl.childNodes[2].nodeValue = " 帳號";
      }
      if (roleNameEl) roleNameEl.textContent = "住戶";
      if (inputCategory) inputCategory.value = isEdit ? String(data.category || "住戶") : "住戶";
      
      if (inputCommunity) {
        const currentCid = isEdit ? String(data.community || cid || "default") : String(cid || "default");
        const options = (state.communities || []).map(c => 
          `<option value="${c.id}">${escapeHtml(c.name)}</option>`
        ).join("");
        inputCommunity.innerHTML = options;
        inputCommunity.value = currentCid;
        inputCommunity.disabled = true;
        
        if (btnUnlockCommunity) {
          btnUnlockCommunity.classList.remove("unlocked");
          btnUnlockCommunity.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
          btnUnlockCommunity.onclick = () => {
            const isLocked = inputCommunity.disabled;
            inputCommunity.disabled = !isLocked;
            btnUnlockCommunity.classList.toggle("unlocked", isLocked);
            if (isLocked) {
              // 切換為解鎖狀態
              btnUnlockCommunity.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path><path d="M12 11v4"></path><path d="M12 11h.01"></path></svg>`;
              toast("已解鎖所屬社區變更");
            } else {
              // 切換為鎖定狀態
              btnUnlockCommunity.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
            }
          };
        }
      }
      if (inputUnit) inputUnit.value = isEdit ? String(data.houseNo || "") : "";
      if (inputSubUnit) inputSubUnit.value = isEdit ? String(data.subUnit || "") : "";
      if (inputName) inputName.value = isEdit ? String(data.displayName || "") : "";
      if (inputEmail) inputEmail.value = isEdit ? String(data.email || "") : "";
      if (inputPhone) inputPhone.value = isEdit ? String(data.phone || "") : "";
      if (inputAddr) inputAddr.value = isEdit ? String(data.address || "") : "";
      if (inputEnabled) inputEnabled.value = String((isEdit ? data.enabled !== false : true) ? "true" : "false");
      if (inputPassword) inputPassword.value = "";
      if (inputEmail) inputEmail.disabled = Boolean(isEdit);
      if (submitBtn) submitBtn.textContent = isEdit ? "更新" : "建立";
      setModalStatus("", false);
      modal.hidden = false;
      requestAnimationFrame(() => {
        if (inputUnit) inputUnit.focus();
      });

      let unitTouched = false;
      let avatarFile = null;
      let avatarPreviewData = "";

      const setAvatarPreview = (dataUrl) => {
        avatarPreviewData = String(dataUrl || "");
        if (avatarPreview) {
          avatarPreview.src = avatarPreviewData || "";
          avatarPreview.style.display = avatarPreviewData ? "block" : "none";
        }
        if (avatarPlaceholder) avatarPlaceholder.style.display = avatarPreviewData ? "none" : "block";
      };

      const syncOtherRoleInput = () => {
        if (!roleOtherText || !roleOtherChk) return;
        roleOtherText.hidden = !roleOtherChk.checked;
        if (!roleOtherChk.checked) roleOtherText.value = "";
      };

      const readResidentRoles = () => {
        const picked = new Set();
        if (rolesWrap) {
          rolesWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => {
            if (el.checked) picked.add(String(el.value || ""));
          });
        }
        const otherEnabled = roleOtherChk && roleOtherChk.checked;
        const otherText = normalizeText(roleOtherText ? roleOtherText.value : "");
        const roles = Array.from(picked).filter(Boolean);
        const extra = otherEnabled ? otherText : "";
        return { roles, extra };
      };

      const updateUnitMatch = () => {
        if (!unitMatchBadge || !inputUnit) return;
        if (!unitTouched) {
          unitMatchBadge.classList.remove("show");
          unitMatchBadge.hidden = true;
          unitMatchBadge.style.display = "none";
          return;
        }
        const unit = normalizeText(inputUnit.value);
        const ok = Boolean(unit) && normalizeUnitList(communityUnits).some((x) => x.toLowerCase() === unit.toLowerCase());
        unitMatchBadge.hidden = !ok;
        unitMatchBadge.classList.toggle("show", ok);
        unitMatchBadge.style.display = ok ? "inline-flex" : "none";
      };

      const fileToAvatarDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read-failed"));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error("image-decode-failed"));
          img.onload = () => {
            const target = 360;
            const srcW = img.naturalWidth || 0;
            const srcH = img.naturalHeight || 0;
            if (!srcW || !srcH) {
              reject(new Error("bad-image"));
              return;
            }
            const side = Math.min(srcW, srcH);
            const sx = Math.round((srcW - side) / 2);
            const sy = Math.round((srcH - side) / 2);
            const canvas = document.createElement("canvas");
            canvas.width = target;
            canvas.height = target;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("no-canvas"));
              return;
            }
            ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
            resolve(canvas.toDataURL("image/jpeg", 0.78));
          };
          img.src = String(reader.result || "");
        };
        reader.readAsDataURL(file);
      });

      if (rolesWrap) {
        rolesWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => (el.checked = false));
      }
      if (roleOtherChk) roleOtherChk.checked = false;
      if (roleOtherText) roleOtherText.value = "";
      syncOtherRoleInput();
      if (isEdit && Array.isArray(data.residentRoles) && rolesWrap) {
        const set = new Set(data.residentRoles.map((x) => String(x || "")));
        rolesWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => {
          el.checked = set.has(String(el.value || ""));
        });
        const extra = normalizeText(data.residentRoleOther || "");
        if (extra && roleOtherChk) {
          roleOtherChk.checked = true;
          if (roleOtherText) roleOtherText.value = extra;
        }
        syncOtherRoleInput();
      }

      if (isEdit) {
        setAvatarPreview(String(data.avatarDataUrl || ""));
      } else {
        setAvatarPreview("");
      }

      const openPicker = () => {
        if (avatarInput) avatarInput.click();
      };

      const onUploaderClick = () => openPicker();
      const onUploaderKeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      };
      const onAvatarChange = () => {
        const file = avatarInput && avatarInput.files && avatarInput.files[0] ? avatarInput.files[0] : null;
        if (!file) return;
        avatarFile = file;
        const reader = new FileReader();
        reader.onload = () => setAvatarPreview(String(reader.result || ""));
        reader.readAsDataURL(file);
      };

      if (avatarUploader) avatarUploader.addEventListener("click", onUploaderClick);
      if (avatarUploader) avatarUploader.addEventListener("keydown", onUploaderKeydown);
      if (avatarInput) avatarInput.addEventListener("change", onAvatarChange);

      const onUnitInput = () => {
        unitTouched = true;
        updateUnitMatch();
        
        // 自動填寫地址
        const unitVal = normalizeText(inputUnit.value);
        if (unitVal && inputAddress && !inputAddress.value.trim()) {
          const found = (Array.isArray(communityUnits) ? communityUnits : []).find(u => {
            const uid = (typeof u === "object" && u !== null) ? String(u.id || "") : String(u || "");
            return uid.trim().toLowerCase() === unitVal.toLowerCase();
          });
          if (found && typeof found === "object" && found.address) {
            inputAddress.value = found.address;
          }
        }
      };
      if (inputUnit) inputUnit.addEventListener("input", onUnitInput);

      const onOtherChk = () => syncOtherRoleInput();
      if (roleOtherChk) roleOtherChk.addEventListener("change", onOtherChk);

      const onCancel = (e) => {
        e.preventDefault();
        modal.hidden = true;
        detach();
      };
      if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onCancel);
      const backdrop = modal.querySelector("[data-modal-close]");
      if (backdrop) backdrop.addEventListener("click", onCancel);

      const onSubmit = async (e) => {
        e.preventDefault();
        if (submitBtn) submitBtn.disabled = true;
        setModalStatus("儲存中...", false);

        const category = normalizeText(inputCategory ? inputCategory.value : "住戶") || "住戶";
        const unit = normalizeText(inputUnit ? inputUnit.value : "");
        const subUnit = normalizeText(inputSubUnit ? inputSubUnit.value : "");
        const name = normalizeText(inputName ? inputName.value : "");
        const email = normalizeText(inputEmail ? inputEmail.value : "");
        const phone = normalizeText(inputPhone ? inputPhone.value : "");
        const passwordRaw = normalizeText(inputPassword ? inputPassword.value : "");
        const address = normalizeText(inputAddr ? inputAddr.value : "");
        const enabled = String(inputEnabled ? inputEnabled.value : "true") === "true";

        if (!name) {
          setModalStatus("請填寫姓名。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (!unit) {
          setModalStatus("請填寫戶號。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }

        // 檢查子戶號重複性 (同社區、同戶號下不可重複)
        const selectedCid = normalizeText(inputCommunity ? inputCommunity.value : cid) || cid || "default";
        const isDuplicateSubUnit = residents.some(r => 
          r.id !== data.id && 
          r.houseNo.toLowerCase() === unit.toLowerCase() && 
          r.subUnit.toLowerCase() === subUnit.toLowerCase()
        );

        if (isDuplicateSubUnit) {
          setModalStatus(`子戶號「${subUnit || "(無)"}」在戶號「${unit}」中已存在。`, true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setModalStatus("電子郵件格式不正確。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (!phone) {
          setModalStatus("電子郵件與手機號碼皆為必填。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const phoneNormalized = normalizePhoneDigits(phone);
        if (!phoneNormalized) {
          setModalStatus("手機號碼格式不正確。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const password = isEdit ? passwordRaw : (passwordRaw || phone);
        if (!password && !isEdit) {
          setModalStatus("未設定預設密碼時，預設會使用手機號碼；請填寫手機號碼或預設密碼。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        const { roles, extra } = readResidentRoles();
        if (roles.includes("其他") && !extra) {
          setModalStatus("已選擇「其他」，請輸入自定義角色。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }

        let createdAuth = null;
        try {
          if (!isEdit) {
            createdAuth = await createAuthUser(email, password || phoneNormalized);
          }
          const id = isEdit ? String(data.id || "") : String(createdAuth && createdAuth.uid ? createdAuth.uid : "");
          if (!id) throw new Error("no-id");

          const selectedCid = normalizeText(inputCommunity ? inputCommunity.value : cid) || cid || "default";
          const selectedCommunity = (state.communities || []).find(c => c.id === selectedCid) || {};
          const communityCode = String(selectedCommunity.username || "");
          
          const payload = {
            role: "住戶",
            community: selectedCid,
            houseNo: unit,
            subUnit: subUnit,
            displayName: name,
            username: email,
            email,
            phone: phoneNormalized,
            phoneNormalized,
            address,
            enabled: Boolean(enabled),
            category,
            residentRoles: roles,
            residentRoleOther: extra,
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (!isEdit) payload.createdAt = FieldValue.serverTimestamp();
          const passwordHash = password ? await sha256Hex(password) : "";
          if (passwordHash) {
            payload.passwordHash = passwordHash;
            payload.passwordHashAlg = "SHA-256";
            payload.passwordUpdatedAt = FieldValue.serverTimestamp();
          }
          const avatarDataUrl = avatarFile ? await fileToAvatarDataUrl(avatarFile) : "";
          if (avatarDataUrl) payload.avatarDataUrl = avatarDataUrl;
          await db.collection("users").doc(id).set(payload, { merge: true });
          await upsertUserLookup({ phoneNormalized, email, phone: phoneNormalized, uid: id, community: payload.community, communityCode, role: payload.role });

          modal.hidden = true;
          detach();
          await loadResidents();
        } catch (err) {
          console.error("Save resident error:", err);
          const code = String(err && err.code ? err.code : "");
          const msg =
            code.includes("auth/email-already-in-use") ? "此電子郵件已被使用。" :
            code.includes("auth/invalid-email") ? "電子郵件格式不正確。" :
            code.includes("auth/weak-password") ? "密碼強度不足（請確認手機號碼）。" :
            code.includes("permission-denied") ? "沒有權限執行此操作（請確認 Firestore 規則）。" :
            "儲存失敗：" + (err.message || "請稍後再試。");
          setModalStatus(msg, true);
        } finally {
          if (createdAuth && createdAuth.auth) {
            try {
              await createdAuth.auth.signOut();
            } catch {}
          }
          if (submitBtn) submitBtn.disabled = false;
        }
      };

      form.addEventListener("submit", onSubmit);
      const oldDetach = detach;
      const detach2 = () => {
        try {
          form.removeEventListener("submit", onSubmit);
        } catch {}
        try {
          if (avatarUploader) avatarUploader.removeEventListener("click", onUploaderClick);
          if (avatarUploader) avatarUploader.removeEventListener("keydown", onUploaderKeydown);
          if (avatarInput) avatarInput.removeEventListener("change", onAvatarChange);
          if (inputUnit) inputUnit.removeEventListener("input", onUnitInput);
          if (roleOtherChk) roleOtherChk.removeEventListener("change", onOtherChk);
          if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
          if (closeBtn) closeBtn.removeEventListener("click", onCancel);
          if (backdrop) backdrop.removeEventListener("click", onCancel);
        } catch {}
        oldDetach();
      };
      detach = detach2;
    };

    const openUnitsEditor = async () => {
      const modal = ensureUnitsModal();
      let detach = () => {};
      detach = bindModalClose(modal, () => detach());
      const form = modal.querySelector("#unitsForm");
      const tbody = modal.querySelector("#unitsTableBody");
      const st = modal.querySelector("#unitsStatus");
      const countEl = modal.querySelector("#unitsModalCount");
      const btnAddRow = modal.querySelector("#btnAddUnitRow");

      const setModalStatus = (msg, isError) => {
        if (!st) return;
        const t = String(msg || "").trim();
        st.textContent = t;
        st.hidden = !t;
        st.classList.toggle("error", Boolean(isError));
      };

      const createRow = (u = {}) => {
        const tr = document.createElement("tr");
        const qrToken = String(u.qrToken || u.qr || u.qrCode || "").trim();
        const ownerName = String(u.ownerName || u.owner || u.ownerText || "").trim();
        tr.innerHTML = `
          <td><input type="text" class="u-qr" value="${qrToken}" placeholder="QR code碼" /></td>
          <td><input type="text" class="u-id" value="${u.id || ""}" placeholder="戶號" /></td>
          <td><input type="text" class="u-owner" value="${ownerName}" placeholder="區分所有權人" /></td>
          <td><input type="text" class="u-address" value="${u.address || ""}" placeholder="地址" /></td>
          <td><input type="text" class="u-area" value="${u.area || ""}" placeholder="坪數" /></td>
          <td><input type="text" class="u-ownership" value="${u.ownership || ""}" placeholder="%" /></td>
          <td><div class="remove-row" title="刪除">&times;</div></td>
        `;
        tr.querySelector(".remove-row").onclick = () => {
          tr.remove();
          updateCount();
        };
        return tr;
      };

      const updateCount = () => {
        if (countEl && tbody) {
          countEl.textContent = `總戶數：${tbody.children.length}`;
        }
      };

      setModalStatus("讀取中...", false);
      modal.hidden = false;
      try {
        const doc = await db.collection("communities").doc(String(cid || "default")).get();
        const v = doc && doc.exists ? (doc.data() || {}) : {};
        const units = Array.isArray(v.units) ? v.units : [];
        communityUnits = units;
        refreshUnitTotals();
        if (tbody) {
          tbody.innerHTML = "";
          units.forEach(u => {
            const rowData = typeof u === "object" && u !== null ? u : { id: String(u) };
            tbody.appendChild(createRow(rowData));
          });
          if (units.length === 0) tbody.appendChild(createRow());
        }
        updateCount();
        setModalStatus("", false);
      } catch (err) {
        console.error("Load units failed:", err);
        if (tbody) tbody.innerHTML = "";
        if (countEl) countEl.textContent = "總戶數：—";
        setModalStatus("讀取失敗，請稍後再試。", true);
      }

      const onAddRow = () => {
        if (tbody) {
          const row = createRow();
          tbody.appendChild(row);
          updateCount();
          row.querySelector("input").focus();
        }
      };

      const onSubmit = async (e) => {
        e.preventDefault();
        if (!tbody) return;
        
        const uniq = [];
        const seen = new Set();
        const rows = Array.from(tbody.querySelectorAll("tr"));
        
        for (const tr of rows) {
          const qrToken = tr.querySelector(".u-qr").value.trim();
          const id = tr.querySelector(".u-id").value.trim();
          const ownerName = tr.querySelector(".u-owner").value.trim();
          const address = tr.querySelector(".u-address").value.trim();
          const area = tr.querySelector(".u-area").value.trim();
          const ownership = tr.querySelector(".u-ownership").value.trim();
          
          if (!id) continue;
          if (seen.has(id)) continue;
          seen.add(id);

          uniq.push({ qrToken, id, ownerName, address, area, ownership });
        }

        if (uniq.length === 0) {
          setModalStatus("請至少輸入 1 個戶號。", true);
          return;
        }

        setModalStatus("儲存中...", false);
        try {
          await db.collection("communities").doc(String(cid || "default")).set(
            { units: uniq, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          communityUnits = uniq;
          refreshUnitTotals();
          modal.hidden = true;
          detach();
        } catch (err) {
          const code = String(err && err.code ? err.code : "");
          setModalStatus(code.includes("permission-denied") ? "沒有權限執行此操作。" : "儲存失敗，請稍後再試。", true);
        }
      };

      const btnExport = modal.querySelector("#btnExportUnits");
      const btnImport = modal.querySelector("#btnImportUnits");
      const inputImport = modal.querySelector("#inputImportUnits");

      const onExport = () => {
        if (!window.XLSX) {
          toast("Excel 函式庫尚未載入，請稍後再試。");
          return;
        }
        // 從目前表格抓取資料（包含尚未儲存的變更）
        const rows = Array.from(tbody.querySelectorAll("tr"));
        const data = rows.map(tr => ({
          "QR code碼": tr.querySelector(".u-qr").value.trim(),
          "戶號": tr.querySelector(".u-id").value.trim(),
          "區分所有權人": tr.querySelector(".u-owner").value.trim(),
          "地址": tr.querySelector(".u-address").value.trim(),
          "坪數": tr.querySelector(".u-area").value.trim(),
          "所有權人%": tr.querySelector(".u-ownership").value.trim()
        })).filter(x => x["戶號"]);

        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "戶號列表");
        XLSX.writeFile(wb, `戶號列表_${cname || "社區"}.xlsx`);
      };

      const onImportClick = () => inputImport.click();

      const onImportFile = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!window.XLSX) {
          toast("Excel 函式庫尚未載入，請稍後再試。");
          return;
        }
        const reader = new FileReader();
        reader.onload = (re) => {
          try {
            const data = new Uint8Array(re.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet);
            
            if (json.length === 0) {
              setModalStatus("檔案中沒有資料。", true);
              return;
            }

            if (tbody) {
              tbody.innerHTML = "";
              json.forEach(row => {
                const values = Object.values(row || {});
                const qrToken = String(row["QR code碼"] || row["qrToken"] || row["qr"] || row["qrcode"] || row["QRCode"] || "").trim();
                const id = String(row["戶號"] || row["id"] || row["戶"] || Object.values(row)[0] || "").trim();
                let ownerName = String(row["區分所有權人"] || row["所有權人"] || row["ownerName"] || row["owner"] || "").trim();
                let addr = String(row["地址"] || row["address"] || "").trim();
                let area = String(row["坪數"] || row["area"] || "").trim();
                let own = String(row["所有權人%"] || row["區分所有權人%"] || row["ownership"] || "").trim();

                if (!addr && !ownerName && values.length >= 2) addr = String(values[1] || "").trim();
                if (!area && values.length >= 3) area = String(values[2] || "").trim();
                if (!own && values.length >= 4) own = String(values[3] || "").trim();
                if (!ownerName && values.length >= 5) ownerName = String(values[4] || "").trim();

                if (id) tbody.appendChild(createRow({ qrToken, id, ownerName, address: addr, area, ownership: own }));
              });
              updateCount();
            }
            setModalStatus("匯入成功，請確認後點擊儲存。", false);
          } catch (err) {
            console.error("Import failed:", err);
            setModalStatus("匯入失敗，請檢查檔案格式。", true);
          } finally {
            inputImport.value = "";
          }
        };
        reader.readAsArrayBuffer(file);
      };

      if (btnAddRow) btnAddRow.addEventListener("click", onAddRow);
      if (btnExport) btnExport.addEventListener("click", onExport);
      if (btnImport) btnImport.addEventListener("click", onImportClick);
      if (inputImport) inputImport.addEventListener("change", onImportFile);

      form.addEventListener("submit", onSubmit);
      const oldDetach = detach;
      detach = () => {
        try {
          if (btnAddRow) btnAddRow.removeEventListener("click", onAddRow);
          if (btnExport) btnExport.removeEventListener("click", onExport);
          if (btnImport) btnImport.removeEventListener("click", onImportClick);
          if (inputImport) inputImport.removeEventListener("change", onImportFile);
          form.removeEventListener("submit", onSubmit);
        } catch {}
        oldDetach();
      };
    };

    if (searchEl) searchEl.addEventListener("input", renderList);
    if (addBtn) addBtn.addEventListener("click", () => openResidentEditor("create"));
    if (unitsBtn) unitsBtn.addEventListener("click", openUnitsEditor);

    if (listEl) {
      listEl.addEventListener("click", async (e) => {
        const row = e.target && e.target.closest ? e.target.closest(".resident-item") : null;
        if (!row) return;
        const id = row.getAttribute("data-id");
        const r = residents.find((x) => String(x.id || "") === String(id || "")) || null;
        if (!id || !r) return;

        const parkingBtn = e.target.closest("[data-parking]");
        if (parkingBtn) {
          openResidentParkingModal80({
            cid,
            uid: id,
            unit: String(r.houseNo || r.unit || "").trim(),
            displayName: String(r.displayName || r.email || id),
          });
          return;
        }

        const controlBtn = e.target.closest("[data-control]");
        if (controlBtn) {
          openResidentControlModal80({
            cid,
            uid: id,
            unit: String(r.houseNo || r.unit || "").trim(),
            displayName: String(r.displayName || r.email || id),
          });
          return;
        }

        const qrBtn = e.target.closest("[data-qr]");
        if (qrBtn) {
          openResidentTokenModal80({
            communityId: cid,
            uid: id,
            displayName: String(r.displayName || r.email || id),
            qrToken: String(r.qrToken || "").trim(),
            onSaved: (token) => {
              r.qrToken = token;
              renderList();
            },
          });
          return;
        }

        const editBtn = e.target.closest("[data-edit]");
        if (editBtn) {
          openResidentEditor("edit", r);
          return;
        }
        const delBtn = e.target.closest("[data-delete]");
        if (delBtn) {
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "確認刪除",
            message: `確定要刪除住戶「${String(r.displayName || r.email || id)}」？`,
            okText: "刪除",
            cancelText: "取消",
            danger: true,
          }) : Promise.resolve(window.confirm("確定要刪除？")));
          if (!ok) return;
          delBtn.disabled = true;
          try {
            await db.collection("users").doc(String(id)).delete();
            residents = residents.filter((x) => String(x.id || "") !== String(id));
            renderList();
          } catch {
            toast("刪除失敗");
          } finally {
            delBtn.disabled = false;
          }
        }
      });

      listEl.addEventListener("change", async (e) => {
        const toggle = e.target && e.target.matches ? (e.target.matches("input[data-toggle]") ? e.target : null) : null;
        if (!toggle) return;
        const row = toggle.closest(".resident-item");
        if (!row) return;
        const id = row.getAttribute("data-id");
        const r = residents.find((x) => String(x.id || "") === String(id || "")) || null;
        if (!id || !r) return;
        const prev = Boolean(r.enabled !== false);
        const next = Boolean(toggle.checked);
        toggle.disabled = true;
        try {
          await db.collection("users").doc(String(id)).set(
            { enabled: next, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          r.enabled = next;
        } catch {
          toggle.checked = prev;
          toast("更新失敗");
        } finally {
          toggle.disabled = false;
        }
      });
    }

    loadResidents();
    (async () => {
      try {
        const doc = await db.collection("communities").doc(String(cid || "default")).get();
        const v = doc && doc.exists ? (doc.data() || {}) : {};
        communityUnits = normalizeUnitList(v.units);
        refreshUnitTotals();
      } catch {}
    })();
    updateFooterActiveNav();
  }

  function ensureVisitorModal() {
    let modal = document.getElementById("visitorModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "visitorModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="visitorModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="visitorModalTitle">新增訪客</h3>
          <button class="modal-close" type="button" id="btnCloseVisitorModal" aria-label="關閉">×</button>
        </div>
        <form id="visitorModalForm">
          <div class="modal-body">
            <div class="field">
              <label for="modal_v_name">訪客姓名</label>
              <input id="modal_v_name" type="text" autocomplete="off" required />
            </div>
            <div class="field">
              <label for="modal_v_email">電子郵件</label>
              <input id="modal_v_email" type="email" autocomplete="email" />
            </div>
            <div class="field">
              <label for="modal_v_phone">手機號碼</label>
              <input id="modal_v_phone" type="tel" autocomplete="tel" />
            </div>
            <div class="field">
              <label for="modal_v_unit">拜訪戶號</label>
              <input id="modal_v_unit" type="text" autocomplete="off" list="visitorUnitOptions" />
              <datalist id="visitorUnitOptions"></datalist>
            </div>
            <div class="field">
              <label for="modal_v_partySize">來訪人數</label>
              <input id="modal_v_partySize" type="number" min="1" step="1" value="1" inputmode="numeric" />
            </div>
            <div class="field">
              <label for="modal_v_purposeType">到訪事由</label>
              <select id="modal_v_purposeType">
                <option value="親友拜訪">親友拜訪</option>
                <option value="施工修繕">施工修繕</option>
                <option value="快遞外送">快遞外送</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div class="field" id="modal_v_purposeOtherField" hidden>
              <label for="modal_v_purposeOther">其他（自定義）</label>
              <input id="modal_v_purposeOther" type="text" autocomplete="off" />
            </div>
            <div class="field">
              <label for="modal_v_plate">車牌</label>
              <input id="modal_v_plate" type="text" autocomplete="off" />
            </div>
            <div class="field">
              <label for="modal_v_note">備註</label>
              <textarea id="modal_v_note" rows="4"></textarea>
            </div>
            <div class="row" id="modal_v_times_row" hidden>
              <div class="field">
                <label for="modal_v_inAt">來訪時間</label>
                <input id="modal_v_inAt" type="datetime-local" />
              </div>
              <div class="field">
                <label for="modal_v_outAt">離開時間</label>
                <input id="modal_v_outAt" type="datetime-local" />
              </div>
            </div>
            <div class="field">
              <div class="deposit-title">留存</div>
              <div class="deposit-grid">
                <label class="check">
                  <input type="checkbox" id="modal_v_keep_cert" />
                  <span>證件</span>
                </label>
                <select id="modal_v_keep_cert_type" disabled>
                  <option value="身分證">身分證</option>
                  <option value="健保卡">健保卡</option>
                  <option value="駕照">駕照</option>
                </select>

                <label class="check">
                  <input type="checkbox" id="modal_v_keep_card" />
                  <span>名片</span>
                </label>
                <span></span>

                <label class="check">
                  <input type="checkbox" id="modal_v_keep_cash" />
                  <span>現金</span>
                </label>
                <input id="modal_v_keep_cash_amount" type="number" inputmode="decimal" min="0" step="1" placeholder="金額" disabled />

                <label class="check">
                  <input type="checkbox" id="modal_v_keep_key" />
                  <span>鑰匙</span>
                </label>
                <span></span>
              </div>
            </div>
            <div class="status" id="visitorModalStatus" hidden></div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" id="btnCancelVisitorModal">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSubmitVisitorModal">建立</button>
          </div>
        </form>
      </div>
    `.trim();
    document.body.appendChild(modal);
    return modal;
  }

  function renderVisitorModule() {
    if (subnavEl) subnavEl.innerHTML = "";
    stopVisitorsSubscription();
    if (!Array.isArray(state.communities) || state.communities.length === 0) {
      contentEl.innerHTML = `
        <section class="card">
          <div class="card-hd">
            <div class="left">
              <div class="chip" aria-hidden="true">${iconSvg("visitor")}</div>
              <div style="min-width:0;">
                <h2>訪客登記</h2>
                <p>讀取社區資料中...</p>
              </div>
            </div>
            <span class="tag red">安全</span>
          </div>
          <div class="card-bd">
            <div class="status">讀取中...</div>
          </div>
        </section>
      `.trim();
      updateFooterActiveNav();
      return;
    }

    const cid = resolveActiveCommunityId();
    const urlCommunityKey = readUrlCommunityKey();
    const activeCommunity = (Array.isArray(state.communities) ? state.communities : []).find((x) => x && String(x.id || "") === String(cid || "")) || null;
    const cname = activeCommunity ? String(activeCommunity.name || "").trim() : "";
    const creatorName = inferUserName(auth.currentUser);
    let visitorCommunitySlug = String(cid || "").trim() || "default";
    const buildVisitorCommunityCandidates = () => {
      const out = [];
      const add = (v) => {
        const s = String(v || "").trim();
        if (!s || out.includes(s)) return;
        out.push(s);
      };
      add(visitorCommunitySlug);
      add(activeCommunity ? activeCommunity.username : "");
      add(urlCommunityKey);
      try { add(sessionStorage.getItem("csp_last_cid")); } catch {}
      return out.filter((x) => x && x !== "default");
    };
    const visitorCommunityCandidates = buildVisitorCommunityCandidates();
    let visitorCommunityTryIndex = 0;
    const visitorDesc = (moduleCatalog.find((m) => m && m.id === "visitor") || {}).desc || "到訪資訊、車牌、進出時間管理";

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;

    if (subnavEl) {
      subnavEl.innerHTML = `
        <button class="btn btn-sm" type="button" id="btnPendingVisitors">
          <span class="badge-inline" id="pendingVisitorsBadge" hidden>0</span>
          待審訪客
        </button>
        <button class="btn btn-sm" type="button" id="btnVisitorQr">訪客QR Code</button>
      `.trim();
      
      const pendingBtn = document.getElementById("btnPendingVisitors");
      if (pendingBtn) {
        pendingBtn.onclick = () => openPendingVisitorsModal80({ communityId: cid, communityName: cname });
      }
    }

    contentEl.innerHTML = `
      <section class="card visitor-page">
        <div class="card-hd">
          <div class="left">
            <div class="chip" aria-hidden="true">${iconSvg("visitor")}</div>
            <div style="min-width:0;">
              <h2>訪客登記</h2>
              <p>${visitorDesc}</p>
            </div>
          </div>
          <button class="btn btn-sm icon-btn" type="button" id="btnScanVisitor" aria-label="掃碼登記">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5h4v4H3V5zm6 0h4v4H9V5zm6 0h4v4h-4V5zM3 11h4v4H3v-4zm6 0h4v4H9v-4zm6 0h4v4h-4v-4zM3 17h4v4H3v-4zm6 0h4v4H9v-4zm6 0h4v4h-4v-4z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="card-bd" id="visitorPanel">
          <div class="visitor-toolbar">
            <div class="field">
              <label for="visitorDate">日期</label>
              <input id="visitorDate" type="date" />
            </div>
            <div class="field">
              <label for="visitorSearch">搜尋</label>
              <input id="visitorSearch" type="text" placeholder="搜尋 姓名 / 手機 / 車牌 / 事由" autocomplete="off" />
            </div>
            <button class="btn btn-sm danger" type="button" id="btnAddVisitor">新增訪客</button>
          </div>
          <div class="status" id="visitorStatus" hidden></div>
          <div class="visitor-list-container" id="visitorList">
            <div class="visitor-grid"></div>
          </div>
        </div>
      </section>
    `.trim();

    const panelEl = document.getElementById("visitorPanel");
    const listContainerEl = document.getElementById("visitorList");
    const listEl = listContainerEl.querySelector(".visitor-grid");
    const statusEl = document.getElementById("visitorStatus");
    const searchEl = document.getElementById("visitorSearch");
    const dateEl = document.getElementById("visitorDate");
    const visitorQrBtn = document.getElementById("btnVisitorQr");
    const scanBtn = document.getElementById("btnScanVisitor");
    const addBtn = document.getElementById("btnAddVisitor");

    ensureVisitorsPendingCountSubscription(cid);

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const toLocalInputValue = (d) => {
      if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return "";
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    };
    const parseLocalInputValue = (v) => {
      const raw = String(v || "").trim();
      if (!raw) return null;
      const d = new Date(raw);
      if (!Number.isFinite(d.getTime())) return null;
      return d;
    };
    const toDate = (v) => {
      if (!v) return null;
      if (v instanceof Date) return v;
      if (typeof v.toDate === "function") return v.toDate();
      return null;
    };
    const formatDt = (v) => {
      const d = toDate(v);
      if (!d) return "";
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    };

    let visitors = [];
    const hydrateCreatorLabels = async (list) => {
      const ids = Array.from(
        new Set(
          (Array.isArray(list) ? list : [])
            .map((x) => String(x && x.createdBy ? x.createdBy : "").trim())
            .filter(Boolean)
        )
      ).filter((x) => !state.creatorLabelByUid.has(x));
      if (!ids.length) return;
      const batchSize = 16;
      for (let i = 0; i < ids.length; i += batchSize) {
        const chunk = ids.slice(i, i + batchSize);
        await Promise.all(chunk.map((id) => getCreatorLabel80(id).catch(() => "")));
      }
      renderList();
    };

    const renderList = () => {
      const q = String(searchEl ? searchEl.value : "").trim().toLowerCase();
      const dateVal = String(dateEl ? dateEl.value : "").trim();
      
      let filtered = visitors;
      
      // 日期筛选
      if (dateVal) {
        filtered = filtered.filter((x) => {
          const vDate = toDate(x.inAt) || toDate(x.createdAt);
          if (!vDate) return false;
          const vDateStr = `${vDate.getFullYear()}-${pad2(vDate.getMonth()+1)}-${pad2(vDate.getDate())}`;
          return vDateStr === dateVal;
        });
      }
      
      // 关键词筛选
      if (q) {
        filtered = filtered.filter((x) => {
          const n = String(x.name || "").toLowerCase();
          const p = String(x.phone || "").toLowerCase();
          const em = String(x.email || "").toLowerCase();
          const unit = String(x.unit || "").toLowerCase();
          const plate = String(x.plate || "").toLowerCase();
          const purpose = String(x.purpose || "").toLowerCase();
          return n.includes(q) || p.includes(q) || em.includes(q) || unit.includes(q) || plate.includes(q) || purpose.includes(q);
        });
      }

      if (!listEl) return;
      if (!filtered.length) {
        listEl.innerHTML = `<div class="status">尚無訪客登記。</div>`;
        return;
      }

      const sortTime = (v) => (toDate(v && v.inAt) || toDate(v && v.createdAt) || new Date(0)).getTime();
      const ordered = [...filtered].sort((a, b) => {
        return sortTime(b) - sortTime(a);
      });

      listEl.innerHTML = ordered
        .map((v) => {
          const name = String(v.name || "—");
          const unit = String(v.unit || "").trim();
          const phone = String(v.phone || "").trim();
          const plate = String(v.plate || "").trim();
          const purpose = String(v.purpose || "").trim();
          const email = String(v.email || "").trim();
          const party = v.partySize != null && Number.isFinite(Number(v.partySize)) && Number(v.partySize) >= 1 ? String(Math.floor(Number(v.partySize))) : "1";
          const keepText = formatKeepText80(v.keep);
          const plateText = plate || "—";
          const inText = formatDt(v.inAt);
          const outText = formatDt(v.outAt);
          const createdText = formatDt(v.createdAt);
          const createdByUid = String(v.createdBy || "").trim();
          const createdByName =
            createdByUid && state.creatorLabelByUid.has(createdByUid)
              ? String(state.creatorLabelByUid.get(createdByUid) || "").trim()
              : String(v.createdByName || "").trim();
          const subHtml = [
            `<span class="field-k">拜訪戶號：</span>${escapeHtml(unit || "—")}`,
            `<span class="field-k">手機：</span>${escapeHtml(phone || "—")}`,
            `<span class="field-k">到訪事由：</span>${escapeHtml(purpose || "—")}`,
          ].join("｜");
          const sub2Html = [
            `<span class="field-k">拜訪人數：</span>${escapeHtml(party)}`,
            `<span class="field-k">電子郵件：</span>${escapeHtml(email || "—")}`,
          ].join("｜");
          const status = String(v.status || "").toLowerCase();
          const isPending = status === "pending";
          const isApproved = status === "approved";
          return `
            <div class="visitor-item ${isPending ? "pending" : ""} ${isApproved ? "approved" : ""}" data-id="${String(v.id || "")}">
              <div class="visitor-left">
                <div class="visitor-text">
                  <div class="visitor-top-row">
                    <div class="visitor-name">${name}</div>
                    <div class="visitor-created"><span class="field-k">建立：</span>${escapeHtml(createdText || "—")}｜<span class="field-k">建立者：</span>${escapeHtml(createdByName || "—")}</div>
                  </div>
                  <div class="visitor-sub-row">
                    <div class="visitor-sub">${subHtml}</div>
                    <div class="visitor-sub2">${sub2Html}</div>
                    <div class="visitor-keep"><span class="field-k">車牌：</span>${escapeHtml(plateText)}｜<span class="field-k">留存：</span>${escapeHtml(keepText || "無")}</div>
                  </div>
                  ${isApproved ? `
                    <div class="visitor-meta">
                      <span class="time-pill in" role="button" tabindex="0" data-time-kind="in">來訪：${inText || "—"}</span>
                      <span class="time-pill out" role="button" tabindex="0" data-time-kind="out">離開：${outText || "—"}</span>
                    </div>
                  ` : ""}
                </div>
              </div>
              <div class="visitor-actions">
                <button class="icon-btn ${isPending ? "warning" : ""}" type="button" data-pass aria-label="${isPending ? "待審核" : "訪客證"}" title="${isPending ? "待審核" : "訪客證"}">
                  ${isPending ? `
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                      <path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  ` : `
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6.5 4.8h11A2.2 2.2 0 0 1 19.7 7v10A2.2 2.2 0 0 1 17.5 19.2h-11A2.2 2.2 0 0 1 4.3 17V7A2.2 2.2 0 0 1 6.5 4.8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                      <path d="M8 9.2h2.2M13.8 9.2H16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                      <path d="M8 12h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                      <path d="M8 14.8h5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                      <path d="M15.4 14.2a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 0 0-2.8 0Z" stroke="currentColor" stroke-width="1.7"/>
                    </svg>
                  `}
                </button>
                <button class="icon-btn" type="button" data-edit aria-label="編輯" title="編輯">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-.2-.2a2 2 0 0 0-2.8 0L5 17v3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="icon-btn danger" type="button" data-delete aria-label="刪除" title="刪除">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 4h6l1 2h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M6 6h12l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          `.trim();
        })
        .join("");
    };

    const applyLocalVisitorPatch = (id, patch) => {
      const idx = visitors.findIndex((x) => String(x.id || "") === String(id || ""));
      if (idx < 0) return;
      const cur = visitors[idx] || {};
      visitors[idx] = { ...cur, ...patch };
      visitors.sort((a, b) => {
        const at = (toDate(a.inAt) || toDate(a.createdAt) || new Date(0)).getTime();
        const bt = (toDate(b.inAt) || toDate(b.createdAt) || new Date(0)).getTime();
        return bt - at;
      });
      renderList();
    };

    const openTimeEditorFromPill = (pillEl) => {
      if (!pillEl) return;
      const itemEl = pillEl.closest ? pillEl.closest(".visitor-item[data-id]") : null;
      const vid = itemEl ? String(itemEl.getAttribute("data-id") || "").trim() : "";
      if (!vid) return;
      const kind = String(pillEl.getAttribute("data-time-kind") || "").trim() === "out" ? "out" : "in";
      const v = visitors.find((x) => String(x.id || "") === vid) || null;
      const initialDate = v ? (kind === "out" ? toDate(v.outAt) : toDate(v.inAt)) : null;
      openVisitorTimeModal80({ cid: visitorCommunitySlug, visitorId: vid, kind, initialDate, onApplied: applyLocalVisitorPatch });
    };

    const collRef = () => db.collection("communities").doc(String(visitorCommunitySlug || "default")).collection("visitors");

    const subscribeVisitors = () => {
      setStatus("讀取中...", false);

      try {
        const startAt = (slug) => {
          stopVisitorsSubscription();
          visitorCommunitySlug = String(slug || "").trim() || visitorCommunitySlug || "default";
          state.unsubVisitors = collRef()
            .orderBy("createdAt", "desc")
            .onSnapshot(
            (snap) => {
              const list = (snap && snap.docs ? snap.docs : []).map((d) => {
                const v = d.data() || {};
                const rawStatus = String(v.status || "").trim().toLowerCase();
                const passAuthorized = Boolean(v.passAuthorized);
                const status = rawStatus || (passAuthorized ? "approved" : "");
                return {
                  id: d.id,
                  qrToken: String(v.qrToken || ""),
                  name: String(v.name || v.visitorName || ""),
                  email: String(v.email || ""),
                  phone: String(v.phone || ""),
                  unit: String(v.unit || v.visitUnit || ""),
                  plate: String(v.plate || v.carPlate || ""),
                  purpose: String(v.purpose || ""),
                  purposeType: String(v.purposeType || ""),
                  purposeOther: String(v.purposeOther || ""),
                  note: String(v.note || ""),
                  inAt: v.inAt || v.inTime || null,
                  outAt: v.outAt || v.outTime || null,
                  partySize: v.partySize != null ? Number(v.partySize) : null,
                  qrInvalidated: Boolean(v.qrInvalidated),
                  keep: v.keep || null,
                  createdBy: String(v.createdBy || ""),
                  createdByName: String(v.createdByName || ""),
                  createdAt: v.createdAt || null,
                  updatedAt: v.updatedAt || null,
                  status,
                  passAuthorized,
                };
              });
              visitors = list;
              setStatus("", false);
              renderList();
              hydrateCreatorLabels(list).catch(() => {});
            },
            (err) => {
              const code = String(err && err.code ? err.code : "");
              if (code.includes("permission-denied") && visitorCommunityTryIndex + 1 < visitorCommunityCandidates.length) {
                visitorCommunityTryIndex += 1;
                setStatus("讀取中...", false);
                startAt(visitorCommunityCandidates[visitorCommunityTryIndex]);
                return;
              }
              setStatus(code.includes("permission-denied") ? "沒有權限讀取訪客資料。" : "讀取失敗，請稍後再試。", true);
              visitors = [];
              renderList();
            }
            );
        };
        const first = visitorCommunityCandidates[0] || String(cid || "default");
        startAt(first);
      } catch {
        setStatus("讀取失敗，請稍後再試。", true);
      }
    };

    let communityUnits = [];
    const loadCommunityUnits = async () => {
      const candidates = [];
      const add = (v) => {
        const s = String(v || "").trim();
        if (!s || candidates.includes(s)) return;
        candidates.push(s);
      };
      add(visitorCommunitySlug);
      add(cid);
      add(urlCommunityKey);
      try { add(sessionStorage.getItem("csp_last_cid")); } catch {}
      for (const slug of candidates) {
        try {
          const doc = await db.collection("communities").doc(String(slug)).get();
          if (doc && doc.exists) {
            const v = doc.data() || {};
            communityUnits = normalizeUnitList(v.units);
            return;
          }
        } catch {}
      }
      communityUnits = [];
    };

    const openVisitorEditor = async (mode, item) => {
      await loadCommunityUnits();
      const modal = ensureVisitorModal();
      let detach = () => {};
      detach = bindModalClose(modal, () => detach());

      const titleEl = modal.querySelector("#visitorModalTitle");
      const form = modal.querySelector("#visitorModalForm");
      const st = modal.querySelector("#visitorModalStatus");
      const inputName = modal.querySelector("#modal_v_name");
      const inputEmail = modal.querySelector("#modal_v_email");
      const inputPhone = modal.querySelector("#modal_v_phone");
      const inputUnit = modal.querySelector("#modal_v_unit");
      const unitDatalist = modal.querySelector("#visitorUnitOptions");
      const inputPartySize = modal.querySelector("#modal_v_partySize");
      const inputPlate = modal.querySelector("#modal_v_plate");
      const purposeTypeEl = modal.querySelector("#modal_v_purposeType");
      const purposeOtherField = modal.querySelector("#modal_v_purposeOtherField");
      const purposeOtherEl = modal.querySelector("#modal_v_purposeOther");
      const inputNote = modal.querySelector("#modal_v_note");
      const timesRow = modal.querySelector("#modal_v_times_row");
      const inputInAt = modal.querySelector("#modal_v_inAt");
      const inputOutAt = modal.querySelector("#modal_v_outAt");
      const keepCertEl = modal.querySelector("#modal_v_keep_cert");
      const keepCertTypeEl = modal.querySelector("#modal_v_keep_cert_type");
      const keepCardEl = modal.querySelector("#modal_v_keep_card");
      const keepCashEl = modal.querySelector("#modal_v_keep_cash");
      const keepCashAmountEl = modal.querySelector("#modal_v_keep_cash_amount");
      const keepKeyEl = modal.querySelector("#modal_v_keep_key");
      const cancelBtn = modal.querySelector("#btnCancelVisitorModal");
      const closeBtn = modal.querySelector("#btnCloseVisitorModal");
      const submitBtn = modal.querySelector("#btnSubmitVisitorModal");

      const setModalStatus = (msg, isError) => {
        if (!st) return;
        const t = String(msg || "").trim();
        st.textContent = t;
        st.hidden = !t;
        st.classList.toggle("error", Boolean(isError));
      };

      const isEdit = mode === "edit";
      const data = item || {};
      if (titleEl) titleEl.textContent = isEdit ? "編輯訪客" : "新增訪客";
      if (submitBtn) submitBtn.textContent = isEdit ? "更新" : "建立";
      if (inputName) inputName.value = isEdit ? String(data.name || "") : "";
      if (inputEmail) inputEmail.value = isEdit ? String(data.email || "") : "";
      if (inputPhone) inputPhone.value = isEdit ? String(data.phone || "") : "";
      if (inputUnit) inputUnit.value = isEdit ? String(data.unit || "") : "";
      if (inputPartySize) inputPartySize.value = String(isEdit && data.partySize != null ? Number(data.partySize) : 1);
      if (inputPlate) inputPlate.value = isEdit ? String(data.plate || "") : "";
      if (inputNote) inputNote.value = isEdit ? String(data.note || "") : "";
      if (timesRow) timesRow.hidden = !isEdit;
      if (inputInAt) inputInAt.value = isEdit ? toLocalInputValue(toDate(data.inAt)) : "";
      if (inputOutAt) inputOutAt.value = isEdit ? toLocalInputValue(toDate(data.outAt)) : "";

      const normalizePurposeType = (raw) => {
        const v = String(raw || "").trim();
        const known = ["親友拜訪", "施工修繕", "快遞外送", "其他"];
        if (known.includes(v)) return v;
        if (!v) return "親友拜訪";
        return "其他";
      };
      const existingPurpose = String(data.purpose || "");
      const existingPurposeType = normalizePurposeType(String(data.purposeType || existingPurpose));
      const existingOther = existingPurposeType === "其他" ? String(data.purposeOther || (existingPurposeType === existingPurpose ? "" : existingPurpose) || "") : "";
      if (purposeTypeEl) purposeTypeEl.value = existingPurposeType;
      if (purposeOtherEl) purposeOtherEl.value = existingOther;

      const setPurposeOtherVisible = () => {
        const isOther = purposeTypeEl && String(purposeTypeEl.value || "") === "其他";
        if (purposeOtherField) {
          purposeOtherField.hidden = !isOther;
          purposeOtherField.style.display = isOther ? "" : "none";
        }
      };
      setPurposeOtherVisible();
      setModalStatus("", false);

      if (unitDatalist) {
        unitDatalist.innerHTML = communityUnits.map((u) => {
          const uid = (typeof u === "object" && u !== null) ? String(u.id || "") : String(u || "");
          const addr = (typeof u === "object" && u !== null && u.address) ? ` (${u.address})` : "";
          return `<option value="${uid.replace(/"/g, "&quot;")}" label="${addr.replace(/"/g, "&quot;")}"></option>`;
        }).join("");
      }

      const applyKeepState = () => {
        const keepCert = Boolean(keepCertEl && keepCertEl.checked);
        const keepCash = Boolean(keepCashEl && keepCashEl.checked);
        if (keepCertTypeEl) keepCertTypeEl.disabled = !keepCert;
        if (keepCashAmountEl) keepCashAmountEl.disabled = !keepCash;
        if (!keepCert && keepCertTypeEl) keepCertTypeEl.value = "身分證";
        if (!keepCash && keepCashAmountEl) keepCashAmountEl.value = "";
      };

      const loadKeepFromData = () => {
        const keep = (data && data.keep) || {};
        const cert = keep && keep.certificate ? keep.certificate : {};
        const cash = keep && keep.cash ? keep.cash : {};
        if (keepCertEl) keepCertEl.checked = Boolean(cert && cert.enabled);
        if (keepCertTypeEl) keepCertTypeEl.value = String((cert && cert.type) || "身分證");
        if (keepCardEl) keepCardEl.checked = Boolean(keep && keep.businessCard);
        if (keepCashEl) keepCashEl.checked = Boolean(cash && cash.enabled);
        if (keepCashAmountEl) keepCashAmountEl.value = cash && cash.amount != null ? String(cash.amount) : "";
        if (keepKeyEl) keepKeyEl.checked = Boolean(keep && keep.key);
        applyKeepState();
      };
      loadKeepFromData();

      const onCancel = (e) => {
        e.preventDefault();
        modal.hidden = true;
        detach();
      };
      if (cancelBtn) cancelBtn.addEventListener("click", onCancel);
      if (closeBtn) closeBtn.addEventListener("click", onCancel);
      if (purposeTypeEl) purposeTypeEl.addEventListener("change", setPurposeOtherVisible);
      if (keepCertEl) keepCertEl.addEventListener("change", applyKeepState);
      if (keepCashEl) keepCashEl.addEventListener("change", applyKeepState);

      const onSubmit = async (e) => {
        e.preventDefault();
        if (submitBtn) submitBtn.disabled = true;
        setModalStatus("儲存中...", false);

        const name = normalizeText(inputName ? inputName.value : "");
        const email = normalizeText(inputEmail ? inputEmail.value : "");
        const phone = normalizeText(inputPhone ? inputPhone.value : "");
        const unit = normalizeText(inputUnit ? inputUnit.value : "");
        const partySizeRaw = inputPartySize ? Number(inputPartySize.value) : 1;
        const partySize = Number.isFinite(partySizeRaw) && partySizeRaw >= 1 ? Math.floor(partySizeRaw) : 1;
        const plate = normalizeText(inputPlate ? inputPlate.value : "");
        const purposeType = normalizeText(purposeTypeEl ? purposeTypeEl.value : "");
        const purposeOther = normalizeText(purposeOtherEl ? purposeOtherEl.value : "");
        const purpose = purposeType === "其他" ? purposeOther : purposeType;
        const note = normalizeText(inputNote ? inputNote.value : "");
        const inDate = isEdit ? (parseLocalInputValue(inputInAt ? inputInAt.value : "") || toDate(data.inAt) || null) : null;
        const outDate = isEdit ? (parseLocalInputValue(inputOutAt ? inputOutAt.value : "") || null) : null;

        if (!name) {
          setModalStatus("請填寫訪客姓名。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
        if (purposeType === "其他" && !purposeOther) {
          setModalStatus("請填寫到訪事由。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }

        const keep = {
          certificate: {
            enabled: Boolean(keepCertEl && keepCertEl.checked),
            type: String(keepCertTypeEl ? keepCertTypeEl.value : "身分證"),
          },
          businessCard: Boolean(keepCardEl && keepCardEl.checked),
          cash: {
            enabled: Boolean(keepCashEl && keepCashEl.checked),
            amount: keepCashEl && keepCashEl.checked ? Number(keepCashAmountEl ? keepCashAmountEl.value : "") : null,
          },
          key: Boolean(keepKeyEl && keepKeyEl.checked),
        };
        if (!Number.isFinite(keep.cash.amount)) keep.cash.amount = null;

        const Timestamp = firebase.firestore.Timestamp;
        const docRef = isEdit ? collRef().doc(String(data.id || "")) : collRef().doc();
        const id = String(docRef.id || "");
      const creatorLabel = !isEdit ? (await getCreatorLabel80(String((auth.currentUser && auth.currentUser.uid) || "")).catch(() => "") || creatorName) : "";
        const payload = {
          qrToken: id,
          name,
          email,
          phone,
          unit,
          partySize,
          plate,
          purpose,
          purposeType: purposeType === "其他" ? "其他" : purposeType,
          purposeOther: purposeType === "其他" ? purposeOther : "",
          note,
          inAt: isEdit && inDate ? Timestamp.fromDate(inDate) : null,
          outAt: isEdit && outDate ? Timestamp.fromDate(outDate) : null,
          keep,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (!isEdit) {
          payload.createdAt = FieldValue.serverTimestamp();
          payload.createdBy = String((auth.currentUser && auth.currentUser.uid) || "");
        payload.createdByName = String(creatorLabel || "").trim();
          payload.qrIssuedAt = FieldValue.serverTimestamp();
          payload.status = "pending";
          payload.passAuthorized = false;
        }
        try {
          await docRef.set(payload, { merge: true });
        } catch (err) {
          const code = String(err && err.code ? err.code : "");
          setModalStatus(code.includes("permission-denied") ? "沒有權限執行此操作。" : "儲存失敗，請稍後再試。", true);
          if (submitBtn) submitBtn.disabled = false;
          return;
        }

        modal.hidden = true;
        detach();

        const clientCreatedAt = Timestamp.fromDate(new Date());
        try {
          const nextItem = {
            id,
            qrToken: id,
            name,
            email,
            phone,
            unit,
            plate,
            purpose,
            purposeType: payload.purposeType,
            purposeOther: payload.purposeOther,
            note,
            inAt: payload.inAt,
            outAt: payload.outAt,
            partySize,
            keep,
            createdBy: !isEdit ? String((auth.currentUser && auth.currentUser.uid) || "") : String(data.createdBy || ""),
            createdByName: !isEdit ? String(creatorLabel || "").trim() : String(data.createdByName || ""),
            createdAt: !isEdit ? clientCreatedAt : (data.createdAt || null),
            status: !isEdit ? "pending" : (data.status || "pending"),
            passAuthorized: !isEdit ? false : (data.passAuthorized || false),
          };
          const idx = visitors.findIndex((x) => String(x.id || "") === id);
          if (idx >= 0) visitors[idx] = { ...(visitors[idx] || {}), ...nextItem };
          else visitors.unshift(nextItem);

          visitors.sort((a, b) => {
            const at = (toDate(a.inAt) || toDate(a.createdAt) || new Date(0)).getTime();
            const bt = (toDate(b.inAt) || toDate(b.createdAt) || new Date(0)).getTime();
            return bt - at;
          });
          renderList();
          if (!isEdit) toast("登記完成");
        } catch {
          toast("已儲存，但畫面更新失敗");
        }

        if (submitBtn) submitBtn.disabled = false;
      };

      form.addEventListener("submit", onSubmit);
      const oldDetach = detach;
      detach = () => {
        try { form.removeEventListener("submit", onSubmit); } catch {}
        try {
          if (cancelBtn) cancelBtn.removeEventListener("click", onCancel);
          if (closeBtn) closeBtn.removeEventListener("click", onCancel);
        } catch {}
        try {
          if (purposeTypeEl) purposeTypeEl.removeEventListener("change", setPurposeOtherVisible);
          if (keepCertEl) keepCertEl.removeEventListener("change", applyKeepState);
          if (keepCashEl) keepCashEl.removeEventListener("change", applyKeepState);
        } catch {}
        oldDetach();
      };

      modal.hidden = false;
      requestAnimationFrame(() => {
        if (inputName) inputName.focus();
      });
    };

    if (searchEl) searchEl.addEventListener("input", renderList);
    if (dateEl) dateEl.addEventListener("change", renderList);

    if (addBtn) addBtn.addEventListener("click", () => openVisitorEditor("create"));
    if (scanBtn) scanBtn.addEventListener("click", () => openVisitorScanModal80({ cid: visitorCommunitySlug, onApplied: applyLocalVisitorPatch }));
    if (visitorQrBtn) visitorQrBtn.addEventListener("click", () => openVisitorQrModal80({ communityId: cid, communityName: cname }));

    if (listEl && !listEl._timePillBound) {
      listEl._timePillBound = true;
      listEl.addEventListener("click", (e) => {
        const pill = e.target && e.target.closest ? e.target.closest(".time-pill[data-time-kind]") : null;
        if (!pill || !listEl.contains(pill)) return;
        e.preventDefault();
        openTimeEditorFromPill(pill);
      });
      listEl.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const pill = e.target && e.target.closest ? e.target.closest(".time-pill[data-time-kind]") : null;
        if (!pill || !listEl.contains(pill)) return;
        e.preventDefault();
        openTimeEditorFromPill(pill);
      });
    }

    if (listEl) {
      listEl.addEventListener("click", async (e) => {
        const row = e.target && e.target.closest ? e.target.closest(".visitor-item") : null;
        if (!row) return;
        const id = row.getAttribute("data-id");
        const v = visitors.find((x) => String(x.id || "") === String(id || "")) || null;
        if (!id || !v) return;

        const editBtn = e.target.closest("[data-edit]");
        if (editBtn) {
          openVisitorEditor("edit", v);
          return;
        }

        const passBtn = e.target.closest("[data-pass]");
        if (passBtn) {
          const isPending = String(v.status || "").toLowerCase() === "pending";
          if (isPending) {
            const ok = await (window.nwConfirm ? window.nwConfirm({
              title: "訪客核准",
              message: `是否同意訪客「${String(v.name || "")}」的登記並核發訪客證？`,
              okText: "同意",
              cancelText: "不同意",
              danger: false,
            }) : Promise.resolve(window.confirm("是否同意核准？")));
            
            if (ok) {
              try {
                await collRef().doc(String(id)).update({
                  status: "approved",
                  passAuthorized: true,
                  updatedAt: FieldValue.serverTimestamp(),
                });
                v.status = "approved";
                v.passAuthorized = true;
                renderList();
                openVisitorPassModal80({
                  cid: visitorCommunitySlug,
                  communityName: cname,
                  visitorId: id,
                  qrToken: String(v.qrToken || "").trim(),
                  name: String(v.name || ""),
                  unit: String(v.unit || ""),
                  purpose: String(v.purpose || ""),
                  phone: String(v.phone || ""),
                  plate: String(v.plate || ""),
                  email: String(v.email || ""),
                  partySize: v.partySize != null ? Number(v.partySize) : 1,
                  keep: v.keep || null,
                  createdAt: v.createdAt || null,
                  createdByName: String(v.createdByName || "").trim(),
                  inAt: v.inAt || null,
                  outAt: v.outAt || null,
                });
              } catch (err) {
                toast("核准失敗");
              }
            }
            return;
          }

          let createdByLabel = String(v.createdByName || "").trim();
          if (v.createdBy) {
            const resolved = await getCreatorLabel80(String(v.createdBy || "")).catch(() => "");
            if (String(resolved || "").trim()) createdByLabel = String(resolved || "").trim();
          }
          openVisitorPassModal80({
            cid: visitorCommunitySlug,
            communityName: cname,
            visitorId: id,
            qrToken: String(v.qrToken || "").trim(),
            name: String(v.name || ""),
            unit: String(v.unit || ""),
            purpose: String(v.purpose || ""),
            phone: String(v.phone || ""),
            plate: String(v.plate || ""),
            email: String(v.email || ""),
            partySize: v.partySize != null ? Number(v.partySize) : 1,
            keep: v.keep || null,
            createdAt: v.createdAt || null,
            createdByName: createdByLabel,
            inAt: v.inAt || null,
            outAt: v.outAt || null,
          });
          return;
        }
        const delBtn = e.target.closest("[data-delete]");
        if (delBtn) {
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "確認刪除",
            message: `確定要刪除訪客「${String(v.name || id)}」的登記？`,
            okText: "刪除",
            cancelText: "取消",
            danger: true,
          }) : Promise.resolve(window.confirm("確定要刪除？")));
          if (!ok) return;
          delBtn.disabled = true;
          try {
            await collRef().doc(String(id)).delete();
            visitors = visitors.filter((x) => String(x.id || "") !== String(id));
            renderList();
          } catch {
            toast("刪除失敗");
          } finally {
            delBtn.disabled = false;
          }
        }
      });
    }

    subscribeVisitors();
    updateFooterActiveNav();
  }

  function setupDashboardReorder(grid) {
    if (!grid || grid._reorderBound) return;
    grid._reorderBound = true;

    let pressTimer = 0;
    let dragging = false;
    let draggingEl = null;
    let pressedEl = null;
    let placeholderEl = null;
    let ghostEl = null;
    let didDrag = false;
    let lastPointerId = null;
    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let detachDocListeners = () => {};

    const clearPressTimer = () => {
      if (pressTimer) window.clearTimeout(pressTimer);
      pressTimer = 0;
    };

    const stopDragging = () => {
      clearPressTimer();
      detachDocListeners();
      detachDocListeners = () => {};
      if (!dragging) return;
      dragging = false;
      if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
      ghostEl = null;
      if (placeholderEl && placeholderEl.parentNode && draggingEl) {
        try {
          placeholderEl.parentNode.insertBefore(draggingEl, placeholderEl);
        } catch {}
        placeholderEl.parentNode.removeChild(placeholderEl);
      }
      placeholderEl = null;
      if (draggingEl) draggingEl.style.display = "";
      if (draggingEl) draggingEl.classList.remove("dragging");
      if (draggingEl) draggingEl.classList.remove("pressing");
      draggingEl = null;
      if (pressedEl) pressedEl.classList.remove("pressing");
      pressedEl = null;
      grid.classList.remove("reorder-mode");
      const cid = resolveActiveCommunityId();
      const ids = Array.from(grid.querySelectorAll(".card[data-id]"))
        .map((el) => String(el.getAttribute("data-id") || "").trim())
        .filter(Boolean);
      saveModuleOrder(cid, ids);
      renderFooterNav();
      updateFooterActiveNav();
    };

    const updateGhostPosition = (e) => {
      if (!ghostEl) return;
      const x = Math.round(e.clientX - offsetX);
      const y = Math.round(e.clientY - offsetY);
      ghostEl.style.left = `${x}px`;
      ghostEl.style.top = `${y}px`;
    };

    const movePlaceholder = (clientX, clientY) => {
      if (!placeholderEl) return;
      const el = document.elementFromPoint(clientX, clientY);
      const over = el && el.closest ? el.closest(".card[data-id]") : null;
      if (!over || !grid.contains(over)) return;
      if (over === placeholderEl) return;
      if (draggingEl && over === draggingEl) return;
      const rect = over.getBoundingClientRect();
      const before = clientY < rect.top + rect.height / 2;
      if (before) {
        if (over.previousElementSibling !== placeholderEl) grid.insertBefore(placeholderEl, over);
      } else {
        if (over.nextElementSibling !== placeholderEl) grid.insertBefore(placeholderEl, over.nextElementSibling);
      }
    };

    grid.addEventListener("pointerdown", (e) => {
      const card = e.target && e.target.closest ? e.target.closest(".card[data-id]") : null;
      if (!card || !grid.contains(card)) return;
      if (e.target && e.target.closest && e.target.closest("button,a,input,textarea,select,label")) return;
      didDrag = false;
      lastPointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      if (pressedEl && pressedEl !== card) pressedEl.classList.remove("pressing");
      pressedEl = card;
      card.classList.add("pressing");
      clearPressTimer();
      pressTimer = window.setTimeout(() => {
        dragging = true;
        didDrag = true;
        draggingEl = card;
        grid.classList.add("reorder-mode");
        card.classList.add("dragging");
        card.classList.remove("pressing");

        const rect = card.getBoundingClientRect();
        offsetX = startX - rect.left;
        offsetY = startY - rect.top;

        placeholderEl = document.createElement("div");
        placeholderEl.className = "card placeholder";
        placeholderEl.style.height = `${Math.round(rect.height)}px`;
        placeholderEl.style.width = `${Math.round(rect.width)}px`;
        grid.insertBefore(placeholderEl, card);

        ghostEl = card.cloneNode(true);
        ghostEl.classList.add("drag-ghost");
        ghostEl.style.display = "";
        ghostEl.style.width = `${Math.round(rect.width)}px`;
        ghostEl.style.height = `${Math.round(rect.height)}px`;
        ghostEl.style.left = `${Math.round(rect.left)}px`;
        ghostEl.style.top = `${Math.round(rect.top)}px`;
        document.body.appendChild(ghostEl);
        card.style.display = "none";

        const onMove = (ev) => {
          if (!dragging) return;
          updateGhostPosition(ev);
          movePlaceholder(ev.clientX, ev.clientY);
          ev.preventDefault();
        };
        const onUp = () => stopDragging();
        document.addEventListener("pointermove", onMove, { passive: false });
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
        detachDocListeners = () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
        };

        updateGhostPosition({ clientX: startX, clientY: startY });
        movePlaceholder(startX, startY);
      }, 380);
    });

    grid.addEventListener("pointerup", () => {
      clearPressTimer();
      if (pressedEl) pressedEl.classList.remove("pressing");
      pressedEl = null;
    });
    grid.addEventListener("pointercancel", () => {
      clearPressTimer();
      if (pressedEl) pressedEl.classList.remove("pressing");
      pressedEl = null;
      stopDragging();
    });

    grid.addEventListener("click", (e) => {
      if (!didDrag) return;
      e.preventDefault();
      e.stopPropagation();
      didDrag = false;
    }, true);
  }

  function renderDashboard() {
    const layoutEl = document.querySelector(".layout");
    if (layoutEl) layoutEl.classList.remove("visitor-main-lock");
    if (subnavEl) subnavEl.innerHTML = "";
    stopVisitorsSubscription();
    contentEl.innerHTML = `
      <div class="grid" id="moduleGrid"></div>
    `;
    const grid = document.getElementById("moduleGrid");
    grid.innerHTML = orderedModules().map((m) => {
      const cfg = resolveUrl(m.id);
      const disabled = !cfg.enabled || !cfg.url;
      return `
        <article class="card" data-id="${m.id}">
          <div class="card-hd">
            <div class="left">
              <div class="chip" aria-hidden="true">${iconSvg(m.id)}</div>
              <div style="min-width:0;">
                <h2>${m.name}</h2>
                <p>${m.desc}</p>
              </div>
            </div>
            <span class="tag ${disabled ? "" : "red"}">${disabled ? "停用" : m.badge}</span>
          </div>
          <div class="card-bd">
            <div class="row">
              <div class="muted">${disabled ? "此功能已停用或未設定連結" : cfg.url}</div>
            </div>
            <button class="btn ${disabled ? "" : "btn-primary"}" type="button" data-open ${disabled ? "disabled" : ""}>進入</button>
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest("[data-id]");
        const id = card.getAttribute("data-id");
        const { url } = resolveUrl(id);
        if (!url) {
          toast("尚未設定連結（示意）");
          return;
        }
        location.href = url;
      });
    });
    updateFooterActiveNav();
    setupDashboardReorder(grid);
  }

  function renderModule(moduleId) {
    const layoutEl = document.querySelector(".layout");
    if (layoutEl) layoutEl.classList.toggle("visitor-main-lock", moduleId === "visitor");
    if (moduleId !== "visitor") stopVisitorsSubscription();
    if (moduleId !== "residents") stopResidentsSubscription();
    if (moduleId !== "parcel") stopParcelsSubscription();
    const gate = getButtonConfig(moduleId);
    if (gate && gate.enabled === false) {
      toast("此功能未開放（示意）");
      renderDashboard();
      return;
    }
    if (moduleId === "residents") {
      renderResidentsModule();
      return;
    }
    if (moduleId === "visitor") {
      renderVisitorModule();
      return;
    }
    if (moduleId === "parcel") {
      renderParcelModule();
      return;
    }
    if (moduleId === "facility") {
      renderFacilityModule();
      return;
    }
    if (subnavEl) subnavEl.innerHTML = "";
    const m = moduleCatalog.find((x) => x && x.id === moduleId) || null;
    if (!m) {
      toast("尚未設定此頁面（示意）");
      renderDashboard();
      return;
    }
    contentEl.innerHTML = `
      <section class="card">
        <div class="card-hd">
          <div class="left">
            <div class="chip" aria-hidden="true">${iconSvg(m.id)}</div>
            <div style="min-width:0;">
              <h2>${m.name}</h2>
              <p>${m.desc}</p>
            </div>
          </div>
          <span class="tag red">${m.badge || ""}</span>
        </div>
        <div class="card-bd">
          <div class="row">
            <div class="muted">此功能頁面尚未建置（示意）。</div>
          </div>
          <button class="btn" type="button" data-back>返回總覽</button>
        </div>
      </section>
    `;
    const backBtn = contentEl.querySelector("[data-back]");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        location.hash = "#community/community-dashboard";
      });
    }
    updateFooterActiveNav();
  }

  function handleHashRoute() {
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    const parts = raw.split("/");
    if (parts[0] !== "community") return false;
    const moduleId = parts[1] || "community-dashboard";
    if (moduleId === "community-dashboard") return false;
    renderModule(moduleId);
    return true;
  }

  if (globalSearchEl) {
    globalSearchEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      toast(`搜尋：「${globalSearchEl.value || "（空）"}」（示意）`);
    });
  }

  if (roleSelectEl) {
    roleSelectEl.addEventListener("change", () => {
      const roleId = roleSelectEl.value;
      if (roleId === "admin") {
        location.href = "system.html";
        return;
      }
      if (roleId === "resident") {
        location.href = "member.html";
        return;
      }
      location.href = "admin.html#community/community-dashboard";
    });
  }

  const bindSignOut = () => {
    const btn = document.getElementById("btnSignOut");
    if (!btn || btn._boundSignOut) return;
    btn._boundSignOut = true;
    btn.addEventListener("click", async () => {
      try {
        sessionStorage.removeItem("csp_role");
        sessionStorage.removeItem("csp_sysadmin");
        await auth.signOut();
      } catch {}
      location.href = "index.html";
    });
  };
  bindSignOut();

  function openAppDownloadModal80() {
    const cid = resolveActiveCommunityId();
    const community = state.communities.find(c => c.id === cid) || { id: cid, name: "預設社區" };
    const communityKey = community.username || community.id;

    let modal = document.getElementById("appDownloadModal");
    if (modal) {
      const infoEl = modal.querySelector(".a4-community-info");
      if (infoEl) {
        infoEl.innerHTML = `
          <span class="cid"><span class="prefix">社區代號：</span>${escapeHtml(communityKey)}</span>
          <span class="cname">${escapeHtml(community.name)}</span>
        `;
      }
    }

    if (!modal) {
      modal = document.createElement("div");
      modal.className = "modal";
      modal.id = "appDownloadModal";
      modal.hidden = true;
      modal.innerHTML = `
        <div class="modal-backdrop" data-modal-close="1"></div>
        <div class="modal-dialog a4-preview-dialog" role="dialog" aria-modal="true">
          <div class="modal-hd">
            <h3 class="modal-title">生活網 APP 下載說明</h3>
            <div class="modal-actions">
              <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
            </div>
          </div>
          <div class="modal-body a4-body">
            <div class="a4-page-scaler" id="appGuideScaler">
              <div class="a4-page" id="appGuidePage">
                <div class="a4-decor a4-decor-tl"></div>
                <div class="a4-decor a4-decor-br"></div>
                <div class="a4-illustration">
                  <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="100" cy="100" r="80" stroke="#d32f2f" stroke-width="2" stroke-dasharray="10 10" opacity="0.2"/>
                    <path d="M100 20V180M20 100H180" stroke="#d32f2f" stroke-width="1" opacity="0.1"/>
                  </svg>
                </div>
                <div class="a4-content">
                  <div class="a4-header">
                    <img src="logo.svg?v=4" class="a4-logo" alt="生活網" />
                    <h1 class="a4-title">生活網</h1>
                    <p class="a4-subtitle">智慧社區服務系統｜住戶端 APP</p>
                  </div>
                  
                  <div class="a4-section">
                    <h2 class="a4-sec-title">立即下載體驗</h2>
                    <div class="a4-qr-wrap">
                      <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=https://nw-app.github.io/nw-app-v2/" class="a4-qr" alt="APP QR Code" />
                      <p class="a4-qr-hint">掃描上方 QR Code 開啟下載頁面</p>
                    </div>
                    <div class="a4-community-info">
                      <span class="cid"><span class="prefix">社區代號：</span>${escapeHtml(communityKey)}</span>
                      <span class="cname">${escapeHtml(community.name)}</span>
                    </div>
                  </div>

                  <div class="a4-section instructions">
                    <h2 class="a4-sec-title">下載與安裝說明</h2>
                    <div class="instruction-steps">
                      <div class="step">
                        <div class="step-num">1</div>
                        <div class="step-text">使用手機相機或掃描器掃描上方 QR Code。</div>
                      </div>
                      <div class="step">
                        <div class="step-num">2</div>
                        <div class="step-text">點擊連結進入「生活網」官方下載頁面。</div>
                      </div>
                      <div class="step">
                        <div class="step-num">3</div>
                        <div class="step-text">依據您的裝置系統（iOS / Android）點擊下載並安裝。</div>
                      </div>
                      <div class="step">
                        <div class="step-num">4</div>
                        <div class="step-text">安裝完成後，開啟 APP 並使用社區提供的帳號登入。</div>
                      </div>
                    </div>
                  </div>

                  <div class="a4-footer">
                    <p>如有任何安裝問題，請洽社區管理室。</p>
                    <p class="copyright">© 2026 生活網｜西北保全 & 西北物業</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" id="btnPrintAppGuide">列印</button>
            <button class="btn" type="button" data-modal-close="1">關閉</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const printBtn = modal.querySelector("#btnPrintAppGuide");
      if (printBtn) {
        printBtn.onclick = () => {
          const content = modal.querySelector("#appGuidePage").innerHTML;
          const win = window.open("", "_blank");
          win.document.write(`
            <html>
              <head>
                <title>生活網 APP 下載說明</title>
                <link rel="stylesheet" href="css/admin.css">
                <style>
                  body { margin: 0; padding: 0; }
                  .a4-page { width: 210mm; height: 297mm; padding: 20mm; margin: 0 auto; box-sizing: border-box; background: white; }
                  @media print {
                    .a4-page { width: 100%; height: 100%; margin: 0; padding: 15mm; border: none; }
                  }
                </style>
              </head>
              <body onload="window.print();window.close()">
                <div class="a4-page">${content}</div>
              </body>
            </html>
          `);
          win.document.close();
        };
      }
    }

    bindModalClose(modal);

    const updateAppGuideScale = () => {
      const scaler = modal.querySelector("#appGuideScaler");
      const page = modal.querySelector("#appGuidePage");
      const body = modal.querySelector(".a4-body");
      if (!scaler || !page || !body || modal.hidden) return;

      const bodyW = body.clientWidth;
      const bodyH = body.clientHeight;
      const pageW = page.offsetWidth;
      const pageH = page.offsetHeight;

      const scaleW = bodyW / pageW;
      const scaleH = bodyH / pageH;
      const scale = Math.min(scaleW, scaleH, 1) * 0.95; // 保持 5% 邊距

      scaler.style.transform = `scale(${scale})`;
    };

    const oldHidden = modal.hidden;
    Object.defineProperty(modal, "hidden", {
      get: () => modal.getAttribute("hidden") !== null,
      set: (val) => {
        if (val) modal.setAttribute("hidden", "");
        else {
          modal.removeAttribute("hidden");
          setTimeout(updateAppGuideScale, 0);
        }
      }
    });

    window.addEventListener("resize", updateAppGuideScale);

    modal.hidden = false;
  }

  const bindTitleClick = () => {
    const titleEl = document.querySelector("header .brand .meta .title");
    if (titleEl) {
      titleEl.style.cursor = "pointer";
      titleEl.onclick = () => openAppDownloadModal80();
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    bindSignOut();
    bindTitleClick();
  });

  auth.onAuthStateChanged(async (user) => {
    const redirectToIndex = () => {
      if (window.__nw_redirecting) return;
      window.__nw_redirecting = true;
      location.replace("index.html");
    };

    if (!user) {
      redirectToIndex();
      return;
    }

    let role = String(sessionStorage.getItem("csp_role") || "").trim().toLowerCase();
    if (!role) {
      try {
        const udoc = await db.collection("users").doc(String(user.uid)).get();
        const udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
        const r = String(udata.role || "").trim();
        if (r === "admin" || r === "系統管理員" || r === "系統管理者" || r === "系統") role = "admin";
        else if (r === "community" || r === "社區") role = "community";
        else if (r) role = "resident";
        if (role) sessionStorage.setItem("csp_role", role);
      } catch {}
    }

    if (role && role !== "community" && role !== "admin") {
      if (role === "resident") {
        const key = readUrlCommunityKey();
        const cPart = key ? `?c=${encodeURIComponent(key)}` : "";
        if (!window.__nw_redirecting) {
          window.__nw_redirecting = true;
          location.replace(`member.html${cPart}`);
        }
        return;
      }
      redirectToIndex();
      return;
    }

    refreshLoginInfo(user);
    ensureUrlCommunityKey(user).then(() => refreshLoginInfo(user)).catch(() => {});
    const fallback = document.getElementById("userAvatarFallback");
    if (fallback) fallback.textContent = String(user.email || "U").trim().slice(0, 1).toUpperCase() || "U";
    ensureCommunitiesSubscription(user);
    if (!handleHashRoute()) renderDashboard();
    updateFooterActiveNav();
  });

  window.addEventListener("hashchange", () => {
    if (!handleHashRoute()) renderDashboard();
    updateFooterActiveNav();
  });
})();
