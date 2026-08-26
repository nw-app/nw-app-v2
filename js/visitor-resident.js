(function () {
  "use strict";

  const firebaseConfig = window.FIREBASE_CONFIG;
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

  const FieldValue = firebase.firestore.FieldValue;
  const Timestamp = firebase.firestore.Timestamp;

  const tabsEl = document.getElementById("visitorTabs");
  const headerEl = document.getElementById("visitorHeader");
  const titleEl = document.getElementById("visitorTitle");

  const activeListEl = document.getElementById("activeList");
  const activeContentEl = document.getElementById("activeContent");
  const activeSearchEl = document.getElementById("activeSearch");

  const historyListEl = document.getElementById("historyList");
  const historyContentEl = document.getElementById("historyContent");
  const historySearchEl = document.getElementById("historySearch");

  const visitorFormModal = document.getElementById("visitorFormModal");
  const btnNewVisitorEl = document.getElementById("btnNewVisitor");
  const vNameEl = document.getElementById("v_name");
  const vPartyEl = document.getElementById("v_party");
  const vPhoneEl = document.getElementById("v_phone");
  const vPlateEl = document.getElementById("v_plate");
  const vEmailEl = document.getElementById("v_email");
  const vPurposeTypeEl = document.getElementById("v_purposeType");
  const vPurposeOtherFieldEl = document.getElementById("purposeOtherField");
  const vPurposeOtherEl = document.getElementById("v_purposeOther");
  const vNoteEl = document.getElementById("v_note");
  const visitorFormStatusEl = document.getElementById("visitorFormStatus");
  const btnSaveVisitorEl = document.getElementById("btnSaveVisitor");

  const COL_VISITORS = "visitors";

  const state = {
    embed: false,
    hideTabs: false,
    currentCommunityId: "default",
    currentCommunityName: "",
    currentUserId: "",
    currentUserEmail: "",
    currentUserProfile: null,
    currentUserName: "",
    currentUserHouseNo: "",
    currentUserHouseVariants: null,
    currentUserRole: "resident",
    visitors: [],
    unsubVisitors: null,
    permissionDenied: false,
    permissionHint: "",
  };

  function escapeHtml(v) {
    const s = String(v ?? "");
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
  }

  function normalizeUnitForStorage(s) {
    const t = normalizeDash(String(s || "")).trim();
    if (!t) return "";
    const idx = t.indexOf("-");
    const base = idx > 0 ? t.slice(0, idx) : t;
    return base;
  }

  function buildVisitorPayload({ vid, name, partySize, phone, plate, email, purpose, purposeType, purposeOther, note, unit, source, status, passAuthorized, createdBy, createdByName }) {
    const safePurposeOther = purposeType === "其他" ? (purposeOther || "其他") : "";
    const payload = {
      qrToken: vid,
      name,
      email,
      phone,
      unit,
      partySize,
      plate,
      purpose,
      purposeType,
      purposeOther: safePurposeOther,
      note,
      inAt: null,
      outAt: null,
      keep: null,
      source,
      status,
      passAuthorized,
      passAuthorizedAt: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy,
      createdByName,
    };
    return payload;
  }

  function formatFriendlyError(err) {
    const e = err && typeof err === "object" ? err : {};
    const code = String(e.code || "").trim();
    const msg = String(e.message || "").trim();
    const combined = (code && msg) ? `${code}｜${msg}` : (msg || code || "");
    if (combined.indexOf("permission-denied") >= 0 || combined.indexOf("Missing or insufficient permissions") >= 0 || combined.indexOf("permission") >= 0) {
      return "權限不足，無法載入訪客資料。請確認您已使用住戶帳號登入且為本社區住戶，或稍後再試一次。";
    }
    if (combined.indexOf("unavailable") >= 0 || combined.indexOf("network") >= 0 || combined.indexOf("timeout") >= 0) {
      return "網路連線不穩，無法載入訪客資料。請檢查網路後再試。";
    }
    if (combined.indexOf("not-found") >= 0) {
      return "訪客資料不存在，可能已被移除。";
    }
    return combined || "操作失敗，請稍後再試。";
  }

  function friendlyErrorWrap(err, actionLabel) {
    const base = formatFriendlyError(err);
    const label = actionLabel ? `${actionLabel}失敗：` : "";
    return `${label}${base}`;
  }

  function renderNeedLogin() {
    if (!activeContentEl || !historyContentEl) return;
    const loginUrl = `member.html?redirect=${encodeURIComponent("visitor-resident.html")}`;
    const html = `<div class="status error" style="display:grid; gap:10px; justify-items:stretch; align-items:start; padding:18px; border-radius:14px; text-align:left;">
      <div style="font-weight:900; font-size:15px;">請先登入社區帳號</div>
      <div style="font-weight:700; color:#374151; font-size:13px;">訪客登記僅開放給本社區住戶使用；未登入狀態或訪客身分無法編輯或查看訪客預約。</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <a class="btn btn-primary" href="${escapeHtml(loginUrl)}" style="text-decoration:none;">前往登入</a>
        <button class="btn" type="button" onclick="location.reload()">重新整理</button>
      </div>
    </div>`;
    activeContentEl.innerHTML = html;
    historyContentEl.innerHTML = html;
  }

  function renderPermissionDenied(hint) {
    if (!activeContentEl || !historyContentEl) return;
    const message = String(hint || "").trim() || "您目前沒有權限查看本社區的訪客預約。請確認登入的帳號為本社區住戶，或聯絡社區管理員協助開啟權限。";
    const loginUrl = `member.html?redirect=${encodeURIComponent("visitor-resident.html")}`;
    const html = `<div class="status error" style="display:grid; gap:10px; justify-items:stretch; align-items:start; padding:18px; border-radius:14px; text-align:left;">
      <div style="font-weight:900; font-size:15px;">無法載入訪客登記</div>
      <div style="font-weight:700; color:#374151; font-size:13px;">${escapeHtml(message)}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <a class="btn btn-primary" href="${escapeHtml(loginUrl)}" style="text-decoration:none;">重新登入</a>
        <button class="btn" type="button" onclick="location.reload()">再試一次</button>
      </div>
    </div>`;
    activeContentEl.innerHTML = html;
    historyContentEl.innerHTML = html;
  }

  function renderEmptyHouseNo() {
    if (!activeContentEl || !historyContentEl) return;
    const html = `<div class="status error" style="display:grid; gap:10px; justify-items:stretch; align-items:start; padding:18px; border-radius:14px; text-align:left;">
      <div style="font-weight:900; font-size:15px;">尚未設定戶號</div>
      <div style="font-weight:700; color:#374151; font-size:13px;">您的住戶帳號尚未設定戶號（houseNo / unit），因此無法查詢或登記訪客預約。請聯絡社區管理員協助補齊住戶資訊後再使用。</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-primary" type="button" onclick="location.reload()">重新整理</button>
      </div>
    </div>`;
    activeContentEl.innerHTML = html;
    historyContentEl.innerHTML = html;
  }


  function setStatus(el, message, isError) {
    if (!el) return;
    const t = String(message || "").trim();
    el.textContent = t;
    el.hidden = !t;
    el.classList.toggle("error", Boolean(isError));
  }

  function formatDateTime(v) {
    const d = v && typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : v ? new Date(v) : null;
    if (!d || !Number.isFinite(d.getTime())) return "";
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function toMillis850(v) {
    if (v == null) return 0;
    if (typeof v.toMillis === "function") {
      try { return v.toMillis(); } catch {}
    }
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : 0;
    }
    return 0;
  }

  function normalizeDash(s) {
    return String(s || "").replace(/[－–—]/g, "-").trim();
  }
  function normalizeKey(s) {
    return normalizeDash(s).replace(/\s+/g, "");
  }
  function userHouseKeyVariants(profile) {
    const rawHouseNo = String((profile && (profile.houseNo || profile.unit)) || "").trim();
    const rawSub = String((profile && (profile.subHouseNo || profile.subUnit || profile.sub)) || "").trim();
    const houseNo = normalizeDash(rawHouseNo);
    const subHouseNo = normalizeDash(rawSub);
    const fullHouseNo = houseNo ? (subHouseNo ? `${houseNo}-${subHouseNo}` : houseNo) : "";
    const base = (() => {
      const v = normalizeDash(houseNo || fullHouseNo || "");
      if (!v) return "";
      const idx = v.indexOf("-");
      return idx > 0 ? normalizeDash(v.slice(0, idx)) : v;
    })();
    const variants = new Set();
    function addVariant(v) {
      const t = normalizeDash(String(v || "").trim());
      if (!t) return;
      variants.add(t);
      const fullDash = t.replace(/-/g, "－");
      if (fullDash !== t) variants.add(fullDash);
      const idx = t.indexOf("-");
      if (idx > 0) {
        const b = normalizeDash(t.slice(0, idx));
        if (b) {
          variants.add(b);
          const bFull = b.replace(/-/g, "－");
          if (bFull !== b) variants.add(bFull);
        }
      }
    }
    if (base) addVariant(base);
    if (houseNo && houseNo !== base) addVariant(houseNo);
    if (fullHouseNo && fullHouseNo !== houseNo && fullHouseNo !== base) addVariant(fullHouseNo);
    return {
      variants,
      normalizedHouseNo: houseNo,
      normalizedSubHouseNo: subHouseNo,
      displayHouseNo: fullHouseNo,
      normalizedKeys: Array.from(variants),
      baseKey: base,
    };
  }
  function matchesUserUnit(dataUnit, variants) {
    if (!variants || variants.size === 0) return false;
    const key = normalizeKey(dataUnit);
    if (!key) return false;
    const dashKey = normalizeDash(dataUnit);
    for (const v of variants) {
      const a = normalizeKey(v);
      if (!a) continue;
      if (a === key) return true;
      const b = normalizeDash(v);
      if (b && b === dashKey) return true;
    }
    return false;
  }

  async function resolveCommunityId(keyOverride) {
    const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";
    const keyFromUrl = (() => {
      try {
        const urlParams = new URLSearchParams(location.search);
        return String(urlParams.get("c") || "").trim();
      } catch {
        return "";
      }
    })();
    const saved = (() => {
      try {
        return String(localStorage.getItem(STORAGE_ACTIVE_COMMUNITY) || "").trim();
      } catch {
        return "";
      }
    })();
    const key = String(keyOverride || "").trim() || keyFromUrl || saved;
    if (!key) return "default";
    if (saved && saved === key) return saved;
    try {
      const byIdSnap = await db.collection("communities").where("id", "==", key).limit(1).get();
      const byId = byIdSnap && byIdSnap.docs && byIdSnap.docs[0] ? byIdSnap.docs[0] : null;
      if (byId && byId.exists) {
        const v = byId.data() || {};
        const cid = String(v.id || byId.id || "").trim() || "default";
        try {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid);
        } catch {}
        return cid;
      }
    } catch {}
    try {
      const byUserSnap = await db.collection("communities").where("username", "==", key).limit(1).get();
      const byUser = byUserSnap && byUserSnap.docs && byUserSnap.docs[0] ? byUserSnap.docs[0] : null;
      if (byUser && byUser.exists) {
        const v = byUser.data() || {};
        const cid = String(v.id || byUser.id || "").trim() || "default";
        try {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid);
        } catch {}
        return cid;
      }
    } catch {}
    try {
      const byDoc = await db.collection("communities").doc(key).get();
      if (byDoc && byDoc.exists) {
        const v = byDoc.data() || {};
        const cid = String(v.id || byDoc.id || "").trim() || "default";
        try {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid);
        } catch {}
        return cid;
      }
    } catch {}
    return key;
  }

  function formatFirebaseError(err) {
    const e = err && typeof err === "object" ? err : {};
    const code = String(e.code || "").trim();
    const msg = String(e.message || "").trim();
    if (code && msg) return `${code}｜${msg}`;
    return msg || code || "操作失敗";
  }

  async function loadCommunityName(cid) {
    const communityId = String(cid || "").trim() || "default";
    if (!communityId || communityId === "default") return "";
    try {
      const doc = await db.collection("communities").doc(communityId).get();
      const data = doc && doc.exists ? doc.data() || {} : {};
      return String(data.name || "").trim();
    } catch {
      return "";
    }
  }

  async function loadUserProfile(user) {
    if (!user) return null;
    let data = {};
    try {
      const doc = await db.collection("users").doc(String(user.uid)).get();
      if (doc && doc.exists) data = doc.data() || {};
    } catch {}
    if (!data || !Object.keys(data).length) {
      try {
        const email = String(user.email || "").trim();
        if (email) {
          const snap = await db.collection("users").where("email", "==", email).limit(1).get();
          if (snap && snap.size > 0) data = snap.docs[0].data() || {};
        }
      } catch {}
    }
    return data && typeof data === "object" ? data : {};
  }

  function normalizeRole(roleValue) {
    const role = String(roleValue || "").trim().toLowerCase();
    if (!role) return "resident";
    if (role === "community" || role === "社區") return "community";
    if (role === "admin" || role === "系統管理員" || role === "系統管理者" || role === "系統") return "admin";
    if (role === "resident" || role === "住戶") return "resident";
    return role;
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.hidden = true;
  }

  function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.hidden = false;
  }

  function bindModalClose() {
    document.querySelectorAll("[data-modal-close]").forEach((el) => {
      el.addEventListener("click", () => {
        const modal = el.closest(".modal");
        closeModal(modal);
      });
    });
  }

  function switchTab(tabId) {
    const tab = String(tabId || "active").trim() || "active";
    tabsEl?.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", String(b.dataset.tab || "") === tab));
    activeListEl?.classList.toggle("hidden", tab !== "active");
    historyListEl?.classList.toggle("hidden", tab !== "history");
    if (tab === "active") renderActive();
    if (tab === "history") renderHistory();
  }

  function ensureEmbedLayout() {
    const params = new URLSearchParams(location.search || "");
    state.embed = String(params.get("embed") || "").trim() === "1";
    state.hideTabs = state.embed && String(params.get("nav") || "").trim() === "0";
    if (state.hideTabs && tabsEl) tabsEl.style.display = "none";
    if (!state.embed) return;

    const layoutEl = document.querySelector(".parcel-layout");
    const midtopEl = document.querySelector(".parcel-midtop");

    if (state.hideTabs && midtopEl) midtopEl.style.display = "none";
    if (layoutEl) {
      if (state.hideTabs) {
        layoutEl.style.gridTemplateRows = "minmax(56px, 8vh) minmax(0, 68vh) minmax(56px, 16vh)";
      } else {
        layoutEl.style.gridTemplateRows = "minmax(56px, 8vh) minmax(56px, 8vh) minmax(0, 60vh) minmax(56px, 16vh)";
      }
    }
  }

  function bindHostMessaging() {
    window.addEventListener("message", (ev) => {
      const data = ev && ev.data ? ev.data : null;
      if (!data || typeof data !== "object") return;
      const origin = String(ev.origin || "").trim();
      if (origin && origin !== String(location.origin || "")) return;
      if (data.type === "VISITOR_NAV") {
        const tab = String(data.tab || "").trim();
        if (!tab) return;
        switchTab(tab);
      }
    });
  }

  function isActiveVisitor(v) {
    const status = String(v.status || "").toLowerCase();
    const hasOutTime = v.outAt != null;
    if (hasOutTime) return false;
    if (status === "rejected" || status === "cancelled") return false;
    return true;
  }

  function isHistoryVisitor(v) {
    return !isActiveVisitor(v);
  }

  function visitorStatusLabel(v) {
    const status = String(v.status || "").toLowerCase();
    const hasInTime = v.inAt != null;
    const hasOutTime = v.outAt != null;
    if (status === "rejected") return { cls: "status-rejected", text: "已拒絕" };
    if (status === "cancelled") return { cls: "status-ended", text: "已取消" };
    if (hasOutTime) return { cls: "status-ended", text: "已離開" };
    if (hasInTime) return { cls: "status-inside", text: "入內中" };
    if (status === "approved" || v.passAuthorized === true) return { cls: "status-approved", text: "已核准" };
    return { cls: "status-pending", text: "待審核" };
  }

  function renderActive() {
    if (!activeContentEl) return;
    const now = Date.now();
    const q = String(activeSearchEl?.value || "").trim().toLowerCase();
    const variants = state.currentUserHouseVariants ? state.currentUserHouseVariants.variants : new Set();
    const hasVariants = variants.size > 0;
    const list = state.visitors
      .filter((v) => hasVariants ? matchesUserUnit(v.unit, variants) : true)
      .filter((v) => isActiveVisitor(v))
      .filter((v) => {
        if (!q) return true;
        const n = String(v.name || "").toLowerCase();
        const p = String(v.phone || "").toLowerCase();
        const pl = String(v.plate || "").toLowerCase();
        const pur = String(v.purpose || "").toLowerCase();
        return n.includes(q) || p.includes(q) || pl.includes(q) || pur.includes(q);
      })
      .sort((a, b) => {
        const at = toMillis850(a.createdAt) || toMillis850(a.inAt) || 0;
        const bt = toMillis850(b.createdAt) || toMillis850(b.inAt) || 0;
        return bt - at;
      });

    if (!list.length) {
      activeContentEl.innerHTML = `<div class="status">目前沒有預約中的訪客</div>`;
      return;
    }

    activeContentEl.innerHTML = list
      .map((v, idx) => {
        const name = String(v.name || "—");
        const phone = String(v.phone || "").trim();
        const plate = String(v.plate || "").trim();
        const purpose = String(v.purpose || "").trim();
        const party = v.partySize != null && Number.isFinite(Number(v.partySize)) && Number(v.partySize) >= 1 ? String(Math.floor(Number(v.partySize))) : "1";
        const createdText = formatDateTime(v.createdAt);
        const inText = formatDateTime(v.inAt);
        const st = visitorStatusLabel(v);
        const blockSep = idx > 0 ? "margin-top:10px;" : "";
        const canCancel = st.cls === "status-pending" || st.cls === "status-approved";
        const leftColHtml = [
          `<div style="font-weight:900; font-size:15px; display:flex; align-items:center; gap:8px;">`,
          `${escapeHtml(name)}`,
          `<span class="${st.cls}">${escapeHtml(st.text)}</span>`,
          `</div>`,
        ].join("");
        const descParts = [
          `拜訪人數：${party}`,
          phone ? `手機：${escapeHtml(phone)}` : "",
          plate ? `車牌：${escapeHtml(plate)}` : "",
          purpose ? `事由：${escapeHtml(purpose)}` : "",
        ].filter(Boolean);
        const timeParts = [
          createdText ? `登記：${escapeHtml(createdText)}` : "",
          inText ? `入內：${escapeHtml(inText)}` : "",
        ].filter(Boolean);
        return `
          <div class="parcel-item" style="${blockSep}">
            <div class="parcel-info">
              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
                <div class="parcel-info" style="padding:0; border:0; background:transparent; min-width:0; flex:1 1 auto;">
                  ${leftColHtml}
                  <div class="parcel-desc" style="margin-top:4px;">${descParts.join("｜")}</div>
                  <div class="parcel-desc" style="margin-top:2px;">${timeParts.join("｜")}</div>
                </div>
                <div style="display:flex; flex-direction:column; gap:6px; flex:0 0 auto;">
                  ${canCancel ? `
                    <button class="icon-btn icon-btn--danger" type="button" data-cancel="${escapeHtml(String(v.id || ""))}" title="取消預約" aria-label="取消預約">
                      <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  ` : ""}
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    activeContentEl.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = String(btn.getAttribute("data-cancel") || "").trim();
        if (!id) return;
        const ok = (window.nwConfirm ? await window.nwConfirm({
          title: "取消訪客預約",
          message: "確定要取消此訪客預約嗎？此操作無法復原。",
          okText: "確認取消",
          cancelText: "保留",
          danger: true,
        }) : Promise.resolve(confirm("確定要取消此訪客預約嗎？")));
        if (!ok) return;
        try {
          await db
            .collection("communities")
            .doc(state.currentCommunityId)
            .collection(COL_VISITORS)
            .doc(id)
            .update({ status: "cancelled", updatedAt: FieldValue.serverTimestamp() });
        } catch (e) {
          alert(friendlyErrorWrap(e, "取消預約"));
        }
      });
    });
  }

  function renderHistory() {
    if (!historyContentEl) return;
    const q = String(historySearchEl?.value || "").trim().toLowerCase();
    const variants = state.currentUserHouseVariants ? state.currentUserHouseVariants.variants : new Set();
    const hasVariants = variants.size > 0;
    const list = state.visitors
      .filter((v) => hasVariants ? matchesUserUnit(v.unit, variants) : true)
      .filter((v) => isHistoryVisitor(v))
      .filter((v) => {
        if (!q) return true;
        const n = String(v.name || "").toLowerCase();
        const p = String(v.phone || "").toLowerCase();
        const pl = String(v.plate || "").toLowerCase();
        const pur = String(v.purpose || "").toLowerCase();
        return n.includes(q) || p.includes(q) || pl.includes(q) || pur.includes(q);
      })
      .sort((a, b) => {
        const at = toMillis850(a.outAt) || toMillis850(a.updatedAt) || toMillis850(a.createdAt) || 0;
        const bt = toMillis850(b.outAt) || toMillis850(b.updatedAt) || toMillis850(b.createdAt) || 0;
        return bt - at;
      });

    if (!list.length) {
      historyContentEl.innerHTML = `<div class="status">目前沒有歷史訪客紀錄</div>`;
      return;
    }

    historyContentEl.innerHTML = list
      .map((v, idx) => {
        const name = String(v.name || "—");
        const phone = String(v.phone || "").trim();
        const plate = String(v.plate || "").trim();
        const purpose = String(v.purpose || "").trim();
        const party = v.partySize != null && Number.isFinite(Number(v.partySize)) && Number(v.partySize) >= 1 ? String(Math.floor(Number(v.partySize))) : "1";
        const createdText = formatDateTime(v.createdAt);
        const inText = formatDateTime(v.inAt);
        const outText = formatDateTime(v.outAt);
        const st = visitorStatusLabel(v);
        const blockSep = idx > 0 ? "margin-top:10px;" : "";
        const leftColHtml = [
          `<div style="font-weight:900; font-size:15px; display:flex; align-items:center; gap:8px;">`,
          `${escapeHtml(name)}`,
          `<span class="${st.cls}">${escapeHtml(st.text)}</span>`,
          `</div>`,
        ].join("");
        const descParts = [
          `拜訪人數：${party}`,
          phone ? `手機：${escapeHtml(phone)}` : "",
          plate ? `車牌：${escapeHtml(plate)}` : "",
          purpose ? `事由：${escapeHtml(purpose)}` : "",
        ].filter(Boolean);
        const timeParts = [
          createdText ? `登記：${escapeHtml(createdText)}` : "",
          inText ? `入內：${escapeHtml(inText)}` : "",
          outText ? `離開：${escapeHtml(outText)}` : "",
        ].filter(Boolean);
        return `
          <div class="parcel-item" style="${blockSep}">
            <div class="parcel-info">
              ${leftColHtml}
              <div class="parcel-desc" style="margin-top:4px;">${descParts.join("｜")}</div>
              <div class="parcel-desc" style="margin-top:2px;">${timeParts.join("｜")}</div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function stopVisitorsSubscription() {
    if (state.unsubVisitors) {
      try { state.unsubVisitors(); } catch {}
      state.unsubVisitors = null;
    }
  }

  async function loadVisitors() {
    stopVisitorsSubscription();
    const cid = state.currentCommunityId;
    if (!cid || cid === "default") {
      state.visitors = [];
      renderActive();
      renderHistory();
      return;
    }
    const authUid = state.currentUserId ? String(state.currentUserId).trim() : "";
    if (!authUid) {
      state.visitors = [];
      renderNeedLogin();
      return;
    }
    const variants = state.currentUserHouseVariants || null;
    const rawKeys = variants && Array.isArray(variants.normalizedKeys) ? variants.normalizedKeys : [];
    const keys = rawKeys.filter(x => String(x || "").trim());
    if (keys.length === 0) {
      state.visitors = [];
      renderEmptyHouseNo();
      return;
    }
    try {
      const safeUnitKey = keys[0];
      const createdByQuery = keys.length > 1 ? true : false;
      const combinedMap = new Map();
      const errorState = { flag: false };
      const pending = { count: 0 };
      function mergeSnapshot(snap, allowAllUnitKeys) {
        (snap && snap.docChanges ? snap.docChanges() : []).forEach((ch) => {
          const d = ch.doc;
          if (!d || !d.exists) return;
          const id = d.id;
          if (ch.type === "removed") {
            combinedMap.delete(id);
            return;
          }
          const data = d.data() || {};
          if (allowAllUnitKeys || matchesUserUnit(data.unit, variants.variants) || data.createdBy === authUid) {
            combinedMap.set(id, { id, ...data });
          }
        });
      }
      function setDoneOrError(wasError) {
        if (wasError) errorState.flag = true;
        pending.count -= 1;
        if (pending.count > 0) return;
        if (errorState.flag) {
          renderPermissionDenied();
          return;
        }
        state.visitors = Array.from(combinedMap.values());
        renderActive();
        renderHistory();
      }
      const unsubs = [];
      const baseRef = db.collection("communities").doc(cid).collection(COL_VISITORS);
      pending.count += 1;
      unsubs.push(baseRef.where("unit", "==", safeUnitKey).onSnapshot(
        (snap) => { mergeSnapshot(snap, false); setDoneOrError(false); },
        (err) => { console.error("Visitors subscribe unit fallback failed:", err); setDoneOrError(true); }
      ));
      if (createdByQuery) {
        pending.count += 1;
        unsubs.push(baseRef.where("createdBy", "==", authUid).onSnapshot(
          (snap) => { mergeSnapshot(snap, true); setDoneOrError(false); },
          (err) => { console.error("Visitors subscribe createdBy fallback failed:", err); setDoneOrError(true); }
        ));
      }
      state.unsubVisitors = () => {
        unsubs.forEach((u) => { try { u(); } catch {} });
      };
    } catch (e) {
      console.error("loadVisitors error:", e);
    }
  }

  async function refresh() {
    await loadVisitors();
  }

  function openVisitorForm() {
    if (!visitorFormModal) return;
    if (vNameEl) vNameEl.value = "";
    if (vPartyEl) vPartyEl.value = "1";
    if (vPhoneEl) vPhoneEl.value = "";
    if (vPlateEl) vPlateEl.value = "";
    if (vEmailEl) vEmailEl.value = "";
    if (vPurposeTypeEl) vPurposeTypeEl.value = "親友拜訪";
    if (vPurposeOtherEl) vPurposeOtherEl.value = "";
    if (vPurposeOtherFieldEl) vPurposeOtherFieldEl.hidden = true;
    if (vNoteEl) vNoteEl.value = "";
    setStatus(visitorFormStatusEl, "", false);
    openModal(visitorFormModal);
  }

  async function saveVisitor() {
    if (!btnSaveVisitorEl) return;
    btnSaveVisitorEl.disabled = true;
    setStatus(visitorFormStatusEl, "送出中...", false);
    try {
      const authUid = state.currentUserId ? String(state.currentUserId).trim() : "";
      if (!authUid) {
        setStatus(visitorFormStatusEl, "您尚未登入，無法送出訪客登記。請重新登入後再試。", true);
        return;
      }
      const cid = state.currentCommunityId;
      if (!cid || cid === "default") {
        setStatus(visitorFormStatusEl, "無法識別您的社區，請先完成住戶社區驗證。", true);
        return;
      }
      const name = String(vNameEl ? vNameEl.value || "" : "").trim();
      const partyRaw = String(vPartyEl ? vPartyEl.value || "" : "").trim();
      const partySize = Math.max(1, Math.min(20, parseInt(partyRaw, 10) || 1));
      const phone = String(vPhoneEl ? vPhoneEl.value || "" : "").trim();
      const plate = String(vPlateEl ? vPlateEl.value || "" : "").trim();
      const email = String(vEmailEl ? vEmailEl.value || "" : "").trim();
      const purposeType = String(vPurposeTypeEl ? vPurposeTypeEl.value || "" : "").trim() || "親友拜訪";
      const purposeOtherRaw = String(vPurposeOtherEl ? vPurposeOtherEl.value || "" : "").trim();
      const note = String(vNoteEl ? vNoteEl.value || "" : "").trim();
      const purposeOther = purposeType === "其他" ? (purposeOtherRaw || "其他") : "";
      const purpose = purposeType === "其他" ? (purposeOtherRaw || "其他") : purposeType;
      const unit = normalizeUnitForStorage(state.currentUserHouseNo || state.currentUserHouseVariants?.baseKey || "");

      if (!name) {
        setStatus(visitorFormStatusEl, "請填寫訪客姓名", true);
        return;
      }
      if (!unit) {
        setStatus(visitorFormStatusEl, "您的住戶帳號尚未設定戶號，無法登記訪客。請聯絡管理員協助補齊住戶資訊。", true);
        return;
      }

      const docRef = db.collection("communities").doc(cid).collection(COL_VISITORS).doc();
      const vid = String(docRef.id || "").trim();
      if (!vid) {
        setStatus(visitorFormStatusEl, "無法建立訪客預約編號，請重新整理後再試一次。", true);
        return;
      }
      const createdByName = String(state.currentUserName || "").trim() || "住戶";
      const payload = buildVisitorPayload({
        vid,
        name,
        partySize,
        phone,
        plate,
        email,
        purpose,
        purposeType,
        purposeOther,
        note,
        unit,
        source: "resident",
        status: "pending",
        passAuthorized: false,
        createdBy: authUid,
        createdByName,
      });
      await docRef.set(payload, { merge: true });
      setStatus(visitorFormStatusEl, "", false);
      closeModal(visitorFormModal);
      switchTab("active");
    } catch (e) {
      const msg = friendlyErrorWrap(e, "送出訪客登記");
      setStatus(visitorFormStatusEl, msg, true);
    } finally {
      if (btnSaveVisitorEl) btnSaveVisitorEl.disabled = false;
    }
  }

  function bindEvents() {
    tabsEl?.querySelectorAll(".tab-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const tab = String(b.dataset.tab || "").trim();
        if (tab) switchTab(tab);
      });
    });

    activeSearchEl?.addEventListener("input", () => renderActive());
    historySearchEl?.addEventListener("input", () => renderHistory());

    btnNewVisitorEl?.addEventListener("click", openVisitorForm);

    bindModalClose();

    vPurposeTypeEl?.addEventListener("change", () => {
      const v = String(vPurposeTypeEl.value || "").trim();
      const isOther = v === "其他";
      if (vPurposeOtherFieldEl) {
        vPurposeOtherFieldEl.hidden = !isOther;
      }
      if (!isOther && vPurposeOtherEl) vPurposeOtherEl.value = "";
    });

    btnSaveVisitorEl?.addEventListener("click", saveVisitor);
  }

  async function bootstrapUser(user) {
    state.currentUserId = user && user.uid ? String(user.uid) : "";
    state.currentUserEmail = user && user.email ? String(user.email) : "";
    const profile = await loadUserProfile(user);
    state.currentUserProfile = profile;

    const name = String(profile?.displayName || profile?.name || profile?.fullName || user.displayName || "").trim() || (state.currentUserEmail ? state.currentUserEmail.split("@")[0] : "");
    state.currentUserName = name || "住戶";

    const houseKeys = userHouseKeyVariants(profile);
    state.currentUserHouseVariants = houseKeys;
    state.currentUserHouseNo = houseKeys.displayHouseNo;

    const params = (() => {
      try {
        return new URLSearchParams(location.search || "");
      } catch {
        return new URLSearchParams("");
      }
    })();
    const roleFromUrl = String(params.get("role") || "").trim();
    const sessionRole = (() => {
      try {
        return String(sessionStorage.getItem("csp_role") || "").trim();
      } catch {
        return "";
      }
    })();
    state.currentUserRole = normalizeRole(roleFromUrl || sessionRole || profile?.role || profile?.userRole || "resident");

    const key = (() => {
      try {
        const urlParams = new URLSearchParams(location.search);
        return String(urlParams.get("c") || "").trim();
      } catch {
        return "";
      }
    })();
    state.currentCommunityId = await resolveCommunityId(key || profile?.community || "");
    state.currentCommunityName = await loadCommunityName(state.currentCommunityId);

    const titleParts = [];
    if (state.currentUserHouseNo) titleParts.push(state.currentUserHouseNo);
    if (state.currentUserName) titleParts.push(state.currentUserName);
    const prefix = titleParts.length ? titleParts.join(" ") : "訪客登記";
    const suffix = state.embed ? "" : (state.currentCommunityName ? `｜${state.currentCommunityName}` : "");
    if (titleEl) titleEl.textContent = `${prefix}${suffix}`;

    await refresh();
    switchTab("active");
  }

  ensureEmbedLayout();
  bindHostMessaging();
  bindEvents();
  try { window.__vr_state = state; } catch(e) {}
  auth.onAuthStateChanged((user) => {
    stopVisitorsSubscription();
    if (!user) {
      state.currentUserId = "";
      state.currentCommunityId = "default";
      state.visitors = [];
      renderNeedLogin();
      return;
    }
    bootstrapUser(user).catch(() => {
      renderNeedLogin();
    });
  });
})();
