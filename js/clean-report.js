(function () {
  "use strict";

  const fbConfig = window.FIREBASE_CONFIG;
  if (!fbConfig) console.error("Missing FIREBASE_CONFIG");
  try { firebase.initializeApp(fbConfig); } catch (e) { console.log("Firebase already initialized:", e); }

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

  const el = {
    title: document.getElementById("crTitle"),
    reportView: document.getElementById("crReportView"),
    historyView: document.getElementById("crHistoryView"),
    locations: document.getElementById("crLocations"),
    note: document.getElementById("crNote"),
    submit: document.getElementById("crSubmit"),
    historyCount: document.getElementById("crHistoryCount"),
    back: document.getElementById("crBack"),
    refresh: document.getElementById("crRefresh"),
    toast: document.getElementById("crToast"),
  };

  const state = {
    user: null,
    profile: {},
    communityId: "",
    locations: [],
    selectedId: "",
    presetLocId: "",
    presetCode: "",
    presetApplied: false,
    myReports: [],
    tab: "report",
    reportsUnsub: null,
    locationsUnsub: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtDateTime(ts) {
    if (!ts) return "";
    let d = null;
    if (ts.toDate) d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else d = new Date(ts);
    if (!d || isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function msOf(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts instanceof Date) return ts.getTime();
    const n = new Date(ts).getTime();
    return isNaN(n) ? 0 : n;
  }
  function toast(msg, isErr) {
    if (!el.toast) return;
    el.toast.textContent = String(msg || "");
    el.toast.style.opacity = "1";
    el.toast.style.background = isErr ? "rgba(220,38,38,.95)" : "rgba(17,24,39,.94)";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.style.opacity = "0"; }, 2200);
  }
  function serverTs() {
    try { return firebase.firestore.FieldValue.serverTimestamp(); } catch { return new Date(); }
  }
  function activeCommunityId() {
    let p = "";
    try { p = String(new URLSearchParams(location.search).get("c") || "").trim(); } catch {}
    const stored = String(localStorage.getItem("csp_active_community_v1") || "").trim();
    return p || stored || "";
  }
  function reportsRef() { return db.collection("communities").doc(state.communityId).collection("clean_reports"); }
  function locationsRef() { return db.collection("communities").doc(state.communityId).collection("clean_locations"); }
  function kindOf(loc) {
    const k = String((loc && loc.kind) || "").trim();
    return (k === "patrol" || k === "both") ? k : "report";
  }
  function isReportLoc(loc) { const k = kindOf(loc); return k === "report" || k === "both"; }

  async function loadProfile(user) {
    let data = {};
    try {
      const snap = await db.collection("users").doc(String(user.uid)).get();
      if (snap && snap.exists) data = snap.data() || {};
      if (!Object.keys(data).length && user.email) {
        const q = await db.collection("users").where("email", "==", String(user.email).trim()).limit(1).get();
        if (q.size) data = q.docs[0].data() || {};
      }
    } catch (e) { console.warn("load profile failed", e); }
    state.profile = data;
    const name = String(data.displayName || data.name || data.fullName || user.displayName || user.email || "").trim();
    const houseNo = String(data.houseNo || data.unit || "").trim();
    const sub = String(data.subHouseNo || data.subUnit || "").trim();
    const full = sub ? `${houseNo}-${sub}` : houseNo;
    state.userName = name;
    state.houseNo = full;
    if (el.title) el.title.textContent = full ? `戶號 ${full}` : "通知清潔";
  }

  /* ---------- views ---------- */
  function switchTab(tab) {
    state.tab = tab === "history" ? "history" : "report";
    if (el.reportView) el.reportView.classList.toggle("hidden", state.tab !== "report");
    if (el.historyView) el.historyView.classList.toggle("hidden", state.tab !== "history");
    document.querySelectorAll("[data-cr-tab]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-cr-tab") === state.tab);
    });
    const bd = document.querySelector(".parcel-bd");
    if (bd) bd.scrollTop = 0;
  }

  function renderLocations() {
    if (!el.locations) return;
    const list = state.locations.filter((x) => x.enabled !== false && isReportLoc(x));
    if (!list.length) {
      el.locations.innerHTML = `<div class="status">社區尚未設定清潔位置，請聯絡管理室</div>`;
      return;
    }
    // QR code 帶入的指定位置：首次載入時自動選取並驗證代碼
    if (!state.presetApplied && state.presetLocId) {
      state.presetApplied = true;
      const preset = list.find((x) => String(x.id) === String(state.presetLocId));
      if (preset) {
        state.selectedId = preset.id;
        const code = String(preset.code || "").trim();
        if (code && state.presetCode && String(state.presetCode) !== code) {
          toast("QR code 驗證失敗，請確認位置是否正確", true);
        }
      }
    }
    if (!state.selectedId || !list.some((x) => x.id === state.selectedId)) {
      state.selectedId = list[0].id;
    }
    el.locations.innerHTML = list.map((x) => `
      <button class="cr-chip ${x.id === state.selectedId ? "active" : ""}" type="button" data-loc-id="${esc(x.id)}">${esc(x.name || "未命名位置")}</button>
    `).join("");
    el.locations.querySelectorAll("[data-loc-id]").forEach((b) => {
      b.onclick = () => { state.selectedId = b.getAttribute("data-loc-id"); renderLocations(); };
    });
    const note = list.find((x) => x.id === state.selectedId);
    const hint = document.getElementById("crLocHint");
    if (hint) {
      const txt = note && String(note.note || "").trim();
      hint.textContent = txt ? `注意事項：${txt}` : "";
      hint.hidden = !txt;
    }
  }

  function renderHistory() {
    if (!el.historyView) return;
    const list = state.myReports;
    const pending = list.filter((r) => String(r.status || "pending") !== "done").length;
    if (el.historyCount) {
      el.historyCount.textContent = String(pending);
      el.historyCount.hidden = pending === 0;
    }
    if (!list.length) {
      el.historyView.innerHTML = `<div class="status">尚無通報紀錄</div>`;
      return;
    }
    el.historyView.innerHTML = list.map((r) => {
      const done = String(r.status || "pending") === "done";
      return `
        <div class="cr-item">
          <div class="cr-row">
            <div class="cr-loc">${esc(r.locationName || "未指定位置")}</div>
            <span class="cr-tag ${done ? "done" : ""}">${done ? "已完成" : "待處理"}</span>
          </div>
          ${r.note ? `<div class="cr-note">${esc(r.note)}</div>` : ""}
          <div class="cr-time">${esc(fmtDateTime(r.createdAt))}${r.handledByName ? `　· 由 ${esc(r.handledByName)} 完成` : ""}</div>
        </div>`;
    }).join("");
  }

  /* ---------- data ---------- */
  function startLocationsListener() {
    if (state.locationsUnsub) { try { state.locationsUnsub(); } catch {} }
    state.locationsUnsub = locationsRef().onSnapshot((snap) => {
      const list = [];
      snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
      list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      state.locations = list;
      renderLocations();
    }, (err) => {
      console.warn("locations listen failed", err);
      if (el.locations) el.locations.innerHTML = `<div class="status error">無法讀取清潔位置</div>`;
    });
  }

  function startMyReportsListener(uid) {
    if (state.reportsUnsub) { try { state.reportsUnsub(); } catch {} }
    state.reportsUnsub = reportsRef().where("reporterUid", "==", String(uid)).onSnapshot((snap) => {
      const list = [];
      snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
      list.sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
      state.myReports = list.slice(0, 50);
      renderHistory();
    }, (err) => {
      console.warn("my reports listen failed", err);
      state.myReports = [];
      renderHistory();
    });
  }

  async function submitReport() {
    if (!state.user) { toast("請先登入", true); return; }
    if (!state.communityId) { toast("缺少社區資訊", true); return; }
    const loc = state.locations.find((x) => x.id === state.selectedId);
    if (!loc) { toast("請先選擇打掃位置", true); return; }
    const note = String((el.note && el.note.value) || "").trim();
    el.submit.disabled = true;
    el.submit.textContent = "送出中…";
    try {
      const now = serverTs();
      await reportsRef().add({
        locationId: loc.id,
        locationName: loc.name || "",
        note,
        status: "pending",
        reporterUid: state.user.uid,
        reporterName: state.userName || "",
        reporterHouseNo: state.houseNo || "",
        createdAt: now,
        updatedAt: now,
      });
      if (el.note) el.note.value = "";
      toast("已送出清潔通報");
      switchTab("history");
    } catch (e) {
      console.error(e);
      toast("送出失敗，請稍後再試", true);
    } finally {
      el.submit.disabled = false;
      el.submit.textContent = "送出清潔通報";
    }
  }

  function goBack() {
    if (window.opener && !window.opener.closed) {
      window.close();
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "member.html";
    }
  }

  function init() {
    try {
      const sp = new URLSearchParams(location.search);
      state.presetLocId = String(sp.get("loc") || "").trim();
      state.presetCode = String(sp.get("k") || "").trim();
    } catch {}
    if (el.submit) el.submit.onclick = submitReport;
    if (el.back) el.back.onclick = goBack;
    if (el.refresh) {
      el.refresh.onclick = async () => {
        if (el.refresh.disabled) return;
        el.refresh.disabled = true;
        const label = el.refresh.textContent;
        el.refresh.textContent = "更新中...";
        try {
          if (!state.user) return;
          const snap = await reportsRef().where("reporterUid", "==", String(state.user.uid)).get();
          const list = [];
          snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
          list.sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
          state.myReports = list.slice(0, 50);
          renderHistory();
          toast("已更新");
        } catch (e) {
          console.warn(e);
          toast("更新失敗", true);
        } finally {
          el.refresh.disabled = false;
          el.refresh.textContent = label;
        }
      };
    }
    document.querySelectorAll("[data-cr-tab]").forEach((b) => {
      b.onclick = () => switchTab(b.getAttribute("data-cr-tab"));
    });

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        const c = activeCommunityId();
        location.href = "index.html" + (c ? `?c=${encodeURIComponent(c)}` : "");
        return;
      }
      state.user = user;
      state.communityId = activeCommunityId();
      await loadProfile(user);
      if (!state.communityId) {
        if (el.locations) el.locations.innerHTML = `<div class="status error">缺少社區資訊</div>`;
        return;
      }
      startLocationsListener();
      startMyReportsListener(user.uid);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("pagehide", () => {
    [state.reportsUnsub, state.locationsUnsub].forEach((u) => { try { u && u(); } catch {} });
    state.reportsUnsub = state.locationsUnsub = null;
  });
})();
