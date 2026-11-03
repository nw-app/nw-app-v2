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

  const WORK_CATEGORIES = ["總幹事", "秘書", "清潔", "機電", "保全"];

  const el = {
    body: document.getElementById("wcBody"),
    nav: document.getElementById("wcNav"),
    communityName: document.getElementById("wcCommunityName"),
    userName: document.getElementById("wcUserName"),
    avatar: document.getElementById("wcAvatar"),
    avatarImg: document.getElementById("wcAvatarImg"),
    userChip: document.getElementById("btnUserChip"),
    toast: document.getElementById("wcToast"),
    profileModal: document.getElementById("profileModal"),
    profileCommunity: document.getElementById("profileCommunityText"),
    profileRole: document.getElementById("profileRole"),
    profileName: document.getElementById("profileNameText"),
    profileAvatar: document.getElementById("profileAvatarFallback"),
    profileAvatarImg: document.getElementById("profileAvatarImg"),
  };

  const state = {
    user: null,
    profile: {},
    communityId: "",
    communityName: "",
    tab: "punch",
    cleanFilter: "all",
    todayCheckin: null,
    reports: [],
    locations: [],
    patrols: [],
    patrolDate: "",
    highlightPatrolId: "",
    autoPatrolHandled: false,
    reportsUnsub: null,
    locationsUnsub: null,
    checkinUnsub: null,
    patrolsUnsub: null,
    scanner: null,
    ready: false,
  };

  /* ---------- helpers ---------- */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayKey(d) {
    const t = d instanceof Date ? d : new Date();
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  }
  function weekdayZh(key) {
    const parts = String(key || "").split("-").map((x) => Number(x));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "";
    return ["日", "一", "二", "三", "四", "五", "六"][new Date(parts[0], parts[1] - 1, parts[2]).getDay()] || "";
  }
  function fmtDateKey(key) {
    const w = weekdayZh(key);
    return w ? `${key}（${w}）` : String(key || "");
  }
  function fmtTime(ts) {
    if (!ts) return "--:--";
    let d = null;
    if (ts.toDate) d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else d = new Date(ts);
    if (!d || isNaN(d.getTime())) return "--:--";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
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
    el.toast.classList.toggle("show", true);
    el.toast.style.background = isErr ? "rgba(220,38,38,.95)" : "rgba(17,24,39,.94)";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.classList.remove("show"); }, 2200);
  }
  function serverTs() {
    try { return firebase.firestore.FieldValue.serverTimestamp(); } catch { return new Date(); }
  }
  function getParam(k) {
    try { return new URLSearchParams(location.search).get(k) || ""; } catch { return ""; }
  }
  function activeCommunityId() {
    const p = String(getParam("c") || "").trim();
    const stored = String(localStorage.getItem("csp_active_community_v1") || "").trim();
    return p || stored || "";
  }
  function initial(name, email) {
    const s = String(name || email || "清").trim();
    return s ? s.slice(0, 1).toUpperCase() : "清";
  }
  function reportsRef() { return db.collection("communities").doc(state.communityId).collection("clean_reports"); }
  function locationsRef() { return db.collection("communities").doc(state.communityId).collection("clean_locations"); }
  function patrolsRef() { return db.collection("communities").doc(state.communityId).collection("clean_patrols"); }
  function checkinsRef() { return db.collection("communities").doc(state.communityId).collection("clean_checkins"); }
  function todayCheckinId() { return `${String(state.user && state.user.uid || "").trim()}_${todayKey()}`; }
  function kindOf(loc) {
    const k = String((loc && loc.kind) || "").trim();
    return (k === "patrol" || k === "both") ? k : "report";
  }
  function isPatrolLoc(loc) { const k = kindOf(loc); return k === "patrol" || k === "both"; }
  function patrolLocs() {
    return state.locations.filter((l) => l.enabled !== false && isPatrolLoc(l));
  }
  function patrolDone(locId) {
    return state.patrols.some((p) => String(p.locationId || "") === String(locId || ""));
  }

  /* ---------- auth ---------- */
  function isAllowedWorker(profile, user) {
    const role = String((profile && profile.role) || "").trim();
    const cat = String((profile && profile.category) || "").trim();
    if (role === "住戶" || role === "resident" || role === "停用") return false;
    if (role === "工作" || role === "worker" || role === "清潔" || role === "清潔人員") return true;
    if (WORK_CATEGORIES.includes(cat)) return true;
    // 系統管理員可預覽
    if (role === "系統" || role === "系統管理員" || role === "系統管理者" || role === "admin") return true;
    return !!(user && user.email === "nwapp.eason@gmail.com");
  }

  async function loadProfile(user) {
    let data = {};
    try {
      const snap = await db.collection("users").doc(String(user.uid)).get();
      if (snap && snap.exists) data = snap.data() || {};
      if (!Object.keys(data).length && user.email) {
        const q = await db.collection("users").where("email", "==", String(user.email).trim()).limit(1).get();
        if (q.size) data = q.docs[0].data() || {};
      }
    } catch (e) {
      console.warn("load user profile failed", e);
    }
    state.profile = data;
    const name = String(data.displayName || data.name || data.fullName || user.displayName || user.email || "").trim();
    state.userName = name;
    if (el.userName) el.userName.textContent = name || "使用者";
    if (el.avatar) el.avatar.textContent = initial(name, user.email);
    const avatarUrl = String(data.avatarDataUrl || data.avatar || "").trim();
    if (el.avatarImg) {
      if (avatarUrl) {
        el.avatarImg.src = avatarUrl;
        el.avatarImg.style.display = "block";
        if (el.avatar) el.avatar.style.display = "none";
      } else {
        el.avatarImg.removeAttribute("src");
        el.avatarImg.style.display = "none";
        if (el.avatar) el.avatar.style.display = "grid";
      }
    }
  }

  async function resolveCommunity() {
    const cid = activeCommunityId();
    state.communityId = cid;
    const profile = state.profile || {};
    const names = Array.isArray(profile.communityNames) ? profile.communityNames : [];
    const ids = Array.isArray(profile.communityIds) ? profile.communityIds : [];
    let name = "";
    const idx = ids.map((x) => String(x || "").trim()).indexOf(String(cid).trim());
    if (idx >= 0 && names[idx]) name = String(names[idx]);
    if (!name && profile.communityName) name = String(profile.communityName);
    if (!name && cid && cid !== "default") {
      try {
        const snap = await db.collection("communities").doc(String(cid)).get();
        if (snap && snap.exists) name = String((snap.data() || {}).name || "").trim();
      } catch (e) { console.warn("resolve community name failed", e); }
      if (!name) {
        try {
          const q = await db.collection("communities").where("username", "==", String(cid)).limit(1).get();
          if (q && q.size) name = String((q.docs[0].data() || {}).name || "").trim();
        } catch (e) { console.warn("resolve community name by username failed", e); }
      }
    }
    state.communityName = name;
    if (el.communityName) el.communityName.textContent = name || cid || "社區智慧系統平台";
  }

  /* ---------- subscriptions ---------- */
  function startSubscriptions() {
    stopSubscriptions();
    if (!state.communityId) return;
    state.checkinUnsub = checkinsRef().doc(todayCheckinId()).onSnapshot((doc) => {
      state.todayCheckin = doc && doc.exists ? (doc.data() || {}) : null;
      if (state.tab === "punch") renderPunch();
    }, (err) => console.warn("checkin listen failed", err));

    state.reportsUnsub = reportsRef().orderBy("createdAt", "desc").limit(100).onSnapshot((snap) => {
      const list = [];
      snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
      state.reports = list;
      if (state.tab === "clean") renderClean();
      else if (state.tab === "punch") renderPunch();
    }, (err) => {
      console.warn("reports listen failed", err);
      state.reports = [];
      if (state.tab === "clean") renderClean();
      else if (state.tab === "punch") renderPunch();
    });

    state.locationsUnsub = locationsRef().onSnapshot((snap) => {
      const list = [];
      snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
      list.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      state.locations = list;
      if (state.tab === "patrol") renderPatrol();
      maybeAutoPatrol();
    }, (err) => console.warn("locations listen failed", err));

    watchPatrols(todayKey());
  }
  function watchPatrols(dateKey) {
    if (state.patrolsUnsub) { try { state.patrolsUnsub(); } catch {} state.patrolsUnsub = null; }
    state.patrolDate = String(dateKey || todayKey());
    state.patrolsUnsub = patrolsRef().where("dateKey", "==", state.patrolDate).onSnapshot((snap) => {
      const list = [];
      snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
      state.patrols = list;
      if (state.tab === "patrol") renderPatrol();
    }, (err) => {
      console.warn("patrols listen failed", err);
      state.patrols = [];
      if (state.tab === "patrol") renderPatrol();
    });
  }
  function stopSubscriptions() {
    [state.reportsUnsub, state.locationsUnsub, state.checkinUnsub, state.patrolsUnsub].forEach((u) => { try { u && u(); } catch {} });
    state.reportsUnsub = state.locationsUnsub = state.checkinUnsub = state.patrolsUnsub = null;
  }

  /* ---------- views ---------- */
  function statusMeta(status) {
    const s = String(status || "pending");
    if (s === "done") return { label: "已完成", cls: "done" };
    if (s === "processing") return { label: "處理中", cls: "" };
    return { label: "待處理", cls: "" };
  }

  function renderPunch() {
    const c = state.todayCheckin || {};
    const inAt = c.inAt || null;
    const outAt = c.outAt || null;
    const onDuty = !!inAt && !outAt;
    const nextType = onDuty ? "out" : "in";
    const statusCls = onDuty ? "on" : (outAt ? "out" : "");
    const statusText = onDuty ? "上班中" : (outAt ? "已下班" : "尚未打卡");
    const dotText = onDuty ? "上" : (outAt ? "下" : "休");
    const btnLabel = onDuty ? "下班打卡" : (outAt ? "重新上班打卡" : "上班打卡");

    el.body.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div>
            <h2>今日出勤</h2>
            <p>${esc(todayKey())}</p>
          </div>
        </div>
        <div class="wc-status ${statusCls}">
          <div class="dot">${dotText}</div>
          <div class="txt">
            <div class="k">目前狀態</div>
            <div class="v">${statusText}</div>
          </div>
        </div>
        <button class="wc-punch ${onDuty ? "out" : ""}" type="button" id="btnPunch">${btnLabel}</button>
        <div class="wc-meta">
          <div class="box"><div class="k">上班打卡</div><div class="v">${fmtTime(inAt)}</div></div>
          <div class="box"><div class="k">下班打卡</div><div class="v">${fmtTime(outAt)}</div></div>
        </div>
      </section>

      <section class="wc-card">
        <div class="hd">
          <div>
            <h2>待處理通報</h2>
            <p>住戶回報的清潔需求</p>
          </div>
          <span class="wc-tag">${pendingCount()} 件</span>
        </div>
        ${renderReportItems(state.reports.filter((r) => String(r.status || "pending") !== "done"), true)}
      </section>
    `;

    const btn = document.getElementById("btnPunch");
    if (btn) btn.onclick = () => doPunch(nextType, btn);
  }

  function pendingCount() {
    return state.reports.filter((r) => String(r.status || "pending") !== "done").length;
  }

  function renderReportItems(list, compact) {
    if (!list || !list.length) return `<div class="wc-empty">目前沒有通報</div>`;
    return `<div class="wc-list">${list.map((r) => {
      const meta = statusMeta(r.status);
      return `
        <div class="wc-item" data-report-id="${esc(r.id)}">
          <div class="row1">
            <div class="loc">${esc(r.locationName || r.location || "未指定位置")}</div>
            <span class="wc-tag ${meta.cls}">${meta.label}</span>
          </div>
          ${r.note ? `<div class="note">${esc(r.note)}</div>` : ""}
          <div class="who">${esc(r.reporterHouseNo ? `戶號 ${r.reporterHouseNo}` : "")}${r.reporterName ? `　${esc(r.reporterName)}` : ""}</div>
          <div class="who">指派人員：${r.assigneeName ? esc(r.assigneeName) : "未指派"}</div>
          <div class="time">${esc(fmtDateTime(r.createdAt))}${r.handledByName ? `　· 由 ${esc(r.handledByName)} 完成` : ""}</div>
          ${compact ? "" : (String(r.status || "pending") === "done" ? "" : `<button class="wc-btn-sm" type="button" data-done="${esc(r.id)}">標記完成</button>`)}
        </div>`;
    }).join("")}</div>`;
  }

  function renderClean() {
    const pending = state.reports.filter((r) => String(r.status || "pending") === "pending");
    const processing = state.reports.filter((r) => String(r.status) === "processing");
    const done = state.reports.filter((r) => String(r.status) === "done");
    const chip = (k, label, n) => `<button class="wc-btn-sm" type="button" data-clean-filter="${k}" style="${state.cleanFilter === k ? "border-color:var(--wc-red);color:var(--wc-red-dark);font-weight:900;" : ""}">${label} ${n}</button>`;

    let list = state.reports;
    if (state.cleanFilter === "pending") list = pending;
    else if (state.cleanFilter === "processing") list = processing;
    else if (state.cleanFilter === "done") list = done;

    el.body.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div>
            <h2>清潔任務</h2>
            <p>接收住戶通報並回報完成</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;">
          ${chip("all", "全部", state.reports.length)}
          ${chip("pending", "待處理", pending.length)}
          ${chip("processing", "處理中", processing.length)}
          ${chip("done", "已完成", done.length)}
        </div>
      </section>
      <section class="wc-card">
        ${renderReportItems(list, false)}
      </section>
    `;

    el.body.querySelectorAll("[data-clean-filter]").forEach((b) => {
      b.onclick = () => { state.cleanFilter = b.getAttribute("data-clean-filter"); renderClean(); };
    });
    el.body.querySelectorAll("[data-done]").forEach((b) => {
      b.onclick = () => markDone(b.getAttribute("data-done"), b);
    });
  }

  function patrolItem(loc) {
    const done = patrolDone(loc.id);
    const rec = state.patrols.find((p) => String(p.locationId || "") === String(loc.id)) || null;
    const hl = state.highlightPatrolId === String(loc.id);
    return `
      <div class="wc-item" style="${hl ? "border-color:var(--wc-red);box-shadow:0 0 0 2px rgba(211,47,47,.18);" : ""}">
        <div class="row1">
          <div class="loc">${esc(loc.name || "未命名")}${loc.zone ? `<span style="font-size:12px;color:var(--wc-muted);font-weight:800;margin-left:6px;">${esc(loc.zone)}</span>` : ""}</div>
          <span class="wc-tag ${done ? "done" : ""}">${done ? "已完成" : "待巡邏"}</span>
        </div>
        ${loc.note ? `<div class="note">${esc(loc.note)}</div>` : ""}
        ${done && rec ? `<div class="time">${esc(fmtDateTime(rec.updatedAt || rec.createdAt))}${rec.name ? `　· ${esc(rec.name)}` : ""}</div>` : ""}
        <button class="wc-btn-sm ${done ? "danger" : ""}" type="button" data-patrol-done="${esc(loc.id)}" data-mark="${done ? "0" : "1"}">${done ? "取消完成" : "標記完成"}</button>
      </div>`;
  }

  function renderPatrol() {
    const locs = patrolLocs();
    const total = locs.length;
    const doneCount = locs.filter((l) => patrolDone(l.id)).length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;

    el.body.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div>
            <h2>今日巡邏</h2>
            <p>${esc(fmtDateKey(todayKey()))}　巡邏點打卡</p>
          </div>
          <span class="wc-tag ${total && doneCount >= total ? "done" : ""}">${doneCount}/${total}</span>
        </div>
        <div style="height:10px;border-radius:999px;background:#eef0f3;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--wc-red),var(--wc-red-dark));transition:width .25s ease;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:var(--wc-muted);margin-top:8px;">
          <span>巡邏完成率</span><span>${pct}%</span>
        </div>
        <button class="wc-btn primary" type="button" id="btnScanPatrol" style="margin-top:12px;">掃描巡邏點 QR code 打卡</button>
      </section>

      <section class="wc-card">
        <div class="hd">
          <div><h2>巡邏清單</h2><p>點選按鈕可手動標記完成／取消</p></div>
        </div>
        ${locs.length ? `<div class="wc-list">${locs.map(patrolItem).join("")}</div>` : `<div class="wc-empty">尚未設定巡邏點，請聯絡社區管理員。</div>`}
      </section>
    `;

    const scan = document.getElementById("btnScanPatrol");
    if (scan) scan.onclick = () => openScanModal();
    el.body.querySelectorAll("[data-patrol-done]").forEach((b) => {
      b.onclick = () => {
        const id = b.getAttribute("data-patrol-done");
        const mark = b.getAttribute("data-mark") === "1";
        togglePatrolDone(id, mark, "worker", b);
      };
    });
  }

  function renderSetting() {
    const p = state.profile || {};
    const roleLabel = String(p.category || p.role || "工作人員");
    el.body.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div><h2>個人資訊</h2><p>帳號與權限</p></div>
        </div>
        <div class="wc-info">
          <div class="r"><span class="k">姓名</span><span class="v">${esc(state.userName || "—")}</span></div>
          <div class="r"><span class="k">角色</span><span class="v">${esc(roleLabel)}</span></div>
          <div class="r"><span class="k">社區</span><span class="v">${esc(state.communityName || state.communityId || "—")}</span></div>
          <div class="r"><span class="k">登入帳號</span><span class="v">${esc(p.username || (state.user && state.user.email) || "—")}</span></div>
          <div class="r"><span class="k">手機</span><span class="v">${esc(p.phone || "—")}</span></div>
        </div>
      </section>

      <section class="wc-card">
        <div class="hd"><div><h2>今日出勤紀錄</h2><p>${esc(todayKey())}</p></div></div>
        <div class="wc-info">
          <div class="r"><span class="k">上班</span><span class="v">${fmtTime(state.todayCheckin && state.todayCheckin.inAt)}</span></div>
          <div class="r"><span class="k">下班</span><span class="v">${fmtTime(state.todayCheckin && state.todayCheckin.outAt)}</span></div>
        </div>
      </section>

      <section class="wc-card">
        <button class="wc-btn ghost" type="button" id="btnReload" style="margin-bottom:10px;">重新載入資料</button>
        <button class="wc-btn primary" type="button" id="btnSignOut">登出</button>
      </section>
    `;
    const reload = document.getElementById("btnReload");
    if (reload) reload.onclick = () => { location.reload(); };
    const out = document.getElementById("btnSignOut");
    if (out) out.onclick = () => {
      out.disabled = true;
      out.textContent = "登出中…";
      auth.signOut().then(() => { location.href = "index.html"; }).catch(() => { out.disabled = false; out.textContent = "登出"; });
    };
  }

  function renderTab() {
    if (!state.ready) { el.body.innerHTML = `<div class="wc-empty">載入中…</div>`; return; }
    el.body.scrollTop = 0;
    if (state.tab === "punch") renderPunch();
    else if (state.tab === "clean") renderClean();
    else if (state.tab === "patrol") renderPatrol();
    else if (state.tab === "schedule" || state.tab === "leave") renderDutyTab(state.tab);
    else renderSetting();
    el.nav.querySelectorAll("[data-wc-tab]").forEach((b) => {
      const on = b.getAttribute("data-wc-tab") === state.tab;
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
  }

  function dutyCtx() {
    const p = state.profile || {};
    return {
      db,
      cid: state.communityId,
      uid: state.user ? state.user.uid : "",
      userName: state.userName || "",
      category: String(p.category || p.role || "清潔"),
      role: "clean",
      communityId: state.communityId,
      communityName: state.communityName,
      user: state.user,
      profile: p,
    };
  }

  function stopDutyTabs() {
    try {
      if (window.NwWorkerDuty && typeof window.NwWorkerDuty.teardown === "function") window.NwWorkerDuty.teardown();
    } catch {}
  }

  function renderDutyTab(key) {
    const mod = window.NwWorkerDuty;
    if (!mod || !mod.tabs || typeof mod.tabs[key] !== "function") {
      el.body.innerHTML = `<section class="wc-card"><div class="wc-empty">勤務模組載入失敗，請重新整理。</div></section>`;
      return;
    }
    let view = null;
    try { view = mod.tabs[key](dutyCtx()); } catch (e) { console.warn("duty tab failed", e); }
    if (!view) {
      el.body.innerHTML = `<section class="wc-card"><div class="wc-empty">勤務模組載入失敗，請重新整理。</div></section>`;
      return;
    }
    el.body.innerHTML = view.html;
    if (typeof view.bind === "function") view.bind(el.body);
  }

  /* ---------- actions ---------- */
  async function savePunch(type, photo, meta) {
    const ref = checkinsRef().doc(todayCheckinId());
    const now = serverTs();
    const geo = {
      latitude: meta && meta.latitude != null ? meta.latitude : null,
      longitude: meta && meta.longitude != null ? meta.longitude : null,
      distance: meta && meta.distance != null ? meta.distance : null,
      accuracy: meta && meta.accuracy != null ? meta.accuracy : null,
    };
    const payload = {
      uid: state.user.uid, name: state.userName || "",
      workDate: todayKey(), communityId: state.communityId, updatedAt: now,
    };
    if (type === "in") {
      Object.assign(payload, { inAt: now, outAt: null, inPhoto: photo || "", inGeo: geo });
    } else {
      Object.assign(payload, { outAt: now, outPhoto: photo || "", outGeo: geo });
    }
    await ref.set(payload, { merge: true });
  }

  function optimisticPunchRecord(base, type, photo, meta) {
    const now = new Date();
    const geo = {
      latitude: meta && meta.latitude != null ? meta.latitude : null,
      longitude: meta && meta.longitude != null ? meta.longitude : null,
      distance: meta && meta.distance != null ? meta.distance : null,
      accuracy: meta && meta.accuracy != null ? meta.accuracy : null,
    };
    const next = Object.assign({}, base || {}, {
      uid: state.user ? state.user.uid : "",
      name: state.userName || "",
      workDate: todayKey(),
      communityId: state.communityId,
      updatedAt: now,
    });
    if (type === "in") {
      next.inAt = now;
      next.outAt = null;
      next.inPhoto = photo || "";
      next.inGeo = geo;
    } else {
      next.outAt = now;
      next.outPhoto = photo || "";
      next.outGeo = geo;
    }
    return next;
  }

  function applyOptimisticPunch(type, photo, meta) {
    state.todayCheckin = optimisticPunchRecord(state.todayCheckin, type, photo, meta);
    if (state.tab === "punch") renderPunch();
  }

  function doPunch(type, btn) {
    if (!state.communityId) { toast("缺少社區資訊", true); return; }
    if (!state.user) { toast("尚未登入", true); return; }
    if (!window.NwPunchFlow) { toast("打卡模組載入失敗，請重新整理", true); return; }
    const isIn = type === "in";
    let lastPhoto = "";
    let lastMeta = null;
    if (btn) btn.disabled = true;
    window.NwPunchFlow.open({
      db,
      communityId: state.communityId,
      title: isIn ? "上班打卡" : "下班打卡",
      onConfirm: (photo, meta) => {
        lastPhoto = photo || "";
        lastMeta = meta || null;
        return savePunch(type, photo, meta);
      },
    }).then((r) => {
      if (btn) { try { btn.disabled = false; } catch {} }
      if (r && r.ok) {
        applyOptimisticPunch(type, lastPhoto, lastMeta);
        toast((isIn ? "上班" : "下班") + "打卡成功 " + fmtTime(new Date()));
      }
    }).catch((e) => {
      console.error(e);
      if (btn) { try { btn.disabled = false; } catch {} }
      toast("打卡失敗，請稍後再試", true);
    });
  }

  async function markDone(id, btn) {
    if (!id) return;
    btn.disabled = true;
    btn.textContent = "處理中…";
    try {
      await reportsRef().doc(String(id)).set({
        status: "done",
        handledBy: state.user ? state.user.uid : "",
        handledByName: state.userName || "",
        handledAt: serverTs(),
        updatedAt: serverTs(),
      }, { merge: true });
      toast("已標記完成");
    } catch (e) {
      console.error(e);
      toast("更新失敗，請稍後再試", true);
      btn.disabled = false;
      btn.textContent = "標記完成";
    }
  }

  async function togglePatrolDone(locId, markDone, source, btn) {
    const loc = state.locations.find((x) => String(x.id) === String(locId));
    if (!loc) { toast("找不到巡邏點", true); return; }
    if (!state.communityId || !state.user) { toast("缺少社區或登入資訊", true); return; }
    const dateKey = state.patrolDate || todayKey();
    const docId = `${dateKey}__${loc.id}`;
    const now = serverTs();
    if (btn) { btn.disabled = true; btn.textContent = markDone ? "打卡中…" : "處理中…"; }
    try {
      if (markDone) {
        await patrolsRef().doc(docId).set({
          communityId: state.communityId,
          dateKey,
          locationId: loc.id,
          locationName: loc.name || "",
          zone: loc.zone || "",
          uid: state.user ? state.user.uid : "",
          name: state.userName || "",
          source: source || "worker",
          createdAt: now,
          updatedAt: now,
        }, { merge: true });
        toast(`${loc.name || "巡邏點"} 已完成巡邏打卡`);
      } else {
        await patrolsRef().doc(docId).delete();
        toast(`${loc.name || "巡邏點"} 已取消打卡`);
      }
    } catch (e) {
      console.error(e);
      toast("更新失敗，請稍後再試", true);
      if (btn) { btn.disabled = false; btn.textContent = markDone ? "標記完成" : "取消完成"; }
    }
  }

  function parsePatrolCode(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    let locId = "";
    let k = "";
    const m1 = raw.match(/[?&]patrol=([^&#]+)/i);
    const m2 = raw.match(/[?&]k=([^&#]+)/i);
    if (m1) locId = decodeURIComponent(m1[1]);
    if (m2) k = decodeURIComponent(m2[1]);
    if (!locId) {
      try {
        const o = JSON.parse(raw);
        if (o && o.patrol) locId = String(o.patrol);
        if (o && o.k) k = String(o.k);
      } catch {}
    }
    return locId ? { locId, k } : null;
  }

  async function handlePatrolCode(text) {
    const parsed = parsePatrolCode(text);
    if (!parsed) { toast("此 QR code 不是巡邏點", true); return; }
    const loc = state.locations.find((x) => String(x.id) === String(parsed.locId));
    if (!loc) { toast("找不到對應的巡邏點，請重新整理", true); return; }
    if (loc.enabled === false) { toast("此巡邏點已停用", true); return; }
    if (!isPatrolLoc(loc)) { toast("此位置未開放巡邏打卡", true); return; }
    const code = String(loc.code || "").trim();
    if (code && parsed.k && String(parsed.k) !== code) { toast("QR code 驗證失敗", true); return; }
    state.highlightPatrolId = String(loc.id);
    state.tab = "patrol";
    if (patrolDone(loc.id)) {
      toast(`${loc.name || "巡邏點"} 今日已完成打卡`);
      renderTab();
      return;
    }
    renderTab();
    await togglePatrolDone(loc.id, true, "scan");
  }

  async function maybeAutoPatrol() {
    if (state.autoPatrolHandled) return;
    const locId = String(getParam("patrol") || "").trim();
    if (!locId) { state.autoPatrolHandled = true; return; }
    if (!state.locations.length) return;
    state.autoPatrolHandled = true;
    const k = String(getParam("k") || "");
    await handlePatrolCode(`?patrol=${encodeURIComponent(locId)}&k=${encodeURIComponent(k)}`);
  }

  /* ---------- 掃描 QR code ---------- */
  async function stopPatrolScan() {
    const scanner = state.scanner;
    state.scanner = null;
    const wrap = document.getElementById("wcScanWrap");
    if (scanner) {
      try { await scanner.stop(); } catch {}
      try { scanner.clear(); } catch {}
    }
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }

  function openScanModal() {
    if (typeof Html5Qrcode !== "function") { toast("掃碼元件未載入，請重新整理", true); return; }
    if (state.scanner) return;
    const wrap = document.createElement("div");
    wrap.id = "wcScanWrap";
    wrap.style.cssText = "position:fixed;inset:0;z-index:99997;background:#000;display:flex;flex-direction:column;";
    wrap.innerHTML = `
      <div style="flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:calc(10px + env(safe-area-inset-top,0px)) 14px 10px;background:#111827;color:#fff;">
        <div style="font-size:15px;font-weight:900;">掃描巡邏點 QR code</div>
        <button type="button" id="wcScanClose" style="border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;border-radius:999px;padding:7px 16px;font-size:13px;font-weight:900;cursor:pointer;">關閉</button>
      </div>
      <div id="wcReader" style="flex:1 1 auto;position:relative;background:#000;overflow:hidden;"></div>
      <div id="wcScanTip" style="flex:0 0 auto;padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));background:#111827;color:#d1d5db;font-size:12px;font-weight:700;text-align:center;">將巡邏點 QR code 置於畫面中央</div>
    `;
    document.body.appendChild(wrap);
    const close = () => { stopPatrolScan(); };
    const closeBtn = document.getElementById("wcScanClose");
    if (closeBtn) closeBtn.onclick = close;

    const scanner = new Html5Qrcode("wcReader", { verbose: false });
    state.scanner = scanner;
    const cfg = {
      fps: 12,
      qrbox: (vw, vh) => {
        const m = Math.floor(Math.min(vw, vh) * 0.85);
        return { width: m, height: m };
      },
      aspectRatio: 1.0,
    };
    scanner.start({ facingMode: "environment" }, cfg, async (text) => {
      if (!state.scanner) return;
      state.scanner = null;
      try { await scanner.stop(); } catch {}
      try { scanner.clear(); } catch {}
      const w = document.getElementById("wcScanWrap");
      if (w && w.parentNode) w.parentNode.removeChild(w);
      handlePatrolCode(text);
    }, () => {}).catch((err) => {
      console.warn("camera start failed", err);
      state.scanner = null;
      const tip = document.getElementById("wcScanTip");
      if (tip) { tip.textContent = "無法開啟相機，請確認已允許相機權限"; tip.style.color = "#fca5a5"; }
    });
  }

  function showDenied() {
    el.body.innerHTML = `<section class="wc-card"><div class="wc-empty">此帳號無清潔人員權限，請聯絡社區管理員。</div>
      <button class="wc-btn primary" type="button" id="btnDeniedOut">登出</button></section>`;
    const b = document.getElementById("btnDeniedOut");
    if (b) b.onclick = () => { auth.signOut().then(() => { location.href = "index.html"; }).catch(() => {}); };
  }

  /* ---------- 個人資訊彈窗（與社區前台一致） ---------- */
  function openProfileModal() {
    const modal = el.profileModal;
    if (!modal) return;
    const roleLabel = String((state.profile && state.profile.category) || (state.profile && state.profile.role) || "清潔");
    if (el.profileCommunity) el.profileCommunity.textContent = state.communityName || state.communityId || "—";
    if (el.profileRole) el.profileRole.textContent = roleLabel;
    if (el.profileName) el.profileName.textContent = state.userName || "—";
    const url = el.avatarImg && el.avatarImg.getAttribute("src") ? String(el.avatarImg.getAttribute("src")) : "";
    if (el.profileAvatarImg) {
      if (url) {
        el.profileAvatarImg.src = url;
        el.profileAvatarImg.style.display = "block";
        if (el.profileAvatar) el.profileAvatar.style.display = "none";
      } else {
        el.profileAvatarImg.removeAttribute("src");
        el.profileAvatarImg.style.display = "none";
        if (el.profileAvatar) {
          el.profileAvatar.style.display = "grid";
          el.profileAvatar.textContent = initial(state.userName, state.user && state.user.email);
        }
      }
    }
    modal.hidden = false;
    if (el.userChip) el.userChip.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }

  function closeProfileModal() {
    const modal = el.profileModal;
    if (!modal) return;
    modal.hidden = true;
    if (el.userChip) el.userChip.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  function bindProfileModal() {
    const modal = el.profileModal;
    if (!modal) return;
    modal.querySelectorAll("[data-wc-modal-close]").forEach((b) => { b.onclick = closeProfileModal; });
    const c1 = document.getElementById("wcProfileClose");
    if (c1) c1.onclick = closeProfileModal;
    const c2 = document.getElementById("wcProfileCloseFt");
    if (c2) c2.onclick = closeProfileModal;
    const out = document.getElementById("wcProfileSignOut");
    if (out) out.onclick = () => {
      out.disabled = true;
      out.textContent = "登出中…";
      auth.signOut().then(() => { location.href = "index.html"; }).catch(() => { out.disabled = false; out.textContent = "登出"; });
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && el.profileModal && !el.profileModal.hidden) closeProfileModal();
    });
  }

  /* ---------- boot ---------- */
  function switchTab(t) {
    if (t !== "punch" && t !== "clean" && t !== "patrol" && t !== "schedule" && t !== "leave" && t !== "setting") return;
    if (state.tab !== t) stopDutyTabs();
    state.tab = t;
    renderTab();
  }

  function init() {
    el.nav.querySelectorAll("[data-wc-tab]").forEach((b) => {
      b.onclick = () => switchTab(b.getAttribute("data-wc-tab"));
    });
    if (el.userChip) el.userChip.onclick = () => openProfileModal();
    bindProfileModal();

    auth.onAuthStateChanged(async (user) => {
      stopSubscriptions();
      if (!user) {
        const url = "index.html" + (activeCommunityId() ? `?c=${encodeURIComponent(activeCommunityId())}` : "");
        location.href = url;
        return;
      }
      state.user = user;
      await loadProfile(user);
      await resolveCommunity();
      if (!isAllowedWorker(state.profile, user)) { state.ready = false; showDenied(); return; }
      if (window.NwWorkerDuty && typeof window.NwWorkerDuty.bindCommunitySwitch === "function") {
        window.NwWorkerDuty.bindCommunitySwitch({ el: el.communityName, profile: state.profile, activeKey: state.communityId });
      }
      state.ready = true;
      renderTab();
      startSubscriptions();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("pagehide", () => { try { stopPatrolScan(); } catch {} stopDutyTabs(); stopSubscriptions(); });
})();
