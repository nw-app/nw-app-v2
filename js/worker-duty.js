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
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function fmtDateTime(ts) {
    const d = toDate(ts);
    if (!d) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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
  function dutySettingRef(cid) { return commRef(cid).collection("settings").doc("duty"); }

  function subscribeDutySettings(cid, cb) {
    if (!cid) { cb(null); return; }
    track(dutySettingRef(cid).onSnapshot((doc) => {
      cb(doc && doc.exists ? (doc.data() || {}) : null);
    }, (err) => { console.warn("duty settings listen failed", err); cb(null); }));
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
  function monthStats(list) {
    let days = 0, ms = 0;
    (list || []).forEach((c) => {
      if (c && c.inAt) days += 1;
      if (c && c.inAt && c.outAt) ms += Math.max(0, msOf(c.outAt) - msOf(c.inAt));
    });
    return { days, hours: (ms / 3600000).toFixed(1) };
  }

  function renderPunchTab(root, ctx, st) {
    const c = st.checkin || {};
    const inAt = c.inAt || null;
    const outAt = c.outAt || null;
    const onDuty = !!inAt && !outAt;
    const statusCls = onDuty ? "on" : (outAt ? "out" : "");
    const statusText = onDuty ? "上班中" : (outAt ? "已下班" : "尚未打卡");
    const dotText = onDuty ? "上" : (outAt ? "下" : "休");
    const btnLabel = onDuty ? "下班打卡" : (outAt ? "重新上班打卡" : "上班打卡");
    const duty = st.duty || DEFAULT_DUTY;
    const stats = monthStats(st.monthCheckins);
    const leave = st.todayLeave;
    const leaveTxt = leave
      ? `${leave.leaveType || "請假"}${leave.reason ? "（" + leave.reason + "）" : ""}`
      : "無";
    const shift = st.todayShift || "未排班";

    root.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div>
            <h2>今日出勤</h2>
            <p>${esc(fmtDateKey(todayKey()))}</p>
          </div>
        </div>
        <div class="wc-status ${statusCls}">
          <div class="dot">${dotText}</div>
          <div class="txt">
            <div class="k">目前狀態</div>
            <div class="v">${statusText}</div>
          </div>
        </div>
        <div class="wc-meta" style="margin-top:12px;">
          <div class="box"><div class="k">上班打卡</div><div class="v">${fmtTime(inAt)}</div></div>
          <div class="box"><div class="k">下班打卡</div><div class="v">${fmtTime(outAt)}</div></div>
        </div>
        <button class="wc-punch ${onDuty ? "out" : ""}" type="button" data-wd-punch="${onDuty ? "out" : "in"}">${btnLabel}</button>
      </section>

      <section class="wc-card">
        <div class="hd">
          <div><h2>本月出勤統計</h2><p>${esc(monthKeyOf(new Date()))}</p></div>
        </div>
        <div class="wc-info">
          <div class="r"><span class="k">上班天數</span><span class="v">${stats.days} 天</span></div>
          <div class="r"><span class="k">總時數</span><span class="v">${stats.hours} 小時</span></div>
          <div class="r"><span class="k">今日班別</span><span class="v">${esc(shift)}</span></div>
          <div class="r"><span class="k">今日請假</span><span class="v">${esc(leaveTxt)}</span></div>
          <div class="r"><span class="k">上班時間</span><span class="v">${esc(duty.workStart)} ~ ${esc(duty.workEnd)}</span></div>
        </div>
      </section>
    `;

    const btn = root.querySelector("[data-wd-punch]");
    if (btn) btn.onclick = () => doPunch(ctx, btn.getAttribute("data-wd-punch"), btn);
  }

  function subscribePunchTab(root, ctx, st, rerender) {
    ctx.__punchUi = { st, rerender };
    subscribeDutySettings(ctx.communityId, (d) => { st.duty = mergedDuty(d); rerender(); });
    if (!ctx.communityId) return;
    const tk = todayKey();

    track(checkinsCol(ctx.communityId).doc(`${ctx.uid}_${tk}`).onSnapshot((doc) => {
      st.checkin = doc && doc.exists ? (doc.data() || {}) : null;
      rerender();
    }, (err) => { console.warn("duty checkin listen failed", err); st.checkin = null; rerender(); }));

    track(schedulesCol(ctx.communityId).doc(tk).onSnapshot((doc) => {
      const d = doc && doc.exists ? (doc.data() || {}) : {};
      const shifts = d.shifts || {};
      st.todayShift = String(shifts[ctx.uid] || "");
      rerender();
    }, (err) => { console.warn("duty schedule listen failed", err); st.todayShift = ""; rerender(); }));

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
  }

  async function savePunch(ctx, type, photo, meta) {
    const tk = todayKey();
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
    await ref.set(payload, { merge: true });
  }

  function optimisticPunchRecord(base, ctx, type, photo, meta) {
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
      workDate: todayKey(),
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
    const next = optimisticPunchRecord(ui.st.checkin, ctx, type, photo, meta);
    ui.st.checkin = next;
    const monthList = Array.isArray(ui.st.monthCheckins) ? ui.st.monthCheckins.slice() : [];
    const idx = monthList.findIndex((x) => x && String(x.workDate || "") === String(next.workDate || ""));
    if (idx >= 0) monthList[idx] = Object.assign({}, monthList[idx], next);
    else monthList.push(next);
    ui.st.monthCheckins = monthList;
    ui.rerender();
  }

  function doPunch(ctx, type, btn) {
    if (!ctx || !ctx.communityId) { toast("缺少社區資訊", true); return; }
    if (!ctx.uid) { toast("尚未登入", true); return; }
    if (!window.NwPunchFlow) { toast("打卡模組載入失敗，請重新整理", true); return; }
    const isIn = type === "in";
    let lastPhoto = "";
    let lastMeta = null;
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
  function renderScheduleTab(root, ctx, st) {
    const mk = monthKeyOf(new Date());
    const sched = st.schedule || {};
    const tk = todayKey();
    const days = daysInMonth(mk);
    const duty = st.duty || DEFAULT_DUTY;
    const leaveTypes = Array.isArray(duty.leaveTypes) && duty.leaveTypes.length ? duty.leaveTypes : DEFAULT_DUTY.leaveTypes;
    const holidayTypes = Array.isArray(duty.holidayTypes) && duty.holidayTypes.length ? duty.holidayTypes : DEFAULT_DUTY.holidayTypes;
    const leaveSet = new Set(leaveTypes.map((x) => String(x)));
    const holidaySet = new Set(holidayTypes.map((x) => String(x)));
    const rows = days.map((k) => {
      const s = sched[k] || "";
      const isLeave = Boolean(s) && (leaveSet.has(s) || s === "休假");
      const isHoliday = Boolean(s) && holidaySet.has(s);
      const tagCls = isLeave || isHoliday ? "" : (s ? "done" : "");
      const tagStyle = isLeave
        ? ' style="background:rgba(37,99,235,.10);color:#1d4ed8;"'
        : (isHoliday ? ' style="background:rgba(14,116,144,.12);color:#0e7490;"' : "");
      const rowStyle = k === tk ? ' style="border-color:var(--wc-red);"' : "";
      return `
        <div class="wc-item"${rowStyle}>
          <div class="row1">
            <div class="loc">${esc(fmtDateKey(k))}</div>
            <span class="wc-tag ${tagCls}"${tagStyle}>${esc(s || "未排班")}</span>
          </div>
        </div>`;
    }).join("");

    root.innerHTML = `
      <section class="wc-card">
        <div class="hd">
          <div><h2>本月班表</h2><p>${esc(mk)}　個人班別（由後台編排）</p></div>
        </div>
        <div class="wc-list">${rows}</div>
      </section>
    `;
  }

  function subscribeScheduleTab(root, ctx, st, rerender) {
    subscribeDutySettings(ctx.communityId, (d) => { st.duty = mergedDuty(d); rerender(); });
    if (!ctx.communityId) { st.schedule = {}; return; }
    const mk = monthKeyOf(new Date());
    track(schedulesCol(ctx.communityId).where("month", "==", mk).onSnapshot((snap) => {
      const map = {};
      snap.forEach((d) => {
        const x = d.data() || {};
        const shifts = x.shifts || {};
        const s = shifts[ctx.uid];
        if (s) map[String(x.dateKey || d.id)] = String(s);
      });
      st.schedule = map;
      rerender();
    }, (err) => { console.warn("duty schedule month listen failed", err); st.schedule = {}; rerender(); }));
  }

  /* ==================================================================== */
  /* 請假／補卡                                                            */
  /* ==================================================================== */
  function readForm(root, st) {
    st.draft = st.draft || {};
    const ids = ["wdLeaveDate", "wdLeaveType", "wdLeaveReason", "wdMakeupDate", "wdMakeupType", "wdMakeupTime", "wdMakeupReason"];
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
    const reason = String(draft.wdLeaveReason || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) { toast("請選擇請假日期", true); return; }
    if (!leaveType) { toast("請選擇假別", true); return; }
    if (!ctx.communityId || !ctx.uid) { toast("缺少社區或登入資訊", true); return; }
    if (btn) { btn.disabled = true; btn.textContent = "送出中…"; }
    try {
      await requestsCol(ctx.communityId).add({
        type: "leave",
        uid: ctx.uid,
        name: ctx.userName || "",
        category: ctx.category || "",
        dateKey,
        leaveType,
        reason,
        createdAt: serverTs(),
        createdBy: ctx.uid,
        communityId: ctx.communityId,
      });
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
  /* 設定                                                                  */
  /* ==================================================================== */
  function renderSettingTab(root, ctx, st) {
    const duty = st.duty || DEFAULT_DUTY;
    const cat = String((ctx && ctx.category) || "").trim();
    const roleList = (duty.roleShifts && duty.roleShifts[cat]) || [];
    const shifts = roleList.length
      ? roleList.map((x) => ({ name: String(x.name || ""), start: String(x.start || ""), end: String(x.end || "") }))
      : (Array.isArray(duty.shifts) ? duty.shifts : DEFAULT_DUTY.shifts).filter((n) => String(n) !== "休假").map((n) => ({ name: String(n), start: "", end: "" }));
    root.innerHTML = `
      <section class="wc-card">
        <div class="hd"><div><h2>個人資訊</h2><p>帳號與權限</p></div></div>
        <div class="wc-info">
          <div class="r"><span class="k">姓名</span><span class="v">${esc(ctx.userName || "—")}</span></div>
          <div class="r"><span class="k">角色</span><span class="v">${esc(ctx.category || "—")}</span></div>
          <div class="r"><span class="k">社區</span><span class="v">${esc(ctx.communityName || ctx.communityId || "—")}</span></div>
        </div>
      </section>

      <section class="wc-card">
        <div class="hd"><div><h2>班別時間</h2><p>${esc(cat || "我的角色")}　由社區管理員設定</p></div></div>
        <div class="wc-info">
          ${shifts.length
            ? shifts.map((s) => `<div class="r"><span class="k">${esc(s.name)}</span><span class="v">${s.start && s.end ? esc(s.start) + " ~ " + esc(s.end) : "—"}</span></div>`).join("")
            : `<div class="r"><span class="k">班別</span><span class="v">尚未設定</span></div>`}
        </div>
        ${duty.note ? `<div class="note" style="margin-top:10px;">${esc(duty.note)}</div>` : ""}
      </section>

      <section class="wc-card">
        <button class="wc-btn primary" type="button" id="wdSignOut">登出</button>
      </section>
    `;
    const out = root.querySelector("#wdSignOut");
    if (out) out.onclick = () => {
      out.disabled = true;
      out.textContent = "登出中…";
      auth.signOut().then(() => { location.href = "index.html"; }).catch(() => { out.disabled = false; out.textContent = "登出"; });
    };
  }

  function subscribeSettingTab(root, ctx, st, rerender) {
    subscribeDutySettings(ctx.communityId, (d) => { st.duty = mergedDuty(d); rerender(); });
  }

  /* ==================================================================== */
  /* exports                                                              */
  /* ==================================================================== */
  const tabs = {
    punch: makeTab({ render: renderPunchTab, subscribe: subscribePunchTab }),
    schedule: makeTab({ render: renderScheduleTab, subscribe: subscribeScheduleTab }),
    leave: makeTab({ render: renderLeaveTab, subscribe: subscribeLeaveTab }),
    setting: makeTab({ render: renderSettingTab, subscribe: subscribeSettingTab }),
  };

  window.NwWorkerDuty = {
    tabs,
    teardown,
    bindCommunitySwitch,
    utils: { esc, pad2, dateKey: dateKeyOf, todayKey, monthKeyOf, monthRange, daysInMonth, weekdayZh, fmtDateKey, fmtTime, fmtDateTime, msOf },
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
.nw-switch-loading{padding:20px 4px;text-align:center;font-size:13px;font-weight:800;color:#6b7280;}`;
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
      const cid = activeCommunityId();
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
