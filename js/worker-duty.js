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

  const ROLE_META = {
    manager: { category: "總幹事", title: "總幹事" },
    secretary: { category: "秘書", title: "秘書" },
    electrical: { category: "機電", title: "機電" },
    preservation: { category: "保全", title: "保全" },
  };

  const DEFAULT_DUTY = {
    workStart: "08:00",
    workEnd: "17:00",
    shifts: ["早班", "晚班"],
    leaveTypes: ["特休", "事假", "病假", "公假", "婚假", "喪假", "產假", "其他"],
    holidayTypes: ["例假", "休假"],
    note: "",
    /* 出勤規則（可由社區 settings/duty 覆寫） */
    breakMinutes: 60,        // 工時扣除的休息分鐘數；0＝不扣（各社區自訂）
    graceMinutes: 10,        // 遲到／早退緩衝分鐘
    otAfterMinutes: 30,      // 超過班別結束幾分鐘才計加班
    punchWindow: { inBefore: 60, inAfter: 120, outBefore: 60, outAfter: 180 },
    guardPunchWindow: { inBefore: 30, inAfter: 60, outBefore: 60, outAfter: 120 },
    needHandover: ["保全"],  // 需上下班交接的職別
  };

  /* ---------- helpers ---------- */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateKeyOf(d) {
    const t = d instanceof Date ? d : new Date();
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  }
  function todayKey() { return dateKeyOf(new Date()); }
  function monthKeyOf(d) {
    const t = d instanceof Date ? d : new Date();
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`;
  }
  function monthRange(mk) {
    const m = String(mk || monthKeyOf(new Date()));
    return { start: `${m}-01`, end: `${m}-31` };
  }
  function daysInMonth(mk) {
    const parts = String(mk || "").split("-").map((x) => Number(x));
    const y = parts[0], m = parts[1];
    if (!y || !m) return [];
    const n = new Date(y, m, 0).getDate();
    const out = [];
    for (let d = 1; d <= n; d++) out.push(`${y}-${pad2(m)}-${pad2(d)}`);
    return out;
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
  function toDate(ts) {
    if (!ts) return null;
    if (ts.toDate) return ts.toDate();
    if (ts instanceof Date) return ts;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtTime(ts) {
    const d = toDate(ts);
    if (!d) return "--:--";
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
      const n = document.getElementById("wdClock");
      if (!n) { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } return; }
      n.textContent = fmtClock(new Date());
    };
    tick();
    if (!clockTimer) clockTimer = setInterval(tick, 1000);
  }
  function fmtDateTime(ts) {
    const d = toDate(ts);
    if (!d) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  /* 依班別時間判定打卡狀態：正常→ok（綠底）／遲到、早退→bad（紅底） */
  function hmToMin(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || "").trim());
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  function minOfDay(ts) {
    const d = toDate(ts);
    return d ? d.getHours() * 60 + d.getMinutes() : null;
  }
  function shiftWindow(duty, category, shiftName) {
    const rs = (duty && duty.roleShifts) || {};
    const list = Array.isArray(rs[category]) ? rs[category] : [];
    const def = list.find((x) => x && String(x.name || "") === String(shiftName || ""));
    const start = (def && def.start) || (duty && duty.workStart) || "";
    const end = (def && def.end) || (duty && duty.workEnd) || "";
    return { start: String(start || ""), end: String(end || "") };
  }
  /* ---------- 出勤規則判定 ---------- */
  const STATUS_LABEL = {
    "": "", onDuty: "上班中", normal: "正常", late: "遲到", early: "早退",
    lateEarly: "遲到+早退", noIn: "未打上班", noOut: "未打下班", absent: "曠職", noHandover: "未交接",
  };
  function nonNegNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  /* 該職別是否需上下班交接（保全） */
  function isHandoverRole(duty, category) {
    const d = duty || DEFAULT_DUTY;
    const list = Array.isArray(d.needHandover) ? d.needHandover : DEFAULT_DUTY.needHandover;
    return list.map((x) => String(x || "").trim()).indexOf(String(category || "").trim()) >= 0;
  }
  /* 該職別適用的打卡有效窗（保全較嚴格） */
  function punchWindowOf(duty, category) {
    const d = duty || DEFAULT_DUTY;
    const key = isHandoverRole(d, category) ? "guardPunchWindow" : "punchWindow";
    const w = Object.assign({}, DEFAULT_DUTY[key], d[key] || {});
    return {
      inBefore: nonNegNum(w.inBefore, 0), inAfter: nonNegNum(w.inAfter, 0),
      outBefore: nonNegNum(w.outBefore, 0), outAfter: nonNegNum(w.outAfter, 0),
    };
  }
  function dateKeyMs(key) {
    const p = String(key || "").split("-").map((x) => Number(x));
    if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return null;
    return new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime();
  }
  /* 班別是否跨日（結束時間早於或等於開始時間） */
  function isCrossDayShift(duty, category, shiftName) {
    const win = shiftWindow(duty, category, shiftName);
    const s = hmToMin(win.start);
    const e = hmToMin(win.end);
    return s != null && e != null && e <= s;
  }
  /* 判斷目前時間是否落在班別允許的打卡時間窗內
     type: "in" 上班（含接班）／"out" 下班（含交班）；baseDateKey 為該班別的起始日 */
  function punchWindowCheck(duty, category, shiftName, type, baseDateKey, when) {
    const d = duty || DEFAULT_DUTY;
    const win = shiftWindow(d, category, shiftName);
    const s = hmToMin(win.start);
    const e = hmToMin(win.end);
    if (s == null || e == null) return { ok: true, start: win.start, end: win.end };
    const base = dateKeyMs(baseDateKey || todayKey());
    if (base == null) return { ok: true, start: win.start, end: win.end };
    const startMs = base + s * 60000;
    const endMs = base + (e + (e <= s ? 1440 : 0)) * 60000;
    const w = punchWindowOf(d, category);
    const t = (when instanceof Date ? when : new Date()).getTime();
    const ok = type === "in"
      ? (t >= startMs - w.inBefore * 60000 && t <= startMs + w.inAfter * 60000)
      : (t >= endMs - w.outBefore * 60000 && t <= endMs + w.outAfter * 60000);
    return { ok, start: win.start, end: win.end };
  }
  /* 依班別時間與打卡紀錄判定單日出勤結果
     opts: { dateKey, hasShift, handovered, past } */
  function evalAttendance(duty, category, shiftName, checkin, opts) {
    const d = duty || DEFAULT_DUTY;
    const o = opts || {};
    const c = checkin || {};
    const win = shiftWindow(d, category, shiftName);
    const startMin = hmToMin(win.start);
    const endRaw = hmToMin(win.end);
    const crossDay = startMin != null && endRaw != null && endRaw <= startMin;
    const baseMs = dateKeyMs(o.dateKey || c.workDate || todayKey());
    const hasShift = !!o.hasShift;
    const inAt = c.inAt || null;
    const outAt = c.outAt || null;
    const inMs = inAt ? msOf(inAt) : 0;
    const outMs = outAt ? msOf(outAt) : 0;
    const startMs = (baseMs != null && startMin != null) ? baseMs + startMin * 60000 : null;
    const endMs = (baseMs != null && endRaw != null) ? baseMs + (endRaw + (crossDay ? 1440 : 0)) * 60000 : null;

    const grace = nonNegNum(d.graceMinutes, DEFAULT_DUTY.graceMinutes);
    const brk = nonNegNum(d.breakMinutes, DEFAULT_DUTY.breakMinutes);
    const otAfter = nonNegNum(d.otAfterMinutes, DEFAULT_DUTY.otAfterMinutes);

    const lateMin = (inMs && startMs) ? Math.max(0, Math.round((inMs - startMs) / 60000) - grace) : 0;
    const earlyMin = (outMs && endMs) ? Math.max(0, Math.round((endMs - outMs) / 60000) - grace) : 0;
    const otRaw = (outMs && endMs) ? Math.round((outMs - endMs) / 60000) : 0;
    const otMin = otRaw > otAfter ? otRaw : 0;
    const workMin = (inMs && outMs) ? Math.max(0, Math.round((outMs - inMs) / 60000) - brk) : 0;

    const flags = [];
    let status = "";
    if (hasShift) {
      if (!inAt && !outAt) {
        status = o.past ? "absent" : "";
        if (status) flags.push(STATUS_LABEL.absent);
      } else if (inAt && !outAt) {
        status = "onDuty";
        if (lateMin > 0) flags.push(`遲到 ${lateMin} 分`);
      } else if (!inAt && outAt) {
        status = "noIn";
        flags.push(STATUS_LABEL.noIn);
        if (earlyMin > 0) flags.push(`早退 ${earlyMin} 分`);
      } else {
        const late = lateMin > 0, early = earlyMin > 0;
        status = late && early ? "lateEarly" : (late ? "late" : (early ? "early" : "normal"));
        if (late) flags.push(`遲到 ${lateMin} 分`);
        if (early) flags.push(`早退 ${earlyMin} 分`);
        if (otMin > 0) flags.push(`加班 ${otMin} 分`);
      }
      const noHandover = isHandoverRole(d, category) && outAt && !o.handovered;
      if (noHandover) {
        flags.push(STATUS_LABEL.noHandover);
        if (!status || status === "normal") status = "noHandover";
      }
    }

    const inCls = hasShift && inAt ? (lateMin > 0 ? "bad" : "ok") : "";
    const outCls = hasShift && outAt ? ((earlyMin > 0 || (isHandoverRole(d, category) && !o.handovered)) ? "bad" : "ok") : "";

    return {
      win, hasShift, crossDay, startMin, endMin: endRaw,
      lateMin, earlyMin, otMin, workMin,
      status, statusLabel: STATUS_LABEL[status] || "", flags, inCls, outCls,
    };
  }
  function msOf(ts) {
    const d = toDate(ts);
    return d ? d.getTime() : 0;
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
  // ?c= 可能是社區代號(username)或社區文件 ID；統一解析為文件 ID，
  // 確保與住戶端/管理端寫入的 communities/{docId}/... 路徑一致，才能即時同步勤務資料。
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
  function initial(name, email) {
    const s = String(name || email || "工").trim();
    return s ? s.slice(0, 1).toUpperCase() : "工";
  }
  function toast(msg, isErr) {
    const el = document.getElementById("wcToast");
    if (!el) return;
    el.textContent = String(msg || "");
    el.classList.toggle("show", true);
    el.style.background = isErr ? "rgba(220,38,38,.95)" : "rgba(17,24,39,.94)";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.classList.remove("show"); }, 2200);
  }
  function mergedDuty(d) {
    const out = Object.assign({}, DEFAULT_DUTY);
    if (d) {
      if (d.workStart) out.workStart = String(d.workStart);
      if (d.workEnd) out.workEnd = String(d.workEnd);
      if (Array.isArray(d.shifts) && d.shifts.length) out.shifts = d.shifts.slice();
      if (d.roleShifts && typeof d.roleShifts === "object") out.roleShifts = d.roleShifts;
      if (Array.isArray(d.leaveTypes) && d.leaveTypes.length) out.leaveTypes = d.leaveTypes.slice();
      if (Array.isArray(d.holidayTypes) && d.holidayTypes.length) out.holidayTypes = d.holidayTypes.slice();
      if (typeof d.note === "string") out.note = d.note;
      ["breakMinutes", "graceMinutes", "otAfterMinutes"].forEach((k) => {
        const n = Number(d[k]);
        if (Number.isFinite(n) && n >= 0) out[k] = n;
      });
      ["punchWindow", "guardPunchWindow"].forEach((k) => {
        const w = d[k];
        if (w && typeof w === "object") out[k] = Object.assign({}, DEFAULT_DUTY[k], w);
      });
      if (Array.isArray(d.needHandover)) out.needHandover = d.needHandover.map((x) => String(x || "").trim()).filter(Boolean);
    }
    return out;
  }

  /* ---------- subscription registry ---------- */
  let activeUnsubs = [];
  function track(u) { if (typeof u === "function") activeUnsubs.push(u); return u; }
  function teardown() {
    activeUnsubs.forEach((u) => { try { u(); } catch {} });
    activeUnsubs = [];
  }

  /* ---------- firestore refs ---------- */
  function commRef(cid) { return db.collection("communities").doc(String(cid)); }
  function checkinsCol(cid) { return commRef(cid).collection("duty_checkins"); }
  function schedulesCol(cid) { return commRef(cid).collection("duty_schedules"); }
  function requestsCol(cid) { return commRef(cid).collection("duty_requests"); }
  function handoversCol(cid) { return commRef(cid).collection("duty_handovers"); }
  function dutySettingRef(cid) { return commRef(cid).collection("settings").doc("duty"); }

  function subscribeDutySettings(cid, cb) {
    if (!cid) { cb(null); return; }
    track(dutySettingRef(cid).onSnapshot((doc) => {
      cb(doc && doc.exists ? (doc.data() || {}) : null);
    }, (err) => { console.warn("duty settings listen failed", err); cb(null); }));
  }

  // 舊版勤務資料可能寫在「社區代號」路徑下，搬移到社區文件 ID 路徑，
  // 讓本人與管理端都能看到相同資料（僅搬移本人本月紀錄，失敗時靜默略過）。
  async function migrateLegacyDutyData(legacyKey, cid, uid) {
    const legacy = String(legacyKey || "").trim();
    const target = String(cid || "").trim();
    const me = String(uid || "").trim();
    if (!legacy || !target || !me || legacy === target) return;
    const flagKey = `csp_duty_migrated_${target}`;
    try { if (sessionStorage.getItem(flagKey)) return; } catch {}
    const r = monthRange(monthKeyOf(new Date()));
    let checkins = null, requests = null;
    try {
      checkins = await checkinsCol(legacy).where("workDate", ">=", r.start).where("workDate", "<=", r.end).get();
    } catch (e) { console.warn("legacy duty checkins read failed", e); }
    try {
      requests = await requestsCol(legacy).where("dateKey", ">=", r.start).where("dateKey", "<=", r.end).get();
    } catch (e) { console.warn("legacy duty requests read failed", e); }
    try { sessionStorage.setItem(flagKey, "1"); } catch {}
    const batch = db.batch();
    let n = 0;
    const put = (col, snap) => {
      if (!snap || !snap.size) return;
      snap.forEach((d) => {
        const x = d.data() || {};
        if (String(x.uid || "") !== me) return;
        batch.set(col.doc(String(d.id)), x, { merge: true });
        n += 1;
      });
    };
    put(checkinsCol(target), checkins);
    put(requestsCol(target), requests);
    if (!n) return;
    try { await batch.commit(); console.info(`migrated ${n} legacy duty records`); }
    catch (e) { console.warn("legacy duty migrate failed", e); }
  }

  /* ==================================================================== */
  /* tab factory                                                          */
  /* ==================================================================== */
  function makeTab(def) {
    return function (ctx) {
      const st = {};
      let rootEl = null;
      const rerender = () => { if (rootEl) def.render(rootEl, ctx, st); };
      return {
        html: `<div class="wc-empty">載入中…</div>`,
        bind(el) {
          rootEl = el;
          teardown();
          try { def.render(el, ctx, st); } catch (e) { console.warn("duty tab render failed", e); }
          try { def.subscribe(el, ctx, st, rerender); } catch (e) { console.warn("duty tab subscribe failed", e); }
        },
      };
    };
  }

  /* ==================================================================== */
  /* 打卡                                                                  */
  /* ==================================================================== */
  function monthStats(list, breakMinutes) {
    const brk = nonNegNum(breakMinutes, DEFAULT_DUTY.breakMinutes);
    let days = 0, ms = 0, otMinSum = 0;
    (list || []).forEach((c) => {
      if (!c) return;
      if (c.inAt) days += 1;
      if (c.inAt && c.outAt) {
        if (c.workMin != null) ms += nonNegNum(c.workMin, 0) * 60000;
        else ms += Math.max(0, msOf(c.outAt) - msOf(c.inAt) - brk * 60000);
      }
      otMinSum += nonNegNum(c.otMin, 0);
    });
    return { days, hours: (ms / 3600000).toFixed(1), otHours: (otMinSum / 60).toFixed(1) };
  }

  /* SVG 圖示 */
  const ICO = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>',
    calDay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/><text x="12" y="17" font-size="9" font-weight="900" text-anchor="middle" fill="currentColor" stroke="none">日</text></svg>',
    clockSmall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    checkSq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/></svg>',
    leave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    win: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    punchIn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5M15 12H3"/></svg>',
    punchOut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M14 17l5-5-5-5M19 12H9"/></svg>',
  };

  function renderPunchTab(root, ctx, st) {
    const act = st.active || { key: todayKey(), data: st.checkin || null, shift: String(st.todayShift || ""), rollover: false };
    const c = act.data || {};
    const inAt = c.inAt || null;
    const outAt = c.outAt || null;
    const onDuty = !!inAt && !outAt;
    const statusCls = onDuty ? "" : (outAt ? "out" : "idle");
    const bigChar = onDuty ? "上" : (outAt ? "下" : "休");
    const statusText = onDuty ? (act.rollover ? "上班中（跨班）" : "上班中") : (outAt ? "已下班" : "尚未打卡");
    const duty = st.duty || DEFAULT_DUTY;
    const guard = isHandoverRole(duty, ctx.category);
    const inLabel = guard ? "接班打卡" : "上班打卡";
    const outLabel = guard ? "交班打卡" : "下班打卡";
    const btnLabel = onDuty ? outLabel : (outAt ? "重新" + inLabel : inLabel);
    const btnIcon = onDuty ? ICO.punchOut : ICO.punchIn;
    const stats = monthStats(st.monthCheckins, duty.breakMinutes);
    const leave = st.todayLeave;
    const leaveTxt = leave
      ? `${leave.leaveType || "請假"}${leave.reason ? "（" + leave.reason + "）" : ""}`
      : "無";
    const shift = act.shift || "未排班";
    const ev = evalAttendance(duty, ctx.category, act.shift || "", c, {
      dateKey: act.key || todayKey(), hasShift: !!act.shift, handovered: !!st.todayHandover,
    });
    const winTxt = ev.win.start && ev.win.end ? `${ev.win.start} ~ ${ev.win.end}` : "—";
    const hd = st.lastHandover || null;
    const hdTxt = hd
      ? `${hd.fromName || "前班"}${hd.shift ? "（" + hd.shift + "）" : ""}`
      : "";
    const monthLabel = monthKeyOf(new Date());

    root.innerHTML = `
      <section class="wc-hero">
        <div class="wc-hero-top">
          <div class="wc-hero-title">
            <div class="t">今日出勤</div>
            <div class="s">今日班表：${esc(shift)}</div>
          </div>
          <div class="wc-hero-clock-badge">${ICO.clock}<span id="wdClock">--:--:--</span></div>
        </div>
        <div class="wc-hero-status">
          <div class="wc-hero-bigcircle ${statusCls}">
            <span class="ch">${bigChar}</span>
            <span class="check">${ICO.check}</span>
          </div>
          <div class="wc-hero-status-text ${statusCls}">
            <span class="k">目前狀態</span>
            <span class="v">${statusText}</span>
            <span class="u"></span>
          </div>
        </div>
        <div class="wc-hero-punch">
          <div class="box in"><span class="ico">${ICO.sun}</span><span class="t"><span class="k">${esc(inLabel)}</span><span class="v">${fmtTime(inAt)}</span></span></div>
          <div class="box"><span class="ico">${ICO.moon}</span><span class="t"><span class="k">${esc(outLabel)}</span><span class="v">${fmtTime(outAt)}</span></span></div>
        </div>
        ${ev.flags.length ? `<div class="wc-hero-flags">${ev.flags.map((f) => `<span class="wc-flag${f.indexOf("加班") === 0 ? " ot" : ""}">${esc(f)}</span>`).join("")}</div>` : ""}
        ${guard ? `<div class="wc-hero-hd">
          <span class="k">交接</span>
          <span class="v">${esc(hdTxt || "尚無交班紀錄")}</span>
          ${hd ? `<button type="button" class="wc-mini" data-wd-hdview="1">查看</button>` : ""}
        </div>` : ""}
        <button class="wc-punch ${onDuty ? "out" : ""}" type="button" data-wd-punch="${onDuty ? "out" : "in"}">${btnIcon}<span>${btnLabel}</span></button>
      </section>

      <section class="wc-card wc-stat">
        <div class="wc-stat-hd">
          <div class="t">${ICO.chart}本月出勤統計</div>
          <div class="m">${ICO.cal}<span>${esc(monthLabel)}</span>▾</div>
        </div>
        <div class="wc-stat-bd">
          <div class="wc-info">
            <div class="r"><span class="ico">${ICO.calDay}</span><span class="k">上班天數</span><span class="v red">${stats.days} 天</span></div>
            <div class="r"><span class="ico">${ICO.clockSmall}</span><span class="k">總時數</span><span class="v">${stats.hours} 小時</span></div>
            <div class="r"><span class="ico">${ICO.checkSq}</span><span class="k">今日班別</span><span class="v">${esc(shift)}</span></div>
          </div>
        </div>
      </section>
    `;

    const btn = root.querySelector("[data-wd-punch]");
    if (btn) btn.onclick = () => {
      const t = btn.getAttribute("data-wd-punch");
      if (t === "out" && guard) { openHandoverModal(ctx, st, () => doPunch(ctx, "out", btn)); return; }
      doPunch(ctx, t, btn);
    };
    const hb = root.querySelector("[data-wd-hdview]");
    if (hb) hb.onclick = () => openHandoverView(hd);
    startClock();
  }

  /* 決定目前要操作／顯示的打卡紀錄：今日未結案優先；否則若前一日為跨日班且未下班，沿用前一日 */
  function syncActive(ctx, st) {
    const duty = st.duty || DEFAULT_DUTY;
    const tk = todayKey();
    const prevKey = shiftDateKey(tk, -1);
    const t = st.checkin || null;
    if (t && t.inAt && !t.outAt) {
      st.active = { key: tk, data: t, shift: String(st.todayShift || ""), rollover: false };
      return;
    }
    const p = st.prevCheckin || null;
    const pShift = String(st.prevShift || "");
    if (p && p.inAt && !p.outAt && pShift && isCrossDayShift(duty, ctx.category, pShift)) {
      st.active = { key: prevKey, data: p, shift: pShift, rollover: true };
      return;
    }
    st.active = { key: tk, data: t, shift: String(st.todayShift || ""), rollover: false };
  }

  function subscribePunchTab(root, ctx, st, rerender) {
    ctx.__punchUi = { st, rerender };
    const rerenderAll = () => { try { syncActive(ctx, st); } catch (e) { console.warn("sync active failed", e); } rerender(); };
    ctx.__punchUi.rerender = rerenderAll;
    subscribeDutySettings(ctx.communityId, (d) => { st.duty = mergedDuty(d); rerenderAll(); });
    if (!ctx.communityId) return;
    const tk = todayKey();
    const prevKey = shiftDateKey(tk, -1);

    track(checkinsCol(ctx.communityId).doc(`${ctx.uid}_${tk}`).onSnapshot((doc) => {
      st.checkin = doc && doc.exists ? (doc.data() || {}) : null;
      rerenderAll();
    }, (err) => { console.warn("duty checkin listen failed", err); st.checkin = null; rerenderAll(); }));

    /* 前一日紀錄：供跨日班（保全夜班）下班打卡沿用 */
    track(checkinsCol(ctx.communityId).doc(`${ctx.uid}_${prevKey}`).onSnapshot((doc) => {
      st.prevCheckin = doc && doc.exists ? (doc.data() || {}) : null;
      rerenderAll();
    }, (err) => { console.warn("duty prev checkin listen failed", err); st.prevCheckin = null; rerenderAll(); }));

    track(schedulesCol(ctx.communityId).doc(tk).onSnapshot((doc) => {
      const d = doc && doc.exists ? (doc.data() || {}) : {};
      const shifts = d.shifts || {};
      st.todayShift = String(shifts[ctx.uid] || "");
      rerenderAll();
    }, (err) => { console.warn("duty schedule listen failed", err); st.todayShift = ""; rerenderAll(); }));

    track(schedulesCol(ctx.communityId).doc(prevKey).onSnapshot((doc) => {
      const d = doc && doc.exists ? (doc.data() || {}) : {};
      const shifts = d.shifts || {};
      st.prevShift = String(shifts[ctx.uid] || "");
      rerenderAll();
    }, (err) => { console.warn("duty prev schedule listen failed", err); st.prevShift = ""; rerenderAll(); }));

    const r = monthRange(monthKeyOf(new Date()));
    track(checkinsCol(ctx.communityId).where("workDate", ">=", r.start).where("workDate", "<=", r.end).onSnapshot((snap) => {
      const list = [];
      snap.forEach((d) => {
        const x = d.data() || {};
        if (String(x.uid) === String(ctx.uid)) list.push(x);
      });
      st.monthCheckins = list;
      rerender();
    }, (err) => { console.warn("duty month checkins listen failed", err); st.monthCheckins = []; rerender(); }));

    track(requestsCol(ctx.communityId).where("dateKey", "==", tk).onSnapshot((snap) => {
      let found = null;
      snap.forEach((d) => {
        const x = d.data() || {};
        if (String(x.uid) === String(ctx.uid) && String(x.type) === "leave") found = x;
      });
      st.todayLeave = found;
      rerender();
    }, (err) => { console.warn("duty today leave listen failed", err); st.todayLeave = null; rerender(); }));

    /* 交接紀錄：本人的交班單（今日／跨班前一日）與前班留下的交接單（保全） */
    track(handoversCol(ctx.communityId).where("workDate", "in", [tk, prevKey]).onSnapshot((snap) => {
      let mine = null, last = null;
      snap.forEach((d) => {
        const x = d.data() || {};
        if (String(x.fromUid) === String(ctx.uid)) mine = x;
        else if (!last || String(x.at || "") > String(last.at || "")) last = x;
      });
      st.todayHandover = mine;
      st.lastHandover = last;
      rerender();
    }, (err) => { console.warn("duty handover listen failed", err); st.todayHandover = null; st.lastHandover = null; rerender(); }));
  }

  /* ==================================================================== */
  /* 打卡紀錄                                                              */
  /* ==================================================================== */
  function recordRow(c) {
    const x = c || {};
    const done = !!(x.inAt && x.outAt);
    const tag = done ? "已完成" : (x.inAt ? "上班中" : "未完成");
    const flags = [];
    if (nonNegNum(x.lateMin, 0) > 0) flags.push(`遲到 ${x.lateMin} 分`);
    if (nonNegNum(x.earlyMin, 0) > 0) flags.push(`早退 ${x.earlyMin} 分`);
    if (String(x.status || "") === "noHandover") flags.push("未交接");
    if (String(x.status || "") === "noIn") flags.push("未打上班");
    if (String(x.status || "") === "absent") flags.push("曠職");
    const extras = [];
    if (nonNegNum(x.otMin, 0) > 0) extras.push(`加班 ${x.otMin} 分`);
    if (done && x.workMin != null) extras.push(`工時 ${(nonNegNum(x.workMin, 0) / 60).toFixed(1)} 小時`);
    return `
      <div class="wc-item">
        <div class="row1">
          <div class="loc">${esc(fmtDateKey(x.workDate))}</div>
          <span class="wc-tag ${done && !flags.length ? "done" : ""}">${tag}</span>
        </div>
        <div class="time">上班 ${esc(fmtTime(x.inAt))}　·　下班 ${esc(fmtTime(x.outAt))}</div>
        ${(flags.length || extras.length) ? `<div class="wc-hero-flags">${flags.concat(extras).map((f) => `<span class="wc-flag${f.indexOf("加班") === 0 ? " ot" : ""}">${esc(f)}</span>`).join("")}</div>` : ""}
      </div>`;
  }

  /* 目前檢視日期（預設當日） */
  function recDateKey(st) {
    const v = String((st && st.recDate) || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayKey();
  }

  function shiftDateKey(key, delta) {
    const p = String(key || "").split("-").map((x) => Number(x));
    const d = new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
    d.setDate(d.getDate() + Number(delta || 0));
    return dateKeyOf(d);
  }

  function renderRecordTab(root, ctx, st) {
    st.recSub = st.recSub === "schedule" ? "schedule" : "checkin";
    root.innerHTML = `
      <div class="wc-subtabs" role="tablist" aria-label="紀錄子分頁">
        <button class="wc-subtab" type="button" role="tab" data-wd-recsub="checkin"${st.recSub === "checkin" ? ' aria-current="page"' : ""}>打卡</button>
        <button class="wc-subtab" type="button" role="tab" data-wd-recsub="schedule"${st.recSub === "schedule" ? ' aria-current="page"' : ""}>班表</button>
      </div>
      <div id="wdRecPane"></div>
    `;
    root.querySelectorAll("[data-wd-recsub]").forEach((b) => {
      b.onclick = () => {
        const k = b.getAttribute("data-wd-recsub");
        if (k === st.recSub) return;
        st.recSub = k;
        renderRecordTab(root, ctx, st);
      };
    });
    const pane = root.querySelector("#wdRecPane");
    if (!pane) return;
    if (st.recSub === "schedule") {
      st.schedView = st.schedView === "cal" ? "cal" : "list";
      pane.innerHTML = scheduleCardHtml(st);
      bindScheduleCard(pane, st, ctx, {
        onMonth: (mk) => {
          st.schedMonth = mk;
          watchScheduleMonth(ctx.communityId, ctx.uid, st, st.rerenderAll);
          if (typeof st.rerenderAll === "function") st.rerenderAll();
        },
        onView: (v) => {
          st.schedView = v;
          if (typeof st.rerenderAll === "function") st.rerenderAll();
        },
      });
      return;
    }
    renderCheckinPane(pane, ctx, st);
  }

  function renderCheckinPane(root, ctx, st) {
    const key = recDateKey(st);
    const today = todayKey();
    const day = st.recordDay || null;
    const has = !!(day && (day.inAt || day.outAt));
    root.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div><h2>打卡紀錄</h2></div>
        </div>
        <div class="wc-field">
          <label>日期</label>
          <div class="wc-datebar">
            <button type="button" class="wc-date-arrow" id="wdRecPrev" aria-label="前一日">‹</button>
            <button type="button" class="wc-date-view" id="wdRecDateBtn" aria-label="選擇日期">${esc(key)}</button>
            <button type="button" class="wc-date-arrow" id="wdRecNext" aria-label="後一日"${key >= today ? " hidden" : ""}>›</button>
          </div>
        </div>
        ${has ? `<div class="wc-list">${recordRow(day)}</div>` : `<div class="wc-empty">此日期尚無打卡紀錄。</div>`}
      </section>
    `;
    const go = (k) => { st.recDate = k; if (typeof st.reloadRecord === "function") st.reloadRecord(); };
    const prev = root.querySelector("#wdRecPrev");
    if (prev) prev.onclick = () => go(shiftDateKey(key, -1));
    const next = root.querySelector("#wdRecNext");
    if (next) next.onclick = () => { const k = shiftDateKey(key, 1); go(k > today ? today : k); };
    const view = root.querySelector("#wdRecDateBtn");
    if (view) view.onclick = () => openRecordDatePicker(ctx, st, go);
  }

  /* 打卡紀錄日期選擇：只列出有打卡紀錄的日期，且不顯示今日之後 */
  function openRecordDatePicker(ctx, st, onPick) {
    const today = todayKey();
    const selected = recDateKey(st);
    const marks = st.calMarks || (st.calMarks = {});
    let month = selected.slice(0, 7);

    const wrap = document.createElement("div");
    wrap.className = "wc-datewrap";
    wrap.innerHTML = `<div class="wc-datecard"><div class="wc-dateloading">載入中…</div></div>`;
    document.body.appendChild(wrap);
    const close = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    const card = wrap.querySelector(".wc-datecard");

    const marksOf = (mk) => (marks[mk] instanceof Set
      ? Promise.resolve(marks[mk])
      : loadRecordMarks(ctx, mk).then((set) => { marks[mk] = set; return set; }));

    const paint = (set) => {
      const p = month.split("-").map((x) => Number(x));
      const y = p[0], m = p[1];
      const startDow = new Date(y, m - 1, 1).getDay();
      const daysIn = new Date(y, m, 0).getDate();
      let cells = "";
      for (let i = 0; i < startDow; i++) cells += "<div></div>";
      for (let d = 1; d <= daysIn; d++) {
        const dayKey = `${y}-${pad2(m)}-${pad2(d)}`;
        if (dayKey > today) { cells += "<div></div>"; continue; }
        const hasRec = set.has(dayKey);
        const isSel = dayKey === selected;
        const isTod = dayKey === today;
        const bg = isSel ? "#d32f2f" : (hasRec ? "#fee2e2" : "#f3f4f6");
        const fg = isSel ? "#fff" : (hasRec ? "#b91c1c" : "#cbd5e1");
        const ring = isTod && !isSel ? "box-shadow:inset 0 0 0 2px rgba(211,47,47,.5);" : "";
        const dot = hasRec && !isSel ? `<span style="display:block;width:5px;height:5px;border-radius:50%;background:#d32f2f;margin:2px auto 0;"></span>` : "";
        cells += `<button type="button" data-day="${dayKey}"${hasRec ? "" : " disabled"} style="height:40px;border:0;background:${bg};color:${fg};border-radius:10px;font-size:15px;font-weight:${hasRec || isSel ? 900 : 700};cursor:${hasRec ? "pointer" : "not-allowed"};${ring}">${d}${dot}</button>`;
      }
      const canNext = month < today.slice(0, 7);
      card.innerHTML = `
        <div class="wc-datehead">
          <button type="button" class="wc-date-arrow" data-nv="-1" aria-label="上個月">‹</button>
          <div class="wc-dateym">${y} 年 ${m} 月</div>
          <button type="button" class="wc-date-arrow" data-nv="1" aria-label="下個月"${canNext ? "" : " disabled"}>›</button>
        </div>
        <div class="wc-dateweek">${["日", "一", "二", "三", "四", "五", "六"].map((w) => `<div>${w}</div>`).join("")}</div>
        <div class="wc-dategrid">${cells}</div>
        <div class="wc-datefoot">
          <span>● 僅有打卡紀錄的日期可點選</span>
          <div>
            <button type="button" class="wc-date-today" data-today="1">今天</button>
            <button type="button" class="wc-date-close" data-close="1">關閉</button>
          </div>
        </div>
      `;
      card.querySelectorAll("[data-nv]").forEach((b) => {
        b.onclick = () => {
          if (b.disabled) return;
          const p2 = month.split("-").map((x) => Number(x));
          const nd = new Date(p2[0], p2[1] - 1 + (Number(b.getAttribute("data-nv")) || 0), 1);
          const nm = `${nd.getFullYear()}-${pad2(nd.getMonth() + 1)}`;
          if (nm > today.slice(0, 7)) return;
          month = nm;
          marksOf(nm).then((s) => { if (wrap.parentNode) paint(s); });
        };
      });
      card.querySelectorAll("[data-day]").forEach((b) => {
        b.onclick = () => { if (b.disabled) return; close(); onPick(b.getAttribute("data-day")); };
      });
      const tb = card.querySelector("[data-today]");
      if (tb) tb.onclick = () => { close(); onPick(today); };
      const cb = card.querySelector("[data-close]");
      if (cb) cb.onclick = close;
    };

    marksOf(month).then((set) => { if (wrap.parentNode) paint(set); });
  }

  function loadRecordMarks(ctx, mk) {
    const r = monthRange(mk);
    if (!ctx.communityId || !ctx.uid) return Promise.resolve(new Set());
    return checkinsCol(ctx.communityId).where("workDate", ">=", r.start).where("workDate", "<=", r.end).get()
      .then((snap) => {
        const set = new Set();
        snap.forEach((d) => {
          const x = d.data() || {};
          if (String(x.uid) === String(ctx.uid)) set.add(String(x.workDate || ""));
        });
        return set;
      })
      .catch((err) => { console.warn("duty record marks failed", err); return new Set(); });
  }

  function watchRecordDay(ctx, st, rerender) {
    if (st.recUnsub) { try { st.recUnsub(); } catch {} st.recUnsub = null; }
    st.recordDay = null;
    rerender();
    if (!ctx.communityId || !ctx.uid) return;
    const key = recDateKey(st);
    st.recUnsub = track(checkinsCol(ctx.communityId).doc(`${ctx.uid}_${key}`).onSnapshot((doc) => {
      st.recordDay = doc && doc.exists ? (doc.data() || {}) : null;
      rerender();
    }, (err) => { console.warn("duty record day listen failed", err); st.recordDay = null; rerender(); }));
  }

  function subscribeRecordTab(root, ctx, st, rerender) {
    st.recDate = recDateKey(st);
    st.rerenderAll = rerender;
    st.reloadRecord = () => watchRecordDay(ctx, st, rerender);
    watchRecordDay(ctx, st, rerender);
    subscribeSchedule(ctx.communityId, ctx.uid, st, rerender);
  }

  /* 依目前畫面狀態算出本次打卡的出勤欄位（班別、遲到／早退／加班、工時、狀態） */
  function punchOutcome(ctx, type) {
    const ui = ctx && ctx.__punchUi;
    const st = (ui && ui.st) || {};
    const act = st.active || null;
    const duty = st.duty || DEFAULT_DUTY;
    const shift = String((act && act.shift) || "");
    const dateKey = (act && act.key) || todayKey();
    const next = Object.assign({}, (act && act.data) || st.checkin || {});
    if (type === "in") { next.inAt = new Date(); next.outAt = null; }
    else { next.outAt = new Date(); }
    const ev = evalAttendance(duty, ctx.category, shift, next, {
      dateKey, hasShift: !!shift, handovered: !!(st.todayHandover || st.__handoverDone),
    });
    return {
      shift,
      shiftStart: ev.win.start,
      shiftEnd: ev.win.end,
      status: ev.status,
      lateMin: ev.lateMin,
      earlyMin: ev.earlyMin,
      otMin: ev.otMin,
      workMin: ev.workMin,
    };
  }

  async function savePunch(ctx, type, photo, meta) {
    const ui = ctx && ctx.__punchUi;
    const act = (ui && ui.st && ui.st.active) || null;
    const tk = (act && act.key) || todayKey();
    const ref = checkinsCol(ctx.communityId).doc(`${ctx.uid}_${tk}`);
    const now = serverTs();
    const geo = {
      latitude: meta && meta.latitude != null ? meta.latitude : null,
      longitude: meta && meta.longitude != null ? meta.longitude : null,
      distance: meta && meta.distance != null ? meta.distance : null,
      accuracy: meta && meta.accuracy != null ? meta.accuracy : null,
    };
    const payload = {
      uid: ctx.uid, name: ctx.userName || "", category: ctx.category || "",
      workDate: tk, communityId: ctx.communityId, updatedAt: now,
    };
    if (type === "in") {
      Object.assign(payload, { inAt: now, outAt: null, inPhoto: photo || "", inGeo: geo });
    } else {
      Object.assign(payload, { outAt: now, outPhoto: photo || "", outGeo: geo });
    }
    Object.assign(payload, punchOutcome(ctx, type));
    await ref.set(payload, { merge: true });
  }

  function optimisticPunchRecord(base, ctx, type, photo, meta, workDate) {
    const now = new Date();
    const geo = {
      latitude: meta && meta.latitude != null ? meta.latitude : null,
      longitude: meta && meta.longitude != null ? meta.longitude : null,
      distance: meta && meta.distance != null ? meta.distance : null,
      accuracy: meta && meta.accuracy != null ? meta.accuracy : null,
    };
    const next = Object.assign({}, base || {}, {
      uid: ctx.uid,
      name: ctx.userName || "",
      category: ctx.category || "",
      workDate: workDate || todayKey(),
      communityId: ctx.communityId,
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

  function applyOptimisticPunch(ctx, type, photo, meta) {
    const ui = ctx && ctx.__punchUi;
    if (!ui || !ui.st || typeof ui.rerender !== "function") return;
    const st = ui.st;
    const act = st.active || null;
    const key = (act && act.key) || todayKey();
    const next = optimisticPunchRecord((act && act.data) || st.checkin, ctx, type, photo, meta, key);
    if (key === todayKey()) st.checkin = next; else st.prevCheckin = next;
    const monthList = Array.isArray(st.monthCheckins) ? st.monthCheckins.slice() : [];
    const idx = monthList.findIndex((x) => x && String(x.workDate || "") === String(next.workDate || ""));
    if (idx >= 0) monthList[idx] = Object.assign({}, monthList[idx], next);
    else monthList.push(next);
    st.monthCheckins = monthList;
    ui.rerender();
  }

  function doPunch(ctx, type, btn) {
    if (!ctx || !ctx.communityId) { toast("缺少社區資訊", true); return; }
    if (!ctx.uid) { toast("尚未登入", true); return; }
    if (!window.NwPunchFlow) { toast("打卡模組載入失敗，請重新整理", true); return; }
    const isIn = type === "in";
    let lastPhoto = "";
    let lastMeta = null;
    /* 打卡時間窗檢查（依社區 settings/duty 設定；超出窗仍可打卡，但需確認） */
    const ui = ctx.__punchUi;
    const act = ui && ui.st && ui.st.active;
    if (act && act.shift) {
      const chk = punchWindowCheck(ui.st.duty || DEFAULT_DUTY, ctx.category, act.shift, type, act.key, new Date());
      if (!chk.ok) {
        const label = isIn ? "上班" : "下班";
        const msg = `目前不在允許的${label}打卡時間窗內（班別 ${chk.start}~${chk.end}）。\n仍要進行${label}打卡嗎？`;
        if (!window.confirm(msg)) return;
      }
    }
    if (btn) btn.disabled = true;
    window.NwPunchFlow.open({
      db,
      communityId: ctx.communityId,
      title: isIn ? "上班打卡" : "下班打卡",
      onConfirm: (photo, meta) => {
        lastPhoto = photo || "";
        lastMeta = meta || null;
        return savePunch(ctx, type, photo, meta);
      },
    }).then((r) => {
      if (btn) { try { btn.disabled = false; } catch {} }
      if (r && r.ok) {
        applyOptimisticPunch(ctx, type, lastPhoto, lastMeta);
        toast((isIn ? "上班" : "下班") + "打卡成功 " + fmtTime(new Date()));
      }
    }).catch((e) => {
      console.error(e);
      if (btn) { try { btn.disabled = false; } catch {} }
      toast("打卡失敗，請稍後再試", true);
    });
  }

  /* ==================================================================== */
  /* 班表                                                                  */
  /* ==================================================================== */
  /* 依班別名稱判斷標籤色系（一般班別／請假／例假） */
  function scheduleTag(duty, s) {
    const d = duty || DEFAULT_DUTY;
    const leaveTypes = Array.isArray(d.leaveTypes) && d.leaveTypes.length ? d.leaveTypes : DEFAULT_DUTY.leaveTypes;
    const holidayTypes = Array.isArray(d.holidayTypes) && d.holidayTypes.length ? d.holidayTypes : DEFAULT_DUTY.holidayTypes;
    const v = String(s || "");
    if (!v) return { kind: "", cls: "", style: "" };
    if (leaveTypes.map((x) => String(x)).includes(v) || v === "休假") {
      return { kind: "leave", cls: "", style: ' style="background:rgba(37,99,235,.10);color:#1d4ed8;"' };
    }
    if (holidayTypes.map((x) => String(x)).includes(v)) {
      return { kind: "holiday", cls: "", style: ' style="background:rgba(14,116,144,.12);color:#0e7490;"' };
    }
    return { kind: "shift", cls: "done", style: "" };
  }

  /* 目前檢視月份（預設當月） */
  function schedMonthOf(st) {
    const v = String((st && st.schedMonth) || "").trim();
    return /^\d{4}-\d{2}$/.test(v) ? v : monthKeyOf(new Date());
  }

  function shiftMonthKey(mk, delta) {
    const p = String(mk || "").split("-").map((x) => Number(x));
    const d = new Date(p[0], (p[1] || 1) - 1 + Number(delta || 0), 1);
    return monthKeyOf(isNaN(d.getTime()) ? new Date() : d);
  }

  /* 班表列表：同一列依序顯示 日期／排班狀況／打卡狀況（上班、下班）／申請按鈕 */
  function scheduleListHtml(mk, sched, duty, checkins) {
    const tk = todayKey();
    const rows = daysInMonth(mk).map((k) => {
      const s = (sched && sched[k]) || "";
      const tag = scheduleTag(duty, s);
      const isShift = tag.kind === "shift";
      const ck = (checkins && checkins[k]) || null;
      const hasIn = Boolean(isShift && ck && ck.inAt);
      const hasOut = Boolean(isShift && ck && ck.outAt);
      const needIn = isShift && k <= tk && !hasIn;
      const needOut = isShift && k <= tk && !hasOut;
      const rowStyle = k === tk ? ' style="border-color:var(--wc-red);"' : "";
      const punch = isShift
        ? `<div class="punch">
             <span class="pu${hasIn ? "" : " miss"}">上班 ${esc(hasIn ? fmtTime(ck.inAt) : "--:--")}</span>
             <span class="pu${hasOut ? "" : " miss"}">下班 ${esc(hasOut ? fmtTime(ck.outAt) : "--:--")}</span>
           </div>`
        : `<div class="punch"></div>`;
      return `
        <div class="wc-item sched-row"${rowStyle}>
          <div class="loc">${esc(fmtDateKey(k))}</div>
          <span class="wc-tag ${tag.cls}"${tag.style}>${esc(s || "未排班")}</span>
          ${punch}
          <button type="button" class="wc-apply" data-sched-apply="${esc(k)}" data-sched-shift="${esc(s)}"${needIn ? ' data-apply-in="1"' : ""}${needOut ? ' data-apply-out="1"' : ""}${isShift ? "" : " disabled"}>申請</button>
        </div>`;
    }).join("");
    return `<div class="wc-list">${rows}</div>`;
  }

  function scheduleCalendarHtml(mk, sched, duty) {
    const p = String(mk).split("-").map((x) => Number(x));
    const y = p[0], m = p[1];
    const startDow = new Date(y, m - 1, 1).getDay();
    const n = new Date(y, m, 0).getDate();
    const tk = todayKey();
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += `<div class="wc-cal-cell empty"></div>`;
    for (let d = 1; d <= n; d++) {
      const k = `${y}-${pad2(m)}-${pad2(d)}`;
      const s = (sched && sched[k]) || "";
      const tag = scheduleTag(duty, s);
      const cls = ["wc-cal-cell", tag.kind, k === tk ? "today" : ""].filter(Boolean).join(" ");
      cells += `<div class="${cls}"><span class="d">${d}</span><span class="s">${esc(s || "—")}</span></div>`;
    }
    return `
      <div class="wc-cal-week">${["日", "一", "二", "三", "四", "五", "六"].map((w) => `<div>${w}</div>`).join("")}</div>
      <div class="wc-cal-grid">${cells}</div>`;
  }

  function scheduleCardHtml(st) {
    const cur = monthKeyOf(new Date());
    const mk = schedMonthOf(st);
    const view = (st && st.schedView) === "cal" ? "cal" : "list";
    const sched = (st && st.schedule) || {};
    const duty = (st && st.duty) || DEFAULT_DUTY;
    const body = view === "cal"
      ? scheduleCalendarHtml(mk, sched, duty)
      : scheduleListHtml(mk, sched, duty, (st && st.schedCheckins) || {});
    return `
      <section class="wc-card">
        <div class="hd"><div><h2>班表</h2></div></div>
        <div class="wc-datebar">
          <button type="button" class="wc-date-arrow" data-sched-nav="-1" aria-label="前一月">‹</button>
          <button type="button" class="wc-date-view" data-sched-month aria-label="選擇月份">${esc(mk)}</button>
          <button type="button" class="wc-date-arrow" data-sched-nav="1" aria-label="後一月"${mk >= cur ? " hidden" : ""}>›</button>
        </div>
        <div class="wc-mode-toggle" role="tablist" aria-label="檢視模式">
          <button type="button" class="wc-mode-btn" data-sched-view="list"${view === "list" ? ' aria-current="page"' : ""}>列表模式</button>
          <button type="button" class="wc-mode-btn" data-sched-view="cal"${view === "cal" ? ' aria-current="page"' : ""}>月曆模式</button>
        </div>
        ${body}
      </section>
    `;
  }

  /* 綁定班表卡片互動：前後月、月份選擇、列表／月曆切換 */
  function bindScheduleCard(root, st, ctx, hooks) {
    const cur = monthKeyOf(new Date());
    const mk = schedMonthOf(st);
    const modes = hooks || {};
    root.querySelectorAll("[data-sched-nav]").forEach((b) => {
      b.onclick = () => {
        const next = shiftMonthKey(mk, Number(b.getAttribute("data-sched-nav")) || 0);
        if (next > cur) return;
        if (typeof modes.onMonth === "function") modes.onMonth(next);
      };
    });
    const mb = root.querySelector("[data-sched-month]");
    if (mb) mb.onclick = () => openScheduleMonthPicker(ctx, st, mk, modes.onMonth);
    root.querySelectorAll("[data-sched-view]").forEach((b) => {
      b.onclick = () => {
        const v = b.getAttribute("data-sched-view") === "cal" ? "cal" : "list";
        if (v === ((st && st.schedView) === "cal" ? "cal" : "list")) return;
        if (typeof modes.onView === "function") modes.onView(v);
      };
    });
    root.querySelectorAll("[data-sched-apply]").forEach((b) => {
      if (b.disabled) { b.onclick = null; return; }
      b.onclick = () => openApplyModal(ctx, {
        dateKey: b.getAttribute("data-sched-apply"),
        duty: (st && st.duty) || DEFAULT_DUTY,
        sched: (st && st.schedule) || {},
        makeupIn: b.getAttribute("data-apply-in") === "1",
        makeupOut: b.getAttribute("data-apply-out") === "1",
      });
    });
  }

  /* ==================================================================== */
  /* 交接（保全早晚班）                                                     */
  /* ==================================================================== */
  function handoverFieldRow(k, v) {
    return `<div class="r"><span class="k">${esc(k)}</span><span class="v">${esc(v || "—")}</span></div>`;
  }
  function openHandoverView(hd) {
    const h = hd || {};
    const wrap = document.createElement("div");
    wrap.className = "wc-applywrap";
    wrap.innerHTML = `
      <div class="wc-applycard" role="dialog" aria-modal="true" aria-label="交接紀錄">
        <div class="wc-applyhd">
          <div class="t">交接紀錄　${esc(fmtDateKey(h.workDate || todayKey()))}</div>
          <button type="button" class="wc-applyclose" data-close="1" aria-label="關閉">×</button>
        </div>
        <div class="wc-applybd">
          <section class="wc-card">
            <div class="wc-info">
              ${handoverFieldRow("交班人員", h.fromName || "")}
              ${handoverFieldRow("班別", h.shift || "")}
              ${handoverFieldRow("交接時間", h.at ? fmtTime(h.at) : "")}
              ${handoverFieldRow("鑰匙數量", h.keys)}
              ${handoverFieldRow("無線電數量", h.radio)}
              ${handoverFieldRow("巡邏進度", h.patrol)}
              ${handoverFieldRow("異常事件", h.issue)}
              ${handoverFieldRow("待辦事項", h.todo)}
              ${handoverFieldRow("備註", h.note)}
            </div>
            ${h.photo ? `<div class="wc-field"><label>交接照片</label><div class="wc-photo"><div class="wc-photo-box"><img src="${esc(h.photo)}" alt=""></div></div></div>` : ""}
          </section>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    const cb = wrap.querySelector("[data-close]");
    if (cb) cb.onclick = close;
  }

  function openHandoverModal(ctx, st, onDone) {
    const s = st || {};
    let photo = "";
    const wrap = document.createElement("div");
    wrap.className = "wc-applywrap";
    wrap.innerHTML = `
      <div class="wc-applycard" role="dialog" aria-modal="true" aria-label="交班交接">
        <div class="wc-applyhd">
          <div class="t">交班交接　${esc(fmtDateKey(todayKey()))}</div>
          <button type="button" class="wc-applyclose" data-close="1" aria-label="關閉">×</button>
        </div>
        <div class="wc-applybd">
          <section class="wc-card">
            <p class="wc-hint">交班前請完成交接內容，未交接將標記異常。</p>
            <div class="wc-field"><label>鑰匙數量</label><input type="number" min="0" id="hdKeys" placeholder="例：3"></div>
            <div class="wc-field"><label>無線電數量</label><input type="number" min="0" id="hdRadio" placeholder="例：2"></div>
            <div class="wc-field"><label>巡邏進度</label><input type="text" id="hdPatrol" placeholder="例：已完成 A、B 棟"></div>
            <div class="wc-field"><label>異常事件</label><textarea id="hdIssue" placeholder="有無異常狀況、處理情形"></textarea></div>
            <div class="wc-field"><label>待辦事項</label><textarea id="hdTodo" placeholder="交接給下一班的待辦"></textarea></div>
            <div class="wc-field"><label>備註</label><input type="text" id="hdNote" placeholder="其他說明"></div>
            <div class="wc-field"><label>交接照片</label>
              <div class="wc-photo">
                <div class="wc-photo-box" id="hdPhotoBox" style="display:none;">
                  <img id="hdPhotoImg" alt="" />
                  <button type="button" class="wc-photo-del" id="hdPhotoDel" aria-label="移除照片">×</button>
                </div>
                <div class="wc-photo-acts" id="hdPhotoActs">
                  <label class="wc-photo-btn">拍照<input type="file" accept="image/*" capture="environment" id="hdPhotoShot" hidden /></label>
                  <label class="wc-photo-btn">上傳照片<input type="file" accept="image/*" id="hdPhotoFile" hidden /></label>
                </div>
              </div>
            </div>
            <button class="wc-btn primary" type="button" id="hdSubmit">完成交接並交班</button>
          </section>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const q = (id) => wrap.querySelector(id);
    const box = q("#hdPhotoBox");
    const acts = q("#hdPhotoActs");
    const img = q("#hdPhotoImg");
    const applyPhoto = (url) => {
      photo = url || "";
      if (img) { if (url) img.src = url; else img.removeAttribute("src"); }
      if (box) box.style.display = url ? "block" : "none";
      if (acts) acts.style.display = url ? "none" : "flex";
    };
    wrap.querySelectorAll("#hdPhotoShot, #hdPhotoFile").forEach((i) => {
      i.onchange = () => { const f = i.files && i.files[0]; if (f) readImageFile(f, applyPhoto); };
    });
    const del = q("#hdPhotoDel");
    if (del) del.onclick = () => { applyPhoto(""); wrap.querySelectorAll("#hdPhotoShot, #hdPhotoFile").forEach((i) => { i.value = ""; }); };

    const close = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    const cb = wrap.querySelector("[data-close]");
    if (cb) cb.onclick = close;

    const submit = q("#hdSubmit");
    if (submit) submit.onclick = async () => {
      submit.disabled = true;
      const tk = (s.active && s.active.key) || todayKey();
      const payload = {
        fromUid: ctx.uid,
        fromName: ctx.userName || "",
        category: ctx.category || "",
        communityId: ctx.communityId,
        workDate: tk,
        shift: String(s.todayShift || ""),
        at: serverTs(),
        keys: Number(q("#hdKeys").value) || 0,
        radio: Number(q("#hdRadio").value) || 0,
        patrol: String(q("#hdPatrol").value || "").trim(),
        issue: String(q("#hdIssue").value || "").trim(),
        todo: String(q("#hdTodo").value || "").trim(),
        note: String(q("#hdNote").value || "").trim(),
        photo: photo || "",
      };
      try {
        await handoversCol(ctx.communityId).doc(`${ctx.uid}_${tk}`).set(payload, { merge: true });
        s.__handoverDone = true;
        s.todayHandover = payload;
        close();
        toast("交接完成");
        if (typeof onDone === "function") onDone();
      } catch (e) {
        console.error(e);
        submit.disabled = false;
        toast("交接儲存失敗，請稍後再試", true);
      }
    };
  }

  /* 申請彈窗（瀏覽器 90% 大小，以分頁按鈕切換 上班補卡／下班補卡／請假申請） */
  function openApplyModal(ctx, opts) {
    const o = opts || {};
    const c = ctx || {};
    const duty = o.duty || DEFAULT_DUTY;
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(o.dateKey)) ? String(o.dateKey) : todayKey();
    const leaveTypes = Array.isArray(duty.leaveTypes) && duty.leaveTypes.length ? duty.leaveTypes : DEFAULT_DUTY.leaveTypes;
    const draftSt = { draft: {} };
    const tabs = [];
    if (o.makeupIn) tabs.push(["makeup-in", "上班補卡"]);
    if (o.makeupOut) tabs.push(["makeup-out", "下班補卡"]);
    tabs.push(["leave", "請假申請"]);
    let cur = tabs[0][0];
    const activeStyle = "border-color:var(--wc-red);color:var(--wc-red-dark);font-weight:900;background:rgba(211,47,47,.06);";
    const punchOf = (k) => (k === "makeup-out" ? "out" : "in");
    /* 依日期取當日排班班別，回傳該班別的上下班時間（自動帶入請假時間） */
    const schedMap = (o.sched && typeof o.sched === "object") ? o.sched : {};
    const shiftTimeOf = (dk) => {
      const nm = String(schedMap[dk] || "").trim();
      if (!nm) return "";
      const w = shiftWindow(duty, c.category, nm);
      return w.start ? `${w.start} ~ ${w.end}` : "";
    };

    const makeupForm = (k) => {
      const d = draftSt.draft || {};
      const punch = punchOf(k);
      const makeDate = d.wdMakeupDate || dateKey;
      const makeTime = d.wdMakeupTime || (punch === "out" ? duty.workEnd : duty.workStart) || "08:00";
      const makeReason = d.wdMakeupReason || "";
      return `
        <section class="wc-card">
          <div class="wc-field"><label>日期</label><input type="date" id="wdMakeupDate" value="${esc(makeDate)}"></div>
          <div class="wc-field"><label>補卡別</label><div class="wc-applytype">${punch === "out" ? "下班補卡" : "上班補卡"}</div></div>
          <div class="wc-field"><label>時間</label><input type="time" id="wdMakeupTime" value="${esc(makeTime)}"></div>
          <div class="wc-field"><label>事由</label><textarea id="wdMakeupReason" placeholder="請輸入補卡事由">${esc(makeReason)}</textarea></div>
          <button class="wc-btn primary" type="button" id="wdMakeupSubmit">送出補卡</button>
        </section>`;
    };

    const leaveForm = () => {
      const d = draftSt.draft || {};
      const leaveDate = d.wdLeaveDate || dateKey;
      const leaveType = d.wdLeaveType || leaveTypes[0] || "";
      const leaveTime = typeof d.wdLeaveTime === "string" ? d.wdLeaveTime : shiftTimeOf(leaveDate);
      const leavePhoto = typeof d.wdLeavePhoto === "string" ? d.wdLeavePhoto : "";
      const leaveReason = d.wdLeaveReason || "";
      return `
        <section class="wc-card">
          <div class="wc-field"><label>日期</label><input type="date" id="wdLeaveDate" value="${esc(leaveDate)}"></div>
          <div class="wc-field"><label>時間</label><input type="text" id="wdLeaveTime" value="${esc(leaveTime)}" placeholder="例：08:00 ~ 17:00"></div>
          <div class="wc-field"><label>假別</label><select id="wdLeaveType">${leaveTypes.map((t) => `<option value="${esc(t)}"${t === leaveType ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
          <div class="wc-field"><label>事由</label><textarea id="wdLeaveReason" placeholder="請輸入請假事由">${esc(leaveReason)}</textarea></div>
          <div class="wc-field"><label>照片</label>
            <div class="wc-photo">
              <div class="wc-photo-box" id="wdLeavePhotoBox" style="display:${leavePhoto ? "block" : "none"};">
                <img id="wdLeavePhotoImg"${leavePhoto ? ` src="${esc(leavePhoto)}"` : ""} alt="" />
                <button type="button" class="wc-photo-del" id="wdLeavePhotoDel" aria-label="移除照片">×</button>
              </div>
              <div class="wc-photo-acts" id="wdLeavePhotoActs" style="display:${leavePhoto ? "none" : "flex"};">
                <label class="wc-photo-btn">拍照<input type="file" accept="image/*" capture="environment" id="wdLeaveShot" hidden /></label>
                <label class="wc-photo-btn">上傳照片<input type="file" accept="image/*" id="wdLeaveFile" hidden /></label>
              </div>
            </div>
          </div>
          <button class="wc-btn primary" type="button" id="wdLeaveSubmit">送出請假</button>
        </section>`;
    };

    const wrap = document.createElement("div");
    wrap.className = "wc-applywrap";
    wrap.innerHTML = `
      <div class="wc-applycard" role="dialog" aria-modal="true" aria-label="申請">
        <div class="wc-applyhd">
          <div class="t">申請　${esc(fmtDateKey(dateKey))}</div>
          <button type="button" class="wc-applyclose" data-close="1" aria-label="關閉">×</button>
        </div>
        <div class="wc-applytabs" role="tablist" aria-label="申請類別"></div>
        <div class="wc-applybd"></div>
      </div>`;
    document.body.appendChild(wrap);

    const tabsEl = wrap.querySelector(".wc-applytabs");
    const bdEl = wrap.querySelector(".wc-applybd");

    const paint = () => {
      if (cur !== "leave") draftSt.draft.wdMakeupType = punchOf(cur);
      tabsEl.innerHTML = tabs.map(([k, label]) => `<button type="button" class="wc-btn-sm" role="tab" data-apply-tab="${k}"${k === cur ? ' aria-current="page"' : ""} style="${k === cur ? activeStyle : ""}">${label}</button>`).join("");
      bdEl.innerHTML = cur === "leave" ? leaveForm() : makeupForm(cur);
      tabsEl.querySelectorAll("[data-apply-tab]").forEach((b) => {
        b.onclick = () => {
          const k = b.getAttribute("data-apply-tab");
          if (k === cur) return;
          readForm(bdEl, draftSt);
          cur = k;
          paint();
        };
      });
      const ls = bdEl.querySelector("#wdLeaveSubmit");
      if (ls) ls.onclick = () => submitLeave(c, draftSt, bdEl, ls);
      const ms = bdEl.querySelector("#wdMakeupSubmit");
      if (ms) ms.onclick = () => submitMakeup(c, draftSt, bdEl, ms);
      /* 改日期時，時間自動帶入該日排班班別的上下班時間 */
      const ld = bdEl.querySelector("#wdLeaveDate");
      const lt = bdEl.querySelector("#wdLeaveTime");
      if (ld && lt) ld.onchange = () => {
        const t = shiftTimeOf(String(ld.value || ""));
        lt.value = t;
        draftSt.draft.wdLeaveTime = t;
      };
      /* 照片：拍照或上傳，僅保留一張 */
      const box = bdEl.querySelector("#wdLeavePhotoBox");
      const acts = bdEl.querySelector("#wdLeavePhotoActs");
      const img = bdEl.querySelector("#wdLeavePhotoImg");
      const del = bdEl.querySelector("#wdLeavePhotoDel");
      const applyPhoto = (url) => {
        draftSt.draft.wdLeavePhoto = url || "";
        if (img) { if (url) img.src = url; else img.removeAttribute("src"); }
        if (box) box.style.display = url ? "block" : "none";
        if (acts) acts.style.display = url ? "none" : "flex";
        if (del) del.onclick = () => applyPhoto("");
        bdEl.querySelectorAll("#wdLeaveShot, #wdLeaveFile").forEach((i) => { i.value = ""; });
      };
      bdEl.querySelectorAll("#wdLeaveShot, #wdLeaveFile").forEach((input) => {
        input.onchange = () => {
          const f = input.files && input.files[0];
          if (f) readImageFile(f, applyPhoto);
        };
      });
      if (box) applyPhoto(String(draftSt.draft.wdLeavePhoto || ""));
    };
    paint();

    const close = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    const cb = wrap.querySelector("[data-close]");
    if (cb) cb.onclick = close;
  }

  /* 僅列出（且不快於當月）後台已編排班表的月份 */
  function loadScheduleMonths(cid) {
    if (!cid) return Promise.resolve([]);
    return schedulesCol(cid).where("month", "<=", monthKeyOf(new Date())).get()
      .then((snap) => {
        const set = new Set();
        snap.forEach((d) => {
          const m = String((d.data() || {}).month || "").trim();
          if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
        });
        return Array.from(set).sort((a, b) => b.localeCompare(a));
      })
      .catch((err) => { console.warn("schedule months load failed", err); return []; });
  }

  function openScheduleMonthPicker(ctx, st, current, onPick) {
    const cur = monthKeyOf(new Date());
    const wrap = document.createElement("div");
    wrap.className = "wc-datewrap";
    wrap.innerHTML = `<div class="wc-datecard"><div class="wc-dateloading">載入中…</div></div>`;
    document.body.appendChild(wrap);
    const close = () => { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
    const card = wrap.querySelector(".wc-datecard");
    const paint = (months) => {
      const list = (months || []).slice();
      list.push(cur);
      list.push(current);
      const uniq = Array.from(new Set(list)).filter((m) => /^\d{4}-\d{2}$/.test(m) && m <= cur).sort((a, b) => b.localeCompare(a));
      const btns = uniq.length
        ? uniq.map((m) => `<button type="button" class="wc-monthbtn" data-month="${esc(m)}"${m === current ? ' aria-current="page"' : ""}>${esc(m)}</button>`).join("")
        : `<div class="wc-dateloading">目前沒有班表資料</div>`;
      card.innerHTML = `
        <div class="wc-datehead">
          <div class="wc-dateym">選擇月份</div>
          <button type="button" class="wc-date-arrow" data-close="1" aria-label="關閉">×</button>
        </div>
        <div class="wc-monthgrid">${btns}</div>
      `;
      card.querySelectorAll("[data-month]").forEach((b) => {
        b.onclick = () => { close(); if (typeof onPick === "function") onPick(b.getAttribute("data-month")); };
      });
      const cb = card.querySelector("[data-close]");
      if (cb) cb.onclick = close;
    };
    loadScheduleMonths(ctx && ctx.communityId).then((months) => { if (wrap.parentNode) paint(months); });
  }

  /* 監聽指定月份本人的打卡紀錄，用於班表顯示打卡狀況 */
  function watchScheduleCheckins(cid, uid, st, rerender) {
    if (st.schedCkUnsub) { try { st.schedCkUnsub(); } catch {} st.schedCkUnsub = null; }
    st.schedCheckins = {};
    if (!cid || !uid) return;
    const r = monthRange(st.schedMonth);
    st.schedCkUnsub = track(checkinsCol(cid).where("workDate", ">=", r.start).where("workDate", "<=", r.end).onSnapshot((snap) => {
      const map = {};
      snap.forEach((d) => {
        const x = d.data() || {};
        if (String(x.uid) !== String(uid)) return;
        map[String(x.workDate || "")] = { inAt: x.inAt || null, outAt: x.outAt || null };
      });
      st.schedCheckins = map;
      if (typeof rerender === "function") rerender();
    }, (err) => { console.warn("duty schedule checkins listen failed", err); st.schedCheckins = {}; if (typeof rerender === "function") rerender(); }));
  }

  /* 監聽指定月份的本人的班別 */
  function watchScheduleMonth(cid, uid, st, rerender) {
    if (st.schedUnsub) { try { st.schedUnsub(); } catch {} st.schedUnsub = null; }
    st.schedule = {};
    st.schedMonth = schedMonthOf(st);
    if (!cid) { if (typeof rerender === "function") rerender(); return; }
    const mk = st.schedMonth;
    st.schedUnsub = schedulesCol(cid).where("month", "==", mk).onSnapshot((snap) => {
      const map = {};
      snap.forEach((d) => {
        const x = d.data() || {};
        const shifts = x.shifts || {};
        const s = shifts[uid];
        if (s) map[String(x.dateKey || d.id)] = String(s);
      });
      st.schedule = map;
      if (typeof rerender === "function") rerender();
    }, (err) => { console.warn("duty schedule month listen failed", err); st.schedule = {}; if (typeof rerender === "function") rerender(); });
    watchScheduleCheckins(cid, uid, st, rerender);
  }

  function subscribeSchedule(cid, uid, st, rerender) {
    st.schedMonth = monthKeyOf(new Date());
    st.schedView = st.schedView === "cal" ? "cal" : "list";
    subscribeDutySettings(cid, (d) => { st.duty = mergedDuty(d); rerender(); });
    watchScheduleMonth(cid, uid, st, rerender);
  }

  /* ==================================================================== */
  /* 請假／補卡                                                            */
  /* ==================================================================== */
  /* 將選取的圖片壓縮成 JPEG data URL（長邊上限 720px） */
  function readImageFile(file, cb) {
    if (!file) return;
    if (!/^image\//.test(String(file.type || ""))) { toast("請選擇圖片檔", true); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 720;
        const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round((img.width || 1) * scale));
        const h = Math.max(1, Math.round((img.height || 1) * scale));
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const g = cv.getContext("2d");
        g.drawImage(img, 0, 0, w, h);
        let url = "";
        try { url = cv.toDataURL("image/jpeg", 0.65); } catch { url = String(rd.result || ""); }
        cb(url);
      };
      img.onerror = () => cb("");
      img.src = String(rd.result || "");
    };
    rd.onerror = () => cb("");
    rd.readAsDataURL(file);
  }

  function readForm(root, st) {
    st.draft = st.draft || {};
    const ids = ["wdLeaveDate", "wdLeaveTime", "wdLeaveType", "wdLeaveReason", "wdMakeupDate", "wdMakeupType", "wdMakeupTime", "wdMakeupReason"];
    ids.forEach((id) => {
      const e = root.querySelector("#" + id);
      if (e && typeof e.value === "string") st.draft[id] = e.value;
    });
  }

  function recordItem(r) {
    const isLeave = String(r.type) === "leave";
    const label = isLeave ? "請假" : "補卡";
    const detail = isLeave
      ? `${esc(r.leaveType || "")}${r.reason ? "　" + esc(r.reason) : ""}`
      : `${String(r.punchType) === "out" ? "下班" : "上班"}補卡　${esc(r.timeHM || "")}${r.reason ? "　" + esc(r.reason) : ""}`;
    return `
      <div class="wc-item">
        <div class="row1">
          <div class="loc">${esc(fmtDateKey(r.dateKey || ""))}</div>
          <span class="wc-tag ${isLeave ? "" : "done"}">${label}</span>
        </div>
        <div class="note">${detail || "—"}</div>
        <div class="time">${esc(fmtDateTime(r.createdAt))}</div>
      </div>`;
  }

  function renderLeaveTab(root, ctx, st) {
    readForm(root, st);
    st.mode = st.mode || "leave";
    const duty = st.duty || DEFAULT_DUTY;
    const leaveTypes = Array.isArray(duty.leaveTypes) && duty.leaveTypes.length ? duty.leaveTypes : DEFAULT_DUTY.leaveTypes;
    const mode = st.mode;
    const records = st.records || [];
    const draft = st.draft || {};

    const leaveDate = draft.wdLeaveDate || todayKey();
    const leaveType = draft.wdLeaveType || leaveTypes[0] || "";
    const leaveReason = draft.wdLeaveReason || "";
    const makeDate = draft.wdMakeupDate || todayKey();
    const makeType = draft.wdMakeupType === "out" ? "out" : "in";
    const makeTime = draft.wdMakeupTime || duty.workStart || "08:00";
    const makeReason = draft.wdMakeupReason || "";

    const toggleBtn = (k, label) => `
      <button class="wc-btn-sm" type="button" data-wd-mode="${k}" style="${mode === k ? "border-color:var(--wc-red);color:var(--wc-red-dark);font-weight:900;background:rgba(211,47,47,.06);" : ""}">${label}</button>`;

    const leaveForm = `
      <div class="wc-field"><label>日期</label><input type="date" id="wdLeaveDate" value="${esc(leaveDate)}"></div>
      <div class="wc-field"><label>假別</label><select id="wdLeaveType">${leaveTypes.map((t) => `<option value="${esc(t)}"${t === leaveType ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="wc-field"><label>事由</label><textarea id="wdLeaveReason" placeholder="請輸入請假事由">${esc(leaveReason)}</textarea></div>
      <button class="wc-btn primary" type="button" id="wdLeaveSubmit">送出請假</button>
    `;

    const makeupForm = `
      <div class="wc-field"><label>日期</label><input type="date" id="wdMakeupDate" value="${esc(makeDate)}"></div>
      <div class="wc-field"><label>補卡別</label><select id="wdMakeupType">
        <option value="in"${makeType === "in" ? " selected" : ""}>上班</option>
        <option value="out"${makeType === "out" ? " selected" : ""}>下班</option>
      </select></div>
      <div class="wc-field"><label>時間</label><input type="time" id="wdMakeupTime" value="${esc(makeTime)}"></div>
      <div class="wc-field"><label>事由</label><textarea id="wdMakeupReason" placeholder="請輸入補卡事由">${esc(makeReason)}</textarea></div>
      <button class="wc-btn primary" type="button" id="wdMakeupSubmit">送出補卡</button>
    `;

    root.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div><h2>請假／補卡</h2><p>送出後立即生效</p></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          ${toggleBtn("leave", "請假")}${toggleBtn("makeup", "補卡")}
        </div>
        ${mode === "leave" ? leaveForm : makeupForm}
      </section>

      <section class="wc-card">
        <div class="hd">
          <div><h2>我的紀錄</h2><p>${esc(monthKeyOf(new Date()))}</p></div>
        </div>
        ${records.length ? `<div class="wc-list">${records.map(recordItem).join("")}</div>` : `<div class="wc-empty">本月尚無紀錄</div>`}
      </section>
    `;

    root.querySelectorAll("[data-wd-mode]").forEach((b) => {
      b.onclick = () => { readForm(root, st); st.mode = b.getAttribute("data-wd-mode"); renderLeaveTab(root, ctx, st); };
    });
    const ls = root.querySelector("#wdLeaveSubmit");
    if (ls) ls.onclick = () => submitLeave(ctx, st, root, ls);
    const ms = root.querySelector("#wdMakeupSubmit");
    if (ms) ms.onclick = () => submitMakeup(ctx, st, root, ms);
  }

  function subscribeLeaveTab(root, ctx, st, rerender) {
    subscribeDutySettings(ctx.communityId, (d) => { st.duty = mergedDuty(d); rerender(); });
    if (!ctx.communityId) { st.records = []; return; }
    const r = monthRange(monthKeyOf(new Date()));
    track(requestsCol(ctx.communityId).where("dateKey", ">=", r.start).where("dateKey", "<=", r.end).onSnapshot((snap) => {
      const list = [];
      snap.forEach((d) => {
        const x = d.data() || {};
        if (String(x.uid) === String(ctx.uid)) list.push(x);
      });
      list.sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
      st.records = list;
      rerender();
    }, (err) => { console.warn("duty requests listen failed", err); st.records = []; rerender(); }));
  }

  async function submitLeave(ctx, st, root, btn) {
    readForm(root, st);
    const draft = st.draft || {};
    const dateKey = String(draft.wdLeaveDate || "").trim() || todayKey();
    const leaveType = String(draft.wdLeaveType || "").trim();
    const timeRange = String(draft.wdLeaveTime || "").trim();
    const photo = String(draft.wdLeavePhoto || "");
    const reason = String(draft.wdLeaveReason || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { toast("請選擇請假日期", true); return; }
    if (!leaveType) { toast("請選擇假別", true); return; }
    if (!ctx.communityId || !ctx.uid) { toast("缺少社區或登入資訊", true); return; }
    if (btn) { btn.disabled = true; btn.textContent = "送出中…"; }
    try {
      const payload = {
        type: "leave",
        uid: ctx.uid,
        name: ctx.userName || "",
        category: ctx.category || "",
        dateKey,
        leaveType,
        timeRange,
        reason,
        createdAt: serverTs(),
        createdBy: ctx.uid,
        communityId: ctx.communityId,
      };
      if (photo) payload.photo = photo;
      await requestsCol(ctx.communityId).add(payload);
      const ta = root.querySelector("#wdLeaveReason");
      if (ta) ta.value = "";
      draft.wdLeaveReason = "";
      toast("請假已送出");
    } catch (e) {
      console.error(e);
      toast("送出失敗，請稍後再試", true);
      if (btn) { btn.disabled = false; btn.textContent = "送出請假"; }
    }
  }

  async function submitMakeup(ctx, st, root, btn) {
    readForm(root, st);
    const draft = st.draft || {};
    const dateKey = String(draft.wdMakeupDate || "").trim() || todayKey();
    const punchType = String(draft.wdMakeupType) === "out" ? "out" : "in";
    const timeHM = String(draft.wdMakeupTime || "").trim();
    const reason = String(draft.wdMakeupReason || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { toast("請選擇補卡日期", true); return; }
    if (!/^\d{2}:\d{2}$/.test(timeHM)) { toast("請選擇補卡時間", true); return; }
    if (!ctx.communityId || !ctx.uid) { toast("缺少社區或登入資訊", true); return; }
    const part = dateKey.split("-").map((x) => Number(x));
    const hm = timeHM.split(":").map((x) => Number(x));
    const when = new Date(part[0], part[1] - 1, part[2], hm[0], hm[1], 0, 0);
    const field = punchType === "out" ? "outAt" : "inAt";
    if (btn) { btn.disabled = true; btn.textContent = "送出中…"; }
    try {
      await requestsCol(ctx.communityId).add({
        type: "makeup",
        uid: ctx.uid,
        name: ctx.userName || "",
        category: ctx.category || "",
        dateKey,
        punchType,
        timeHM,
        reason,
        createdAt: serverTs(),
        createdBy: ctx.uid,
        communityId: ctx.communityId,
      });
      const payload = {
        uid: ctx.uid,
        name: ctx.userName || "",
        category: ctx.category || "",
        workDate: dateKey,
        communityId: ctx.communityId,
        updatedAt: serverTs(),
      };
      payload[field] = when;
      await checkinsCol(ctx.communityId).doc(`${ctx.uid}_${dateKey}`).set(payload, { merge: true });
      const ta = root.querySelector("#wdMakeupReason");
      if (ta) ta.value = "";
      draft.wdMakeupReason = "";
      toast("補卡已送出");
    } catch (e) {
      console.error(e);
      toast("送出失敗，請稍後再試", true);
      if (btn) { btn.disabled = false; btn.textContent = "送出補卡"; }
    }
  }

  /* ==================================================================== */
  /* exports                                                              */
  /* ==================================================================== */
  const tabs = {
    punch: makeTab({ render: renderPunchTab, subscribe: subscribePunchTab }),
    leave: makeTab({ render: renderLeaveTab, subscribe: subscribeLeaveTab }),
    record: makeTab({ render: renderRecordTab, subscribe: subscribeRecordTab }),
  };

  window.NwWorkerDuty = {
    tabs,
    teardown,
    bindCommunitySwitch,
    scheduleCardHtml,
    bindScheduleCard,
    openApplyModal,
    utils: { esc, pad2, dateKey: dateKeyOf, todayKey, monthKeyOf, monthRange, daysInMonth, weekdayZh, fmtDateKey, fmtTime, fmtDateTime, msOf, mergedDuty, shiftWindow, evalAttendance, isHandoverRole, STATUS_LABEL },
    DEFAULT_DUTY,
    ROLE_META,
  };

  /* ==================================================================== */
  /* 個人資料 / header / 彈窗                                              */
  /* ==================================================================== */
  function isAllowedWorker(profile, user) {
    const role = String((profile && profile.role) || "").trim();
    const cat = String((profile && profile.category) || "").trim();
    if (role === "住戶" || role === "resident" || role === "停用") return false;
    if (role === "工作" || role === "worker" || role === "清潔" || role === "清潔人員") return true;
    if (WORK_CATEGORIES.includes(cat)) return true;
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
    return data;
  }

  function displayName(profile, user) {
    return String((profile && (profile.displayName || profile.name || profile.fullName)) || (user && user.displayName) || (user && user.email) || "").trim();
  }

  async function resolveCommunityName(profile, cid) {
    const names = Array.isArray(profile && profile.communityNames) ? profile.communityNames : [];
    const ids = Array.isArray(profile && profile.communityIds) ? profile.communityIds : [];
    const key = String(cid || "").trim();
    let name = "";
    const idx = ids.map((x) => String(x || "").trim()).indexOf(key);
    if (idx >= 0 && names[idx]) name = String(names[idx]);
    if (!name && profile && profile.communityName) name = String(profile.communityName);
    if (!name && key && key !== "default") {
      try {
        const snap = await db.collection("communities").doc(key).get();
        if (snap && snap.exists) name = String((snap.data() || {}).name || "").trim();
      } catch (e) { console.warn("resolve community name failed", e); }
      if (!name) {
        try {
          const q = await db.collection("communities").where("username", "==", key).limit(1).get();
          if (q && q.size) name = String((q.docs[0].data() || {}).name || "").trim();
        } catch (e) { console.warn("resolve community name by username failed", e); }
      }
    }
    return name;
  }

  /* ==================================================================== */
  /* 社區切換（服務多個社區的帳號）                                        */
  /* ==================================================================== */
  function servedCommunities(profile) {
    const src = profile || {};
    const ids = Array.isArray(src.communityIds) ? src.communityIds : [];
    const codes = Array.isArray(src.communityCodes) ? src.communityCodes : [];
    const names = Array.isArray(src.communityNames) ? src.communityNames : [];
    const out = [];
    const seen = new Set();
    const add = (key, id, name) => {
      const k = String(key || id || "").trim();
      if (!k) return;
      const low = k.toLowerCase();
      if (seen.has(low)) return;
      seen.add(low);
      out.push({ key: k, id: String(id || "").trim(), name: String(name || "").trim() });
    };
    const n = Math.max(ids.length, codes.length, names.length);
    for (let i = 0; i < n; i++) add(codes[i] || ids[i], ids[i], names[i]);
    if (!out.length) add(src.community || src.communityCode || src.communityId || "", src.communityId || "", src.communityName || "");
    return out;
  }

  function ensureSwitchStyles() {
    if (document.getElementById("nwCommunitySwitchStyle")) return;
    const st = document.createElement("style");
    st.id = "nwCommunitySwitchStyle";
    st.textContent = `
.wc-brand .sub.clickable{cursor:pointer;}
.wc-brand .sub.clickable::after{content:"▾";margin-left:4px;font-size:11px;line-height:1;opacity:.85;}
.nw-switch-loading{padding:20px 4px;text-align:center;font-size:15px;font-weight:800;color:#6b7280;}`;
    document.head.appendChild(st);
  }

  function ensureSwitchModal() {
    let modal = document.getElementById("communityPickerModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "communityPickerModal";
    modal.className = "modal modal-community-picker";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="communityPickerTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="communityPickerTitle">切換社區</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="community-picker-filters" id="communityPickerFilters" aria-label="社區區域篩選"></div>
          <div class="community-picker-list" id="communityPickerList"></div>
        </div>
        <div class="modal-ft">
          <button class="intercom-btn ghost community-picker-close" type="button" data-modal-close="1">關閉</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function switchToCommunity(key) {
    const k = String(key || "").trim();
    if (!k) return;
    try { localStorage.setItem("csp_active_community_v1", k); } catch {}
    try { sessionStorage.setItem("csp_last_cid", k); } catch {}
    try {
      const u = new URL(location.href);
      u.searchParams.set("c", k);
      location.href = u.toString();
    } catch { location.href = `?c=${encodeURIComponent(k)}`; }
  }

  async function openSwitchModal(list, activeKey) {
    const modal = ensureSwitchModal();
    const listEl = modal.querySelector("#communityPickerList");
    const filtersEl = modal.querySelector("#communityPickerFilters");
    const active = String(activeKey || "").trim().toLowerCase();
    const onKey = (e) => { if (e && e.key === "Escape") close(); };
    function close() {
      modal.hidden = true;
      document.body.style.overflow = "";
      modal.querySelectorAll("[data-modal-close]").forEach((x) => x.removeEventListener("click", close));
      document.removeEventListener("keydown", onKey, true);
    }
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modal.querySelectorAll("[data-modal-close]").forEach((x) => x.addEventListener("click", close));
    document.addEventListener("keydown", onKey, true);
    if (filtersEl) filtersEl.innerHTML = "";
    if (listEl) listEl.innerHTML = `<div class="nw-switch-loading">讀取中…</div>`;

    const items = await Promise.all(list.map(async (it) => {
      let name = it.name;
      let area = "";
      let key = it.key;
      let id = it.id;
      try {
        let data = null;
        if (it.id) {
          const s = await db.collection("communities").doc(it.id).get();
          if (s && s.exists) data = s.data() || {};
        }
        if (!data) {
          for (const f of ["username", "id"]) {
            const q = await db.collection("communities").where(f, "==", it.key).limit(1).get();
            if (q && q.size) { data = q.docs[0].data() || {}; break; }
          }
        }
        if (data) {
          name = String(data.name || name || "").trim();
          area = String(data.area || "").trim();
          key = String(data.username || data.id || key).trim();
          id = String(data.id || id).trim();
        }
      } catch (e) { console.warn("load community for switch failed", e); }
      return { key: key || it.key, id, name: name || key || it.key, area };
    }));

    const areas = [];
    items.forEach((x) => { if (x.area && !areas.includes(x.area)) areas.push(x.area); });
    let activeArea = "";

    const renderList = () => {
      if (!listEl) return;
      const shown = activeArea ? items.filter((x) => x.area === activeArea) : items;
      if (!shown.length) {
        listEl.innerHTML = `<div class="nw-switch-loading">目前沒有可切換的社區</div>`;
        return;
      }
      listEl.innerHTML = shown.map((x) => {
        const isActive = Boolean(active) && (x.key.toLowerCase() === active || String(x.id || "").toLowerCase() === active);
        return `
          <div class="community-picker-item">
            <button type="button" class="${isActive ? "community-picker-btn active" : "community-picker-btn"}" data-community-key="${esc(x.key)}">
              <span class="community-picker-name">${esc(x.name)}</span>
              <span class="community-picker-code">${esc(x.key)}</span>
            </button>
          </div>`;
      }).join("");
      listEl.querySelectorAll("[data-community-key]").forEach((btn) => {
        btn.onclick = () => {
          const key = String(btn.getAttribute("data-community-key") || "").trim();
          close();
          if (key) switchToCommunity(key);
        };
      });
    };

    if (filtersEl && areas.length > 1) {
      filtersEl.innerHTML = areas.map((a) => `<button type="button" class="community-picker-filter-btn" data-community-area="${esc(a)}">${esc(a)}</button>`).join("");
      filtersEl.querySelectorAll("[data-community-area]").forEach((btn) => {
        btn.onclick = () => {
          const next = String(btn.getAttribute("data-community-area") || "").trim();
          activeArea = activeArea === next ? "" : next;
          filtersEl.querySelectorAll("[data-community-area]").forEach((b) => b.classList.toggle("active", String(b.getAttribute("data-community-area") || "") === activeArea));
          renderList();
        };
      });
    }
    renderList();
  }

  function bindCommunitySwitch(opts) {
    const el = opts && opts.el;
    if (!el) return;
    const list = servedCommunities(opts.profile);
    if (list.length <= 1) return;
    ensureSwitchStyles();
    el.classList.add("clickable");
    try {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      if (!el.getAttribute("role")) el.setAttribute("role", "button");
      if (!el.getAttribute("title")) el.setAttribute("title", "點擊切換社區");
    } catch {}
    const open = (e) => {
      if (e) { try { e.preventDefault(); e.stopPropagation(); } catch {} }
      openSwitchModal(list, (opts && opts.activeKey) || "");
    };
    el.onclick = open;
    el.onkeydown = (e) => {
      const k = String((e && e.key) || "");
      if (k === "Enter" || k === " ") open(e);
    };
  }

  function bootStandalone() {
    const roleKey = String(document.body.getAttribute("data-duty-role") || "manager");
    const meta = ROLE_META[roleKey] || ROLE_META.manager;
    const nav = document.getElementById("wdNav");
    const bodyEl = document.getElementById("wdBody");
    if (!nav || !bodyEl) return;

    document.title = `${meta.category}｜社區系統`;
    const titleEl = document.querySelector(".wc-brand .title");
    if (titleEl) titleEl.textContent = meta.category;

    const els = {
      communityName: document.getElementById("wcCommunityName"),
      userName: document.getElementById("wcUserName"),
      avatar: document.getElementById("wcAvatar"),
      avatarImg: document.getElementById("wcAvatarImg"),
      userChip: document.getElementById("btnUserChip"),
      profileModal: document.getElementById("profileModal"),
      profileCommunity: document.getElementById("profileCommunityText"),
      profileRole: document.getElementById("profileRole"),
      profileName: document.getElementById("profileNameText"),
      profileAvatar: document.getElementById("profileAvatarFallback"),
      profileAvatarImg: document.getElementById("profileAvatarImg"),
    };

    let currentCtx = null;
    let currentTab = "punch";
    let lastAvatarUrl = "";

    function setHeader(name, communityName, profile) {
      if (els.userName) els.userName.textContent = name || "使用者";
      if (els.communityName) els.communityName.textContent = communityName || "社區智慧系統平台";
      if (els.avatar) els.avatar.textContent = initial(name, "");
      lastAvatarUrl = String((profile && (profile.avatarDataUrl || profile.avatar)) || "").trim();
      if (els.avatarImg) {
        if (lastAvatarUrl) {
          els.avatarImg.src = lastAvatarUrl;
          els.avatarImg.style.display = "block";
          if (els.avatar) els.avatar.style.display = "none";
        } else {
          els.avatarImg.removeAttribute("src");
          els.avatarImg.style.display = "none";
          if (els.avatar) els.avatar.style.display = "grid";
        }
      }
    }

    function openProfileModal() {
      const modal = els.profileModal;
      if (!modal) return;
      if (els.profileCommunity) els.profileCommunity.textContent = (currentCtx && (currentCtx.communityName || currentCtx.communityId)) || "—";
      if (els.profileRole) els.profileRole.textContent = (currentCtx && currentCtx.category) || "—";
      if (els.profileName) els.profileName.textContent = (currentCtx && currentCtx.userName) || "—";
      if (els.profileAvatarImg) {
        if (lastAvatarUrl) {
          els.profileAvatarImg.src = lastAvatarUrl;
          els.profileAvatarImg.style.display = "block";
          if (els.profileAvatar) els.profileAvatar.style.display = "none";
        } else {
          els.profileAvatarImg.removeAttribute("src");
          els.profileAvatarImg.style.display = "none";
          if (els.profileAvatar) {
            els.profileAvatar.style.display = "grid";
            els.profileAvatar.textContent = initial(currentCtx && currentCtx.userName, "");
          }
        }
      }
      modal.hidden = false;
      if (els.userChip) els.userChip.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      fillProfileShift();
    }

    /* 將原「設定」分頁的班別時間填入個人資訊彈窗 */
    async function fillProfileShift() {
      const host = document.getElementById("profileShiftList");
      const noteEl = document.getElementById("profileShiftNote");
      if (!host) return;
      const cid = currentCtx && currentCtx.communityId;
      let data = null;
      try {
        if (cid) {
          const snap = await dutySettingRef(cid).get();
          data = snap && snap.exists ? (snap.data() || {}) : null;
        }
      } catch (e) { console.warn("load duty settings for profile failed", e); }
      const duty = mergedDuty(data);
      const cat = String((currentCtx && currentCtx.category) || "").trim();
      const roleList = (duty.roleShifts && duty.roleShifts[cat]) || [];
      const shifts = roleList.length
        ? roleList.map((x) => ({ name: String(x.name || ""), start: String(x.start || ""), end: String(x.end || "") }))
        : (Array.isArray(duty.shifts) ? duty.shifts : DEFAULT_DUTY.shifts).filter((n) => String(n) !== "休假").map((n) => ({ name: String(n), start: "", end: "" }));
      host.innerHTML = shifts.length
        ? shifts.map((s) => `<div class="r"><span class="k">${esc(s.name)}</span><span class="v">${s.start && s.end ? esc(s.start) + " ~ " + esc(s.end) : "—"}</span></div>`).join("")
        : `<div class="r"><span class="k">班別</span><span class="v">尚未設定</span></div>`;
      if (noteEl) {
        if (duty.note) { noteEl.textContent = duty.note; noteEl.style.display = "block"; }
        else { noteEl.textContent = ""; noteEl.style.display = "none"; }
      }
    }

    function closeProfileModal() {
      const modal = els.profileModal;
      if (!modal) return;
      modal.hidden = true;
      if (els.userChip) els.userChip.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }

    function bindProfileModal() {
      const modal = els.profileModal;
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
        if (e.key === "Escape" && els.profileModal && !els.profileModal.hidden) closeProfileModal();
      });
    }

    function showDenied() {
      bodyEl.classList.remove("wc-split");
      bodyEl.innerHTML = `<section class="wc-card"><div class="wc-empty">此帳號無工作人員權限，請聯絡社區管理員。</div>
        <button class="wc-btn primary" type="button" id="wdDeniedOut">登出</button></section>`;
      const b = bodyEl.querySelector("#wdDeniedOut");
      if (b) b.onclick = () => { auth.signOut().then(() => { location.href = "index.html"; }).catch(() => {}); };
    }

    function showTab(t) {
      if (!tabs[t]) return;
      currentTab = t;
      bodyEl.scrollTop = 0;
      const view = tabs[t](currentCtx);
      bodyEl.innerHTML = view.html;
      if (view.bind) view.bind(bodyEl);
      nav.querySelectorAll("[data-wd-tab]").forEach((b) => {
        if (b.getAttribute("data-wd-tab") === t) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
    }

    nav.querySelectorAll("[data-wd-tab]").forEach((b) => {
      b.onclick = () => {
        const t = b.getAttribute("data-wd-tab");
        if (!currentCtx) return;
        if (t === "request") {
          openApplyModal(currentCtx, { dateKey: todayKey() });
          return;
        }
        showTab(t);
      };
    });
    if (els.userChip) els.userChip.onclick = () => openProfileModal();
    bindProfileModal();

    auth.onAuthStateChanged(async (user) => {
      teardown();
      if (!user) {
        const cid = activeCommunityId();
        location.href = "index.html" + (cid ? `?c=${encodeURIComponent(cid)}` : "");
        return;
      }
      const profile = await loadProfile(user);
      const rawCid = activeCommunityId();
      const cid = await resolveCommunityDocId(rawCid);
      const legacyCid = (rawCid && rawCid !== cid) ? rawCid : "";
      const communityName = await resolveCommunityName(profile, cid);
      const name = displayName(profile, user);
      setHeader(name, communityName, profile);
      currentCtx = {
        db,
        cid,
        uid: user.uid,
        userName: name,
        category: meta.category,
        role: roleKey,
        communityId: cid,
        communityName,
        user,
        profile,
      };
      if (!isAllowedWorker(profile, user)) { showDenied(); return; }
      migrateLegacyDutyData(legacyCid, cid, user.uid).catch(() => {});
      bindCommunitySwitch({ el: els.communityName, profile, activeKey: cid });
      showTab(currentTab);
    });

    window.addEventListener("pagehide", () => { try { teardown(); } catch {} });
  }

  function boot() {
    if (!document.getElementById("wdBody")) return;
    bootStandalone();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
