(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

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

  const STORAGE_CONFIG = "csp_config_v1";
  const STORAGE_ACCOUNTS = "csp_accounts_v1";
  const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";

  const state = {
    communities: [],
    config: null,
  };

  const moduleCatalog = [
    { id: "parcel", name: "包裹郵件", desc: "登記到貨、通知住戶、領取簽收", badge: "常用", page: "#community/parcel" },
    { id: "visitor", name: "訪客登記", desc: "到訪資訊、車牌、進出時間管理", badge: "安全", page: "#community/visitor" },
    { id: "residents", name: "住戶造冊", desc: "住戶/承租/車位/聯絡方式彙整", badge: "資料", page: "#community/residents" },
    { id: "facility", name: "設施預約", desc: "時段控管、名額與審核流程", badge: "熱門", page: "#community/facility" },
    { id: "bulletin", name: "公告系統", desc: "分類公告、置頂、閱讀回覆", badge: "通知", page: "#community/bulletin" },
    { id: "parking", name: "綠色停車", desc: "電動車/節能車位管理與登記", badge: "綠能", page: "#community/parking" },
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
    const cid = resolveActiveCommunityId();
    configDocRef(cid).get().then((doc) => {
      state.config = doc && doc.exists ? (doc.data() || null) : null;
      if (handleHashRoute()) return;
      renderDashboard();
    }).catch(() => {
      state.config = null;
      if (handleHashRoute()) return;
      renderDashboard();
    });
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

  function iconSvg(id) {
    if (id === "parcel") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 8.5 12 13 3 8.5 12 4l9 4.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M21 8.5V17a2 2 0 0 1-1.1 1.8L12 22l-7.9-3.2A2 2 0 0 1 3 17V8.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 13v9" stroke="currentColor" stroke-width="1.7"/></svg>`;
    if (id === "visitor") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" stroke-width="1.7"/><path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "residents") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 21v-9a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v9" stroke="currentColor" stroke-width="1.7"/><path d="M12 7a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 7Z" stroke="currentColor" stroke-width="1.7"/></svg>`;
    if (id === "facility") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h10v4H7V3Z" stroke="currentColor" stroke-width="1.7"/><path d="M6 7h12v14H6V7Z" stroke="currentColor" stroke-width="1.7"/><path d="M9 11h6M9 15h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "bulletin") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h10v16H7V4Z" stroke="currentColor" stroke-width="1.7"/><path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "parking") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 21V3h6a5 5 0 0 1 0 10H7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 13.5c2 2 2 5.5-1.5 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M14.5 13.5c2 2 2 5.5-1.5 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.85"/></svg>`;
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.5c5.247 0 9.5-4.253 9.5-9.5S17.247 2.5 12 2.5 2.5 6.753 2.5 12 6.753 21.5 12 21.5Z" stroke="currentColor" stroke-width="1.7" opacity="0.9"/></svg>`;
  }

  function renderDashboard() {
    contentEl.innerHTML = `
      <div class="grid" id="moduleGrid"></div>
    `;
    const grid = document.getElementById("moduleGrid");
    grid.innerHTML = moduleCatalog.map((m) => {
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
  }

  function renderModule(moduleId) {
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
    if (handleHashRoute()) return;
    renderDashboard();
  });

  window.addEventListener("hashchange", () => {
    if (handleHashRoute()) return;
    renderDashboard();
  });
})();
