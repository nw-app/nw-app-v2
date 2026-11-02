(function () {
  "use strict";

  /* ============================ utils ============================ */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function tsToDate(ts) {
    if (!ts) return null;
    let d = null;
    if (ts.toDate) d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else d = new Date(ts);
    if (!d || isNaN(d.getTime())) return null;
    return d;
  }
  function fmtDateTime(ts) {
    const d = tsToDate(ts);
    if (!d) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function fmtTime(ts) {
    const d = tsToDate(ts);
    if (!d) return "";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function keyOfDate(d) {
    if (!d || isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function todayKey() { return keyOfDate(new Date()); }
  function shiftDateKey(key, delta) {
    const parts = String(key || "").split("-").map((x) => Number(x));
    const d = (parts.length === 3 && parts.every((n) => Number.isFinite(n)))
      ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date();
    d.setDate(d.getDate() + Number(delta || 0));
    return keyOfDate(d);
  }
  function weekdayZh(key) {
    const parts = String(key || "").split("-").map((x) => Number(x));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "";
    return ["日", "一", "二", "三", "四", "五", "六"][new Date(parts[0], parts[1] - 1, parts[2]).getDay()] || "";
  }
  function weekdayNum(key) {
    const parts = String(key || "").split("-").map((x) => Number(x));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return -1;
    return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
  }
  function fmtDateKey(key) {
    const w = weekdayZh(key);
    return w ? `${key}（${w}）` : String(key || "");
  }
  function monthKeyOf(dateKey) { return String(dateKey || "").slice(0, 7); }
  /* 取該日期所屬週的週日（一週的起始日） */
  function startOfWeekKey(key) {
    const parts = String(key || "").split("-").map((x) => Number(x));
    const d = (parts.length === 3 && parts.every((n) => Number.isFinite(n)))
      ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date();
    d.setDate(d.getDate() - d.getDay());
    return keyOfDate(d);
  }
  /* 取得該週七日（週日～週六）的日期鍵 */
  function weekDaysKeys(weekStartKey) {
    const base = startOfWeekKey(weekStartKey);
    if (!base) return [];
    return Array.from({ length: 7 }, (_, i) => shiftDateKey(base, i));
  }
  function weekLabel(weekStartKey) {
    const end = shiftDateKey(weekStartKey, 6);
    const a = String(weekStartKey || "").slice(5).replace(/-/g, "/");
    const b = String(end || "").slice(5).replace(/-/g, "/");
    return `${a}（${weekdayZh(weekStartKey)}）～ ${b}（${weekdayZh(end)}）`;
  }
  function tsFromDateHM(dateKey, hm) {
    const dParts = String(dateKey || "").split("-").map((x) => Number(x));
    const tParts = String(hm || "").split(":").map((x) => Number(x));
    if (dParts.length !== 3 || dParts.some((n) => !Number.isFinite(n))) return null;
    const dt = new Date(dParts[0], dParts[1] - 1, dParts[2], tParts[0] || 0, tParts[1] || 0, 0, 0);
    if (isNaN(dt.getTime())) return null;
    return dt;
  }
  function fbErr(e, fallback) {
    const code = String((e && e.code) || "");
    const msg = String((e && e.message) || "");
    const all = `${code} ${msg}`;
    if (all.indexOf("permission-denied") >= 0 || all.indexOf("insufficient permissions") >= 0) {
      return "沒有權限儲存：請確認已部署最新的 Firestore 資料庫規則";
    }
    if (all.indexOf("unavailable") >= 0 || all.indexOf("offline") >= 0 || all.indexOf("network") >= 0) {
      return "目前無法連線，請確認網路後再試";
    }
    return `${fallback || "操作失敗"}：${msg || code || "未知錯誤"}`;
  }

  function openSimpleModal({ title, bodyHtml, footerHtml, width }) {
    const backdrop = document.createElement("div");
    backdrop.className = "mr-modal-backdrop";
    backdrop.innerHTML = `
      <div class="mr-modal" role="dialog" aria-modal="true">
        <div class="mr-modal-hd">
          <div class="title">${esc(title || "")}</div>
          <button class="mr-modal-close" type="button" aria-label="關閉">×</button>
        </div>
        <div class="mr-modal-bd">${bodyHtml || ""}</div>
        <div class="mr-modal-ft">${footerHtml || ""}</div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const modal = backdrop.querySelector(".mr-modal");
    if (width) modal.style.width = width;
    modal.style.maxHeight = "88vh";
    modal.style.display = "grid";
    modal.style.gridTemplateRows = "auto 1fr auto";
    const bd = modal.querySelector(".mr-modal-bd");
    if (bd) { bd.style.overflowY = "auto"; bd.style.overflowX = "hidden"; }
    const close = () => { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); };
    backdrop.querySelector(".mr-modal-close").onclick = close;
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    return { el: backdrop, modal, close };
  }

  function toast(msg, isErr) {
    if (!msg) return;
    const tEl = document.getElementById("toast");
    if (!tEl) { alert(msg); return; }
    tEl.textContent = String(msg);
    tEl.classList.toggle("show", true);
    tEl.style.background = isErr ? "rgba(220,38,38,.95)" : "rgba(17,24,39,.92)";
    tEl.style.color = "#fff";
    tEl.style.zIndex = 999999;
    setTimeout(() => { tEl.classList.toggle("show", false); tEl.textContent = ""; }, 2200);
  }

  /* 產生列印視窗（同時可另存為 PDF） */
  function openPrintWindow({ title, subtitle, bodyHtml, auto }) {
    const w = window.open("", "_blank");
    if (!w) { toast("請允許彈出視窗以列印 / 匯出 PDF", true); return; }
    const css = `
      *{box-sizing:border-box;}
      body{font-family:"Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif;margin:20px;color:#111827;background:#fff;}
      h1{font-size:20px;margin:0 0 4px;}
      .sub{color:#6b7280;font-size:12px;margin-bottom:14px;}
      .toolbar{margin-bottom:16px;}
      .toolbar button{padding:8px 18px;border-radius:8px;border:1px solid #d32f2f;background:#d32f2f;color:#fff;font-weight:800;cursor:pointer;font-size:13px;}
      .dt{font-weight:900;margin:18px 0 6px;padding-bottom:4px;border-bottom:2px solid #d32f2f;font-size:14px;}
      .dt .n{color:#6b7280;font-weight:700;font-size:12px;margin-left:6px;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th,td{border:1px solid #d1d5db;padding:6px 8px;text-align:left;vertical-align:top;}
      th{background:#f3f4f6;font-weight:900;white-space:nowrap;}
      @media print{.toolbar{display:none;}}
    `;
    w.document.write(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/><title>${esc(title || "")}</title><style>${css}</style></head><body>
      <div class="toolbar"><button type="button" onclick="window.print()">列印 / 另存 PDF</button></div>
      <h1>${esc(title || "")}</h1>
      <div class="sub">${esc(subtitle || "")}</div>
      ${bodyHtml || ""}
      <script>${auto ? "window.onload=function(){setTimeout(function(){window.print();},300);};" : ""}<\/script>
    </body></html>`);
    w.document.close();
  }

  /* ============================ 常數 ============================ */
  const CATEGORY_ORDER = ["總幹事", "秘書", "清潔", "機電", "保全"];
  /* 各角色預設班別（名稱＋上下班時間）；請假屬「假別」，不列在班別中 */
  const DEFAULT_ROLE_SHIFTS = {
    "總幹事": [
      { name: "早班", start: "08:00", end: "17:00" },
      { name: "晚班", start: "13:00", end: "22:00" },
    ],
    "秘書": [
      { name: "早班", start: "08:00", end: "17:00" },
      { name: "晚班", start: "13:00", end: "22:00" },
    ],
    "清潔": [
      { name: "早班", start: "07:00", end: "16:00" },
      { name: "晚班", start: "12:00", end: "21:00" },
    ],
    "機電": [
      { name: "早班", start: "08:00", end: "17:00" },
      { name: "晚班", start: "13:00", end: "22:00" },
    ],
    "保全": [
      { name: "日班", start: "07:00", end: "19:00" },
      { name: "夜班", start: "19:00", end: "07:00" },
    ],
  };
  const DEFAULT_SHIFT_NAMES = ["早班", "晚班"];
  const DEFAULT_SETTINGS = {
    workStart: "08:00",
    workEnd: "17:00",
    roleShifts: DEFAULT_ROLE_SHIFTS,
    leaveTypes: ["特休", "事假", "病假", "公假", "婚假", "喪假", "產假", "其他"],
    holidayTypes: ["例假", "休假"],
    note: "",
  };
  const TABS = [
    { key: "overview", label: "總覽" },
    { key: "schedule", label: "班表" },
    { key: "punch", label: "打卡" },
    { key: "settings", label: "設定" },
  ];

  /* 清理單一班別清單：名稱必填且去重，時間可留空 */
  function sanitizeShiftList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    const seen = new Set();
    list.forEach((x) => {
      if (x == null) return;
      const name = String(typeof x === "string" ? x : (x.name || "")).trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({
        name,
        start: String((x && x.start != null ? x.start : "") || "").trim(),
        end: String((x && x.end != null ? x.end : "") || "").trim(),
      });
    });
    return out;
  }
  function defaultRoleShifts() {
    const out = {};
    CATEGORY_ORDER.forEach((cat) => { out[cat] = DEFAULT_ROLE_SHIFTS[cat].map((x) => Object.assign({}, x)); });
    return out;
  }
  /* 正規化各角色班別；若無新資料則以舊版班別清單（無時間）代入，再退回預設 */
  function normalizeRoleShifts(v, legacyShifts) {
    const src = v && typeof v === "object" ? v : null;
    /* 舊版「休假」屬班別，現由假別清單取代，故不再帶入 */
    const fallbackNames = Array.isArray(legacyShifts) ? legacyShifts.filter((x) => x && x !== "休假") : [];
    const out = {};
    CATEGORY_ORDER.forEach((cat) => {
      const list = src ? sanitizeShiftList(src[cat]) : [];
      if (list.length) { out[cat] = list; return; }
      const fb = defaultRoleShifts()[cat];
      if (fallbackNames.length) {
        const mapped = sanitizeShiftList(fallbackNames.map((n) => ({ name: n, start: "", end: "" })));
        if (mapped.length) { out[cat] = mapped; return; }
      }
      out[cat] = fb;
    });
    return out;
  }
  function unionShiftNames(roleShifts) {
    const names = [];
    CATEGORY_ORDER.forEach((cat) => {
      (roleShifts[cat] || []).forEach((s) => { if (s && s.name && names.indexOf(s.name) < 0) names.push(s.name); });
    });
    return names;
  }
  function normalizeSettings(v) {
    const d = DEFAULT_SETTINGS;
    const legacyShifts = Array.isArray(v && v.shifts) && v.shifts.length ? v.shifts.map((x) => String(x)).filter(Boolean) : null;
    const roleShifts = normalizeRoleShifts(v && v.roleShifts, legacyShifts);
    const union = unionShiftNames(roleShifts);
    const leaveTypes = Array.isArray(v && v.leaveTypes) && v.leaveTypes.length ? v.leaveTypes.map((x) => String(x)).filter(Boolean) : d.leaveTypes.slice();
    const holidayTypes = Array.isArray(v && v.holidayTypes) && v.holidayTypes.length ? v.holidayTypes.map((x) => String(x)).filter(Boolean) : d.holidayTypes.slice();
    return {
      workStart: String((v && v.workStart) || d.workStart),
      workEnd: String((v && v.workEnd) || d.workEnd),
      roleShifts,
      shifts: union.length ? union : DEFAULT_SHIFT_NAMES.slice(),
      leaveTypes,
      holidayTypes,
      note: String((v && v.note) || ""),
    };
  }

  /* ============================ 樣式（僅注入一次） ============================ */
  function ensureStyles() {
    if (document.getElementById("nwDutyStyles")) return;
    const st = document.createElement("style");
    st.id = "nwDutyStyles";
    st.textContent = `
      .duty-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}
      .duty-metric{padding:14px 16px;border-radius:16px;background:#fff;border:1px solid rgba(17,24,39,.10);box-shadow:0 8px 22px rgba(17,24,39,.06);display:grid;gap:4px;}
      .duty-metric .k{font-size:calc(12px * var(--fs,1));color:#6b7280;font-weight:800;}
      .duty-metric .v{font-size:calc(26px * var(--fs,1));font-weight:900;line-height:1.1;}
      .duty-metric .u{font-size:calc(12px * var(--fs,1));color:#6b7280;font-weight:700;margin-left:4px;}
      .duty-metric.red .v{color:#c62828;}
      .duty-metric.amber .v{color:#b7791f;}
      .duty-metric.green .v{color:#1b7f3a;}
      .duty-metric.blue .v{color:#1d4ed8;}
      .duty-tag{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:calc(11px * var(--fs,1));font-weight:800;border:1px solid transparent;white-space:nowrap;}
      .duty-tag.working{background:rgba(37,99,235,.10);color:#1d4ed8;border-color:rgba(37,99,235,.24);}
      .duty-tag.ok{background:rgba(22,163,74,.10);color:#1b7f3a;border-color:rgba(22,163,74,.24);}
      .duty-tag.miss{background:rgba(211,47,47,.10);color:#b71c1c;border-color:rgba(211,47,47,.24);}
      .duty-tag.leave{background:rgba(245,158,11,.12);color:#b7791f;border-color:rgba(245,158,11,.30);}
      .duty-tag.holiday{background:rgba(14,116,144,.12);color:#0e7490;border-color:rgba(14,116,144,.28);}
      .duty-group{padding:12px;border-radius:18px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);display:grid;gap:8px;}
      .duty-group-hd{font-weight:900;font-size:calc(13px * var(--fs,1));display:flex;align-items:center;gap:8px;}
      .duty-group-hd .n{color:#6b7280;font-weight:700;font-size:calc(11px * var(--fs,1));}
      .duty-rs-row{display:grid;grid-template-columns:1.3fr 1fr 1fr auto;gap:8px;align-items:center;padding:8px 10px;border-radius:12px;background:#fff;border:1px solid rgba(17,24,39,.10);}
      .duty-rs-row input{padding:9px 10px;border-radius:10px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;font-size:calc(13px * var(--fs,1));}
      @media (max-width:560px){.duty-rs-row{grid-template-columns:1fr 1fr;grid-auto-rows:auto;} .duty-rs-row input[data-rsname]{grid-column:1 / -1;} .duty-rs-row [data-rsdel]{grid-column:1 / -1;}}
      .duty-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:10px 12px;border-radius:14px;background:#fff;border:1px solid rgba(17,24,39,.10);}
      .duty-row .nm{font-weight:900;font-size:calc(14px * var(--fs,1));}
      .duty-row .sub{color:#6b7280;font-weight:700;font-size:calc(11px * var(--fs,1));}
      .duty-scroll{overflow-x:auto;border-radius:14px;border:1px solid rgba(17,24,39,.10);background:#fff;}
      .duty-tbl{border-collapse:separate;border-spacing:0;font-size:calc(12px * var(--fs,1));min-width:100%;}
      .duty-tbl th,.duty-tbl td{border-right:1px solid rgba(17,24,39,.10);border-bottom:1px solid rgba(17,24,39,.10);padding:5px 6px;text-align:center;white-space:nowrap;}
      .duty-tbl th{background:#f3f4f6;font-weight:900;position:sticky;top:0;}
      .duty-tbl th .dw{display:block;font-size:calc(10px * var(--fs,1));font-weight:700;color:#9ca3af;}
      .duty-tbl th.wk .dw,.duty-tbl th.wk{color:#c62828;}
      .duty-tbl td.wk{background:rgba(211,47,47,.05);}
      .duty-tbl .sticky{position:sticky;left:0;z-index:2;background:#fff;text-align:left;min-width:132px;}
      .duty-tbl thead .sticky{z-index:4;background:#f3f4f6;}
      .duty-tbl td.sticky .nm{font-weight:900;display:block;}
      .duty-tbl td.sticky .sub{color:#6b7280;font-size:calc(10px * var(--fs,1));font-weight:700;}
      .duty-tbl td.sticky .duty-stat-btn{margin-top:5px;margin-left:auto;display:block;width:fit-content;padding:2px 8px;font-size:calc(10px * var(--fs,1));line-height:1.5;}
      .duty-tbl select{padding:4px 6px;border-radius:8px;border:1px solid rgba(17,24,39,.14);font-weight:800;font-family:inherit;font-size:calc(11px * var(--fs,1));background:#fff;}
      .duty-cell-empty{color:#9ca3af;}
    `;
    document.head.appendChild(st);
  }

  /* ============================ 主體 ============================ */
  window.NwAdminDuty = {
    UI: {
      renderDutyPage(container, ctx) {
        if (!container) return;
        ensureStyles();
        const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
        const db = fb && fb.firestore ? fb.firestore() : null;
        const cid = String((ctx && ctx.communityId) || "").trim();
        if (typeof window.__nwDutyCleanup === "function") {
          try { window.__nwDutyCleanup(); } catch {}
        }
        if (!db) {
          container.innerHTML = `<section class="card"><div class="card-bd"><div class="tag red">Firestore 未初始化</div></div></section>`;
          return;
        }
        if (!cid) {
          container.innerHTML = `<section class="card"><div class="card-bd"><div class="tag yellow">請先選擇社區</div></div></section>`;
          return;
        }

        const state = {
          tab: "overview",
          staff: [],
          schedules: [],
          settings: normalizeSettings(null),
          todaySchedule: {},
          loading: true,
          scheduleWeekStart: startOfWeekKey(todayKey()),
          punchDate: todayKey(),
        };
        const dayData = new Map();   // dateKey -> { checkins: [], requests: [] }
        const daySubs = new Map();   // dateKey -> { unsubCheckins, unsubRequests }
        let scheduleSubs = [];
        let scheduleMonthKeys = [];
        let unsubTodaySched = null;
        let unsubSettings = null;
        let myName = "";

        window.__nwDutyCleanup = () => {
          Array.from(daySubs.values()).forEach((e) => {
            try { e.unsubCheckins && e.unsubCheckins(); } catch {}
            try { e.unsubRequests && e.unsubRequests(); } catch {}
          });
          daySubs.clear();
          dayData.clear();
          scheduleSubs.forEach((fn) => { try { fn(); } catch {} });
          scheduleSubs = [];
          scheduleMonthKeys = [];
          try { unsubTodaySched && unsubTodaySched(); } catch {}
          try { unsubSettings && unsubSettings(); } catch {}
          unsubTodaySched = unsubSettings = null;
          const subnav = document.getElementById("subnav");
          if (subnav) subnav.innerHTML = "";
          window.__nwDutyCleanup = null;
        };

        const refCheckins = () => db.collection("communities").doc(cid).collection("duty_checkins");
        const refSchedules = () => db.collection("communities").doc(cid).collection("duty_schedules");
        const refRequests = () => db.collection("communities").doc(cid).collection("duty_requests");
        const refSettings = () => db.collection("communities").doc(cid).collection("settings");
        const serverTs = () => (fb.firestore.FieldValue.serverTimestamp ? fb.firestore.FieldValue.serverTimestamp() : new Date());
        const delField = () => (fb.firestore.FieldValue.delete ? fb.firestore.FieldValue.delete() : undefined);
        const tsOrDefault = (dt) => (fb.firestore.Timestamp && fb.firestore.Timestamp.fromDate ? fb.firestore.Timestamp.fromDate(dt) : dt);

        /* ---------- 人員名單 ---------- */
        function isDutyStaff(v) {
          const cat = String((v && v.category) || "").trim();
          const role = String((v && v.role) || "").trim();
          if (role === "住戶" || role === "resident" || role === "停用") return false;
          return CATEGORY_ORDER.includes(cat);
        }
        function pickStaff(d) {
          const v = d.data() || {};
          const name = String(v.displayName || v.name || v.fullName || v.username || v.email || "").trim() || "未命名";
          return {
            id: d.id,
            name,
            category: String(v.category || "").trim(),
            title: String(v.title || v.subCategory || "").trim(),
          };
        }
        async function loadStaff() {
          let list = [];
          try {
            const snap = await db.collection("users").where("communityIds", "array-contains", cid).get();
            snap.forEach((d) => { if (isDutyStaff(d.data() || {})) list.push(pickStaff(d)); });
          } catch (e) {
            console.warn("load duty staff failed", e);
          }
          if (!list.length) {
            try {
              const snap = await db.collection("users").where("role", "==", "工作").get();
              snap.forEach((d) => { if (isDutyStaff(d.data() || {})) list.push(pickStaff(d)); });
            } catch (e) { /* ignore */ }
          }
          list.sort((a, b) => (CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
            || String(a.name).localeCompare(String(b.name), "zh-Hant-TW"));
          state.staff = list;
          render();
        }
        async function loadMyName() {
          try {
            const u = fb.auth && fb.auth().currentUser;
            if (!u) return;
            const snap = await db.collection("users").doc(String(u.uid)).get();
            const d = snap && snap.exists ? (snap.data() || {}) : {};
            myName = String(d.displayName || d.name || u.displayName || u.email || "").trim();
          } catch (e) { /* ignore */ }
        }

        function groupedStaff() {
          const map = new Map();
          CATEGORY_ORDER.forEach((c) => map.set(c, []));
          state.staff.forEach((s) => {
            if (!map.has(s.category)) map.set(s.category, []);
            map.get(s.category).push(s);
          });
          return CATEGORY_ORDER.map((c) => ({ category: c, list: map.get(c) || [] }));
        }

        /* ---------- 訂閱 ---------- */
        function wantDates() {
          const set = new Set([todayKey()]);
          if (state.tab === "punch" && state.punchDate) set.add(state.punchDate);
          return Array.from(set);
        }
        function syncDaySubs() {
          const wanted = wantDates();
          Array.from(daySubs.keys()).forEach((k) => {
            if (wanted.indexOf(k) >= 0) return;
            const e = daySubs.get(k);
            try { e.unsubCheckins && e.unsubCheckins(); } catch {}
            try { e.unsubRequests && e.unsubRequests(); } catch {}
            daySubs.delete(k);
            dayData.delete(k);
          });
          wanted.forEach((k) => {
            if (daySubs.has(k)) return;
            const entry = { unsubCheckins: null, unsubRequests: null };
            daySubs.set(k, entry);
            dayData.set(k, { checkins: [], requests: [] });
            entry.unsubCheckins = refCheckins().where("workDate", "==", k).onSnapshot((snap) => {
              const list = [];
              snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
              const cur = dayData.get(k);
              if (cur) cur.checkins = list;
              render();
            }, (err) => {
              console.warn("duty checkins listen failed", err);
              const cur = dayData.get(k);
              if (cur) cur.checkins = [];
              render();
            });
            entry.unsubRequests = refRequests().where("dateKey", "==", k).onSnapshot((snap) => {
              const list = [];
              snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
              const cur = dayData.get(k);
              if (cur) cur.requests = list;
              render();
            }, (err) => {
              console.warn("duty requests listen failed", err);
              const cur = dayData.get(k);
              if (cur) cur.requests = [];
              render();
            });
          });
        }
        function watchScheduleWeeks(weekStartKey) {
          const days = weekDaysKeys(weekStartKey);
          const months = Array.from(new Set(days.map((k) => monthKeyOf(k)))).sort();
          if (scheduleSubs.length && scheduleMonthKeys.join(",") === months.join(",")) return;
          scheduleSubs.forEach((fn) => { try { fn(); } catch {} });
          scheduleSubs = [];
          scheduleMonthKeys = months;
          const acc = new Map();
          const emit = () => {
            state.schedules = Array.from(acc.values());
            if (state.tab === "schedule") render();
          };
          months.forEach((mk) => {
            const unsub = refSchedules().where("month", "==", String(mk)).onSnapshot((snap) => {
              Array.from(acc.keys()).forEach((id) => {
                if (String((acc.get(id) || {}).month || "") === String(mk)) acc.delete(id);
              });
              snap.forEach((d) => acc.set(d.id, Object.assign({ id: d.id }, d.data())));
              emit();
            }, (err) => {
              console.warn("duty schedules listen failed", err);
              emit();
            });
            scheduleSubs.push(unsub);
          });
        }
        function subscribe() {
          state.loading = true;
          render();
          try { unsubTodaySched && unsubTodaySched(); } catch {}
          unsubTodaySched = refSchedules().doc(todayKey()).onSnapshot((snap) => {
            state.todaySchedule = (snap && snap.exists ? (snap.data() || {}).shifts : null) || {};
            render();
          }, (err) => {
            console.warn("duty today schedule listen failed", err);
            state.todaySchedule = {};
          });
          try { unsubSettings && unsubSettings(); } catch {}
          unsubSettings = refSettings().doc("duty").onSnapshot((snap) => {
            state.settings = normalizeSettings(snap && snap.exists ? (snap.data() || {}) : null);
            state.loading = false;
            render();
          }, (err) => {
            console.warn("duty settings listen failed", err);
            state.settings = normalizeSettings(null);
            state.loading = false;
            render();
          });
          watchScheduleWeeks(state.scheduleWeekStart);
          syncDaySubs();
        }

        /* ---------- 取值 ---------- */
        const checkinsFor = (dateKey) => (dayData.get(dateKey) || { checkins: [] }).checkins;
        const requestsFor = (dateKey) => (dayData.get(dateKey) || { requests: [] }).requests;
        function checkinMapFor(dateKey) {
          const map = new Map();
          checkinsFor(dateKey).forEach((c) => map.set(String(c.uid || ""), c));
          return map;
        }
        function leaveUidsFor(dateKey) {
          const set = new Set();
          requestsFor(dateKey).forEach((r) => {
            if (String(r.type || "") === "leave") set.add(String(r.uid || ""));
          });
          return set;
        }
        function punchStatus(uid, dateKey) {
          if (leaveUidsFor(dateKey).has(String(uid))) return { key: "leave", label: "請假", tone: "leave" };
          const c = checkinMapFor(dateKey).get(String(uid));
          if (c && c.inAt && c.outAt) return { key: "out", label: "已下班", tone: "ok" };
          if (c && c.inAt) return { key: "in", label: "上班中", tone: "working" };
          return { key: "none", label: "未打卡", tone: "miss" };
        }
        function schedulesByDate() {
          const map = new Map();
          state.schedules.forEach((s) => {
            const k = String(s.dateKey || s.id || "");
            if (k) map.set(k, s.shifts || {});
          });
          return map;
        }

        /* ================= 總覽 ================= */
        function metric(label, value, unit, tone) {
          return `<div class="duty-metric ${tone || ""}"><div class="k">${esc(label)}</div><div class="v">${esc(value)}${unit ? `<span class="u">${esc(unit)}</span>` : ""}</div></div>`;
        }

        function overviewView() {
          const today = todayKey();
          const shifts = state.todaySchedule || {};
          const leaveSet = new Set((state.settings.leaveTypes || []).map((x) => String(x)));
          const holidaySet = new Set((state.settings.holidayTypes || []).map((x) => String(x)));
          const scheduledWorkers = state.staff.filter((s) => {
            const v = String(shifts[s.id] || "").trim();
            return v && v !== "休假" && !leaveSet.has(v) && !holidaySet.has(v);
          });
          const assignedCount = state.staff.filter((s) => String(shifts[s.id] || "").trim()).length;
          const cmap = checkinMapFor(today);
          const inCount = state.staff.filter((s) => { const c = cmap.get(String(s.id)); return c && c.inAt; }).length;
          const workingCount = state.staff.filter((s) => { const c = cmap.get(String(s.id)); return c && c.inAt && !c.outAt; }).length;
          const outCount = state.staff.filter((s) => { const c = cmap.get(String(s.id)); return c && c.inAt && c.outAt; }).length;
          const leaveCount = requestsFor(today).filter((r) => String(r.type || "") === "leave").length;
          const makeupCount = requestsFor(today).filter((r) => String(r.type || "") === "makeup").length;
          const notPunched = scheduledWorkers.filter((s) => {
            const st = punchStatus(s.id, today);
            return st.key === "none";
          }).length;
          const rate = state.staff.length ? Math.round((assignedCount / state.staff.length) * 100) : 0;

          const groups = groupedStaff();
          const groupHtml = groups.map((g) => `
            <section class="duty-group">
              <div class="duty-group-hd">${esc(g.category)}<span class="n">${g.list.length} 人</span></div>
              ${g.list.length === 0 ? `<div class="muted" style="padding:6px 2px;">（尚無人員）</div>`
                : `<div style="display:grid;gap:8px;">${g.list.map((s) => {
                    const shift = String(shifts[s.id] || "").trim();
                    const isLeave = Boolean(shift) && leaveSet.has(shift);
                    const isHoliday = Boolean(shift) && holidaySet.has(shift);
                    const st = punchStatus(s.id, today);
                    return `<div class="duty-row">
                      <div style="min-width:0;">
                        <div class="nm">${esc(s.name)}</div>
                        <div class="sub">${esc(s.title || s.category)}</div>
                      </div>
                      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                        <span class="duty-tag ${shift ? (isLeave ? "leave" : (isHoliday ? "holiday" : "")) : "miss"}" style="${shift && !isLeave && !isHoliday ? "background:rgba(107,114,128,.10);color:#4b5563;border-color:rgba(107,114,128,.22);" : ""}">${esc(shift || "未排班")}</span>
                        <span class="duty-tag ${st.tone}">${esc(st.label)}</span>
                      </div>
                    </div>`;
                  }).join("")}</div>`}
            </section>`).join("");

          return `
            <div class="duty-metrics">
              ${metric("今日應上班人數", scheduledWorkers.length, "人", "blue")}
              ${metric("已上班", inCount, "人", "green")}
              ${metric("上班中", workingCount, "人", "blue")}
              ${metric("已下班", outCount, "人", "green")}
              ${metric("未打卡", notPunched, "人", notPunched ? "red" : "green")}
              ${metric("今日請假", leaveCount, "筆", "amber")}
              ${metric("今日補卡", makeupCount, "筆", "amber")}
              ${metric("今日排班完成率", rate, "%", rate >= 100 ? "green" : (rate > 0 ? "amber" : "red"))}
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div style="font-weight:900;font-size:calc(14px * var(--fs,1));">目前當日值班狀況　<span style="color:#6b7280;font-weight:700;font-size:calc(12px * var(--fs,1));">${esc(fmtDateKey(today))}</span></div>
            </div>

            ${state.staff.length === 0 && !state.loading
              ? `<div class="muted" style="padding:24px;text-align:center;">尚無勤務人員，請先至「管理帳號」新增類別為 總幹事／秘書／清潔／機電／保全 的人員。</div>`
              : `<div style="display:grid;gap:12px;">${groupHtml}</div>`}
          `;
        }

        /* ================= 班表 ================= */
        function scheduleView() {
          const weekStart = state.scheduleWeekStart;
          const days = weekDaysKeys(weekStart);
          if (!days.length) return `<div class="muted">週資料錯誤。</div>`;
          const shiftsMap = schedulesByDate();
          const shiftOpts = state.settings.shifts;
          const roleNames = (cat) => ((state.settings.roleShifts || {})[cat] || []).map((x) => x.name).filter(Boolean);
          const today = todayKey();

          const head = days.map((dk) => {
            const wd = weekdayNum(dk);
            const isWk = wd === 0 || wd === 6;
            const isToday = dk === today;
            return `<th class="${isWk ? "wk" : ""}">${esc(dk.slice(5))}<span class="dw">週${esc(weekdayZh(dk))}${isToday ? "・今天" : ""}</span></th>`;
          }).join("");

          const body = state.staff.map((s) => {
            const cells = days.map((dk) => {
              const wd = weekdayNum(dk);
              const isWk = wd === 0 || wd === 6;
              const cur = String((shiftsMap.get(dk) || {})[s.id] || "");
              const names = roleNames(s.category);
              const workList = names.length ? names.slice() : shiftOpts.slice();
              const leaveList = state.settings.leaveTypes.slice();
              const holidayList = state.settings.holidayTypes.slice();
              if (cur && workList.indexOf(cur) < 0 && leaveList.indexOf(cur) < 0 && holidayList.indexOf(cur) < 0) workList.unshift(cur);
              const opt = (o) => `<option value="${esc(o)}"${o === cur ? " selected" : ""}>${esc(o)}</option>`;
              const opts = `<option value="">（未排）</option>`
                + `<optgroup label="班別">${workList.map(opt).join("")}</optgroup>`
                + (holidayList.length ? `<optgroup label="假日">${holidayList.map(opt).join("")}</optgroup>` : "")
                + (leaveList.length ? `<optgroup label="請假">${leaveList.map(opt).join("")}</optgroup>` : "");
              return `<td class="${isWk ? "wk" : ""}"><select data-duty-shift="${esc(dk)}" data-duty-uid="${esc(s.id)}">${opts}</select></td>`;
            }).join("");
            return `<tr>
              <td class="sticky">
                <span class="nm">${esc(s.name)}</span>
                <span class="sub">${esc(s.category)}${s.title ? "・" + esc(s.title) : ""}</span>
                <button class="btn btn-sm btn-ghost duty-stat-btn" type="button" data-duty-stat="${esc(s.id)}">月統計</button>
              </td>
              ${cells}
            </tr>`;
          }).join("");

          const isThisWeek = weekStart === startOfWeekKey(today);

          return `
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" type="button" id="dutyPrevWeek">‹ 上一週</button>
                <div style="font-weight:900;font-size:calc(15px * var(--fs,1));min-width:190px;text-align:center;">${esc(weekLabel(weekStart))}</div>
                <button class="btn btn-sm btn-ghost" type="button" id="dutyNextWeek">下一週 ›</button>
                ${!isThisWeek ? `<button class="btn btn-sm btn-ghost" type="button" id="dutyThisWeek">本週</button>` : ""}
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <select id="dutyFillShift" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(17,24,39,.14);font-weight:800;font-family:inherit;">
                  ${shiftOpts.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
                </select>
                <button class="btn btn-sm btn-primary" type="button" id="dutyFillBtn">帶入本週</button>
              </div>
            </div>
            <div class="muted">於下方表格直接選擇班別即時儲存；選「（未排）」可清除該日班別。「帶入本週」會將本週（週日～週六）尚未排定的欄位填入所選班別。</div>
            ${state.staff.length === 0
              ? `<div class="muted" style="padding:24px;text-align:center;">尚無勤務人員，請先至「管理帳號」新增人員。</div>`
              : `<div class="duty-scroll">
                  <table class="duty-tbl">
                    <thead><tr><th class="sticky">人員</th>${head}</tr></thead>
                    <tbody>${body}</tbody>
                  </table>
                </div>`}
            <div class="muted">今日：${esc(fmtDateKey(today))}　·　目前顯示 ${esc(weekLabel(weekStart))}（週日～週六），共 ${state.staff.length} 人 × 7 天。</div>
          `;
        }

        /* ================= 打卡 ================= */
        function punchView() {
          const dk = state.punchDate;
          const groups = groupedStaff();
          const cmap = checkinMapFor(dk);
          const reqs = requestsFor(dk);
          const leaves = reqs.filter((r) => String(r.type || "") === "leave");
          const makeups = reqs.filter((r) => String(r.type || "") === "makeup");

          const groupHtml = groups.map((g) => `
            <section class="duty-group">
              <div class="duty-group-hd">${esc(g.category)}<span class="n">${g.list.length} 人</span></div>
              ${g.list.length === 0 ? `<div class="muted" style="padding:6px 2px;">（尚無人員）</div>`
                : `<div style="display:grid;gap:8px;">${g.list.map((s) => {
                    const c = cmap.get(String(s.id));
                    const st = punchStatus(s.id, dk);
                    return `<div class="duty-row" style="grid-template-columns:1fr auto auto;">
                      <div style="min-width:0;">
                        <div class="nm">${esc(s.name)}</div>
                        <div class="sub">${esc(s.category)}${s.title ? "・" + esc(s.title) : ""}</div>
                      </div>
                      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                        <span class="duty-tag ok">上班 ${esc(c && c.inAt ? fmtTime(c.inAt) : "—")}</span>
                        <span class="duty-tag ok">下班 ${esc(c && c.outAt ? fmtTime(c.outAt) : "—")}</span>
                        <span class="duty-tag ${st.tone}">${esc(st.label)}</span>
                      </div>
                      <button class="btn btn-sm btn-ghost" type="button" data-duty-makeup="${esc(s.id)}">補登</button>
                    </div>`;
                  }).join("")}</div>`}
            </section>`).join("");

          return `
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" type="button" id="dutyPrevDay">‹ 前一日</button>
                <input id="dutyPunchDate" type="date" value="${esc(dk)}" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(17,24,39,.14);font-weight:800;font-family:inherit;"/>
                <button class="btn btn-sm btn-ghost" type="button" id="dutyToday">今日</button>
                <button class="btn btn-sm btn-ghost" type="button" id="dutyNextDay">後一日 ›</button>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm" type="button" id="dutyPrintPunch">列印</button>
                <button class="btn btn-sm" type="button" id="dutyPdfPunch">匯出 PDF</button>
              </div>
            </div>

            <div class="duty-metrics">
              ${metric("人員", state.staff.length, "人", "blue")}
              ${metric("已上班", state.staff.filter((s) => { const c = cmap.get(String(s.id)); return c && c.inAt; }).length, "人", "green")}
              ${metric("上班中", state.staff.filter((s) => { const c = cmap.get(String(s.id)); return c && c.inAt && !c.outAt; }).length, "人")}
              ${metric("已下班", state.staff.filter((s) => { const c = cmap.get(String(s.id)); return c && c.inAt && c.outAt; }).length, "人", "green")}
              ${metric("請假", leaves.length, "筆", "amber")}
              ${metric("補卡", makeups.length, "筆", "amber")}
            </div>

            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div style="font-weight:900;font-size:calc(14px * var(--fs,1));">打卡狀況　<span style="color:#6b7280;font-weight:700;font-size:calc(12px * var(--fs,1));">${esc(fmtDateKey(dk))}</span></div>
            </div>
            ${state.staff.length === 0
              ? `<div class="muted" style="padding:24px;text-align:center;">尚無勤務人員，請先至「管理帳號」新增人員。</div>`
              : `<div style="display:grid;gap:12px;">${groupHtml}</div>`}

            <section class="duty-group">
              <div class="duty-group-hd">請假紀錄<span class="n">${leaves.length} 筆</span></div>
              ${leaves.length === 0 ? `<div class="muted" style="padding:6px 2px;">此日無人請假。</div>`
                : `<div style="display:grid;gap:8px;">${leaves.map((r) => `
                    <div class="duty-row">
                      <div style="min-width:0;">
                        <div class="nm">${esc(r.name || "—")}</div>
                        <div class="sub">${esc(r.category || "")}${r.leaveType ? "・" + esc(r.leaveType) : ""}</div>
                      </div>
                      <div class="sub" style="text-align:right;">${esc(r.reason || "")}</div>
                    </div>`).join("")}</div>`}
            </section>

            <section class="duty-group">
              <div class="duty-group-hd">補卡紀錄<span class="n">${makeups.length} 筆</span></div>
              ${makeups.length === 0 ? `<div class="muted" style="padding:6px 2px;">此日無補卡紀錄。</div>`
                : `<div style="display:grid;gap:8px;">${makeups.map((r) => `
                    <div class="duty-row">
                      <div style="min-width:0;">
                        <div class="nm">${esc(r.name || "—")}</div>
                        <div class="sub">${esc(r.category || "")}・${esc(String(r.punchType || "") === "out" ? "下班" : "上班")} ${esc(r.timeHM || "")}${r.createdBy ? "・由 " + esc(r.createdBy) : ""}</div>
                      </div>
                      <div class="sub" style="text-align:right;">${esc(r.reason || "")}</div>
                    </div>`).join("")}</div>`}
            </section>
          `;
        }

        function buildPunchPrintHtml() {
          const dk = state.punchDate;
          const cmap = checkinMapFor(dk);
          const rows = state.staff.map((s) => {
            const c = cmap.get(String(s.id));
            const st = punchStatus(s.id, dk);
            return `<tr>
              <td>${esc(s.category || "—")}</td>
              <td>${esc(s.name || "—")}</td>
              <td>${esc(c && c.inAt ? fmtTime(c.inAt) : "—")}</td>
              <td>${esc(c && c.outAt ? fmtTime(c.outAt) : "—")}</td>
              <td>${esc(st.label)}</td>
            </tr>`;
          }).join("");
          const reqs = requestsFor(dk);
          const leaves = reqs.filter((r) => String(r.type || "") === "leave");
          const makeups = reqs.filter((r) => String(r.type || "") === "makeup");
          return `<div class="dt">${esc(fmtDateKey(dk))}<span class="n">共 ${state.staff.length} 人</span></div>
            <table>
              <thead><tr><th>類別</th><th>姓名</th><th>上班時間</th><th>下班時間</th><th>狀態</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="5">尚無人員</td></tr>`}</tbody>
            </table>
            <div class="dt">請假紀錄<span class="n">${leaves.length} 筆</span></div>
            <table>
              <thead><tr><th>姓名</th><th>類別</th><th>假別</th><th>事由</th></tr></thead>
              <tbody>${leaves.length ? leaves.map((r) => `<tr><td>${esc(r.name || "—")}</td><td>${esc(r.category || "—")}</td><td>${esc(r.leaveType || "—")}</td><td>${esc(r.reason || "")}</td></tr>`).join("") : `<tr><td colspan="4">無</td></tr>`}</tbody>
            </table>
            <div class="dt">補卡紀錄<span class="n">${makeups.length} 筆</span></div>
            <table>
              <thead><tr><th>姓名</th><th>類別</th><th>補卡別</th><th>時間</th><th>事由</th><th>補登人</th></tr></thead>
              <tbody>${makeups.length ? makeups.map((r) => `<tr><td>${esc(r.name || "—")}</td><td>${esc(r.category || "—")}</td><td>${esc(String(r.punchType || "") === "out" ? "下班" : "上班")}</td><td>${esc(r.timeHM || "—")}</td><td>${esc(r.reason || "")}</td><td>${esc(r.createdBy || "—")}</td></tr>`).join("") : `<tr><td colspan="6">無</td></tr>`}</tbody>
            </table>`;
        }
        function printPunch(auto) {
          openPrintWindow({
            title: "勤務打卡紀錄",
            subtitle: `社區：${esc((ctx && ctx.communityName) || "")}　列印時間：${esc(fmtDateTime(new Date()))}`,
            bodyHtml: buildPunchPrintHtml(),
            auto,
          });
        }

        /* ================= 設定 ================= */
        function roleShiftRowHtml(item) {
          const it = item || {};
          return `
            <div class="duty-rs-row" data-duty-rsrow>
              <input type="text" data-rsname value="${esc(it.name || "")}" placeholder="班別名稱（如：早班）" />
              <input type="time" data-rsstart value="${esc(it.start || "")}" aria-label="上班時間" />
              <input type="time" data-rsend value="${esc(it.end || "")}" aria-label="下班時間" />
              <button class="btn btn-sm btn-ghost" type="button" data-rsdel>刪除</button>
            </div>`;
        }
        function roleShiftBlock(cat, list) {
          const rows = (list && list.length ? list : [null]).map((x) => roleShiftRowHtml(x)).join("");
          return `
            <div class="duty-group" data-duty-rsgroup="${esc(cat)}">
              <div class="duty-group-hd">${esc(cat)}<span class="n">設定早班／晚班或自訂班別與時間；請假請於下方「假別」設定</span></div>
              <div data-duty-rsrows style="display:grid;gap:8px;">${rows}</div>
              <div><button class="btn btn-sm" type="button" data-rsadd>＋ 新增班別</button></div>
            </div>`;
        }
        function settingsView() {
          const s = state.settings;
          const rs = s.roleShifts || {};
          return `
            <div class="muted">分別為「總幹事、秘書、清潔、機電、保全」設定各自的班別與上下班時間；排班時將依人員角色提供對應班別，並可選「假別」標記請假（請假當日即以該員當日班別時間計）。</div>
            <div style="display:grid;gap:12px;max-width:820px;">${CATEGORY_ORDER.map((cat) => roleShiftBlock(cat, rs[cat] || [])).join("")}</div>
            <div class="field" style="gap:4px;margin:0;max-width:640px;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">假別（逗號分隔）</label><input id="duty_cfg_leaves" type="text" value="${esc(s.leaveTypes.join(","))}" placeholder="特休,事假,病假,公假,婚假,喪假,產假,其他" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/></div>
            <div class="field" style="gap:4px;margin:0;max-width:640px;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">假日別（逗號分隔）</label><input id="duty_cfg_holidays" type="text" value="${esc(s.holidayTypes.join(","))}" placeholder="例假,休假" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/></div>
            <div class="field" style="gap:4px;margin:0;max-width:640px;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">備註／注意事項</label><textarea id="duty_cfg_note" placeholder="例如：現場人員須於上班前 10 分鐘至管理室簽到" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;min-height:90px;font-weight:800;font-family:inherit;">${esc(s.note)}</textarea></div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-primary" type="button" id="dutySetSave">儲存設定</button>
            </div>
          `;
        }

        /* ================= render / bind ================= */
        function header() {
          const working = state.staff.filter((s) => {
            const c = checkinMapFor(todayKey()).get(String(s.id));
            return c && c.inAt && !c.outAt;
          }).length;
          return `
            <div class="card-hd">
              <div class="left">
                <div class="chip" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.2c4.8 0 8.7-3.9 8.7-8.7S16.8 3.8 12 3.8 3.3 7.7 3.3 12.5 7.2 21.2 12 21.2Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.6v5.1l3.2 1.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                <div style="min-width:0;">
                  <h2>勤務管理</h2>
                  <p>掌握值班狀況、排班班表、打卡紀錄與勤務設定。</p>
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                <div class="tag blue" style="background:rgba(37,99,235,.10);color:#1d4ed8;border-color:rgba(37,99,235,.24);">上班中 ${working}</div>
              </div>
            </div>
          `;
        }

        function renderTabs() {
          const subnav = document.getElementById("subnav");
          if (!subnav) return;
          subnav.innerHTML = TABS.map((x) => {
            const active = state.tab === x.key;
            return `<button class="btn btn-sm ${active ? "btn-primary" : ""}" type="button" data-duty-tab="${x.key}"${active ? ' aria-current="page"' : ""}>${x.label}</button>`;
          }).join("");
          subnav.querySelectorAll("[data-duty-tab]").forEach((b) => {
            b.onclick = () => {
              state.tab = String(b.getAttribute("data-duty-tab") || "overview");
              syncDaySubs();
              render();
            };
          });
        }

        function bodyView() {
          if (state.tab === "overview") return overviewView();
          if (state.tab === "schedule") return scheduleView();
          if (state.tab === "punch") return punchView();
          return settingsView();
        }

        function render() {
          renderTabs();
          container.innerHTML = `
            <section class="card meter-page">
              ${header()}
              <div class="card-bd" style="display:grid;gap:12px;">
                ${bodyView()}
              </div>
            </section>
          `;
          bind();
        }

        function bind() {
          /* 班表 */
          const prevW = container.querySelector("#dutyPrevWeek");
          if (prevW) prevW.onclick = () => { state.scheduleWeekStart = shiftDateKey(state.scheduleWeekStart, -7); watchScheduleWeeks(state.scheduleWeekStart); render(); };
          const nextW = container.querySelector("#dutyNextWeek");
          if (nextW) nextW.onclick = () => { state.scheduleWeekStart = shiftDateKey(state.scheduleWeekStart, 7); watchScheduleWeeks(state.scheduleWeekStart); render(); };
          const thisW = container.querySelector("#dutyThisWeek");
          if (thisW) thisW.onclick = () => { state.scheduleWeekStart = startOfWeekKey(todayKey()); watchScheduleWeeks(state.scheduleWeekStart); render(); };
          container.querySelectorAll("[data-duty-shift]").forEach((sel) => {
            sel.onchange = () => setShift(sel.getAttribute("data-duty-shift"), sel.getAttribute("data-duty-uid"), String(sel.value || ""));
          });
          const fillBtn = container.querySelector("#dutyFillBtn");
          if (fillBtn) fillBtn.onclick = () => {
            const fs = container.querySelector("#dutyFillShift");
            fillWeek(fs ? String(fs.value || "") : "");
          };
          container.querySelectorAll("[data-duty-stat]").forEach((btn) => {
            btn.onclick = () => {
              const s = state.staff.find((x) => String(x.id) === String(btn.getAttribute("data-duty-stat")));
              if (s) openStatsModal(s);
            };
          });

          /* 打卡 */
          const prevD = container.querySelector("#dutyPrevDay");
          if (prevD) prevD.onclick = () => { state.punchDate = shiftDateKey(state.punchDate, -1); syncDaySubs(); render(); };
          const nextD = container.querySelector("#dutyNextDay");
          if (nextD) nextD.onclick = () => { state.punchDate = shiftDateKey(state.punchDate, 1); syncDaySubs(); render(); };
          const tdy = container.querySelector("#dutyToday");
          if (tdy) tdy.onclick = () => { state.punchDate = todayKey(); syncDaySubs(); render(); };
          const pd = container.querySelector("#dutyPunchDate");
          if (pd) pd.onchange = () => {
            const v = String(pd.value || "").trim();
            if (!v) return;
            state.punchDate = v;
            syncDaySubs();
            render();
          };
          container.querySelectorAll("[data-duty-makeup]").forEach((b) => {
            b.onclick = () => openMakeupModal(b.getAttribute("data-duty-makeup"));
          });
          const printP = container.querySelector("#dutyPrintPunch");
          if (printP) printP.onclick = () => printPunch(false);
          const pdfP = container.querySelector("#dutyPdfPunch");
          if (pdfP) pdfP.onclick = () => printPunch(true);

          /* 設定：角色班別 新增／刪除（事件委派，僅綁定一次） */
          if (!container.__dutyRsBound) {
            container.__dutyRsBound = true;
            container.addEventListener("click", (e) => {
              const t = e.target;
              if (!t || !t.closest) return;
              const add = t.closest("[data-rsadd]");
              if (add) {
                const grp = add.closest("[data-duty-rsgroup]");
                const rows = grp && grp.querySelector("[data-duty-rsrows]");
                if (rows) {
                  rows.insertAdjacentHTML("beforeend", roleShiftRowHtml(null));
                  const inp = rows.lastElementChild && rows.lastElementChild.querySelector("[data-rsname]");
                  if (inp) inp.focus();
                }
                return;
              }
              const del = t.closest("[data-rsdel]");
              if (del) {
                const row = del.closest("[data-duty-rsrow]");
                const box = row && row.parentNode;
                if (row) row.remove();
                if (box && !box.querySelector("[data-duty-rsrow]")) box.insertAdjacentHTML("beforeend", roleShiftRowHtml(null));
              }
            });
          }

          /* 設定 */
          const saveBtn = container.querySelector("#dutySetSave");
          if (saveBtn) saveBtn.onclick = () => saveSettings(saveBtn);
        }

        /* ================= 動作：班表 ================= */
        async function setShift(dateKey, uid, value) {
          if (!dateKey || !uid) return;
          const month = monthKeyOf(dateKey);
          const shifts = {};
          if (value) shifts[uid] = value;
          else {
            const d = delField();
            if (d === undefined) { toast("此環境不支援刪除欄位", true); return; }
            shifts[uid] = d;
          }
          try {
            await refSchedules().doc(dateKey).set({
              dateKey, month, shifts, updatedAt: serverTs(), updatedBy: myName || "",
            }, { merge: true });
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "儲存班表失敗"), true);
          }
        }

        async function fillWeek(shift) {
          if (!shift) { toast("請先選擇要帶入的班別", true); return; }
          const days = weekDaysKeys(state.scheduleWeekStart);
          if (!days.length) return;
          const shiftsMap = schedulesByDate();
          const batch = db.batch();
          let count = 0;
          days.forEach((dk) => {
            const month = monthKeyOf(dk);
            const cur = shiftsMap.get(dk) || {};
            const fill = {};
            let has = false;
            state.staff.forEach((s) => {
              if (!String(cur[s.id] || "").trim()) { fill[s.id] = shift; has = true; }
            });
            if (has) {
              batch.set(refSchedules().doc(dk), {
                dateKey: dk, month, shifts: fill, updatedAt: serverTs(), updatedBy: myName || "",
              }, { merge: true });
              count += 1;
            }
          });
          if (!count) { toast("本週欄位皆已排定，無需帶入"); return; }
          try {
            await batch.commit();
            toast(`已帶入「${shift}」（${count} 天）`);
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "帶入失敗"), true);
          }
        }

        /* 顯示某員「顯示週所屬月份」的總上班日／例假／休假 */
        async function openStatsModal(s) {
          const month = monthKeyOf(state.scheduleWeekStart);
          const monthText = `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
          const m = openSimpleModal({
            title: `${s.name}　月統計`,
            bodyHtml: `<div class="muted" style="padding:8px 0;">載入中…</div>`,
            footerHtml: `<button class="btn btn-sm btn-ghost" type="button" id="duty_stat_close">關閉</button>`,
            width: "380px",
          });
          m.modal.querySelector("#duty_stat_close").onclick = m.close;
          const bd = m.modal.querySelector(".mr-modal-bd");
          const cell = (label, val, color) => `
            <div style="border:1px solid rgba(17,24,39,.1);border-radius:14px;padding:12px 8px;background:#fff;text-align:center;">
              <div class="muted" style="margin:0 0 4px;">${esc(label)}</div>
              <div style="font-size:26px;font-weight:900;line-height:1.1;color:${color};">${esc(String(val))}</div>
            </div>`;
          try {
            const leaveSet = new Set(state.settings.leaveTypes || []);
            const holidaySet = new Set(state.settings.holidayTypes || []);
            const snap = await refSchedules().where("month", "==", String(month)).get();
            let work = 0; let libu = 0; let xiu = 0;
            snap.forEach((d) => {
              const v = String(((d.data() || {}).shifts || {})[s.id] || "").trim();
              if (!v) return;
              if (v === "例假") { libu += 1; return; }
              if (v === "休假") { xiu += 1; return; }
              if (leaveSet.has(v) || holidaySet.has(v)) return;
              work += 1;
            });
            if (bd) bd.innerHTML = `
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
                ${cell("總上班日", work, "#d32f2f")}
                ${cell("例假", libu, "#b45309")}
                ${cell("休假", xiu, "#0e7490")}
              </div>
              <div class="muted" style="margin-top:12px;line-height:1.6;">
                統計月份：${esc(monthText)}（${esc(s.category)}${s.title ? "・" + esc(s.title) : ""}）<br>
                總上班日＝當月已排班別天數（不含請假與假日）。
              </div>`;
          } catch (e) {
            console.error(e);
            if (bd) bd.innerHTML = `<div class="muted">讀取失敗：${esc(fbErr(e, "無法取得班表"))}</div>`;
          }
        }

        /* ================= 動作：打卡補登 ================= */
        function openMakeupModal(uid) {
          const s = state.staff.find((x) => String(x.id) === String(uid));
          if (!s) return;
          const cmap = checkinMapFor(state.punchDate);
          const c = cmap.get(String(s.id));
          const m = openSimpleModal({
            title: `手動補登｜${s.name}`,
            width: "min(480px, 92vw)",
            bodyHtml: `
              <div style="display:grid;gap:12px;">
                <div class="muted">日期：<b>${esc(fmtDateKey(state.punchDate))}</b>　類別：${esc(s.category || "—")}<br/>目前上班 ${esc(c && c.inAt ? fmtTime(c.inAt) : "—")}　下班 ${esc(c && c.outAt ? fmtTime(c.outAt) : "—")}</div>
                <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">補卡別 *</label>
                  <select id="duty_mk_type" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;">
                    <option value="in">上班</option>
                    <option value="out">下班</option>
                  </select>
                </div>
                <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">時間 *</label>
                  <input id="duty_mk_time" type="time" value="${esc(state.settings.workStart || "08:00")}" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/>
                </div>
                <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">事由</label>
                  <textarea id="duty_mk_reason" placeholder="例如：忘記打卡、設備異常" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;min-height:70px;font-weight:800;font-family:inherit;"></textarea>
                </div>
              </div>
            `,
            footerHtml: `<button class="btn btn-ghost" type="button" id="duty_mk_cancel">取消</button><button class="btn btn-primary" type="button" id="duty_mk_save">送出補登</button>`,
          });
          m.modal.querySelector("#duty_mk_cancel").onclick = m.close;
          const saveBtn = m.modal.querySelector("#duty_mk_save");
          saveBtn.onclick = async () => {
            const punchType = String(m.modal.querySelector("#duty_mk_type").value || "in");
            const timeHM = String(m.modal.querySelector("#duty_mk_time").value || "").trim();
            const reason = String(m.modal.querySelector("#duty_mk_reason").value || "").trim();
            if (!timeHM) { toast("請選擇時間", true); return; }
            saveBtn.disabled = true;
            saveBtn.textContent = "送出中…";
            try {
              await refRequests().add({
                type: "makeup",
                uid: s.id,
                name: s.name,
                category: s.category || "",
                dateKey: state.punchDate,
                punchType,
                timeHM,
                reason,
                createdAt: serverTs(),
                createdBy: myName || "管理室",
                communityId: cid,
              });
              const dt = tsFromDateHM(state.punchDate, timeHM);
              const docId = `${s.id}_${state.punchDate}`;
              const patch = {
                uid: s.id,
                name: s.name,
                category: s.category || "",
                workDate: state.punchDate,
                communityId: cid,
                updatedAt: serverTs(),
              };
              if (dt) {
                if (punchType === "out") patch.outAt = tsOrDefault(dt);
                else patch.inAt = tsOrDefault(dt);
              }
              await refCheckins().doc(docId).set(patch, { merge: true });
              m.close();
              toast("已補登打卡紀錄");
            } catch (e) {
              console.error(e);
              toast(fbErr(e, "補登失敗"), true);
              saveBtn.disabled = false;
              saveBtn.textContent = "送出補登";
            }
          };
        }

        /* ================= 動作：設定 ================= */
        function collectRoleShifts() {
          const out = {};
          CATEGORY_ORDER.forEach((cat) => {
            const grp = container.querySelector(`[data-duty-rsgroup="${cat}"]`);
            const list = [];
            const seen = new Set();
            if (grp) {
              grp.querySelectorAll("[data-duty-rsrow]").forEach((row) => {
                const name = String((row.querySelector("[data-rsname]") || {}).value || "").trim();
                if (!name || seen.has(name)) return;
                seen.add(name);
                list.push({
                  name,
                  start: String((row.querySelector("[data-rsstart]") || {}).value || "").trim(),
                  end: String((row.querySelector("[data-rsend]") || {}).value || "").trim(),
                });
              });
            }
            out[cat] = list.length ? list : DEFAULT_ROLE_SHIFTS[cat].map((x) => Object.assign({}, x));
          });
          return out;
        }
        async function saveSettings(saveBtn) {
          const splitList = (v) => String(v || "").split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
          const roleShifts = collectRoleShifts();
          const union = unionShiftNames(roleShifts);
          const leaveTypes = splitList((container.querySelector("#duty_cfg_leaves") || {}).value);
          const holidayTypes = splitList((container.querySelector("#duty_cfg_holidays") || {}).value);
          const note = String((container.querySelector("#duty_cfg_note") || {}).value || "").trim();
          const firstWithTime = CATEGORY_ORDER.reduce((acc, cat) => acc || (roleShifts[cat] || []).find((x) => x.start && x.end), null);
          const workStart = String((firstWithTime && firstWithTime.start) || state.settings.workStart || DEFAULT_SETTINGS.workStart);
          const workEnd = String((firstWithTime && firstWithTime.end) || state.settings.workEnd || DEFAULT_SETTINGS.workEnd);
          const payload = {
            workStart,
            workEnd,
            roleShifts,
            shifts: union.length ? union : DEFAULT_SHIFT_NAMES.slice(),
            leaveTypes: leaveTypes.length ? leaveTypes : DEFAULT_SETTINGS.leaveTypes.slice(),
            holidayTypes: holidayTypes.length ? holidayTypes : DEFAULT_SETTINGS.holidayTypes.slice(),
            note,
            updatedAt: serverTs(),
          };
          if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "儲存中…"; }
          try {
            await refSettings().doc("duty").set(payload, { merge: false });
            toast("已儲存勤務設定");
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "儲存失敗"), true);
          } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "儲存設定"; }
          }
        }

        /* ================= boot ================= */
        subscribe();
        loadStaff();
        loadMyName();
      },
    },
  };
})();
