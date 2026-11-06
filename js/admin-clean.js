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
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function fmtTime(ts) {
    const d = tsToDate(ts);
    if (!d) return "";
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }
  function msOf(ts) {
    if (!ts) return 0;
    if (ts.toMillis) return ts.toMillis();
    if (ts instanceof Date) return ts.getTime();
    const n = new Date(ts).getTime();
    return isNaN(n) ? 0 : n;
  }
  function keyOfDate(d) {
    if (!d || isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function dateKeyOf(ts) { return keyOfDate(tsToDate(ts)); }
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
  function fmtDateKey(key) {
    const w = weekdayZh(key);
    return w ? `${key}（${w}）` : String(key || "");
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
      .qrwrap{display:flex;flex-wrap:wrap;gap:14px;}
      .qrbox{page-break-inside:avoid;border:1px dashed #9ca3af;border-radius:10px;padding:12px;text-align:center;width:226px;}
      .qrbox .nm{font-weight:900;font-size:14px;margin-bottom:8px;}
      .qrbox .zt{font-size:11px;color:#6b7280;margin-top:6px;word-break:break-all;}
      .qrbox .nt{margin-top:8px;font-size:11px;color:#374151;text-align:left;white-space:pre-wrap;}
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

  /* ============================ 識別碼 / QR ============================ */
  const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  function genCode(len) {
    let s = "";
    for (let i = 0; i < (len || 8); i += 1) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }
  function qrSvg(text, size) {
    if (typeof qrcode !== "function") return `<div class="muted">QR 元件未載入</div>`;
    try {
      const qr = qrcode(0, "M");
      qr.addData(String(text || ""));
      qr.make();
      const count = qr.getModuleCount();
      const quiet = 2;
      const total = count + quiet * 2;
      let path = "";
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
        }
      }
      const px = Number(size) || 170;
      return `<svg viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code" style="width:${px}px;height:${px}px;background:#fff;display:block;margin:0 auto;"><path d="${path}" fill="#111827"/></svg>`;
    } catch (e) {
      return `<div class="muted">QR 產生失敗</div>`;
    }
  }

  /* ============================ 常數 ============================ */
  const TABS = [
    { key: "overview", label: "總覽" },
    { key: "map", label: "地圖" },
    { key: "reports", label: "通報" },
    { key: "patrol", label: "巡邏" },
    { key: "settings", label: "設定" },
  ];
  const REPORT_FILTERS = [
    { key: "all", label: "全部" },
    { key: "pending", label: "待處理" },
    { key: "processing", label: "處理中" },
    { key: "done", label: "已完成" },
    { key: "unassigned", label: "未指派" },
  ];
  const KIND_OPTIONS = [
    { key: "report", label: "通報位置（住戶可回報）" },
    { key: "patrol", label: "巡邏位置（清潔人員打卡）" },
    { key: "both", label: "兩者皆是" },
  ];
  const DEFAULT_LOCATIONS = [
    { name: "一樓大廳", zone: "1F", kind: "both" },
    { name: "電梯", zone: "1F", kind: "both" },
    { name: "樓梯間", zone: "1F", kind: "patrol" },
    { name: "垃圾間", zone: "B1", kind: "both" },
    { name: "中庭", zone: "1F", kind: "both" },
    { name: "停車場", zone: "B1", kind: "both" },
    { name: "頂樓", zone: "RF", kind: "patrol" },
    { name: "公共廁所", zone: "1F", kind: "both" },
  ];
  /* 清潔重點常用項目（可自行新增） */
  const POINT_OPTIONS = ["清潔", "消毒", "垃圾清運", "地板拖洗", "玻璃擦拭", "廁所清潔", "垃圾分類", "補充耗材"];

  function kindOf(loc) {
    const k = String((loc && loc.kind) || "").trim();
    return (k === "patrol" || k === "both") ? k : "report";
  }
  function isReportLoc(loc) { const k = kindOf(loc); return k === "report" || k === "both"; }
  function isPatrolLoc(loc) { const k = kindOf(loc); return k === "patrol" || k === "both"; }
  function statusOf(r) { return String((r && r.status) || "pending"); }

  /* 清潔重點：預設為「清潔」 */
  function pointsOf(loc) {
    const arr = (loc && loc.points) || [];
    const list = Array.isArray(arr) ? arr.map((x) => String(x || "").trim()).filter(Boolean) : [];
    return list.length ? list : ["清潔"];
  }
  function pointModeOf(loc) { return String((loc && loc.pointMode) || "multi") === "single" ? "single" : "multi"; }
  /* 清潔頻率：一日多次 / 多日一次 */
  function freqOf(loc) {
    const f = (loc && loc.freq) || {};
    const type = String(f.type || "day") === "span" ? "span" : "day";
    return {
      type,
      times: Math.max(1, Number(f.times) || 1),
      days: Math.max(1, Number(f.days) || 1),
    };
  }
  function freqText(loc) {
    const f = freqOf(loc);
    return f.type === "span" ? `每 ${f.days} 日 1 次` : `一日 ${f.times} 次`;
  }

  function reportStatusTag(status) {
    const s = statusOf({ status });
    if (s === "done") return `<span class="tag green">已完成</span>`;
    if (s === "processing") return `<span class="tag yellow">處理中</span>`;
    return `<span class="tag red">待處理</span>`;
  }
  function kindTag(k) {
    if (k === "patrol") return `<span class="cln-tag patrol">巡邏點</span>`;
    if (k === "both") return `<span class="cln-tag both">通報＋巡邏</span>`;
    return `<span class="cln-tag report">通報點</span>`;
  }

  /* ============================ 樣式（僅注入一次） ============================ */
  function ensureStyles() {
    if (document.getElementById("nwCleanStyles")) return;
    const st = document.createElement("style");
    st.id = "nwCleanStyles";
    st.textContent = `
      .cln-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}
      .cln-metric{padding:14px 16px;border-radius:16px;background:#fff;border:1px solid rgba(17,24,39,.10);box-shadow:0 8px 22px rgba(17,24,39,.06);display:grid;gap:4px;}
      .cln-metric .k{font-size:calc(12px * var(--fs,1));color:#6b7280;font-weight:800;}
      .cln-metric .v{font-size:calc(26px * var(--fs,1));font-weight:900;line-height:1.1;}
      .cln-metric .u{font-size:calc(12px * var(--fs,1));color:#6b7280;font-weight:700;margin-left:4px;}
      .cln-metric.red .v{color:#c62828;}
      .cln-metric.amber .v{color:#b7791f;}
      .cln-metric.green .v{color:#1b7f3a;}
      .cln-metric.blue .v{color:#1d4ed8;}
      .cln-legend{display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:calc(12px * var(--fs,1));color:#4b5563;font-weight:800;}
      .cln-legend i{display:inline-block;width:10px;height:10px;border-radius:999px;margin-right:6px;}
      .cln-legend i.red{background:#d32f2f;}
      .cln-legend i.orange{background:#f59e0b;}
      .cln-legend i.green{background:#16a34a;}
      .cln-map{display:grid;gap:14px;}
      .cln-zone{padding:12px;border-radius:18px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);}
      .cln-zone-hd{font-weight:900;font-size:calc(13px * var(--fs,1));margin-bottom:10px;display:flex;align-items:center;gap:8px;}
      .cln-zone-hd .n{color:#6b7280;font-weight:700;font-size:calc(11px * var(--fs,1));}
      .cln-grid{display:grid;gap:8px;}
      .cln-cell{position:relative;display:grid;gap:2px;align-content:center;justify-items:center;padding:8px 6px;border-radius:14px;border:1px solid rgba(17,24,39,.12);background:#fff;cursor:pointer;text-align:center;font-family:inherit;}
      .cln-cell .nm{font-weight:900;font-size:calc(12px * var(--fs,1));color:#111827;line-height:1.2;}
      .cln-cell .bd{font-size:calc(10px * var(--fs,1));font-weight:800;color:#6b7280;}
      .cln-cell.red{background:rgba(211,47,47,.10);border-color:rgba(211,47,47,.45);}
      .cln-cell.red .bd{color:#c62828;}
      .cln-cell.orange{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.45);}
      .cln-cell.orange .bd{color:#b7791f;}
      .cln-cell.green{background:rgba(22,163,74,.08);border-color:rgba(22,163,74,.35);}
      .cln-cell.green .bd{color:#1b7f3a;}
      .cln-cell .pin{position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:999px;background:#d32f2f;box-shadow:0 0 0 0 rgba(211,47,47,.6);animation:clnPulse 1.6s infinite;}
      @keyframes clnPulse{0%{box-shadow:0 0 0 0 rgba(211,47,47,.55);}70%{box-shadow:0 0 0 9px rgba(211,47,47,0);}100%{box-shadow:0 0 0 0 rgba(211,47,47,0);}}
      .cln-tag{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:calc(11px * var(--fs,1));font-weight:800;border:1px solid transparent;}
      .cln-tag.report{background:rgba(37,99,235,.10);color:#1d4ed8;border-color:rgba(37,99,235,.24);}
      .cln-tag.patrol{background:rgba(22,163,74,.10);color:#1b7f3a;border-color:rgba(22,163,74,.24);}
      .cln-tag.both{background:rgba(124,58,237,.10);color:#6d28d9;border-color:rgba(124,58,237,.24);}
      .cln-date-hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 2px;font-weight:900;font-size:calc(13px * var(--fs,1));border-bottom:2px solid rgba(211,47,47,.35);}
      .cln-date-hd .n{color:#6b7280;font-weight:700;font-size:calc(11px * var(--fs,1));}
      .cln-row{display:grid;gap:8px;padding:14px;border-radius:18px;background:#fff;border:1px solid rgba(17,24,39,.10);box-shadow:0 8px 22px rgba(17,24,39,.06);}
      .cln-qr-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));}
      .cln-qr-card{padding:12px;border-radius:14px;border:1px dashed rgba(17,24,39,.24);text-align:center;}
      .cln-qr-card .lb{font-weight:900;font-size:calc(12px * var(--fs,1));margin-bottom:8px;}
      .cln-qr-card .cd{margin-top:6px;font-size:calc(11px * var(--fs,1));color:#6b7280;font-weight:800;letter-spacing:1px;}
      .cln-qr-card .ur{margin-top:4px;font-size:calc(10px * var(--fs,1));color:#9ca3af;word-break:break-all;}
    `;
    document.head.appendChild(st);
  }

  /* ============================ 主體 ============================ */
  window.NwAdminClean = {
    UI: {
      renderCleanPage(container, ctx) {
        if (!container) return;
        ensureStyles();
        const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
        const db = fb && fb.firestore ? fb.firestore() : null;
        const cid = String((ctx && ctx.communityId) || "").trim();
        if (typeof window.__nwCleanCleanup === "function") {
          try { window.__nwCleanCleanup(); } catch {}
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
          reports: [],
          locations: [],
          patrols: [],
          cleaners: [],
          checkins: [],
          loading: true,
          reportFilter: "all",
          patrolDate: todayKey(),
          patrolLoading: true,
        };
        let unsubReports = null;
        let unsubLocations = null;
        let unsubPatrols = null;
        let unsubCheckins = null;
        let patrolDateBound = "";
        let myName = "";
        let myRole = "";

        window.__nwCleanCleanup = () => {
          try { unsubReports && unsubReports(); } catch {}
          try { unsubLocations && unsubLocations(); } catch {}
          try { unsubPatrols && unsubPatrols(); } catch {}
          try { unsubCheckins && unsubCheckins(); } catch {}
          unsubReports = unsubLocations = unsubPatrols = unsubCheckins = null;
          const subnav = document.getElementById("subnav");
          if (subnav) subnav.innerHTML = "";
          window.__nwCleanCleanup = null;
        };

        const refReports = () => db.collection("communities").doc(cid).collection("clean_reports");
        const refLocations = () => db.collection("communities").doc(cid).collection("clean_locations");
        const refPatrols = () => db.collection("communities").doc(cid).collection("clean_patrols");
        const refCheckins = () => db.collection("communities").doc(cid).collection("clean_checkins");
        const serverTs = () => (fb.firestore.FieldValue.serverTimestamp ? fb.firestore.FieldValue.serverTimestamp() : new Date());
        const uidOf = () => {
          const u = fb.auth && fb.auth().currentUser;
          return u ? String(u.uid || "") : "";
        };

        function baseUrl() {
          try { return location.origin + location.pathname.replace(/[^/]+$/, ""); }
          catch { return ""; }
        }
        function qrTargets(loc) {
          const out = [];
          const code = String(loc.code || "");
          if (isReportLoc(loc)) out.push({ label: "住戶通報", url: `${baseUrl()}clean-report.html?c=${encodeURIComponent(cid)}&loc=${encodeURIComponent(loc.id)}&k=${encodeURIComponent(code)}` });
          if (isPatrolLoc(loc)) out.push({ label: "巡邏打卡", url: `${baseUrl()}worker-clean.html?c=${encodeURIComponent(cid)}&patrol=${encodeURIComponent(loc.id)}&k=${encodeURIComponent(code)}` });
          return out;
        }

        /* ---------- 資料整理 ---------- */
        const reportLocs = () => state.locations.filter((l) => l.enabled !== false && isReportLoc(l))
          .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const patrolLocs = () => state.locations.filter((l) => l.enabled !== false && isPatrolLoc(l))
          .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
        const locName = (id) => {
          const l = state.locations.find((x) => x.id === id);
          return l ? String(l.name || "未命名位置") : "";
        };
        const patrolOf = (locId) => state.patrols.find((p) => String(p.locationId || "") === String(locId)) || null;

        function reportsOfLoc(locId) {
          return state.reports.filter((r) => String(r.locationId || "") === String(locId));
        }
        function locStatus(loc) {
          const rs = reportsOfLoc(loc.id);
          const pending = rs.filter((r) => statusOf(r) === "pending").length;
          const processing = rs.filter((r) => statusOf(r) === "processing").length;
          if (pending) return { cls: "red", text: `${pending} 待處理`, pending, processing };
          if (processing) return { cls: "orange", text: `${processing} 處理中`, pending, processing };
          return { cls: "green", text: "正常", pending, processing };
        }
        function groupByDate(list, tsField) {
          const map = new Map();
          list.forEach((r) => {
            const k = dateKeyOf(r[tsField]) || "未標示";
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(r);
          });
          return Array.from(map.entries()).sort((a, b) => String(b[0]).localeCompare(String(a[0])));
        }

        /* ---------- 讀取清潔人員（管理帳號中類別＝清潔） ---------- */
        async function loadCleaners() {
          const isCleaner = (u) => {
            const role = String((u && u.role) || "").trim();
            const cat = String((u && u.category) || "").trim();
            if (cat === "清潔") return true;
            if (role === "清潔" || role === "清潔人員") return true;
            return false;
          };
          const pick = (d) => {
            const v = d.data() || {};
            return {
              id: d.id,
              name: String(v.displayName || v.name || v.fullName || v.username || v.email || "").trim() || "未命名",
            };
          };
          let list = [];
          try {
            const snap = await db.collection("users").where("communityIds", "array-contains", cid).get();
            snap.forEach((d) => { if (isCleaner(d.data() || {})) list.push(pick(d)); });
          } catch (e) {
            console.warn("load cleaners failed", e);
          }
          if (!list.length) {
            try {
              const snap = await db.collection("users").where("role", "==", "工作").get();
              snap.forEach((d) => { if (isCleaner(d.data() || {})) list.push(pick(d)); });
            } catch (e) { /* ignore */ }
          }
          list.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hant-TW"));
          state.cleaners = list;
          if (state.tab === "reports" || state.tab === "overview" || state.tab === "map") render();
        }
        async function loadMyName() {
          try {
            const u = fb.auth && fb.auth().currentUser;
            if (!u) return;
            const snap = await db.collection("users").doc(String(u.uid)).get();
            const d = snap && snap.exists ? (snap.data() || {}) : {};
            myName = String(d.displayName || d.name || u.displayName || u.email || "").trim();
            myRole = String(d.category || d.role || "").trim();
          } catch (e) { /* ignore */ }
        }

        /* ---------- 訂閱 ---------- */
        function watchPatrols(dateKey) {
          patrolDateBound = dateKey;
          try { unsubPatrols && unsubPatrols(); } catch {}
          state.patrolLoading = true;
          unsubPatrols = refPatrols().where("dateKey", "==", String(dateKey)).onSnapshot((snap) => {
            const list = [];
            snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
            state.patrols = list;
            state.patrolLoading = false;
            if (state.tab === "patrol" || state.tab === "overview") render();
          }, (err) => {
            console.warn("clean patrols listen failed", err);
            state.patrols = [];
            state.patrolLoading = false;
            if (state.tab === "patrol" || state.tab === "overview") render();
          });
        }

        function subscribe() {
          state.loading = true;
          render();
          try { unsubReports && unsubReports(); } catch {}
          try { unsubLocations && unsubLocations(); } catch {}
          unsubReports = refReports().orderBy("createdAt", "desc").limit(400).onSnapshot((snap) => {
            const list = [];
            snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
            state.reports = list;
            state.loading = false;
            render();
          }, (err) => {
            console.warn("clean reports listen failed", err);
            state.reports = [];
            state.loading = false;
            render();
          });
          unsubLocations = refLocations().onSnapshot((snap) => {
            const list = [];
            snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
            state.locations = list;
            render();
          }, (err) => {
            console.warn("clean locations listen failed", err);
            state.locations = [];
          });
          try { unsubCheckins && unsubCheckins(); } catch {}
          unsubCheckins = refCheckins().where("workDate", "==", todayKey()).onSnapshot((snap) => {
            const list = [];
            snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
            state.checkins = list;
          }, (err) => {
            console.warn("clean checkins listen failed", err);
            state.checkins = [];
          });
        }

        /* 當日值班人員：今日已上班打卡且尚未下班的清潔人員 */
        function dutyOf() {
          const today = todayKey();
          const list = state.checkins
            .filter((c) => String(c.workDate || "") === today && c.inAt && !c.outAt)
            .sort((a, b) => msOf(a.inAt) - msOf(b.inAt));
          const c = list[0];
          if (!c) return null;
          const uid = String(c.uid || "").trim();
          if (!uid) return null;
          return { uid, name: String(c.name || "").trim() };
        }
        /* 指派下拉清單：清潔人員＋（若不在名單中）當日值班人員 */
        function assigneeList() {
          const duty = dutyOf();
          const list = state.cleaners.slice();
          if (duty && !list.some((x) => x.id === duty.uid)) {
            list.unshift({ id: duty.uid, name: duty.name || "值班人員", duty: true });
          }
          return list.map((c) => (duty && c.id === duty.uid ? Object.assign({}, c, { duty: true }) : c));
        }

        /* ================= 總覽 ================= */
        function metric(label, value, unit, tone) {
          return `<div class="cln-metric ${tone || ""}"><div class="k">${esc(label)}</div><div class="v">${esc(value)}${unit ? `<span class="u">${esc(unit)}</span>` : ""}</div></div>`;
        }

        function overviewView() {
          const today = todayKey();
          const pending = state.reports.filter((r) => statusOf(r) === "pending");
          const processing = state.reports.filter((r) => statusOf(r) === "processing");
          const todayNew = state.reports.filter((r) => dateKeyOf(r.createdAt) === today);
          const todayDone = state.reports.filter((r) => statusOf(r) === "done" && dateKeyOf(r.handledAt || r.updatedAt) === today);
          const unassigned = state.reports.filter((r) => statusOf(r) !== "done" && !String(r.assigneeUid || "").trim());
          const pLocs = patrolLocs();
          const doneLocs = pLocs.filter((l) => patrolOf(l.id));
          const rate = pLocs.length ? Math.round((doneLocs.length / pLocs.length) * 100) : 0;
          const undone = pLocs.filter((l) => !patrolOf(l.id));

          const hotLocs = reportLocs()
            .map((l) => ({ loc: l, st: locStatus(l) }))
            .filter((x) => x.st.pending > 0)
            .sort((a, b) => b.st.pending - a.st.pending)
            .slice(0, 6);

          return `
            <div class="cln-metrics">
              ${metric("待處理通報", pending.length, "件", "red")}
              ${metric("處理中", processing.length, "件", "amber")}
              ${metric("今日新增通報", todayNew.length, "件", "blue")}
              ${metric("今日完成", todayDone.length, "件", "green")}
              ${metric("未指派", unassigned.length, "件", "amber")}
              ${metric("今日巡邏完成率", rate, "%", rate >= 100 ? "green" : (rate > 0 ? "amber" : "red"))}
              ${metric("巡邏點", pLocs.length, "點")}
              ${metric("清潔人員", state.cleaners.length, "人")}
            </div>

            <section style="display:grid;gap:12px;">
              <div style="font-weight:900;font-size:calc(14px * var(--fs,1));">今日巡邏進度　<span style="color:#6b7280;font-weight:700;font-size:calc(12px * var(--fs,1));">完成 ${doneLocs.length} / ${pLocs.length}</span></div>
              ${pLocs.length === 0 ? `<div class="muted">尚未設定巡邏位置。</div>`
                : undone.length === 0 ? `<div class="tag green" style="align-self:flex-start;">今日巡邏全部完成</div>`
                : `<div style="display:flex;flex-wrap:wrap;gap:8px;">${undone.map((l) => `<span class="cln-tag patrol">${esc(l.name || "未命名")}</span>`).join("")}</div>`}
            </section>

            <section style="display:grid;gap:10px;">
              <div style="font-weight:900;font-size:calc(14px * var(--fs,1));">需要打掃的位置</div>
              ${hotLocs.length === 0 ? `<div class="muted">目前沒有待處理的通報位置。</div>`
                : `<div style="display:grid;gap:8px;">${hotLocs.map((x) => `
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(211,47,47,.28);">
                      <div style="min-width:0;">
                        <div style="font-weight:900;font-size:calc(14px * var(--fs,1));">${esc(x.loc.name || "未命名")}</div>
                        <div class="muted">${esc(x.loc.zone || "未分區")}</div>
                      </div>
                      <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                        <span class="tag red">待處理 ${x.st.pending}</span>
                        <button class="btn btn-sm" type="button" data-cln-map-loc="${esc(x.loc.id)}">查看</button>
                      </div>
                    </div>`).join("")}</div>`}
            </section>
          `;
        }

        /* ================= 地圖 ================= */
        function zoneBlock(zoneName, list) {
          const cols = Math.max(2, ...list.map((l) => Number(l.gridX) || 0));
          const cells = list.map((l, i) => {
            const st = locStatus(l);
            const gx = Number(l.gridX) > 0 ? Number(l.gridX) : (i % cols) + 1;
            const gy = Number(l.gridY) > 0 ? Number(l.gridY) : Math.floor(i / cols) + 1;
            return `<button class="cln-cell ${st.cls}" type="button" data-cln-map-loc="${esc(l.id)}" style="grid-column:${gx};grid-row:${gy};">
              ${st.cls === "red" ? `<span class="pin" aria-hidden="true"></span>` : ""}
              <span class="nm">${esc(l.name || "未命名")}</span>
              <span class="bd">${esc(st.text)}</span>
            </button>`;
          }).join("");
          return `<section class="cln-zone">
            <div class="cln-zone-hd">${esc(zoneName)}<span class="n">${list.length} 點</span></div>
            <div class="cln-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr));grid-auto-rows:minmax(60px,auto);">${cells}</div>
          </section>`;
        }

        function mapView() {
          const locs = reportLocs();
          if (!locs.length) return `<div class="muted" style="padding:24px;text-align:center;">尚未設定可通報的位置，請至「設定」新增。</div>`;
          const zoneMap = new Map();
          locs.forEach((l) => {
            const z = String(l.zone || "未分區").trim() || "未分區";
            if (!zoneMap.has(z)) zoneMap.set(z, []);
            zoneMap.get(z).push(l);
          });
          const zones = Array.from(zoneMap.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0]), "zh-Hant-TW"));
          return `
            <div class="cln-legend">
              <span><i class="red"></i>待處理</span>
              <span><i class="orange"></i>處理中</span>
              <span><i class="green"></i>正常</span>
              <span style="color:#6b7280;">點選區塊可查看通報並指派人員</span>
            </div>
            <div class="cln-map">${zones.map(([z, list]) => zoneBlock(z, list)).join("")}</div>
          `;
        }

        /* ================= 通報 ================= */
        // 社區後台帳號顯示「角色名稱 + 姓名」；住戶端通報顯示「戶號」。
        function reporterLabel(r) {
          const isAdminSrc = String(r.source || "resident") === "admin";
          const name = String(r.reporterName || "").trim();
          if (isAdminSrc) {
            const role = String(r.reporterRole || "").trim() || "管理室";
            return [role, name].filter(Boolean).join(" ");
          }
          const house = String(r.reporterHouseNo || "").trim();
          return [house ? `戶號 ${house}` : "", name].filter(Boolean).join("　");
        }
        function reportCard(r) {
          const status = statusOf(r);
          const src = String(r.source || "resident") === "admin" ? "管理室" : "住戶";
          const assignee = String(r.assigneeName || "").trim();
          return `
            <div class="cln-row">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
                <div style="min-width:0;">
                  <div style="font-weight:900;font-size:calc(16px * var(--fs,1));">${esc(r.locationName || r.location || "未指定位置")}</div>
                  <div class="muted" style="margin-top:4px;">${esc(src)}通報　${esc(reporterLabel(r))}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
                  ${assignee ? `<span class="cln-tag report">指派 ${esc(assignee)}</span>` : `<span class="cln-tag" style="background:rgba(107,114,128,.12);color:#4b5563;border-color:rgba(107,114,128,.24);">未指派</span>`}
                  ${reportStatusTag(status)}
                </div>
              </div>
              ${r.note ? `<div style="font-size:calc(13px * var(--fs,1));color:#374151;white-space:pre-wrap;word-break:break-word;">${esc(r.note)}</div>` : ""}
              <div class="muted">通報：${esc(fmtDateTime(r.createdAt))}${r.handledByName ? `　· 完成：由 ${esc(r.handledByName)}` : ""}</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                ${status !== "done" ? `<button class="btn btn-sm btn-ghost" type="button" data-cln-assign="${esc(r.id)}">指派人員</button>` : ""}
                ${status === "pending" ? `<button class="btn btn-sm btn-ghost" type="button" data-cln-processing="${esc(r.id)}">標記處理中</button>` : ""}
                ${status !== "done" ? `<button class="btn btn-sm btn-primary" type="button" data-cln-done="${esc(r.id)}">標記完成</button>` : ""}
                <button class="btn btn-sm btn-danger" type="button" data-cln-del-report="${esc(r.id)}">刪除</button>
              </div>
            </div>
          `;
        }

        function reportsView() {
          const counts = {
            all: state.reports.length,
            pending: state.reports.filter((r) => statusOf(r) === "pending").length,
            processing: state.reports.filter((r) => statusOf(r) === "processing").length,
            done: state.reports.filter((r) => statusOf(r) === "done").length,
            unassigned: state.reports.filter((r) => statusOf(r) !== "done" && !String(r.assigneeUid || "").trim()).length,
          };
          const filtered = state.reports.filter((r) => {
            if (state.reportFilter === "unassigned") return statusOf(r) !== "done" && !String(r.assigneeUid || "").trim();
            if (state.reportFilter === "all") return true;
            return statusOf(r) === state.reportFilter;
          });
          const groups = groupByDate(filtered, "createdAt");
          return `
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                ${REPORT_FILTERS.map((f) => `<button class="btn btn-sm ${state.reportFilter === f.key ? "btn-primary" : "btn-ghost"}" type="button" data-cln-filter="${f.key}">${f.label}(${counts[f.key] || 0})</button>`).join("")}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                <button class="btn btn-sm btn-primary" type="button" id="clnAddReport">＋ 新增通報</button>
                <button class="btn btn-sm" type="button" id="clnPrintReports">列印</button>
                <button class="btn btn-sm" type="button" id="clnPdfReports">匯出 PDF</button>
              </div>
            </div>
            ${state.loading ? `<div class="muted" style="padding:24px;text-align:center;">讀取中...</div>`
              : filtered.length === 0 ? `<div class="muted" style="padding:24px;text-align:center;">目前沒有符合條件的通報。</div>`
              : `<div style="display:grid;gap:14px;">${groups.map(([k, list]) => `
                  <section style="display:grid;gap:10px;">
                    <div class="cln-date-hd"><span>${esc(fmtDateKey(k))}</span><span class="n">共 ${list.length} 筆</span></div>
                    <div style="display:grid;gap:12px;">${list.map(reportCard).join("")}</div>
                  </section>`).join("")}</div>`}
          `;
        }

        function buildReportsPrintHtml() {
          const filtered = state.reports.filter((r) => {
            if (state.reportFilter === "unassigned") return statusOf(r) !== "done" && !String(r.assigneeUid || "").trim();
            if (state.reportFilter === "all") return true;
            return statusOf(r) === state.reportFilter;
          });
          const groups = groupByDate(filtered, "createdAt");
          const statusLabel = (s) => (s === "done" ? "已完成" : (s === "processing" ? "處理中" : "待處理"));
          const body = groups.map(([k, list]) => `
            <div class="dt">${esc(fmtDateKey(k))}<span class="n">共 ${list.length} 筆</span></div>
            <table>
              <thead><tr><th>時間</th><th>位置</th><th>來源</th><th>通報人</th><th>狀態</th><th>指派</th><th>備註</th></tr></thead>
              <tbody>${list.map((r) => `<tr>
                <td>${esc(fmtDateTime(r.createdAt))}</td>
                <td>${esc(r.locationName || r.location || "未指定位置")}</td>
                <td>${esc(String(r.source || "resident") === "admin" ? "管理室" : "住戶")}</td>
                <td>${esc(reporterLabel(r))}</td>
                <td>${esc(statusLabel(statusOf(r)))}</td>
                <td>${esc(r.assigneeName || "—")}</td>
                <td>${esc(r.note || "")}</td>
              </tr>`).join("")}</tbody>
            </table>`).join("");
          return body || `<div class="muted">沒有符合條件的通報。</div>`;
        }
        function printReports(auto) {
          openPrintWindow({
            title: "清潔通報紀錄",
            subtitle: `社區：${esc((ctx && ctx.communityName) || "")}　列印時間：${esc(fmtDateTime(new Date()))}　共 ${state.reports.length} 筆`,
            bodyHtml: buildReportsPrintHtml(),
            auto,
          });
        }

        /* ================= 巡邏 ================= */
        function patrolView() {
          const locs = patrolLocs();
          const done = locs.filter((l) => patrolOf(l.id));
          const rate = locs.length ? Math.round((done.length / locs.length) * 100) : 0;
          return `
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn btn-sm btn-ghost" type="button" id="clnPatrolPrev">‹ 前一日</button>
                <input id="clnPatrolDate" type="date" value="${esc(state.patrolDate)}" style="padding:8px 10px;border-radius:10px;border:1px solid rgba(17,24,39,.14);font-weight:800;font-family:inherit;"/>
                <button class="btn btn-sm btn-ghost" type="button" id="clnPatrolToday">今日</button>
                <button class="btn btn-sm btn-ghost" type="button" id="clnPatrolNext">後一日 ›</button>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-sm" type="button" id="clnPrintPatrol">列印</button>
                <button class="btn btn-sm" type="button" id="clnPdfPatrol">匯出 PDF</button>
              </div>
            </div>

            <div class="cln-metrics">
              ${metric("應巡點數", locs.length, "點")}
              ${metric("已完成", done.length, "點", "green")}
              ${metric("完成率", rate, "%", rate >= 100 ? "green" : (rate > 0 ? "amber" : "red"))}
            </div>

            ${locs.length === 0 ? `<div class="muted" style="padding:24px;text-align:center;">尚未設定巡邏位置，請至「設定」新增（用途選「巡邏位置」或「兩者皆是」）。</div>`
              : state.patrolLoading ? `<div class="muted" style="padding:24px;text-align:center;">讀取中...</div>`
              : `<section style="display:grid;gap:10px;">
                  <div class="cln-date-hd"><span>${esc(fmtDateKey(state.patrolDate))}</span><span class="n">完成 ${done.length} / ${locs.length}</span></div>
                  <div style="display:grid;gap:10px;">
                    ${locs.map((l) => {
                      const p = patrolOf(l.id);
                      const ok = !!p;
                      return `<div class="cln-row" style="padding:12px 14px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                          <div style="min-width:0;">
                            <div style="font-weight:900;font-size:calc(15px * var(--fs,1));">${esc(l.name || "未命名")}</div>
                            <div class="muted">${esc(l.zone || "未分區")}${ok ? `　· ${esc(fmtTime(p.createdAt))}　${esc(p.name || "")}${String(p.source || "") === "admin" ? "（後台）" : "（掃碼）"}` : ""}</div>
                          </div>
                          <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                            ${ok ? `<span class="tag green">已完成</span>` : `<span class="tag red">未完成</span>`}
                            <button class="btn btn-sm ${ok ? "btn-ghost" : "btn-primary"}" type="button" data-cln-patrol="${esc(l.id)}" data-cln-patrol-done="${ok ? "0" : "1"}">${ok ? "取消" : "標記完成"}</button>
                          </div>
                        </div>
                      </div>`;
                    }).join("")}
                  </div>
                </section>`}
          `;
        }

        function buildPatrolPrintHtml() {
          const locs = patrolLocs();
          const rows = locs.map((l) => {
            const p = patrolOf(l.id);
            return `<tr>
              <td>${esc(l.name || "未命名")}</td>
              <td>${esc(l.zone || "—")}</td>
              <td>${p ? "已完成" : "未完成"}</td>
              <td>${p ? esc(fmtTime(p.createdAt)) : "—"}</td>
              <td>${p ? esc(p.name || "—") : "—"}</td>
            </tr>`;
          }).join("");
          const done = locs.filter((l) => patrolOf(l.id)).length;
          return `<div class="dt">${esc(fmtDateKey(state.patrolDate))}<span class="n">完成 ${done} / ${locs.length}</span></div>
            <table>
              <thead><tr><th>巡邏點</th><th>區域</th><th>狀態</th><th>完成時間</th><th>完成人員</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="5">尚未設定巡邏位置</td></tr>`}</tbody>
            </table>`;
        }
        function printPatrol(auto) {
          openPrintWindow({
            title: "每日清潔巡邏紀錄",
            subtitle: `社區：${esc((ctx && ctx.communityName) || "")}　列印時間：${esc(fmtDateTime(new Date()))}`,
            bodyHtml: buildPatrolPrintHtml(),
            auto,
          });
        }

        /* ================= 設定 ================= */
        function settingsView() {
          const list = state.locations.slice().sort((a, b) => {
            const za = String(a.zone || ""); const zb = String(b.zone || "");
            if (za !== zb) return za.localeCompare(zb, "zh-Hant-TW");
            return (Number(a.order) || 0) - (Number(b.order) || 0);
          });
          return `
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;">
              <div style="display:flex;flex-wrap:wrap;gap:8px;">
                <button class="btn btn-sm btn-primary" type="button" id="clnAddLoc">＋ 新增位置</button>
                ${list.length === 0 ? `<button class="btn btn-sm btn-ghost" type="button" id="clnSeedLoc">載入預設位置</button>` : ""}
              </div>
              ${list.length ? `<button class="btn btn-sm" type="button" id="clnPrintQr">列印全部 QR code</button>` : ""}
            </div>
            <div class="muted">設定通報位置與巡邏位置；每個位置都有專屬 QR code 與注意事項，供住戶通報及清潔人員巡邏打卡使用。</div>
            ${list.length === 0 ? `<div class="muted" style="padding:24px;text-align:center;">尚未設定清潔位置，住戶端將無法選擇要通報的位置。</div>`
              : `<div style="display:grid;gap:10px;">${list.map(locationCard).join("")}</div>`}
          `;
        }

        function locationCard(loc) {
          const on = loc.enabled !== false;
          const k = kindOf(loc);
          const targets = qrTargets(loc).length;
          return `
            <div class="cln-row" style="padding:12px 14px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <div style="min-width:0;display:grid;gap:4px;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <div style="font-weight:900;font-size:calc(15px * var(--fs,1));">${esc(loc.name || "未命名位置")}</div>
                    ${kindTag(k)}
                    <span class="tag ${on ? "green" : ""}" style="${on ? "" : "background:rgba(107,114,128,.12);color:#4b5563;border-color:rgba(107,114,128,.24);"}">${on ? "啟用" : "停用"}</span>
                  </div>
                  <div class="muted">區域 ${esc(loc.zone || "未分區")}　· 排序 ${esc(loc.order == null ? 0 : loc.order)}　· 格位 (${esc(Number(loc.gridX) || 0)}, ${esc(Number(loc.gridY) || 0)})　· 代碼 ${esc(loc.code || "—")}</div>
                  <div class="muted">清潔重點：${esc(pointsOf(loc).join("、"))}（${pointModeOf(loc) === "single" ? "單選" : "複選"}）　· 頻率：${esc(freqText(loc))}</div>
                  ${loc.note ? `<div class="muted">注意事項：${esc(loc.note)}</div>` : ""}
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;">
                  <button class="btn btn-sm" type="button" data-cln-setting-loc="${esc(loc.id)}" title="清潔設定" aria-label="清潔設定" style="display:inline-flex;align-items:center;gap:6px;">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
                    設定
                  </button>
                  <button class="btn btn-sm" type="button" data-cln-qr="${esc(loc.id)}">QR code${targets > 1 ? "（2）" : ""}</button>
                  <button class="btn btn-sm" type="button" data-cln-edit-loc="${esc(loc.id)}">編輯</button>
                  <button class="btn btn-sm btn-danger" type="button" data-cln-del-loc="${esc(loc.id)}">刪除</button>
                </div>
              </div>
            </div>
          `;
        }

        /* ================= render / bind ================= */
        function header() {
          const pending = state.reports.filter((r) => statusOf(r) === "pending").length;
          return `
            <div class="card-hd">
              <div class="left">
                <div class="chip" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 12h4l3 4H7l3-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7.5 16 6 21.5M9.5 16 8.5 21.5M11.5 16 11 21.5M13.5 16l.5 5.5M15.5 16l1 5.5M17.5 16l2 5.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div>
                <div style="min-width:0;">
                  <h2>清潔通報</h2>
                  <p>掌握社區清潔狀況、指派人員、巡邏打卡與位置 QR code 設定。</p>
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                <div class="tag red">待處理 ${pending}</div>
              </div>
            </div>
          `;
        }

        function renderTabs() {
          const subnav = document.getElementById("subnav");
          if (!subnav) return;
          subnav.innerHTML = TABS.map((x) => {
            const active = state.tab === x.key;
            return `<button class="btn btn-sm ${active ? "btn-primary" : ""}" type="button" data-cln-tab="${x.key}"${active ? ' aria-current="page"' : ""}>${x.label}</button>`;
          }).join("");
          subnav.querySelectorAll("[data-cln-tab]").forEach((b) => {
            b.onclick = () => {
              state.tab = String(b.getAttribute("data-cln-tab") || "overview");
              if (state.tab === "patrol" && patrolDateBound !== state.patrolDate) watchPatrols(state.patrolDate);
              render();
            };
          });
        }

        function bodyView() {
          if (state.tab === "overview") return overviewView();
          if (state.tab === "map") return mapView();
          if (state.tab === "reports") return reportsView();
          if (state.tab === "patrol") return patrolView();
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
          container.querySelectorAll("[data-cln-map-loc]").forEach((b) => {
            b.onclick = () => openLocationPanel(b.getAttribute("data-cln-map-loc"));
          });
          container.querySelectorAll("[data-cln-filter]").forEach((b) => {
            b.onclick = () => { state.reportFilter = String(b.getAttribute("data-cln-filter") || "all"); render(); };
          });
          container.querySelectorAll("[data-cln-assign]").forEach((b) => {
            b.onclick = () => openAssignModal(b.getAttribute("data-cln-assign"));
          });
          container.querySelectorAll("[data-cln-processing]").forEach((b) => {
            b.onclick = () => updateReport(b.getAttribute("data-cln-processing"), { status: "processing" });
          });
          container.querySelectorAll("[data-cln-done]").forEach((b) => {
            b.onclick = () => updateReport(b.getAttribute("data-cln-done"), { status: "done" });
          });
          container.querySelectorAll("[data-cln-del-report]").forEach((b) => {
            b.onclick = () => deleteReport(b.getAttribute("data-cln-del-report"));
          });
          container.querySelectorAll("[data-cln-patrol]").forEach((b) => {
            b.onclick = () => togglePatrol(b.getAttribute("data-cln-patrol"), b.getAttribute("data-cln-patrol-done") === "1");
          });
          const addReport = container.querySelector("#clnAddReport");
          if (addReport) addReport.onclick = () => openReportModal(null);
          const printReports = container.querySelector("#clnPrintReports");
          if (printReports) printReports.onclick = () => printReports(false);
          const pdfReports = container.querySelector("#clnPdfReports");
          if (pdfReports) pdfReports.onclick = () => printReports(true);

          const prev = container.querySelector("#clnPatrolPrev");
          if (prev) prev.onclick = () => { state.patrolDate = shiftDateKey(state.patrolDate, -1); watchPatrols(state.patrolDate); render(); };
          const next = container.querySelector("#clnPatrolNext");
          if (next) next.onclick = () => { state.patrolDate = shiftDateKey(state.patrolDate, 1); watchPatrols(state.patrolDate); render(); };
          const tdy = container.querySelector("#clnPatrolToday");
          if (tdy) tdy.onclick = () => { state.patrolDate = todayKey(); watchPatrols(state.patrolDate); render(); };
          const pd = container.querySelector("#clnPatrolDate");
          if (pd) pd.onchange = () => {
            const v = String(pd.value || "").trim();
            if (!v) return;
            state.patrolDate = v;
            watchPatrols(v);
            render();
          };
          const printPatrol = container.querySelector("#clnPrintPatrol");
          if (printPatrol) printPatrol.onclick = () => printPatrol(false);
          const pdfPatrol = container.querySelector("#clnPdfPatrol");
          if (pdfPatrol) pdfPatrol.onclick = () => printPatrol(true);

          const addLoc = container.querySelector("#clnAddLoc");
          if (addLoc) addLoc.onclick = () => openLocationModal(null);
          const seedLoc = container.querySelector("#clnSeedLoc");
          if (seedLoc) seedLoc.onclick = () => seedLocations();
          const printQr = container.querySelector("#clnPrintQr");
          if (printQr) printQr.onclick = () => printAllQr();
          container.querySelectorAll("[data-cln-qr]").forEach((b) => {
            b.onclick = () => {
              const id = String(b.getAttribute("data-cln-qr") || "");
              const loc = state.locations.find((x) => x.id === id);
              if (loc) openQrModal(loc);
            };
          });
          container.querySelectorAll("[data-cln-edit-loc]").forEach((b) => {
            b.onclick = () => {
              const id = String(b.getAttribute("data-cln-edit-loc") || "");
              const loc = state.locations.find((x) => x.id === id);
              if (loc) openLocationModal(loc);
            };
          });
          container.querySelectorAll("[data-cln-setting-loc]").forEach((b) => {
            b.onclick = () => {
              const id = String(b.getAttribute("data-cln-setting-loc") || "");
              const loc = state.locations.find((x) => x.id === id);
              if (loc) openLocSettingModal(loc);
            };
          });
          container.querySelectorAll("[data-cln-del-loc]").forEach((b) => {
            b.onclick = () => deleteLocation(b.getAttribute("data-cln-del-loc"));
          });
        }

        /* ================= 動作：通報 ================= */
        async function updateReport(id, patch) {
          if (!id) return;
          try {
            const payload = Object.assign({}, patch, { updatedAt: serverTs() });
            if (patch.status === "done") {
              payload.handledBy = uidOf();
              payload.handledByName = myName;
              payload.handledAt = serverTs();
            }
            await refReports().doc(String(id)).set(payload, { merge: true });
            toast("已更新狀態");
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "更新失敗"), true);
          }
        }

        async function deleteReport(id) {
          if (!id) return;
          if (!window.confirm("確定要刪除這筆清潔通報？")) return;
          try {
            await refReports().doc(String(id)).delete();
            toast("已刪除");
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "刪除失敗"), true);
          }
        }

        function openAssignModal(reportId) {
          const r = state.reports.find((x) => x.id === reportId);
          if (!r) return;
          const duty = dutyOf();
          const list = assigneeList();
          const selectedUid = String(r.assigneeUid || "").trim() || (duty ? duty.uid : "");
          const opts = list.map((c) => `<option value="${esc(c.id)}"${c.id === selectedUid ? " selected" : ""}>${esc(c.name)}${c.duty ? "（今日值班）" : ""}</option>`).join("");
          const m = openSimpleModal({
            title: "指派清潔人員",
            width: "min(460px, 92vw)",
            bodyHtml: `
              <div style="display:grid;gap:12px;">
                <div class="muted">位置：<b>${esc(r.locationName || r.location || "未指定位置")}</b></div>
                ${list.length === 0
                  ? `<div class="tag yellow">尚無清潔人員，請先至「管理帳號」新增類別為「清潔」的人員</div>`
                  : `<div class="field" style="gap:4px;margin:0;">
                      <label style="font-size:calc(12px * var(--fs,1));font-weight:800;">清潔人員</label>
                      <select id="cln_assign_uid" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;">
                        <option value="">（取消指派）</option>
                        ${opts}
                      </select>
                    </div>`}
              </div>
            `,
            footerHtml: `<button class="btn btn-ghost" type="button" id="cln_assign_cancel">取消</button><button class="btn btn-primary" type="button" id="cln_assign_save">儲存</button>`,
          });
          m.modal.querySelector("#cln_assign_cancel").onclick = m.close;
          const saveBtn = m.modal.querySelector("#cln_assign_save");
          saveBtn.onclick = async () => {
            const sel = m.modal.querySelector("#cln_assign_uid");
            const uid = sel ? String(sel.value || "") : "";
            const c = list.find((x) => x.id === uid);
            saveBtn.disabled = true;
            saveBtn.textContent = "儲存中…";
            try {
              const payload = {
                assigneeUid: uid,
                assigneeName: c ? c.name : "",
                assignedAt: uid ? serverTs() : null,
                assignedBy: myName,
                updatedAt: serverTs(),
              };
              if (uid && statusOf(r) === "pending") payload.status = "processing";
              await refReports().doc(String(r.id)).set(payload, { merge: true });
              m.close();
              toast(uid ? `已指派給 ${c ? c.name : ""}` : "已取消指派");
            } catch (e) {
              console.error(e);
              toast(fbErr(e, "指派失敗"), true);
              saveBtn.disabled = false;
              saveBtn.textContent = "儲存";
            }
          };
        }

        function openReportModal() {
          const locs = reportLocs();
          const duty = dutyOf();
          const list = assigneeList();
          const m = openSimpleModal({
            title: "新增清潔通報（管理室）",
            width: "min(520px, 92vw)",
            bodyHtml: `
              <div style="display:grid;gap:12px;">
                ${locs.length === 0
                  ? `<div class="tag yellow">尚未設定可通報的位置，請先至「設定」新增</div>`
                  : `<div class="field" style="gap:4px;margin:0;">
                      <label style="font-size:calc(12px * var(--fs,1));font-weight:800;">位置 *</label>
                      <select id="cln_rp_loc" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;">
                        ${locs.map((l) => `<option value="${esc(l.id)}">${esc(l.name || "未命名")}${l.zone ? `（${esc(l.zone)}）` : ""}</option>`).join("")}
                      </select>
                    </div>`}
                <div class="field" style="gap:4px;margin:0;">
                  <label style="font-size:calc(12px * var(--fs,1));font-weight:800;">指派人員（可略）</label>
                  <select id="cln_rp_assign" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;">
                    <option value="">（稍後指派）</option>
                    ${list.map((c) => `<option value="${esc(c.id)}"${duty && c.id === duty.uid ? " selected" : ""}>${esc(c.name)}${c.duty ? "（今日值班）" : ""}</option>`).join("")}
                  </select>
                </div>
                <div class="field" style="gap:4px;margin:0;">
                  <label style="font-size:calc(12px * var(--fs,1));font-weight:800;">備註</label>
                  <textarea id="cln_rp_note" placeholder="例如：垃圾間異味明顯" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;min-height:70px;font-weight:800;font-family:inherit;"></textarea>
                </div>
              </div>
            `,
            footerHtml: `<button class="btn btn-ghost" type="button" id="cln_rp_cancel">取消</button><button class="btn btn-primary" type="button" id="cln_rp_save">送出通報</button>`,
          });
          m.modal.querySelector("#cln_rp_cancel").onclick = m.close;
          const saveBtn = m.modal.querySelector("#cln_rp_save");
          saveBtn.onclick = async () => {
            const locSel = m.modal.querySelector("#cln_rp_loc");
            if (!locSel) { toast("尚未設定可通報的位置", true); return; }
            const locId = String(locSel.value || "");
            const loc = locs.find((x) => x.id === locId);
            if (!loc) { toast("請選擇位置", true); return; }
            const asgSel = m.modal.querySelector("#cln_rp_assign");
            const assigneeUid = asgSel ? String(asgSel.value || "") : "";
            const assignee = list.find((x) => x.id === assigneeUid);
            const note = String(m.modal.querySelector("#cln_rp_note").value || "").trim();
            saveBtn.disabled = true;
            saveBtn.textContent = "送出中…";
            try {
              const now = serverTs();
              // 新增一律以 pending 建立（符合 clean_reports 的 create 規則），指派再以更新寫入
              const docRef = await refReports().add({
                locationId: loc.id,
                locationName: loc.name || "",
                note,
                status: "pending",
                source: "admin",
                reporterUid: uidOf(),
                reporterName: myName || "管理室",
                reporterRole: myRole || "管理室",
                reporterHouseNo: "",
                assigneeUid: "",
                assigneeName: "",
                assignedAt: null,
                assignedBy: "",
                createdAt: now,
                updatedAt: now,
              });
              if (assigneeUid && docRef) {
                await docRef.set({
                  assigneeUid,
                  assigneeName: assignee ? assignee.name : "",
                  assignedAt: serverTs(),
                  assignedBy: myName,
                  status: "processing",
                  updatedAt: serverTs(),
                }, { merge: true });
              }
              m.close();
              toast("已送出清潔通報");
            } catch (e) {
              console.error(e);
              toast(fbErr(e, "送出失敗"), true);
              saveBtn.disabled = false;
              saveBtn.textContent = "送出通報";
            }
          };
        }

        /* 地圖區塊 → 位置明細（含通報與指派） */
        function openLocationPanel(locId) {
          const loc = state.locations.find((x) => x.id === locId);
          if (!loc) return;
          const rs = reportsOfLoc(locId).sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt)).slice(0, 20);
          const st = locStatus(loc);
          const m = openSimpleModal({
            title: String(loc.name || "未命名位置"),
            width: "min(560px, 94vw)",
            bodyHtml: `
              <div style="display:grid;gap:12px;">
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                  ${kindTag(kindOf(loc))}
                  <span class="tag ${st.cls === "red" ? "red" : st.cls === "orange" ? "yellow" : "green"}">${esc(st.text)}</span>
                  <span class="muted">區域 ${esc(loc.zone || "未分區")}</span>
                </div>
                ${loc.note ? `<div class="muted">注意事項：${esc(loc.note)}</div>` : ""}
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <button class="btn btn-sm btn-primary" type="button" id="cln_lp_add">＋ 在此新增通報</button>
                </div>
                <div style="font-weight:900;font-size:calc(13px * var(--fs,1));">通報紀錄（近 20 筆）</div>
                ${rs.length === 0 ? `<div class="muted">此位置目前沒有通報紀錄。</div>`
                  : `<div style="display:grid;gap:10px;">${rs.map((r) => `
                      <div style="padding:10px 12px;border-radius:14px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);display:grid;gap:6px;">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                          <span class="muted">${esc(fmtDateTime(r.createdAt))}　${esc(String(r.source || "resident") === "admin" ? "管理室" : "住戶")}</span>
                          <span style="display:flex;gap:6px;align-items:center;">
                            ${r.assigneeName ? `<span class="cln-tag report">${esc(r.assigneeName)}</span>` : ""}
                            ${reportStatusTag(statusOf(r))}
                          </span>
                        </div>
                        ${r.note ? `<div style="font-size:calc(13px * var(--fs,1));color:#374151;white-space:pre-wrap;word-break:break-word;">${esc(r.note)}</div>` : ""}
                        <div style="display:flex;gap:8px;flex-wrap:wrap;">
                          ${statusOf(r) !== "done" ? `<button class="btn btn-sm btn-ghost" type="button" data-cln-lp-assign="${esc(r.id)}">指派</button>
                          <button class="btn btn-sm btn-primary" type="button" data-cln-lp-done="${esc(r.id)}">標記完成</button>` : ""}
                        </div>
                      </div>`).join("")}</div>`}
              </div>
            `,
          });
          const addBtn = m.modal.querySelector("#cln_lp_add");
          if (addBtn) addBtn.onclick = () => { m.close(); openReportModal(); };
          m.modal.querySelectorAll("[data-cln-lp-assign]").forEach((b) => {
            b.onclick = () => { m.close(); openAssignModal(b.getAttribute("data-cln-lp-assign")); };
          });
          m.modal.querySelectorAll("[data-cln-lp-done]").forEach((b) => {
            b.onclick = () => { m.close(); updateReport(b.getAttribute("data-cln-lp-done"), { status: "done" }); };
          });
        }

        /* ================= 動作：巡邏 ================= */
        async function togglePatrol(locId, markDone) {
          const loc = state.locations.find((x) => x.id === locId);
          if (!loc) return;
          const docId = `${state.patrolDate}__${loc.id}`;
          try {
            if (markDone) {
              const now = serverTs();
              await refPatrols().doc(docId).set({
                communityId: cid,
                dateKey: state.patrolDate,
                locationId: loc.id,
                locationName: loc.name || "",
                zone: loc.zone || "",
                uid: uidOf(),
                name: myName || "管理室",
                source: "admin",
                createdAt: now,
                updatedAt: now,
              }, { merge: true });
              toast("已標記完成");
            } else {
              await refPatrols().doc(docId).delete();
              toast("已取消完成");
            }
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "更新失敗"), true);
          }
        }

        /* ================= 動作：位置設定 ================= */
        async function deleteLocation(id) {
          if (!id) return;
          if (!window.confirm("確定要刪除這個清潔位置？（QR code 將同時失效）")) return;
          try {
            await refLocations().doc(String(id)).delete();
            toast("已刪除");
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "刪除失敗"), true);
          }
        }

        async function seedLocations() {
          try {
            const batch = db.batch();
            DEFAULT_LOCATIONS.forEach((item, i) => {
              const ref = refLocations().doc();
              batch.set(ref, {
                name: item.name,
                zone: item.zone,
                kind: item.kind,
                order: (i + 1) * 10,
                gridX: (i % 4) + 1,
                gridY: Math.floor(i / 4) + 1,
                enabled: true,
                note: "",
                code: genCode(8),
                points: ["清潔"],
                pointMode: "multi",
                freq: { type: "day", times: 1, days: 1 },
                createdAt: serverTs(),
                updatedAt: serverTs(),
              });
            });
            await batch.commit();
            toast("已載入預設位置");
          } catch (e) {
            console.error(e);
            toast(fbErr(e, "載入失敗"), true);
          }
        }

        function openLocationModal(loc) {
          const isEdit = Boolean(loc);
          const k = isEdit ? kindOf(loc) : "report";
          const m = openSimpleModal({
            title: (isEdit ? "編輯" : "新增") + "清潔位置",
            width: "min(560px, 94vw)",
            bodyHtml: `
              <div style="display:grid;gap:12px;">
                <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">位置名稱 *</label><input id="cln_loc_name" type="text" value="${esc(isEdit ? (loc.name || "") : "")}" placeholder="例如：一樓大廳" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/></div>
                <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">用途 *</label>
                  <select id="cln_loc_kind" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;">
                    ${KIND_OPTIONS.map((o) => `<option value="${o.key}" ${k === o.key ? "selected" : ""}>${o.label}</option>`).join("")}
                  </select>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">區域</label><input id="cln_loc_zone" type="text" value="${esc(isEdit ? (loc.zone || "") : "")}" placeholder="例如：1F / B1" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/></div>
                  <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">排序</label><input id="cln_loc_order" type="number" value="${esc(isEdit ? (loc.order == null ? 0 : loc.order) : ((state.locations.length + 1) * 10))}" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                  <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">地圖格位 X（欄）</label><input id="cln_loc_gx" type="number" min="0" value="${esc(isEdit ? (Number(loc.gridX) || 0) : 0)}" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/></div>
                  <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">地圖格位 Y（列）</label><input id="cln_loc_gy" type="number" min="0" value="${esc(isEdit ? (Number(loc.gridY) || 0) : 0)}" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;"/></div>
                </div>
                <div class="muted">格位為 0 時，地圖會自動依排序排列。</div>
                <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">注意事項</label><textarea id="cln_loc_note" placeholder="例如：含垃圾分類區，請留意資源回收時段" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;min-height:70px;font-weight:800;font-family:inherit;">${esc(isEdit ? (loc.note || "") : "")}</textarea></div>
                <div class="field" style="gap:4px;margin:0;"><label style="font-size:calc(12px * var(--fs,1));font-weight:800;">位置代碼（QR code）</label><input id="cln_loc_code" type="text" value="${esc(isEdit ? (loc.code || "") : "")}" placeholder="留空將自動產生 8 碼" style="padding:11px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);width:100%;font-weight:800;font-family:inherit;letter-spacing:1px;"/></div>
                <label style="display:flex;align-items:center;gap:8px;font-size:calc(13px * var(--fs,1));font-weight:800;"><input id="cln_loc_enabled" type="checkbox" ${(!isEdit || loc.enabled !== false) ? "checked" : ""}/> 啟用</label>
              </div>
            `,
            footerHtml: `<button class="btn btn-ghost" type="button" id="cln_loc_cancel">取消</button><button class="btn btn-primary" type="button" id="cln_loc_save">${isEdit ? "儲存" : "建立"}</button>`,
          });
          const saveBtn = m.modal.querySelector("#cln_loc_save");
          m.modal.querySelector("#cln_loc_cancel").onclick = m.close;
          saveBtn.onclick = async () => {
            const name = String(m.modal.querySelector("#cln_loc_name").value || "").trim();
            const kind = String(m.modal.querySelector("#cln_loc_kind").value || "report");
            const zone = String(m.modal.querySelector("#cln_loc_zone").value || "").trim();
            const order = Number(m.modal.querySelector("#cln_loc_order").value) || 0;
            const gridX = Number(m.modal.querySelector("#cln_loc_gx").value) || 0;
            const gridY = Number(m.modal.querySelector("#cln_loc_gy").value) || 0;
            const note = String(m.modal.querySelector("#cln_loc_note").value || "").trim();
            const code = String(m.modal.querySelector("#cln_loc_code").value || "").trim().toUpperCase() || genCode(8);
            const enabled = !!m.modal.querySelector("#cln_loc_enabled").checked;
            if (!name) { toast("請輸入位置名稱", true); return; }
            saveBtn.disabled = true;
            saveBtn.textContent = "儲存中…";
            try {
              const payload = { name, kind, zone, order, gridX, gridY, note, code, enabled, updatedAt: serverTs() };
              if (isEdit) {
                await refLocations().doc(String(loc.id)).set(payload, { merge: true });
              } else {
                payload.createdAt = serverTs();
                await refLocations().add(payload);
              }
              m.close();
              toast(isEdit ? "已更新位置" : "已新增位置");
            } catch (e) {
              console.error(e);
              toast(fbErr(e, "儲存失敗"), true);
              saveBtn.disabled = false;
              saveBtn.textContent = isEdit ? "儲存" : "建立";
            }
          };
        }

        /* ================= 清潔設定（清潔重點／頻率） ================= */
        function openLocSettingModal(loc) {
          if (!loc) return;
          let points = pointsOf(loc).slice();
          const mode0 = pointModeOf(loc);
          const f0 = freqOf(loc);

          const pointChip = (p) => {
            const on = points.indexOf(p) >= 0;
            return `<button type="button" data-set-point="${esc(p)}" style="padding:8px 12px;border-radius:999px;border:1px solid ${on ? "var(--brand, #d32f2f)" : "rgba(17,24,39,.14)"};background:${on ? "#fee2e2" : "#fff"};color:${on ? "#b91c1c" : "#374151"};font-weight:900;font-size:calc(13px * var(--fs,1));cursor:pointer;">${on ? "✓ " : ""}${esc(p)}</button>`;
          };

          const m = openSimpleModal({
            title: `清潔設定｜${loc.name || "未命名位置"}`,
            width: "min(560px, 94vw)",
            bodyHtml: `
              <div style="display:grid;gap:16px;">
                <div style="display:grid;gap:8px;">
                  <div style="font-weight:900;font-size:calc(13px * var(--fs,1));">清潔重點<span class="muted" style="font-weight:700;">（預設：清潔）</span></div>
                  <div id="clnSetPts" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
                  <div style="display:flex;gap:8px;">
                    <input id="clnSetNewPt" type="text" placeholder="新增項目，例如：飲水機擦拭" style="flex:1;padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.14);font-weight:800;font-family:inherit;"/>
                    <button class="btn btn-sm" type="button" id="clnSetAddPt">新增</button>
                  </div>
                  <div class="muted">這些項目會出現在清潔人員掃碼後的勾選視窗。</div>
                </div>

                <div style="display:grid;gap:8px;">
                  <div style="font-weight:900;font-size:calc(13px * var(--fs,1));">清潔人員勾選方式</div>
                  <div style="display:flex;gap:18px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:8px;font-weight:800;"><input type="radio" name="clnSetMode" value="single" ${mode0 === "single" ? "checked" : ""}/> 單選</label>
                    <label style="display:flex;align-items:center;gap:8px;font-weight:800;"><input type="radio" name="clnSetMode" value="multi" ${mode0 === "multi" ? "checked" : ""}/> 複選</label>
                  </div>
                </div>

                <div style="display:grid;gap:8px;">
                  <div style="font-weight:900;font-size:calc(13px * var(--fs,1));">清潔頻率</div>
                  <div style="display:flex;gap:18px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:8px;font-weight:800;"><input type="radio" name="clnSetFreq" value="day" ${f0.type === "day" ? "checked" : ""}/> 一日多次</label>
                    <label style="display:flex;align-items:center;gap:8px;font-weight:800;"><input type="radio" name="clnSetFreq" value="span" ${f0.type === "span" ? "checked" : ""}/> 多日一次</label>
                  </div>
                  <div id="clnSetFreqDay" style="display:${f0.type === "day" ? "flex" : "none"};align-items:center;gap:8px;font-weight:800;flex-wrap:wrap;">
                    每 1 日
                    <input id="clnSetTimes" type="number" min="1" max="48" value="${f0.times}" style="width:84px;padding:9px 10px;border-radius:10px;border:1px solid rgba(17,24,39,.14);font-weight:800;font-family:inherit;text-align:center;"/>
                    次
                  </div>
                  <div id="clnSetFreqSpan" style="display:${f0.type === "span" ? "flex" : "none"};align-items:center;gap:8px;font-weight:800;flex-wrap:wrap;">
                    每
                    <input id="clnSetDays" type="number" min="1" max="365" value="${f0.days}" style="width:84px;padding:9px 10px;border-radius:10px;border:1px solid rgba(17,24,39,.14);font-weight:800;font-family:inherit;text-align:center;"/>
                    日 1 次
                  </div>
                </div>
              </div>
            `,
            footerHtml: `<button class="btn btn-ghost" type="button" id="clnSetCancel">取消</button><button class="btn btn-primary" type="button" id="clnSetSave">儲存設定</button>`,
          });

          const ptsBox = m.modal.querySelector("#clnSetPts");
          const renderPts = () => {
            const all = Array.from(new Set(POINT_OPTIONS.concat(points)));
            ptsBox.innerHTML = all.map(pointChip).join("");
            ptsBox.querySelectorAll("[data-set-point]").forEach((b) => {
              b.onclick = () => {
                const p = String(b.getAttribute("data-set-point") || "");
                const i = points.indexOf(p);
                if (i >= 0) points.splice(i, 1); else points.push(p);
                renderPts();
              };
            });
          };
          renderPts();

          m.modal.querySelector("#clnSetAddPt").onclick = () => {
            const inp = m.modal.querySelector("#clnSetNewPt");
            const v = String(inp.value || "").trim();
            if (!v) { toast("請輸入清潔重點名稱", true); return; }
            if (points.indexOf(v) < 0) points.push(v);
            inp.value = "";
            renderPts();
          };

          m.modal.querySelectorAll('input[name="clnSetFreq"]').forEach((r) => {
            r.onchange = () => {
              const day = m.modal.querySelector('input[name="clnSetFreq"]:checked');
              const isDay = !day || day.value === "day";
              m.modal.querySelector("#clnSetFreqDay").style.display = isDay ? "flex" : "none";
              m.modal.querySelector("#clnSetFreqSpan").style.display = isDay ? "none" : "flex";
            };
          });

          m.modal.querySelector("#clnSetCancel").onclick = m.close;
          const saveBtn = m.modal.querySelector("#clnSetSave");
          saveBtn.onclick = async () => {
            const modeEl = m.modal.querySelector('input[name="clnSetMode"]:checked');
            const freqEl = m.modal.querySelector('input[name="clnSetFreq"]:checked');
            const freqType = freqEl && freqEl.value === "span" ? "span" : "day";
            const times = Math.max(1, Number(m.modal.querySelector("#clnSetTimes").value) || 1);
            const days = Math.max(1, Number(m.modal.querySelector("#clnSetDays").value) || 1);
            const payload = {
              points: points.length ? points : ["清潔"],
              pointMode: modeEl && modeEl.value === "single" ? "single" : "multi",
              freq: { type: freqType, times, days },
              updatedAt: serverTs(),
            };
            saveBtn.disabled = true;
            saveBtn.textContent = "儲存中…";
            try {
              await refLocations().doc(String(loc.id)).set(payload, { merge: true });
              m.close();
              toast("已更新清潔設定");
            } catch (e) {
              console.error(e);
              toast(fbErr(e, "儲存失敗"), true);
              saveBtn.disabled = false;
              saveBtn.textContent = "儲存設定";
            }
          };
        }

        function openQrModal(loc) {
          const targets = qrTargets(loc);
          const m = openSimpleModal({
            title: `QR code｜${loc.name || "未命名位置"}`,
            width: "min(560px, 94vw)",
            bodyHtml: `
              <div style="display:grid;gap:12px;">
                <div class="muted">位置代碼：<b style="letter-spacing:1px;">${esc(loc.code || "—")}</b>　區域：${esc(loc.zone || "未分區")}</div>
                ${targets.length === 0 ? `<div class="tag yellow">此位置尚未設定用途</div>`
                  : `<div class="cln-qr-grid">${targets.map((t) => `
                      <div class="cln-qr-card">
                        <div class="lb">${esc(t.label)}</div>
                        ${qrSvg(t.url, 170)}
                        <div class="cd">${esc(loc.code || "")}</div>
                        <div class="ur">${esc(t.url)}</div>
                      </div>`).join("")}</div>`}
                ${loc.note ? `<div style="padding:10px 12px;border-radius:12px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);"><div style="font-weight:900;font-size:calc(12px * var(--fs,1));margin-bottom:4px;">注意事項</div><div style="font-size:calc(13px * var(--fs,1));color:#374151;white-space:pre-wrap;">${esc(loc.note)}</div></div>` : ""}
              </div>
            `,
            footerHtml: `<button class="btn btn-ghost" type="button" id="cln_qr_close">關閉</button><button class="btn btn-sm" type="button" id="cln_qr_print">列印 QR code</button><button class="btn btn-primary" type="button" id="cln_qr_copy">複製連結</button>`,
          });
          m.modal.querySelector("#cln_qr_close").onclick = m.close;
          const printBtn = m.modal.querySelector("#cln_qr_print");
          if (printBtn) printBtn.onclick = () => printQrLabels([loc]);
          const copyBtn = m.modal.querySelector("#cln_qr_copy");
          if (copyBtn) copyBtn.onclick = async () => {
            const text = targets.map((t) => `${t.label}：${t.url}`).join("\n");
            try {
              await navigator.clipboard.writeText(text);
              toast("已複製連結");
            } catch {
              toast("複製失敗，請手動複製", true);
            }
          };
        }

        function buildQrLabelsHtml(locs) {
          return `<div class="qrwrap">${locs.map((loc) => qrTargets(loc).map((t) => `
            <div class="qrbox">
              <div class="nm">${esc(loc.name || "未命名位置")}</div>
              ${qrSvg(t.url, 150)}
              <div class="zt">${esc(t.label)}　代碼 ${esc(loc.code || "")}</div>
              <div class="zt">${esc(t.url)}</div>
              ${loc.note ? `<div class="nt">${esc(loc.note)}</div>` : ""}
            </div>`).join("")).join("")}</div>`;
        }
        function printQrLabels(locs) {
          if (!locs.length) { toast("尚無位置可列印", true); return; }
          openPrintWindow({
            title: "清潔位置 QR code",
            subtitle: `社區：${esc((ctx && ctx.communityName) || "")}　列印時間：${esc(fmtDateTime(new Date()))}`,
            bodyHtml: buildQrLabelsHtml(locs),
            auto: false,
          });
        }
        function printAllQr() {
          printQrLabels(state.locations.filter((l) => l.enabled !== false));
        }

        /* ================= boot ================= */
        subscribe();
        watchPatrols(state.patrolDate);
        loadMyName();
        loadCleaners();
      },
    },
  };
})();
