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
    creatorLabelByUid: new Map(),
    creatorFetches: new Map(),
  };

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
      { id: "community-dashboard", label: "總覽", url: "admin.html#community/community-dashboard", icon: homeSvg() },
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
        <span class="label">${String(x.label)}</span>
      </a>
    `.trim()).join("");
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
          <button class="btn" type="button" id="btnCopyVisitorQrUrl">複製</button>
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
    const btnCopy = modal.querySelector("#btnCopyVisitorQrUrl");
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
    const u = new URL("visitor.html", location.href);
    u.searchParams.set("c", key);
    const fixedUrl = u.toString();
    if (inputEl) inputEl.value = fixedUrl;

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
    renderQr();
    setStatus("提示：此網址為固定產生（依社區）。", false);

    const onCopy = async () => {
      const url = String(inputEl ? inputEl.value : "").trim();
      if (!url) return;
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(url);
          toast("已複製");
          return;
        }
      } catch {}
      try {
        window.prompt("複製此網址", url);
      } catch {}
    };

    const onOpen = () => {
      const url = String(inputEl ? inputEl.value : "").trim();
      if (!url) return;
      try { window.open(url, "_blank", "noopener,noreferrer"); } catch { location.href = url; }
    };

    if (btnCopy) btnCopy.addEventListener("click", onCopy);
    if (btnOpen) btnOpen.addEventListener("click", onOpen);
    const oldDetach = detach;
    detach = () => {
      try { if (btnCopy) btnCopy.removeEventListener("click", onCopy); } catch {}
      try { if (btnOpen) btnOpen.removeEventListener("click", onOpen); } catch {}
      oldDetach();
    };

    modal.hidden = false;
    requestAnimationFrame(() => {
      if (inputEl && inputEl.focus) inputEl.focus();
    });
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

  function openVisitorPassModal80({ cid, communityName, visitorId, name, unit, purpose, phone, plate, email, partySize, keep, createdAt, createdByName, inAt, outAt, autoSendEmail }) {
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

    const qrData = `nwapp://visitor-pass?cid=${String(cid || "")}&vid=${String(visitorId || "")}&t=${String(visitorId || "")}`;
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
      try {
        if (navigator && typeof navigator.share === "function") {
          try {
            const resp = await fetch(qrSrc, { cache: "no-store" });
            const blob = await resp.blob();
            const file = new File([blob], "visitor-pass-qr.png", { type: blob.type || "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ title: "訪客證", text: shareText, files: [file] });
              return;
            }
          } catch {}
          await navigator.share({ title: "訪客證", text: shareText });
          return;
        }
      } catch {}
      const url = `https://social-plugins.line.me/lineit/share?text=${encodeURIComponent(shareText)}`;
      try { window.open(url, "_blank", "noopener,noreferrer"); } catch { location.href = url; }
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

    const pad2 = (n) => String(n).padStart(2, "0");
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
      if (!cid || !vid) return null;
      return { cid, vid };
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
    if (!mCid || !mVid) return null;
    const cid = decodeURIComponent(String(mCid[1] || "").trim());
    const vid = decodeURIComponent(String(mVid[1] || "").trim());
    if (!cid || !vid) return null;
    return { cid, vid };
  }

  function formatYmdHms(d) {
    if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return "";
    const pad2 = (n) => String(n).padStart(2, "0");
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

    const start = async () => {
      setStatus("", false);
      if (hintEl) hintEl.textContent = "請將訪客證 QR code 對準框線。";
      if (stageEl) stageEl.hidden = false;

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        setStatus("此瀏覽器不支援相機功能。", true);
        return;
      }

      running = true;
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
        setStatus("無法開啟相機，請確認已允許相機權限。", true);
        running = false;
        stop();
        return;
      }

      const handleScan = async (rawValue) => {
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

      const schedule = (fn) => {
        loopTimer = window.setTimeout(fn, 180);
      };

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
                  await handleScan(rawValue);
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
              await handleScan(rawValue);
            }
          }
        } catch {}
        schedule(scanOnce);
      };
      scanOnce();
    };

    modal.hidden = false;
    requestAnimationFrame(() => {
      const closeBtn = modal.querySelector(".modal-close");
      if (closeBtn && closeBtn.focus) closeBtn.focus();
    });
    start();
  }

  function normalizePhoneDigits(input) {
    const raw = String(input || "").trim();
    let digits = raw.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("886") && digits.length === 12) digits = `0${digits.slice(3)}`;
    return digits;
  }

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
              <select id="modal_r_community" required></select>
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
          <h3 class="modal-title" id="unitsModalTitle">戶號列表 <span class="unit-modal-count" id="unitsModalCount">總戶數：—</span></h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="unitsForm">
          <div class="modal-body">
            <div class="status" id="unitsStatus" hidden></div>
            <div class="profile-item">
              <div class="profile-label">戶號列表（每行一戶）</div>
              <textarea id="unitsText" class="units-text" placeholder="例如：&#10;A1101&#10;A1102"></textarea>
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

  function renderResidentsModule() {
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
          <div class="resident-page-actions">
            <button class="btn" type="button" id="btnUnits">戶號列表</button>
            <button class="btn btn-primary" type="button" id="btnAddResident">新增帳號</button>
          </div>
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
        const v = String(x || "").trim();
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

    const avatarHtml = (r) => {
      const name = String(r.displayName || r.name || r.email || "U").trim();
      const initial = name.slice(0, 1).toUpperCase() || "U";
      const url = String(r.avatarDataUrl || "").trim();
      if (url) return `<img class="avatar-img" alt="" src="${url}">`;
      return `<span class="avatar-fallback" aria-hidden="true">${initial}</span>`;
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
          const phone = String(r.phone || "").trim();
          const email = String(r.email || "").trim();
          const subParts = [houseNo, phone, email].filter(Boolean);
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
        const snap = await db.collection("users").where("community", "==", String(cid || "default")).get();
        const list = snap.docs
          .map((d) => {
            const v = d.data() || {};
            return {
              id: d.id,
              role: String(v.role || ""),
              houseNo: String(v.houseNo || v.unit || ""),
              displayName: String(v.displayName || v.name || ""),
              email: String(v.email || v.username || ""),
              phone: String(v.phone || ""),
              enabled: v.enabled !== false,
              address: String(v.address || ""),
              avatarDataUrl: String(v.avatarDataUrl || ""),
              phoneNormalized: String(v.phoneNormalized || ""),
            };
          })
          .filter((x) => isResidentRole(x.role));

        list.sort((a, b) => {
          const ah = String(a.houseNo || "");
          const bh = String(b.houseNo || "");
          if (ah !== bh) return ah.localeCompare(bh, "zh-Hant");
          return String(a.displayName || "").localeCompare(String(b.displayName || ""), "zh-Hant");
        });

        residents = list;
        setStatus("", false);
        renderList();
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限讀取住戶資料。" : "讀取失敗，請稍後再試。", true);
        residents = [];
        renderList();
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
        inputCommunity.innerHTML = `<option value="${String(cid || "default")}">${String(cname || cid || "—")}</option>`;
        inputCommunity.value = String(cid || "default");
        inputCommunity.disabled = true;
      }
      if (inputUnit) inputUnit.value = isEdit ? String(data.houseNo || "") : "";
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
        const ok = Boolean(unit) && normalizeUnitList(communityUnits).some((x) => x === unit);
        unitMatchBadge.hidden = !ok;
        unitMatchBadge.classList.toggle("show", ok);
        unitMatchBadge.style.display = ok ? "inline-flex" : "none";
      };

      const sha256Hex = async (text) => {
        const v = String(text || "");
        const cryptoObj = window.crypto && window.crypto.subtle ? window.crypto : null;
        if (!cryptoObj) return "";
        const data = new TextEncoder().encode(v);
        const hashBuf = await cryptoObj.subtle.digest("SHA-256", data);
        const bytes = Array.from(new Uint8Array(hashBuf));
        return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
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

          const communityCode = c ? String(c.username || "") : "";
          const payload = {
            role: "住戶",
            community: String(cid || "default"),
            houseNo: unit,
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
          const code = String(err && err.code ? err.code : "");
          const msg =
            code.includes("auth/email-already-in-use") ? "此電子郵件已被使用。" :
            code.includes("auth/invalid-email") ? "電子郵件格式不正確。" :
            code.includes("auth/weak-password") ? "密碼強度不足（請確認手機號碼）。" :
            code.includes("permission-denied") ? "沒有權限執行此操作。" :
            "儲存失敗，請稍後再試。";
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
      const ta = modal.querySelector("#unitsText");
      const st = modal.querySelector("#unitsStatus");
      const countEl = modal.querySelector("#unitsModalCount");

      const setModalStatus = (msg, isError) => {
        if (!st) return;
        const t = String(msg || "").trim();
        st.textContent = t;
        st.hidden = !t;
        st.classList.toggle("error", Boolean(isError));
      };

      setModalStatus("讀取中...", false);
      modal.hidden = false;
      try {
        const doc = await db.collection("communities").doc(String(cid || "default")).get();
        const v = doc && doc.exists ? (doc.data() || {}) : {};
        const units = normalizeUnitList(v.units);
        communityUnits = units;
        refreshUnitTotals();
        if (countEl) countEl.textContent = `總戶數：${units.length}`;
        if (ta) ta.value = units.join("\n");
        setModalStatus("", false);
      } catch {
        if (ta) ta.value = "";
        if (countEl) countEl.textContent = "總戶數：—";
        setModalStatus("讀取失敗，請稍後再試。", true);
      }

      const onSubmit = async (e) => {
        e.preventDefault();
        const raw = String(ta ? ta.value : "");
        const lines = raw.split(/\r?\n/).map((x) => String(x || "").trim()).filter(Boolean);
        const uniq = [];
        const seen = new Set();
        for (const x of lines) {
          if (seen.has(x)) continue;
          seen.add(x);
          uniq.push(x);
        }
        if (uniq.length === 0) {
          setModalStatus("請至少輸入 1 個戶號（每行一戶）。", true);
          return;
        }
        setModalStatus("儲存中...", false);
        try {
          await db.collection("communities").doc(String(cid || "default")).set(
            { units: uniq, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
          const clean = normalizeUnitList(uniq);
          communityUnits = clean;
          refreshUnitTotals();
          modal.hidden = true;
          detach();
        } catch (err) {
          const code = String(err && err.code ? err.code : "");
          setModalStatus(code.includes("permission-denied") ? "沒有權限執行此操作。" : "儲存失敗，請稍後再試。", true);
        }
      };

      form.addEventListener("submit", onSubmit);
      const oldDetach = detach;
      detach = () => {
        try {
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
          <div class="resident-page-actions">
            <button class="btn" type="button" id="btnVisitorQr">訪客QR Code</button>
            <button class="btn" type="button" id="btnScanVisitor">掃碼登記</button>
            <button class="btn btn-primary" type="button" id="btnAddVisitor">新增訪客</button>
          </div>
        </div>
        <div class="card-bd" id="visitorPanel">
          <div class="visitor-toolbar">
            <div class="visitor-total" id="visitorTotal">總筆數：—</div>
            <div class="search visitor-search">
              <input id="visitorSearch" type="text" placeholder="搜尋 姓名 / 手機 / 車牌 / 事由" autocomplete="off" />
            </div>
          </div>
          <div class="status" id="visitorStatus" hidden></div>
          <div class="visitor-list" id="visitorList"></div>
        </div>
      </section>
    `.trim();

    const panelEl = document.getElementById("visitorPanel");
    const listEl = document.getElementById("visitorList");
    const statusEl = document.getElementById("visitorStatus");
    const searchEl = document.getElementById("visitorSearch");
    const visitorQrBtn = document.getElementById("btnVisitorQr");
    const scanBtn = document.getElementById("btnScanVisitor");
    const addBtn = document.getElementById("btnAddVisitor");
    const totalEl = document.getElementById("visitorTotal");

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const pad2 = (n) => String(n).padStart(2, "0");
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
      const filtered = q
        ? visitors.filter((x) => {
            const n = String(x.name || "").toLowerCase();
            const p = String(x.phone || "").toLowerCase();
            const em = String(x.email || "").toLowerCase();
            const unit = String(x.unit || "").toLowerCase();
            const plate = String(x.plate || "").toLowerCase();
            const purpose = String(x.purpose || "").toLowerCase();
            return n.includes(q) || p.includes(q) || em.includes(q) || unit.includes(q) || plate.includes(q) || purpose.includes(q);
          })
        : visitors;

      if (totalEl) totalEl.textContent = `總筆數：${visitors.length}`;
      if (!listEl) return;
      if (!filtered.length) {
        listEl.innerHTML = `<div class="status">尚無訪客登記。</div>`;
        return;
      }

      listEl.innerHTML = filtered
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
          return `
            <div class="visitor-item" data-id="${String(v.id || "")}">
              <div class="visitor-left">
                <div class="visitor-text">
                  <div class="visitor-name">${name}</div>
                  <div class="visitor-sub">${subHtml}</div>
                  <div class="visitor-sub2">${sub2Html}</div>
                  <div class="visitor-keep"><span class="field-k">車牌：</span>${escapeHtml(plateText)}｜<span class="field-k">留存：</span>${escapeHtml(keepText || "無")}</div>
                  <div class="visitor-created"><span class="field-k">建立：</span>${escapeHtml(createdText || "—")}｜<span class="field-k">建立者：</span>${escapeHtml(createdByName || "—")}</div>
                  <div class="visitor-meta">
                    <span class="time-pill in" role="button" tabindex="0" data-time-kind="in">來訪：${inText || "—"}</span>
                    <span class="time-pill out" role="button" tabindex="0" data-time-kind="out">離開：${outText || "—"}</span>
                  </div>
                </div>
              </div>
              <div class="visitor-actions">
                <button class="icon-btn" type="button" data-pass aria-label="訪客證" title="訪客證">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6.5 4.8h11A2.2 2.2 0 0 1 19.7 7v10A2.2 2.2 0 0 1 17.5 19.2h-11A2.2 2.2 0 0 1 4.3 17V7A2.2 2.2 0 0 1 6.5 4.8Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M8 9.2h2.2M13.8 9.2H16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M8 12h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M8 14.8h5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M15.4 14.2a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 0 0-2.8 0Z" stroke="currentColor" stroke-width="1.7"/>
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
            .limit(200)
            .onSnapshot(
            (snap) => {
              const list = (snap && snap.docs ? snap.docs : []).map((d) => {
                const v = d.data() || {};
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
        if (purposeOtherField) purposeOtherField.hidden = !isOther;
      };
      setPurposeOtherVisible();
      setModalStatus("", false);

      if (unitDatalist) {
        unitDatalist.innerHTML = communityUnits.map((u) => `<option value="${String(u).replace(/"/g, "&quot;")}"></option>`).join("");
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
        } catch {
          toast("已儲存，但畫面更新失敗");
        }

        if (!isEdit) {
          try {
            openVisitorPassModal80({
              cid: visitorCommunitySlug,
              communityName: cname,
              visitorId: id,
              name,
              unit,
              purpose,
              phone,
              plate,
              email,
              partySize,
              keep,
              createdAt: clientCreatedAt,
              createdByName: String(creatorName || "").trim(),
              inAt: null,
              outAt: null,
              autoSendEmail: true,
            });
          } catch {
            toast("已儲存，但無法開啟訪客證");
          }
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
          let createdByLabel = String(v.createdByName || "").trim();
          if (v.createdBy) {
            const resolved = await getCreatorLabel80(String(v.createdBy || "")).catch(() => "");
            if (String(resolved || "").trim()) createdByLabel = String(resolved || "").trim();
          }
          openVisitorPassModal80({
            cid: visitorCommunitySlug,
            communityName: cname,
            visitorId: id,
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
    if (moduleId !== "visitor") stopVisitorsSubscription();
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
  document.addEventListener("DOMContentLoaded", bindSignOut);

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
