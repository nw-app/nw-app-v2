(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  const auth = firebase.auth();

  const STORAGE_CONFIG = "csp_config_v1";
  const STORAGE_ACCOUNTS = "csp_accounts_v1";
  const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";

  const moduleCatalog = [
    { id: "parcel", name: "包裹郵件", desc: "登記到貨、通知住戶、領取簽收", badge: "常用", page: "nw01.html" },
    { id: "visitor", name: "訪客登記", desc: "到訪資訊、車牌、進出時間管理", badge: "安全", page: "nw02.html" },
    { id: "residents", name: "住戶造冊", desc: "住戶/承租/車位/聯絡方式彙整", badge: "資料", page: "nw03.html" },
    { id: "facility", name: "設施預約", desc: "時段控管、名額與審核流程", badge: "熱門", page: "nw04.html" },
    { id: "bulletin", name: "公告系統", desc: "分類公告、置頂、閱讀回覆", badge: "通知", page: "nw05.html" },
    { id: "parking", name: "綠色停車", desc: "電動車/節能車位管理與登記", badge: "綠能", page: "nw06.html" },
  ];

  const moduleToPage = Object.fromEntries(moduleCatalog.map((m) => [m.id, m.page]));

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
    try {
      const raw = localStorage.getItem(STORAGE_ACCOUNTS);
      if (!raw) return { communities: [], residents: [] };
      const parsed = JSON.parse(raw);
      return {
        communities: Array.isArray(parsed.communities) ? parsed.communities : [],
        residents: Array.isArray(parsed.residents) ? parsed.residents : [],
      };
    } catch {
      return { communities: [], residents: [] };
    }
  }

  function resolveActiveCommunityId() {
    const accounts = loadAccounts();
    const saved = localStorage.getItem(STORAGE_ACTIVE_COMMUNITY);
    const first = accounts.communities.find((x) => x && x.enabled)?.id || accounts.communities[0]?.id || "";
    if (saved && accounts.communities.some((x) => x && x.id === saved)) return saved;
    if (first) {
      localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, first);
      return first;
    }
    return "default";
  }

  function configKey(communityId) {
    return `${STORAGE_CONFIG}:${String(communityId || "default")}`;
  }

  function ensureConfigMigrated(communityId) {
    const key = configKey(communityId);
    if (localStorage.getItem(key)) return;
    const legacy = localStorage.getItem(STORAGE_CONFIG);
    if (legacy) localStorage.setItem(key, legacy);
  }

  function loadConfig(communityId) {
    try {
      ensureConfigMigrated(communityId);
      const raw = localStorage.getItem(configKey(communityId));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getButtonConfig(moduleId) {
    const communityId = resolveActiveCommunityId();
    const cfg = loadConfig(communityId);
    const v = cfg && cfg.communityButtons ? cfg.communityButtons[moduleId] : null;
    if (!v) return { enabled: true, url: `#community/${moduleId}` };
    return { enabled: v.enabled !== false, url: String(v.url || "").trim() || `#community/${moduleId}` };
  }

  function resolveUrl(moduleId) {
    const cfg = getButtonConfig(moduleId);
    if (!cfg.enabled) return { enabled: false, url: "" };
    const u = cfg.url;
    if (u.startsWith("#community/")) {
      const id = u.split("/")[1] || moduleId;
      return { enabled: true, url: moduleToPage[id] || moduleToPage[moduleId] || "" };
    }
    if (u.startsWith("#")) {
      return { enabled: true, url: moduleToPage[moduleId] || "" };
    }
    return { enabled: true, url: u };
  }

  function iconSvg(id) {
    if (id === "parcel") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 8.5 12 13 3 8.5 12 4l9 4.5Z" stroke="white" stroke-width="1.7" stroke-linejoin="round"/><path d="M21 8.5V17a2 2 0 0 1-1.1 1.8L12 22l-7.9-3.2A2 2 0 0 1 3 17V8.5" stroke="white" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 13v9" stroke="white" stroke-width="1.7"/></svg>`;
    if (id === "visitor") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="white" stroke-width="1.7"/><path d="M4 20a8 8 0 0 1 16 0" stroke="white" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "residents") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 21v-9a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v9" stroke="white" stroke-width="1.7"/><path d="M12 7a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 12 7Z" stroke="white" stroke-width="1.7"/></svg>`;
    if (id === "facility") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h10v4H7V3Z" stroke="white" stroke-width="1.7"/><path d="M6 7h12v14H6V7Z" stroke="white" stroke-width="1.7"/><path d="M9 11h6M9 15h6" stroke="white" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "bulletin") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h10v16H7V4Z" stroke="white" stroke-width="1.7"/><path d="M9 8h6M9 12h6M9 16h4" stroke="white" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "parking") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 21V3h6a5 5 0 0 1 0 10H7" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 13.5c2 2 2 5.5-1.5 7" stroke="white" stroke-width="1.7" stroke-linecap="round"/><path d="M14.5 13.5c2 2 2 5.5-1.5 7" stroke="white" stroke-width="1.7" stroke-linecap="round" opacity="0.85"/></svg>`;
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.5c5.247 0 9.5-4.253 9.5-9.5S17.247 2.5 12 2.5 2.5 6.753 2.5 12 6.753 21.5 12 21.5Z" stroke="white" stroke-width="1.7" opacity="0.9"/></svg>`;
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

  function handleHashRoute() {
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    const parts = raw.split("/");
    if (parts[0] !== "community") return false;
    const moduleId = parts[1] || "community-dashboard";
    if (moduleId === "community-dashboard") return false;
    const url = moduleToPage[moduleId];
    if (url) {
      location.replace(url);
      return true;
    }
    return false;
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

  if (btnSignOut) {
    btnSignOut.addEventListener("click", async () => {
      try {
        sessionStorage.removeItem("csp_role");
        await auth.signOut();
      } catch {}
      location.href = "index.html";
    });
  }

  auth.onAuthStateChanged((user) => {
    const role = sessionStorage.getItem("csp_role");
    if (!user || role !== "community") {
      location.href = "index.html";
      return;
    }
    if (loginInfoEl) {
      const accounts = loadAccounts();
      const cid = resolveActiveCommunityId();
      const cname = accounts.communities.find((c) => c.id === cid)?.name || cid;
      loginInfoEl.textContent = `已登入：${user.email || "（未知）"}｜${cname}`;
    }
    if (handleHashRoute()) return;
    renderDashboard();
  });

  window.addEventListener("hashchange", () => {
    if (handleHashRoute()) return;
    renderDashboard();
  });
})();
