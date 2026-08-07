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
  };

  function escapeHtml(v) {
    const s = String(v ?? "");
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
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
    [houseNo, fullHouseNo, base].forEach((x) => {
      const v = normalizeDash(x);
      if (!v) return;
      variants.add(v);
      const fullDash = v.replace(/-/g, "－");
      if (fullDash !== v) variants.add(fullDash);
      const idx = v.indexOf("-");
      if (idx > 0) {
        const b = normalizeDash(v.slice(0, idx));
        if (b) {
          variants.add(b);
          const bFull = b.replace(/-/g, "－");
          if (bFull !== b) variants.add(bFull);
        }
      }
    });
    return {
      variants,
      normalizedHouseNo: houseNo,
      normalizedSubHouseNo: subHouseNo,
      displayHouseNo: fullHouseNo,
      normalizedKeys: Array.from(variants),
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
          alert("操作失敗：" + formatFirebaseError(e));
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
    if (!cid || cid === "default") return;
    const keys = state.currentUserHouseVariants && Array.isArray(state.currentUserHouseVariants.normalizedKeys)
      ? state.currentUserHouseVariants.normalizedKeys.filter(x => String(x || "").trim())
      : [];
    try {
      if (keys.length === 0) {
        state.visitors = [];
        renderActive();
        renderHistory();
        return;
      }
      if (keys.length === 1) {
        state.unsubVisitors = db
          .collection("communities")
          .doc(cid)
          .collection(COL_VISITORS)
          .where("unit", "==", keys[0])
          .onSnapshot(
            (snap) => {
              state.visitors = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
              renderActive();
              renderHistory();
            },
            (err) => {
              console.error("Visitors subscribe failed:", err);
              if (activeContentEl) activeContentEl.innerHTML = `<div class="status error">載入失敗：${formatFirebaseError(err)}</div>`;
              if (historyContentEl) historyContentEl.innerHTML = `<div class="status error">載入失敗：${formatFirebaseError(err)}</div>`;
            }
          );
        return;
      }
      const chunks = [];
      for (let i = 0; i < keys.length; i += 10) chunks.push(keys.slice(i, i + 10));
      let stopped = false;
      const combinedMap = new Map();
      const doneCounts = new Map(chunks.map((_, i) => [i, false]));
      const tryFinish = () => {
        if (stopped) return;
        for (const done of doneCounts.values()) if (!done) return;
        state.visitors = Array.from(combinedMap.values());
        renderActive();
        renderHistory();
      };
      const unsubs = chunks.map((chunk, idx) => db
        .collection("communities")
        .doc(cid)
        .collection(COL_VISITORS)
        .where("unit", "in", chunk)
        .onSnapshot(
          (snap) => {
            if (stopped) return;
            (snap && snap.docChanges ? snap.docChanges() : []).forEach((ch) => {
              const d = ch.doc;
              if (!d || !d.exists) return;
              const id = d.id;
              if (ch.type === "removed") combinedMap.delete(id);
              else combinedMap.set(id, { id, ...(d.data() || {}) });
            });
            doneCounts.set(idx, true);
            tryFinish();
          },
          (err) => {
            console.error("Visitors subscribe failed:", err);
            if (activeContentEl) activeContentEl.innerHTML = `<div class="status error">載入失敗：${formatFirebaseError(err)}</div>`;
            if (historyContentEl) historyContentEl.innerHTML = `<div class="status error">載入失敗：${formatFirebaseError(err)}</div>`;
          }
        )
      );
      state.unsubVisitors = () => {
        stopped = true;
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
      const name = String(vNameEl ? vNameEl.value : "").trim();
      const partyRaw = String(vPartyEl ? vPartyEl.value : "").trim();
      const partySize = Math.max(1, Math.min(20, parseInt(partyRaw, 10) || 1));
      const phone = String(vPhoneEl ? vPhoneEl.value : "").trim();
      const plate = String(vPlateEl ? vPlateEl.value : "").trim();
      const email = String(vEmailEl ? vEmailEl.value : "").trim();
      const purposeType = String(vPurposeTypeEl ? vPurposeTypeEl.value : "").trim() || "親友拜訪";
      const purposeOther = String(vPurposeOtherEl ? vPurposeOtherEl.value : "").trim();
      const note = String(vNoteEl ? vNoteEl.value : "").trim();
      const purpose = purposeType === "其他" ? (purposeOther || "其他") : purposeType;
      const unit = String(state.currentUserHouseNo || "").trim();

      if (!name) {
        setStatus(visitorFormStatusEl, "請填寫訪客姓名", true);
        return;
      }
      if (!unit) {
        setStatus(visitorFormStatusEl, "無法取得您的戶號資訊", true);
        return;
      }

      const docRef = db.collection("communities").doc(state.currentCommunityId).collection(COL_VISITORS).doc();
      const vid = docRef.id;
      const nowTs = Timestamp.now();
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
        purposeOther: purposeType === "其他" ? purposeOther : "",
        note,
        inAt: null,
        outAt: null,
        keep: null,
        source: "resident",
        status: "pending",
        passAuthorized: false,
        passAuthorizedAt: null,
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: state.currentUserId || "resident",
        createdByName: state.currentUserName || "住戶",
      };
      await docRef.set(payload, { merge: true });
      setStatus(visitorFormStatusEl, "", false);
      closeModal(visitorFormModal);
      switchTab("active");
    } catch (e) {
      setStatus(visitorFormStatusEl, formatFirebaseError(e), true);
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

  function renderNeedLogin() {
    if (activeContentEl) activeContentEl.innerHTML = `<div class="status error">請先登入</div>`;
    if (historyContentEl) historyContentEl.innerHTML = `<div class="status error">請先登入</div>`;
  }

  ensureEmbedLayout();
  bindHostMessaging();
  bindEvents();
  auth.onAuthStateChanged((user) => {
    if (!user) {
      renderNeedLogin();
      return;
    }
    bootstrapUser(user).catch(() => {
      renderNeedLogin();
    });
  });
})();
