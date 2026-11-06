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
    cleanDate: todayKey(),
    todayCheckin: null,
    todayShift: "",
    dutySettings: null,
    records: [],
    reports: [],
    locations: [],
    patrols: [],
    patrolDate: "",
    highlightPatrolId: "",
    autoPatrolHandled: false,
    reportsUnsub: null,
    locationsUnsub: null,
    checkinUnsub: null,
    shiftUnsub: null,
    settingsUnsub: null,
    recordsUnsub: null,
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
  function dateKeyOfTs(ts) {
    const d = toDateObj(ts);
    return d ? todayKey(d) : "";
  }
  function fmtTime(ts) {
    if (!ts) return "--:--";
    let d = null;
    if (ts.toDate) d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else d = new Date(ts);
    if (!d || isNaN(d.getTime())) return "--:--";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  /* 現在時間 HH:MM:SS（每秒更新） */
  let clockTimer = null;
  function fmtClock(d) {
    const t = d instanceof Date ? d : new Date();
    return `${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;
  }
  function startClock() {
    const tick = () => {
      const n = document.getElementById("wcClock");
      if (!n) { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } return; }
      n.textContent = fmtClock(new Date());
    };
    tick();
    if (!clockTimer) clockTimer = setInterval(tick, 1000);
  }
  function fmtDateTime(ts) {
    if (!ts) return "";
    let d = null;
    if (ts.toDate) d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else d = new Date(ts);
    if (!d || isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function msOf(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts instanceof Date) return ts.getTime();
    const n = new Date(ts).getTime();
    return isNaN(n) ? 0 : n;
  }
  /* 依班別時間判定打卡狀態：正常→ok（綠底）／遲到、早退→bad（紅底） */
  function toDateObj(ts) {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  function hmToMin(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  function minOfDay(ts) {
    const d = toDateObj(ts);
    return d ? d.getHours() * 60 + d.getMinutes() : null;
  }
  function shiftWindow(category, shiftName) {
    const ds = state.dutySettings || {};
    const rs = ds.roleShifts || {};
    const list = Array.isArray(rs[category]) ? rs[category] : [];
    const def = list.find((x) => x && String(x.name || "") === String(shiftName || ""));
    const start = (def && def.start) || ds.workStart || "08:00";
    const end = (def && def.end) || ds.workEnd || "17:00";
    return { start: String(start || ""), end: String(end || "") };
  }
  function punchBoxCls(ts, limitMin, isIn) {
    if (!ts) return "";
    const cur = minOfDay(ts);
    if (cur == null || limitMin == null) return "ok";
    if (isIn) return cur > limitMin ? "bad" : "ok";
    return cur < limitMin ? "bad" : "ok";
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
  function schedulesRef() { return db.collection("communities").doc(state.communityId).collection("duty_schedules"); }
  function dutySettingRef() { return db.collection("communities").doc(state.communityId).collection("settings").doc("duty"); }
  function todayCheckinId() { return `${String(state.user && state.user.uid || "").trim()}_${todayKey()}`; }
  function kindOf(loc) {
    const k = String((loc && loc.kind) || "").trim();
    return (k === "patrol" || k === "both") ? k : "report";
  }
  function isPatrolLoc(loc) { const k = kindOf(loc); return k === "patrol" || k === "both"; }
  /* 清潔重點（預設「清潔」）與勾選方式 */
  function pointsOf(loc) {
    const arr = (loc && loc.points) || [];
    const list = Array.isArray(arr) ? arr.map((x) => String(x || "").trim()).filter(Boolean) : [];
    return list.length ? list : ["清潔"];
  }
  function pointModeOf(loc) { return String((loc && loc.pointMode) || "multi") === "single" ? "single" : "multi"; }
  function patrolLocs() {
    return state.locations.filter((l) => l.enabled !== false && isPatrolLoc(l));
  }
  function patrolDone(locId) {
    if (state.patrols.some((p) => String(p.locationId || "") === String(locId || ""))) return true;
    return pendingPatrolDone(locId);
  }

  /* ---------- 巡邏打卡離線暫存 ---------- */
  const PATROL_QUEUE_KEY = "nw_clean_patrol_queue_v1";
  function loadPatrolQueue() {
    try { const a = JSON.parse(localStorage.getItem(PATROL_QUEUE_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  function savePatrolQueue(q) {
    try { localStorage.setItem(PATROL_QUEUE_KEY, JSON.stringify(q)); } catch (e) { console.warn("save queue failed", e); }
  }
  function enqueuePatrol(item) {
    const q = loadPatrolQueue().filter((x) => !(x.dateKey === item.dateKey && String(x.locationId) === String(item.locationId)));
    q.push(item);
    savePatrolQueue(q);
  }
  function dequeuePatrol(dateKey, locationId) {
    savePatrolQueue(loadPatrolQueue().filter((x) => !(x.dateKey === dateKey && String(x.locationId) === String(locationId))));
  }
  function pendingPatrolDone(locId) {
    const dk = state.patrolDate || todayKey();
    return loadPatrolQueue().some((x) => x.dateKey === dk && String(x.locationId) === String(locId || ""));
  }
  function queuePatrolCheckin(loc, source, extra) {
    const ex = extra || {};
    enqueuePatrol({
      dateKey: state.patrolDate || todayKey(),
      locationId: loc.id,
      locationName: loc.name || "",
      zone: loc.zone || "",
      uid: state.user ? state.user.uid : "",
      name: state.userName || "",
      source: source || "worker",
      points: Array.isArray(ex.points) ? ex.points : [],
      photo: String(ex.photo || ""),
      atMs: Date.now(),
    });
  }
  let flushingPatrols = false;
  async function flushPatrolQueue() {
    if (flushingPatrols) return;
    if (!state.communityId || !state.user) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const q = loadPatrolQueue();
    if (!q.length) return;
    flushingPatrols = true;
    let sent = 0;
    try {
      for (const item of q.slice()) {
        try {
          const at = firebase.firestore.Timestamp.fromMillis(Number(item.atMs) || Date.now());
          await patrolsRef().doc(`${item.dateKey}__${item.locationId}`).set({
            communityId: state.communityId,
            dateKey: item.dateKey,
            locationId: item.locationId,
            locationName: item.locationName || "",
            zone: item.zone || "",
            uid: item.uid || "",
            name: item.name || "",
            source: item.source || "worker",
            points: Array.isArray(item.points) ? item.points : [],
            photo: String(item.photo || ""),
            createdAt: at,
            updatedAt: serverTs(),
            offlineQueued: true,
          }, { merge: true });
          dequeuePatrol(item.dateKey, item.locationId);
          sent += 1;
        } catch (e) {
          console.warn("flush patrol failed", e);
          break;
        }
      }
    } finally {
      flushingPatrols = false;
    }
    if (sent) {
      toast(`已同步上傳 ${sent} 筆巡邏打卡`);
      if (state.tab === "patrol") renderPatrol();
    }
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

  async function resolveCommunityDocId(key) {
    const k = String(key || "").trim();
    if (!k || k === "default") return k;
    try {
      const byId = await db.collection("communities").doc(k).get();
      if (byId && byId.exists) return k;
    } catch (e) { console.warn("resolve community by id failed", e); }
    try {
      const snap = await db.collection("communities").where("username", "==", k).limit(1).get();
      if (snap && snap.size) return String(snap.docs[0].id || k);
    } catch (e) { console.warn("resolve community by username failed", e); }
    return k;
  }

  async function resolveCommunity() {
    // ?c= 可能是社區代號(username)或社區文件 ID；統一解析為文件 ID，
    // 確保與住戶端/管理端寫入的 communities/{docId}/... 路徑一致，才能即時同步清潔通報等資料。
    const rawKey = activeCommunityId();
    const cid = await resolveCommunityDocId(rawKey);
    state.communityId = cid;
    // 舊版打卡可能寫在 communities/{代號}/clean_checkins，記錄下來以便搬移
    state.legacyCommunityId = (rawKey && rawKey !== cid) ? rawKey : "";
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

  // 舊版打卡資料可能寫在「社區代號」路徑下，搬移到社區文件 ID 路徑，
  // 讓本人與管理端都能看到相同資料（僅搬移本人本月紀錄，失敗時靜默略過）。
  async function migrateLegacyCheckins() {
    const legacyKey = String(state.legacyCommunityId || "").trim();
    const uid = String(state.user && state.user.uid || "").trim();
    if (!legacyKey || !uid) return;
    const flagKey = `csp_clean_checkin_migrated_${state.communityId}`;
    try { if (sessionStorage.getItem(flagKey)) return; } catch {}
    const mk = todayKey().slice(0, 7);
    let snap = null;
    try {
      snap = await db.collection("communities").doc(legacyKey).collection("clean_checkins")
        .where("workDate", ">=", `${mk}-01`).where("workDate", "<=", `${mk}-31`).get();
    } catch (e) { console.warn("legacy checkins read failed", e); return; }
    try { sessionStorage.setItem(flagKey, "1"); } catch {}
    if (!snap || !snap.size) return;
    const batch = db.batch();
    let n = 0;
    snap.forEach((d) => {
      const x = d.data() || {};
      if (String(x.uid || "") !== uid) return;
      batch.set(checkinsRef().doc(String(d.id)), x, { merge: true });
      n += 1;
    });
    if (!n) return;
    try { await batch.commit(); console.info(`migrated ${n} legacy clean checkins`); }
    catch (e) { console.warn("legacy checkins migrate failed", e); }
  }

  /* ---------- subscriptions ---------- */
  function startSubscriptions() {
    stopSubscriptions();
    if (!state.communityId) return;
    state.checkinUnsub = checkinsRef().doc(todayCheckinId()).onSnapshot((doc) => {
      state.todayCheckin = doc && doc.exists ? (doc.data() || {}) : null;
      if (state.tab === "punch") renderPunch();
    }, (err) => console.warn("checkin listen failed", err));

    state.shiftUnsub = schedulesRef().doc(todayKey()).onSnapshot((doc) => {
      const d = doc && doc.exists ? (doc.data() || {}) : {};
      const shifts = d.shifts || {};
      state.todayShift = String(shifts[String(state.user && state.user.uid || "")] || "");
      if (state.tab === "punch") renderPunch();
    }, (err) => { console.warn("shift listen failed", err); state.todayShift = ""; });

    state.settingsUnsub = dutySettingRef().onSnapshot((doc) => {
      state.dutySettings = doc && doc.exists ? (doc.data() || {}) : null;
      if (state.tab === "punch") renderPunch();
    }, (err) => { console.warn("duty settings listen failed", err); state.dutySettings = null; });

    const mk = todayKey().slice(0, 7);
    state.recordsUnsub = checkinsRef().where("workDate", ">=", `${mk}-01`).where("workDate", "<=", `${mk}-31`).onSnapshot((snap) => {
      const list = [];
      const uid = String(state.user && state.user.uid || "");
      snap.forEach((d) => {
        const x = d.data() || {};
        if (String(x.uid || "") === uid) list.push(x);
      });
      state.records = list;
      if (state.tab === "record") renderRecord();
    }, (err) => {
      console.warn("month checkins listen failed", err);
      state.records = [];
      if (state.tab === "record") renderRecord();
    });

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
    /* 恢復連線後自動補上離線暫存的巡邏打卡 */
    flushPatrolQueue().catch(() => {});
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
    [state.reportsUnsub, state.locationsUnsub, state.checkinUnsub, state.shiftUnsub, state.settingsUnsub, state.recordsUnsub, state.patrolsUnsub].forEach((u) => { try { u && u(); } catch {} });
    state.reportsUnsub = state.locationsUnsub = state.checkinUnsub = state.shiftUnsub = state.settingsUnsub = state.recordsUnsub = state.patrolsUnsub = null;
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

    const shift = state.todayShift || "未排班";
    const cat = String((state.profile && (state.profile.category || state.profile.role)) || "清潔").trim();
    const win = shiftWindow(cat, state.todayShift || "");
    const inCls = punchBoxCls(inAt, hmToMin(win.start), true);
    const outCls = punchBoxCls(outAt, hmToMin(win.end), false);

    el.body.innerHTML = `
      <section class="wc-card">
        <div class="hd today-hd">
          <div>
            <h2>今日出勤</h2>
            <p>今日班表：${esc(shift)}</p>
          </div>
          <div id="wcClock" style="font-weight:900;letter-spacing:.5px;color:var(--wc-red);font-variant-numeric:tabular-nums;">--:--:--</div>
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
          <div class="box${inCls ? " " + inCls : ""}"><div class="k">上班打卡</div><div class="v">${fmtTime(inAt)}</div></div>
          <div class="box${outCls ? " " + outCls : ""}"><div class="k">下班打卡</div><div class="v">${fmtTime(outAt)}</div></div>
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
    startClock();
  }

  function pendingCount() {
    return state.reports.filter((r) => String(r.status || "pending") !== "done").length;
  }

  // 通報人顯示：社區後台帳號顯示「角色名稱 + 姓名」；住戶端通報顯示「戶號」。
  const reporterRoleCache = Object.create(null);
  function isStaffReport(r) {
    return String((r && r.source) || "") === "admin" || !!String((r && r.reporterRole) || "").trim();
  }
  function reporterRoleOf(r) {
    const uid = String((r && r.reporterUid) || "").trim();
    if (!uid) return "";
    if (Object.prototype.hasOwnProperty.call(reporterRoleCache, uid)) return reporterRoleCache[uid];
    reporterRoleCache[uid] = "";
    db.collection("users").doc(uid).get().then((snap) => {
      const d = snap && snap.exists ? (snap.data() || {}) : {};
      const role = String(d.category || d.role || "").trim();
      reporterRoleCache[uid] = role;
      if (role) {
        if (state.tab === "clean") renderClean();
        else if (state.tab === "punch") renderPunch();
      }
    }).catch(() => {});
    return "";
  }
  function reporterDisplay(r) {
    const name = String((r && r.reporterName) || "").trim();
    const house = String((r && r.reporterHouseNo) || "").trim();
    if (isStaffReport(r)) {
      const role = String((r && r.reporterRole) || "").trim() || reporterRoleOf(r) || "管理室";
      return [role, name].filter(Boolean).join(" ");
    }
    const parts = [];
    if (house) parts.push(`戶號 ${house}`);
    if (name) parts.push(name);
    return parts.join("　");
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
          <div class="who">通報人員：${esc(reporterDisplay(r))}</div>
          <div class="who">指派人員：${r.assigneeName ? esc(r.assigneeName) : "未指派"}</div>
          <div class="time">${esc(fmtDateTime(r.createdAt))}${r.handledByName ? `　· 由 ${esc(r.handledByName)} 完成` : ""}</div>
          ${compact ? "" : (String(r.status || "pending") === "done" ? "" : `<button class="wc-btn-sm" type="button" data-done="${esc(r.id)}">標記完成</button>`)}
        </div>`;
    }).join("")}</div>`;
  }

  function renderClean() {
    const today = todayKey();
    const dayKey = state.cleanDate || today;
    /* 以日期為頁面單位：先取出選定日期的通報 */
    const dayList = state.reports.filter((r) => {
      const k = dateKeyOfTs(r.createdAt);
      return k === dayKey || (!k && dayKey === today);
    });
    const pending = dayList.filter((r) => String(r.status || "pending") === "pending");
    const processing = dayList.filter((r) => String(r.status) === "processing");
    const done = dayList.filter((r) => String(r.status) === "done");
    const chip = (k, label, n) => `<button class="wc-btn-sm" type="button" data-clean-filter="${k}" style="${state.cleanFilter === k ? "border-color:var(--wc-red);color:var(--wc-red-dark);font-weight:900;" : ""}">${label} ${n}</button>`;

    let list = dayList;
    if (state.cleanFilter === "pending") list = pending;
    else if (state.cleanFilter === "processing") list = processing;
    else if (state.cleanFilter === "done") list = done;

    const isToday = dayKey === today;
    const dateLabel = `${fmtDateKey(dayKey)}${isToday ? "（今天）" : ""}`;
    const nextBtn = isToday
      ? `<button class="wc-btn-sm" type="button" disabled style="opacity:.45;">後一日 ▶</button>`
      : `<button class="wc-btn-sm" type="button" data-clean-date="1">後一日 ▶</button>`;

    el.body.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div>
            <h2>清潔任務</h2>
            <p>接收住戶通報並回報完成</p>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
          <button class="wc-btn-sm" type="button" data-clean-date="-1">◀ 前一日</button>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;">
            <button class="wc-btn-sm" type="button" data-clean-picker="1" style="border-color:var(--wc-red);color:var(--wc-red-dark);font-weight:900;">${esc(dateLabel)} ▾</button>
            ${isToday ? "" : `<button class="wc-btn-sm" type="button" data-clean-today="1">回到今日</button>`}
          </div>
          ${nextBtn}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px;">
          ${chip("all", "全部", dayList.length)}
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
    el.body.querySelectorAll("[data-clean-date]").forEach((b) => {
      b.onclick = () => shiftCleanDate(Number(b.getAttribute("data-clean-date")) || 0);
    });
    const todayBtn = el.body.querySelector("[data-clean-today]");
    if (todayBtn) todayBtn.onclick = () => { state.cleanDate = todayKey(); renderClean(); };
    const picker = el.body.querySelector("[data-clean-picker]");
    if (picker) picker.onclick = () => openDatePicker();
    el.body.querySelectorAll("[data-done]").forEach((b) => {
      b.onclick = () => markDone(b.getAttribute("data-done"), b);
    });
  }

  /* 切換清潔任務的日期頁（不超過今日） */
  function shiftCleanDate(delta) {
    if (!delta) return;
    const today = todayKey();
    const base = state.cleanDate || today;
    const parts = String(base).split("-").map((x) => Number(x));
    const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
    d.setDate(d.getDate() + delta);
    const next = todayKey(d);
    state.cleanDate = next > today ? today : next;
    renderClean();
  }

  /* 日期選擇彈窗：月曆標記有紀錄的日期，點選即跳至該日 */
  function openDatePicker() {
    const today = todayKey();
    const marks = new Set();
    state.reports.forEach((r) => { const k = dateKeyOfTs(r.createdAt); if (k) marks.add(k); });
    let cur = state.cleanDate || today;
    let curMonth = cur.slice(0, 7);

    const wrap = document.createElement("div");
    wrap.id = "wcDateWrap";
    wrap.style.cssText = "position:fixed;inset:0;z-index:99996;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:20px;";
    wrap.innerHTML = `<div id="wcDateCard" style="width:100%;max-width:360px;background:#fff;border-radius:18px;box-shadow:0 18px 44px rgba(17,24,39,.32);overflow:hidden;"></div>`;
    document.body.appendChild(wrap);

    const close = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });

    const card = document.getElementById("wcDateCard");

    const renderCal = () => {
      const parts = curMonth.split("-").map((x) => Number(x));
      const y = parts[0], m = parts[1];
      const startDow = new Date(y, m - 1, 1).getDay();
      const daysIn = new Date(y, m, 0).getDate();
      const canNext = curMonth < today.slice(0, 7);

      let cells = "";
      for (let i = 0; i < startDow; i++) cells += `<div></div>`;
      for (let d = 1; d <= daysIn; d++) {
        const key = `${y}-${pad2(m)}-${pad2(d)}`;
        const isFuture = key > today;
        const hasRec = marks.has(key);
        const isSel = key === cur;
        const isTod = key === today;
        /* 沒有紀錄的日期不可點選 */
        const disabled = isFuture || !hasRec;
        const bg = isSel ? "#d32f2f" : (hasRec ? "#fee2e2" : "#f3f4f6");
        const fg = isSel ? "#fff" : (disabled ? "#cbd5e1" : "#b91c1c");
        const ring = isTod && !isSel ? "box-shadow:inset 0 0 0 2px rgba(211,47,47,.5);" : "";
        const dot = hasRec && !isSel ? `<span style="display:block;width:5px;height:5px;border-radius:50%;background:#d32f2f;margin:2px auto 0;"></span>` : "";
        cells += `<button type="button" data-day="${key}" ${disabled ? "disabled" : ""} style="height:38px;border:0;background:${bg};color:${fg};border-radius:10px;font-size:14px;font-weight:${hasRec || isSel ? 900 : 700};cursor:${disabled ? "not-allowed" : "pointer"};${ring}">${d}${dot}</button>`;
      }

      const nextBtn = canNext
        ? `<button type="button" data-nv="1" style="border:1px solid var(--wc-line);background:#fff;border-radius:10px;width:36px;height:36px;font-size:16px;font-weight:900;cursor:pointer;">›</button>`
        : `<button type="button" disabled style="border:1px solid var(--wc-line);background:#fff;border-radius:10px;width:36px;height:36px;font-size:16px;font-weight:900;opacity:.4;cursor:not-allowed;">›</button>`;

      card.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 14px 10px;">
          <button type="button" data-nv="-1" style="border:1px solid var(--wc-line);background:#fff;border-radius:10px;width:36px;height:36px;font-size:16px;font-weight:900;cursor:pointer;">‹</button>
          <div style="font-size:16px;font-weight:900;">${y} 年 ${m} 月</div>
          ${nextBtn}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:0 12px 6px;color:var(--wc-muted);font-size:11px;font-weight:900;text-align:center;">
          ${["日", "一", "二", "三", "四", "五", "六"].map((w) => `<div>${w}</div>`).join("")}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:0 12px 12px;">
          ${cells}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px 14px;border-top:1px solid var(--wc-line);">
          <span style="font-size:12px;color:var(--wc-muted);font-weight:700;">● 僅有紀錄的日期可點選</span>
          <div style="display:flex;gap:8px;">
            <button type="button" data-today="1" style="border:1px solid var(--wc-line);background:#fff;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:900;cursor:pointer;">今天</button>
            <button type="button" data-close="1" style="border:0;background:#d32f2f;color:#fff;border-radius:10px;padding:8px 14px;font-size:13px;font-weight:900;cursor:pointer;">關閉</button>
          </div>
        </div>
      `;

      card.querySelectorAll("[data-nv]").forEach((b) => {
        b.onclick = () => {
          const del = Number(b.getAttribute("data-nv")) || 0;
          const p = curMonth.split("-").map((x) => Number(x));
          const nd = new Date(p[0], p[1] - 1 + del, 1);
          const nm = `${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}`;
          if (nm > today.slice(0, 7)) return;
          curMonth = nm;
          renderCal();
        };
      });
      card.querySelectorAll("[data-day]").forEach((b) => {
        b.onclick = () => {
          if (b.disabled) return;
          state.cleanDate = b.getAttribute("data-day");
          close();
          renderClean();
        };
      });
      const tb = card.querySelector("[data-today]");
      if (tb) tb.onclick = () => { state.cleanDate = today; close(); renderClean(); };
      const cb = card.querySelector("[data-close]");
      if (cb) cb.onclick = close;
    };

    renderCal();
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
        ${done
          ? `<button class="wc-btn-sm danger" type="button" data-patrol-done="${esc(loc.id)}" data-mark="0">取消完成</button>`
          : `<button class="wc-btn-sm" type="button" data-patrol-scan="1" style="border-color:var(--wc-red);color:var(--wc-red-dark);font-weight:900;">掃描 QR code 完成</button>`}
      </div>`;
  }

  function renderPatrol() {
    const locs = patrolLocs();
    const total = locs.length;
    const doneCount = locs.filter((l) => patrolDone(l.id)).length;
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    const pendCount = loadPatrolQueue().filter((x) => x.dateKey === (state.patrolDate || todayKey())).length;

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
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="wc-btn primary" type="button" id="btnScanPatrol" style="flex:1 1 0;min-width:0;">掃描 QR code</button>
          <button class="wc-btn" type="button" id="btnNfcPatrol" style="flex:1 1 0;min-width:0;">NFC 感應</button>
        </div>
        <div style="font-size:12px;color:var(--wc-muted);font-weight:700;margin-top:8px;text-align:center;">QR code 與 NFC 標籤內容相同，擇一使用即可</div>
        ${pendCount ? `
        <div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;font-size:12px;font-weight:800;display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span>待上傳 ${pendCount} 筆（連線恢復後自動同步）</span>
          <button type="button" id="btnFlushPatrol" style="border:0;background:#ea580c;color:#fff;border-radius:10px;padding:7px 12px;font-size:12px;font-weight:900;cursor:pointer;">立即同步</button>
        </div>` : ""}
      </section>

      <section class="wc-card">
        <div class="hd">
          <div><h2>巡邏清單</h2><p>須掃描 QR code 或感應 NFC 才能完成打卡</p></div>
        </div>
        ${locs.length ? `<div class="wc-list">${locs.map(patrolItem).join("")}</div>` : `<div class="wc-empty">尚未設定巡邏點，請聯絡社區管理員。</div>`}
      </section>
    `;

    const scan = document.getElementById("btnScanPatrol");
    if (scan) scan.onclick = () => openScanModal();
    const nfc = document.getElementById("btnNfcPatrol");
    if (nfc) nfc.onclick = () => startNfcScan();
    const flush = document.getElementById("btnFlushPatrol");
    if (flush) flush.onclick = () => { flushPatrolQueue(); };
    /* 未完成的巡邏點只能透過掃描 QR code 或 NFC 完成，無法直接標記 */
    el.body.querySelectorAll("[data-patrol-scan]").forEach((b) => {
      const v = b.getAttribute("data-patrol-scan");
      b.onclick = () => { if (v === "nfc") startNfcScan(); else openScanModal(); };
    });
    el.body.querySelectorAll("[data-patrol-done]").forEach((b) => {
      b.onclick = () => {
        const id = b.getAttribute("data-patrol-done");
        const mark = b.getAttribute("data-mark") === "1";
        togglePatrolDone(id, mark, "worker", b);
      };
    });
  }

  /* 打卡紀錄：本月出勤明細 */
  function recordRow(c) {
    const x = c || {};
    const done = !!(x.inAt && x.outAt);
    const tag = done ? "已完成" : (x.inAt ? "上班中" : "未完成");
    return `
      <div class="wc-item">
        <div class="row1">
          <div class="loc">${esc(fmtDateKey(x.workDate))}</div>
          <span class="wc-tag ${done ? "done" : ""}">${tag}</span>
        </div>
        <div class="time">上班 ${esc(fmtTime(x.inAt))}　·　下班 ${esc(fmtTime(x.outAt))}</div>
      </div>`;
  }

  function renderRecord() {
    const list = (state.records || []).slice().sort((a, b) => String((b && b.workDate) || "").localeCompare(String((a && a.workDate) || "")));
    el.body.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div><h2>打卡紀錄</h2><p>${esc(todayKey().slice(0, 7))}　本月出勤明細</p></div>
        </div>
        ${list.length ? `<div class="wc-list">${list.map(recordRow).join("")}</div>` : `<div class="wc-empty">本月尚無打卡紀錄。</div>`}
      </section>
    `;
  }

  function renderTab() {
    if (!state.ready) { el.body.innerHTML = `<div class="wc-empty">載入中…</div>`; return; }
    el.body.scrollTop = 0;
    if (state.tab === "punch") renderPunch();
    else if (state.tab === "clean") renderClean();
    else if (state.tab === "patrol") renderPatrol();
    else if (state.tab === "record") renderRecord();
    else renderDutyTab(state.tab);
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

  async function togglePatrolDone(locId, markDone, source, btn, extra) {
    const loc = state.locations.find((x) => String(x.id) === String(locId));
    if (!loc) { toast("找不到巡邏點", true); return; }
    if (!state.communityId || !state.user) { toast("缺少社區或登入資訊", true); return; }
    const ex = extra || {};
    const exPoints = Array.isArray(ex.points) ? ex.points : [];
    const exPhoto = String(ex.photo || "");
    const dateKey = state.patrolDate || todayKey();
    const docId = `${dateKey}__${loc.id}`;
    const now = serverTs();
    if (btn) { btn.disabled = true; btn.textContent = markDone ? "打卡中…" : "處理中…"; }
    /* 目前無網路：先暫存在本機，待連線後自動上傳 */
    if (markDone && typeof navigator !== "undefined" && navigator.onLine === false) {
      queuePatrolCheckin(loc, source, { points: exPoints, photo: exPhoto });
      toast(`${loc.name || "巡邏點"} 已離線打卡，待連線後自動上傳`);
      renderTab();
      return;
    }
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
          points: exPoints,
          photo: exPhoto,
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
      if (markDone) {
        queuePatrolCheckin(loc, source, { points: exPoints, photo: exPhoto });
        toast("目前無網路，已暫存打卡，待連線後自動上傳");
        renderTab();
        return;
      }
      toast("更新失敗，請稍後再試", true);
      if (btn) { btn.disabled = false; btn.textContent = "取消完成"; }
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

  async function handlePatrolCode(text, source) {
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
    openPatrolConfirmModal(loc, source || "scan");
  }

  /* ---------- 掃碼／感應成功：清潔重點與拍照確認 ---------- */
  async function compressImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const MAX_SIDE = 480;
            const JPEG_Q = 0.62;
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
            w = Math.max(1, Math.round(w * scale));
            h = Math.max(1, Math.round(h * scale));
            const cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            const ctx = cv.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            resolve(cv.toDataURL("image/jpeg", JPEG_Q));
          } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error("image load failed"));
        img.src = String(reader.result || "");
      };
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  function openPatrolConfirmModal(loc, source) {
    const old = document.getElementById("wcPatrolConfirm");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    const points = pointsOf(loc);
    const single = pointModeOf(loc) === "single";
    const inputType = single ? "radio" : "checkbox";
    const pointsHtml = points.map((p) => `
      <label style="display:inline-flex;align-items:center;gap:6px;margin:0 8px 8px 0;padding:7px 12px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;font-size:13px;font-weight:800;color:#374151;cursor:pointer;">
        <input type="${inputType}" name="wcPcPoint" value="${esc(p)}" style="width:16px;height:16px;accent-color:var(--wc-red,#e11d48);" />
        <span>${esc(p)}</span>
      </label>`).join("");

    const wrap = document.createElement("div");
    wrap.id = "wcPatrolConfirm";
    wrap.style.cssText = "position:fixed;inset:0;z-index:99998;background:rgba(17,24,39,.55);display:flex;align-items:flex-end;justify-content:center;";
    wrap.innerHTML = `
      <div style="width:100%;max-width:520px;max-height:92dvh;overflow:auto;background:#fff;border-radius:20px 20px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -8px 30px rgba(0,0,0,.2);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <div style="font-size:17px;font-weight:900;color:#111827;">完成清潔</div>
            <div style="font-size:12px;font-weight:700;color:#6b7280;margin-top:2px;">${esc(loc.name || "巡邏點")}${loc.zone ? `　·　${esc(loc.zone)}` : ""}</div>
          </div>
          <button type="button" id="wcPcClose" style="border:0;background:#f3f4f6;color:#374151;border-radius:999px;width:32px;height:32px;font-size:16px;font-weight:900;cursor:pointer;">×</button>
        </div>

        <div style="margin-top:16px;font-size:13px;font-weight:900;color:#374151;">清潔重點 <span style="font-weight:700;color:#9ca3af;font-size:12px;">（${single ? "單選" : "可複選"}）</span></div>
        <div id="wcPcPoints" style="margin-top:10px;display:flex;flex-wrap:wrap;">${pointsHtml}</div>

        <div style="margin-top:16px;font-size:13px;font-weight:900;color:#374151;">清潔照片 <span style="font-weight:700;color:#9ca3af;font-size:12px;">（選填，最多一張）</span></div>
        <div style="margin-top:10px;">
          <input type="file" id="wcPcPhotoInput" accept="image/*" capture="environment" style="display:none;" />
          <button type="button" id="wcPcPhotoBtn" style="width:100%;border:1.5px dashed #d1d5db;background:#f9fafb;border-radius:14px;padding:12px;font-size:13px;font-weight:900;color:#374151;cursor:pointer;">＋ 拍照 / 選擇照片</button>
          <div id="wcPcPhotoBox" style="display:none;margin-top:10px;position:relative;">
            <img id="wcPcPhotoImg" alt="清潔照片" style="width:100%;max-height:240px;object-fit:cover;border-radius:14px;display:block;" />
            <button type="button" id="wcPcPhotoDel" style="position:absolute;top:8px;right:8px;border:0;background:rgba(17,24,39,.72);color:#fff;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;cursor:pointer;">移除</button>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-top:20px;">
          <button type="button" id="wcPcCancel" style="flex:1 1 0;border:1px solid #e5e7eb;background:#fff;color:#374151;border-radius:14px;padding:13px;font-size:14px;font-weight:900;cursor:pointer;">取消</button>
          <button type="button" id="wcPcConfirm" style="flex:2 1 0;border:0;background:var(--wc-red,#e11d48);color:#fff;border-radius:14px;padding:13px;font-size:14px;font-weight:900;cursor:pointer;">確認完成</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    let photoData = "";
    let busy = false;
    document.body.style.overflow = "hidden";

    function close() {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      document.body.style.overflow = "";
    }

    const closeBtn = document.getElementById("wcPcClose");
    if (closeBtn) closeBtn.onclick = close;
    const cancelBtn = document.getElementById("wcPcCancel");
    if (cancelBtn) cancelBtn.onclick = close;

    const photoInput = document.getElementById("wcPcPhotoInput");
    const photoBtn = document.getElementById("wcPcPhotoBtn");
    const photoBox = document.getElementById("wcPcPhotoBox");
    const photoImg = document.getElementById("wcPcPhotoImg");
    const photoDel = document.getElementById("wcPcPhotoDel");
    if (photoBtn && photoInput) photoBtn.onclick = () => photoInput.click();
    if (photoInput) {
      photoInput.onchange = async () => {
        const f = photoInput.files && photoInput.files[0];
        photoInput.value = "";
        if (!f) return;
        if (photoBtn) { photoBtn.disabled = true; photoBtn.textContent = "處理照片中…"; }
        try {
          photoData = await compressImageFile(f);
          if (photoImg) photoImg.src = photoData;
          if (photoBox) photoBox.style.display = "block";
          if (photoBtn) photoBtn.style.display = "none";
          if (photoDel) photoDel.onclick = () => {
            photoData = "";
            if (photoBox) photoBox.style.display = "none";
            if (photoImg) photoImg.removeAttribute("src");
            if (photoBtn) { photoBtn.disabled = false; photoBtn.style.display = "block"; photoBtn.textContent = "＋ 拍照 / 選擇照片"; }
          };
        } catch (e) {
          console.warn("photo compress failed", e);
          toast("照片處理失敗，請重拍", true);
        } finally {
          if (photoBtn && !photoData) { photoBtn.disabled = false; photoBtn.textContent = "＋ 拍照 / 選擇照片"; }
        }
      };
    }

    const confirmBtn = document.getElementById("wcPcConfirm");
    if (confirmBtn) {
      confirmBtn.onclick = async () => {
        if (busy) return;
        const sel = [];
        wrap.querySelectorAll("#wcPcPoints input:checked").forEach((i) => sel.push(String(i.value || "")));
        busy = true;
        confirmBtn.disabled = true;
        confirmBtn.textContent = "處理中…";
        close();
        await togglePatrolDone(loc.id, true, source || "scan", null, { points: sel, photo: photoData });
      };
    }
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

  /* ---------- NFC 感應（與 QR code 相同內容） ---------- */
  let nfcReader = null;

  function nfcSupported() { return typeof window.NDEFReader === "function"; }

  function readNdefText(message) {
    let out = "";
    const records = (message && message.records) || [];
    for (const r of records || []) {
      try {
        if (!r || !r.data) continue;
        const rt = String(r.recordType || "");
        if (rt === "text") out += new TextDecoder(r.encoding || "utf-8").decode(r.data);
        else if (rt === "url" || rt === "absolute-url") out += new TextDecoder().decode(r.data);
        else if (rt === "mime") out += new TextDecoder().decode(r.data);
      } catch (e) { console.warn("read ndef record failed", e); }
    }
    return out.trim();
  }

  function showNfcOverlay() {
    if (document.getElementById("wcNfcWrap")) return;
    const wrap = document.createElement("div");
    wrap.id = "wcNfcWrap";
    wrap.style.cssText = "position:fixed;inset:0;z-index:99997;background:rgba(17,24,39,.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#fff;padding:24px;text-align:center;";
    wrap.innerHTML = `
      <div style="font-size:54px;line-height:1;">&#128246;</div>
      <div style="font-size:16px;font-weight:900;">將手機靠近巡邏點 NFC 標籤</div>
      <div style="font-size:12px;color:#d1d5db;font-weight:700;">NFC 標籤內容須與 QR code 相同</div>
      <button type="button" id="wcNfcClose" style="margin-top:12px;border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;border-radius:999px;padding:9px 22px;font-size:13px;font-weight:900;cursor:pointer;">取消</button>
    `;
    document.body.appendChild(wrap);
    const c = document.getElementById("wcNfcClose");
    if (c) c.onclick = () => stopNfcScan();
  }

  function stopNfcScan() {
    if (nfcReader) {
      try { nfcReader.onreading = null; } catch {}
      try { nfcReader.onreadingerror = null; } catch {}
      nfcReader = null;
    }
    const w = document.getElementById("wcNfcWrap");
    if (w && w.parentNode) w.parentNode.removeChild(w);
  }

  async function startNfcScan() {
    if (!nfcSupported()) { toast("此裝置或瀏覽器不支援 NFC，請改用 QR code 掃描", true); return; }
    if (nfcReader) return;
    try {
      const reader = new window.NDEFReader();
      await reader.scan();
      nfcReader = reader;
      showNfcOverlay();
      reader.onreading = (ev) => {
        const text = readNdefText(ev && ev.message);
        stopNfcScan();
        if (!text) { toast("NFC 標籤沒有可用內容", true); return; }
        handlePatrolCode(text, "nfc");
      };
      reader.onreadingerror = () => { toast("NFC 感應失敗，請再靠近一次", true); };
    } catch (e) {
      console.warn("nfc scan failed", e);
      nfcReader = null;
      stopNfcScan();
      toast("無法開啟 NFC，請確認已允許權限", true);
    }
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
    fillProfileInfo();
  }

  /* 將原「設定」分頁內容填入個人資訊彈窗 */
  function fillProfileInfo() {
    const p = state.profile || {};
    const acc = document.getElementById("profileAccountText");
    if (acc) acc.textContent = String(p.username || (state.user && state.user.email) || "—");
    const phone = document.getElementById("profilePhoneText");
    if (phone) phone.textContent = String(p.phone || "—");
    const inEl = document.getElementById("profileInText");
    if (inEl) inEl.textContent = fmtTime(state.todayCheckin && state.todayCheckin.inAt);
    const outEl = document.getElementById("profileOutText");
    if (outEl) outEl.textContent = fmtTime(state.todayCheckin && state.todayCheckin.outAt);
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
    if (t !== "punch" && t !== "clean" && t !== "patrol" && t !== "schedule" && t !== "leave" && t !== "record") return;
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
      migrateLegacyCheckins().catch(() => {});
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("pagehide", () => { try { stopPatrolScan(); } catch {} stopDutyTabs(); stopSubscriptions(); });

  // PWA 由背景返回前景時，重新建立即時監聽，確保清潔通報等資料能即時同步
  function resumeSubscriptions() {
    if (!state.ready || !state.communityId) return;
    startSubscriptions();
    if (state.tab === "schedule" || state.tab === "leave") renderTab();
    flushPatrolQueue().catch(() => {});
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeSubscriptions();
  });
  window.addEventListener("pageshow", (e) => { if (e && e.persisted) resumeSubscriptions(); });
  /* 網路恢復時，立即同步離線暫存的巡邏打卡 */
  window.addEventListener("online", () => { flushPatrolQueue().catch(() => {}); });
})();
