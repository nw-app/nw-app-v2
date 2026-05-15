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
    { id: "finance", name: "收支報表", desc: "收入/支出彙總、分類與月份查詢（示意）", badge: "財務", page: "#community/finance" },
    { id: "checkin-vote", name: "報到投票", desc: "活動報到、投票與統計結果（示意）", badge: "活動", page: "#community/checkin-vote" },
    { id: "assignments", name: "交辦事項", desc: "派工、追蹤進度、回報與結案（示意）", badge: "待辦", page: "#community/assignments" },
    { id: "duty", name: "勤務管理", desc: "排班、值勤紀錄與交接（示意）", badge: "管理", page: "#community/duty" },
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
    if (id === "residents") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 11.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="1.7"/><path d="M16.5 11a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z" stroke="currentColor" stroke-width="1.7"/><path d="M3.8 20a6.2 6.2 0 0 1 10.4 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M14.4 20a5.2 5.2 0 0 1 6.2 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "facility") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4v2M17 4v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M5 7.5h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6 6.5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 11.2h.01M12 11.2h.01M15 11.2h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>`;
    if (id === "bulletin") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 11.2V8.8A2.3 2.3 0 0 1 6.8 6.5h2.9l7.2-2.7a.9.9 0 0 1 1.2.8v14.8a.9.9 0 0 1-1.2.8l-7.2-2.7H6.8A2.3 2.3 0 0 1 4.5 15v-2.4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M20.2 9.2a4.2 4.2 0 0 1 0 5.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M6.8 17.5v2.2a1.8 1.8 0 0 0 3.6 0v-1.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    if (id === "finance") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 19.5h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.2 18.8V11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 18.8V8.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16.8 18.8V13.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7.2 10.3 10 7.8l2.6 2.4L16.8 6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (id === "checkin-vote") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10.5 10 13.5 17 6.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 4.5h11A2 2 0 0 1 19.5 6.5v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    if (id === "assignments") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 6.5h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 11h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8 15.5h5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9.2 4.5h5.6a1 1 0 0 1 1 1V7H8.2V5.5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
    if (id === "duty") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.2c4.8 0 8.7-3.9 8.7-8.7S16.8 3.8 12 3.8 3.3 7.7 3.3 12.5 7.2 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.6v5.1l3.2 1.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    if (id === "parking") return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 16.5 7.4 11.8A2.5 2.5 0 0 1 9.8 10h4.4a2.5 2.5 0 0 1 2.4 1.8L18 16.5" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M6 16.5h12v2a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 18.5v-2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.2 10.4 9.2 7.8A2 2 0 0 1 11.1 6.5h1.8a2 2 0 0 1 1.9 1.3l1 2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M9 18.2h.01M15 18.2h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>`;
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.5c5.247 0 9.5-4.253 9.5-9.5S17.247 2.5 12 2.5 2.5 6.753 2.5 12 6.753 21.5 12 21.5Z" stroke="currentColor" stroke-width="1.7" opacity="0.9"/></svg>`;
  }

  function normalizeText(v) {
    return String(v || "").trim();
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
    let modal = document.getElementById("residentEditorModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "residentEditorModal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="residentEditorModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="residentEditorModalTitle">新增住戶</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="residentEditorForm">
          <div class="modal-body">
            <div class="status" id="residentEditorStatus" hidden></div>
            <div class="profile-item">
              <div class="profile-label">戶號</div>
              <input type="text" id="residentHouseNo" autocomplete="off" placeholder="例如：A1101" />
            </div>
            <div class="profile-item">
              <div class="profile-label">姓名</div>
              <input type="text" id="residentName" autocomplete="off" placeholder="例如：王小明" />
            </div>
            <div class="profile-item">
              <div class="profile-label">電子郵件（登入帳號）</div>
              <input type="text" id="residentEmail" autocomplete="off" placeholder="例如：user@example.com" />
            </div>
            <div class="profile-item">
              <div class="profile-label">手機號碼（預設密碼）</div>
              <input type="text" id="residentPhone" autocomplete="off" placeholder="例如：0912345678" />
            </div>
            <div class="profile-item">
              <div class="profile-label">地址</div>
              <input type="text" id="residentAddress" autocomplete="off" placeholder="（選填）" />
            </div>
            <div class="profile-item">
              <div class="profile-label">狀態</div>
              <select class="role-select" id="residentEnabled">
                <option value="true">啟用</option>
                <option value="false">停用</option>
              </select>
            </div>
          </div>
          <div class="modal-ft">
            <button class="btn" type="button" data-modal-close="1">取消</button>
            <button class="btn btn-primary" type="submit" id="btnSaveResident">儲存</button>
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
          <h3 class="modal-title" id="unitsModalTitle">戶號管理</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <form id="unitsForm">
          <div class="modal-body">
            <div class="status" id="unitsStatus" hidden></div>
            <div class="profile-item">
              <div class="profile-label">戶號清單（每行一戶）</div>
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
          <button class="btn btn-primary" type="button" id="btnAddResident">新增住戶</button>
        </div>
        <div class="card-bd">
          <div class="resident-toolbar">
            <div class="resident-total" id="residentTotal">總人數：—</div>
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
    const totalEl = document.getElementById("residentTotal");

    const setStatus = (msg, isError) => {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    let residents = [];

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
      if (totalEl) totalEl.textContent = `總人數：${residents.length}`;
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
      const titleEl = modal.querySelector("#residentEditorModalTitle");
      const form = modal.querySelector("#residentEditorForm");
      const st = modal.querySelector("#residentEditorStatus");
      const inputHouse = modal.querySelector("#residentHouseNo");
      const inputName = modal.querySelector("#residentName");
      const inputEmail = modal.querySelector("#residentEmail");
      const inputPhone = modal.querySelector("#residentPhone");
      const inputAddr = modal.querySelector("#residentAddress");
      const inputEnabled = modal.querySelector("#residentEnabled");
      const btnSave = modal.querySelector("#btnSaveResident");

      const setModalStatus = (msg, isError) => {
        if (!st) return;
        const t = String(msg || "").trim();
        st.textContent = t;
        st.hidden = !t;
        st.classList.toggle("error", Boolean(isError));
      };

      const isEdit = mode === "edit";
      const data = resident || {};
      if (titleEl) titleEl.textContent = isEdit ? "編輯住戶" : "新增住戶";
      if (inputHouse) inputHouse.value = isEdit ? String(data.houseNo || "") : "";
      if (inputName) inputName.value = isEdit ? String(data.displayName || "") : "";
      if (inputEmail) inputEmail.value = isEdit ? String(data.email || "") : "";
      if (inputPhone) inputPhone.value = isEdit ? String(data.phone || "") : "";
      if (inputAddr) inputAddr.value = isEdit ? String(data.address || "") : "";
      if (inputEnabled) inputEnabled.value = String((isEdit ? data.enabled !== false : true) ? "true" : "false");
      if (inputEmail) inputEmail.disabled = Boolean(isEdit);
      setModalStatus("", false);
      modal.hidden = false;
      requestAnimationFrame(() => {
        if (inputHouse) inputHouse.focus();
      });

      const onSubmit = async (e) => {
        e.preventDefault();
        if (btnSave) btnSave.disabled = true;
        setModalStatus("儲存中...", false);

        const houseNo = normalizeText(inputHouse ? inputHouse.value : "");
        const name = normalizeText(inputName ? inputName.value : "");
        const email = normalizeText(inputEmail ? inputEmail.value : "");
        const phone = normalizeText(inputPhone ? inputPhone.value : "");
        const address = normalizeText(inputAddr ? inputAddr.value : "");
        const enabled = String(inputEnabled ? inputEnabled.value : "true") === "true";

        if (!houseNo) {
          setModalStatus("請填寫戶號。", true);
          if (btnSave) btnSave.disabled = false;
          return;
        }
        if (!name) {
          setModalStatus("請填寫姓名。", true);
          if (btnSave) btnSave.disabled = false;
          return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setModalStatus("電子郵件格式不正確。", true);
          if (btnSave) btnSave.disabled = false;
          return;
        }
        const phoneNormalized = normalizePhoneDigits(phone);
        if (!phoneNormalized) {
          setModalStatus("手機號碼格式不正確。", true);
          if (btnSave) btnSave.disabled = false;
          return;
        }

        let createdAuth = null;
        try {
          if (!isEdit) {
            createdAuth = await createAuthUser(email, phoneNormalized);
          }
          const id = isEdit ? String(data.id || "") : String(createdAuth && createdAuth.uid ? createdAuth.uid : "");
          if (!id) throw new Error("no-id");

          const communityCode = c ? String(c.username || "") : "";
          const payload = {
            role: "住戶",
            community: String(cid || "default"),
            houseNo,
            displayName: name,
            username: email,
            email,
            phone: phoneNormalized,
            phoneNormalized,
            address,
            enabled: Boolean(enabled),
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (!isEdit) payload.createdAt = FieldValue.serverTimestamp();
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
          if (btnSave) btnSave.disabled = false;
        }
      };

      form.addEventListener("submit", onSubmit);
      const oldDetach = detach;
      const detach2 = () => {
        try {
          form.removeEventListener("submit", onSubmit);
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
        const units = Array.isArray(v.units) ? v.units : [];
        if (ta) ta.value = units.map((x) => String(x || "").trim()).filter(Boolean).join("\n");
        setModalStatus("", false);
      } catch {
        if (ta) ta.value = "";
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
    updateFooterActiveNav();
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
    updateFooterActiveNav();
  }

  function renderModule(moduleId) {
    if (moduleId === "residents") {
      renderResidentsModule();
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
