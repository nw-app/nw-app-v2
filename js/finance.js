/*
 * 財報系統模組（finance）
 * 命名空間：window.NwFinance = { Model, UI, Export }
 * 子分頁：總覽 / 收入明細 / 支出明細 / 銀行明細 / 管理費 / 報表匯出 / 收入名單 / 支出名單 / 設定
 * Firestore：
 *   communities/{cid}/financeTx/{id}          財報明細（kind: income | expense）
 *   communities/{cid}/financeBooks/{id}       帳本（活存／定存／現金／其他）
 *   communities/{cid}/financeBank/{id}        帳本存入／提出紀錄（bookId 指向帳本）
 *   communities/{cid}/financeFee/{userId}     住戶每月管理費金額
 *   communities/{cid}/financeBudgets/{年度}   年度預算（科目、金額）
 *   communities/{cid}/financeNotices/{id}     管理費催收通知紀錄（含免登入公開連結所需內容）
 *   communities/{cid}/financeAudit/{id}       稽核紀錄（刪除等留痕動作，含當時快照與原因）
 *   communities/{cid}/financeConfig/config    類別、帳本類型、對象名單與催收通知設定
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* 共用工具                                                            */
  /* ------------------------------------------------------------------ */

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function nowStamp() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function toNum(v, fallback) {
    const n = Number(String(v == null ? "" : v).replace(/[,\s$]/g, ""));
    if (Number.isFinite(n)) return n;
    return typeof fallback === "number" ? fallback : 0;
  }

  function fmtMoney(v) {
    const n = toNum(v, 0);
    return n.toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function genId(prefix) {
    return String(prefix || "fin") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function sanitizeFilename(name) {
    return String(name == null ? "" : name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "community";
  }

  function toast(msg, isErr) {
    const tEl = document.getElementById("toast");
    if (!tEl) {
      if (isErr) console.warn("[finance]", msg);
      return;
    }
    tEl.textContent = String(msg || "");
    tEl.classList.add("show");
    tEl.style.background = isErr ? "rgba(220,38,38,.95)" : "rgba(17,24,39,.92)";
    tEl.style.color = "#fff";
    tEl.style.zIndex = "999999";
    window.clearTimeout(tEl._finT);
    tEl._finT = window.setTimeout(function () {
      tEl.classList.remove("show");
      tEl.textContent = "";
    }, 2000);
  }

  function getDb() {
    const fb = window.firebase;
    return fb && fb.firestore ? fb.firestore() : null;
  }

  function serverTs() {
    const fb = window.firebase;
    if (fb && fb.firestore && fb.firestore.FieldValue && fb.firestore.FieldValue.serverTimestamp) {
      return fb.firestore.FieldValue.serverTimestamp();
    }
    return Date.now();
  }

  function fmtDateTime(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function tsToStr(ts) {
    if (!ts) return "";
    try {
      if (typeof ts.toDate === "function") return fmtDateTime(ts.toDate());
      if (typeof ts === "number") return fmtDateTime(new Date(ts));
      if (typeof ts === "string") return ts;
    } catch (e) { /* 忽略 */ }
    return "";
  }

  /**
   * 將圖片檔壓縮為 Base64（最大邊 maxEdge、JPEG 品質 quality）。
   * 以 Base64 存入 Firestore，符合「零付費、不使用 Cloud Storage」原則。
   */
  function compressImageFile(file, maxEdge, quality) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error("未選擇圖片")); return; }
      if (!/^image\//.test(String(file.type || ""))) { reject(new Error("僅支援圖片檔")); return; }
      const limit = toNum(maxEdge, 1024) || 1024;
      const q = typeof quality === "number" ? quality : 0.72;
      const reader = new FileReader();
      reader.onerror = function () { reject(new Error("讀取失敗")); };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error("圖片格式不支援")); };
        img.onload = function () {
          try {
            const sw = img.naturalWidth || img.width;
            const sh = img.naturalHeight || img.height;
            let w = sw;
            let h = sh;
            if (sw > limit || sh > limit) {
              const s = Math.min(limit / sw, limit / sh);
              w = Math.max(1, Math.round(sw * s));
              h = Math.max(1, Math.round(sh * s));
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) { reject(new Error("無法處理圖片")); return; }
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const out = canvas.toDataURL("image/jpeg", q);
            if (!out) { reject(new Error("編碼失敗")); return; }
            resolve(out);
          } catch (e) {
            reject(e);
          }
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  /** 去除空白與重複的項目 */
  function cleanList(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(function (v) {
      const s = String(v == null ? "" : v).trim();
      if (s && out.indexOf(s) === -1) out.push(s);
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 樣式（僅注入一次，全部以 fin- 前綴避免衝突）                          */
  /* ------------------------------------------------------------------ */

  function ensureStyles() {
    if (document.getElementById("finStyles")) return;
    const st = document.createElement("style");
    st.id = "finStyles";
    st.textContent = [
      ".fin-page .card-bd{gap:14px;}",
      ".fin-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;}",
      ".fin-toolbar .field{margin:0;min-width:120px;}",
      ".fin-toolbar .field > label{font-size:calc(11px * var(--fs, 1));font-weight:800;color:#6b7280;}",
      ".fin-toolbar input,.fin-toolbar select{padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);font-weight:700;width:100%;}",
      ".fin-stat-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));}",
      ".fin-stat{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(17,24,39,.10);box-shadow:0 8px 22px rgba(17,24,39,.05);}",
      ".fin-stat .k{font-size:calc(11px * var(--fs, 1));font-weight:800;color:#6b7280;}",
      ".fin-stat .v{margin-top:4px;font-size:calc(20px * var(--fs, 1));font-weight:900;letter-spacing:.3px;}",
      ".fin-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:14px;border:1px solid rgba(17,24,39,.10);background:#fff;}",
      ".fin-table{width:100%;border-collapse:collapse;min-width:640px;}",
      ".fin-table th,.fin-table td{padding:10px 12px;font-size:calc(13px * var(--fs, 1));text-align:left;border-bottom:1px solid rgba(17,24,39,.08);white-space:nowrap;}",
      ".fin-table th{background:#f9fafb;font-weight:900;color:#374151;font-size:calc(12px * var(--fs, 1));}",
      ".fin-table tbody tr:last-child td{border-bottom:none;}",
      ".fin-table td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:800;}",
      ".fin-table .ops{display:flex;gap:6px;flex-wrap:wrap;}",
      ".fin-btn-notice{background:#b45309;border-color:rgba(0,0,0,.08);color:#fff;}",
      ".fin-btn-notice:hover{box-shadow:0 12px 26px rgba(180,83,9,.32);}",
      ".btn-line{background:#06C755;border-color:rgba(0,0,0,0);color:#fff;}",
      ".btn-line:hover{filter:brightness(.96);}",
      ".fin-tag{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:999px;font-size:calc(12px * var(--fs, 1));font-weight:900;}",
      ".fin-empty{padding:26px;text-align:center;color:#6b7280;font-weight:700;}",
      ".fin-cfg-block{border:1px solid rgba(17,24,39,.10);border-radius:16px;background:#fff;padding:12px 14px;display:grid;gap:10px;box-shadow:0 8px 22px rgba(17,24,39,.04);}",
      ".fin-cfg-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
      ".fin-cfg-title{font-size:calc(13px * var(--fs, 1));font-weight:900;color:#374151;}",
      ".fin-chips{display:flex;flex-wrap:wrap;gap:8px;}",
      ".fin-chip{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 6px 0 12px;border-radius:999px;background:#f3f4f6;border:1px solid rgba(17,24,39,.10);font-size:calc(12px * var(--fs, 1));font-weight:800;color:#374151;}",
      ".fin-chip-x{width:20px;height:20px;border:0;padding:0;border-radius:50%;background:rgba(220,38,38,.12);color:#b91c1c;font-size:calc(14px * var(--fs, 1));line-height:1;font-weight:900;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}",
      ".fin-chip-x:hover{background:rgba(220,38,38,.24);}",
      ".fin-cfg-add{display:flex;gap:8px;align-items:center;}",
      ".fin-cfg-add input{flex:1 1 auto;min-width:0;padding:9px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);font-weight:700;}",
      ".fin-hint{font-size:calc(12px * var(--fs, 1));color:#6b7280;font-weight:700;line-height:1.75;}",
      ".fin-table td .ops .btn[disabled]{opacity:.35;pointer-events:none;}",
      "@media (max-width:768px){",
      ".fin-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr));}",
      ".fin-toolbar .field{flex:1 1 140px;}",
      ".fin-table th,.fin-table td{padding:9px 10px;font-size:calc(12px * var(--fs, 1));}",
      "}",
      /* 行動版：支援卡片化的表格改為「每筆一張卡」呈現，免橫向捲動 */
      "@media (max-width:640px){",
      ".fin-cards{border:0;background:transparent;border-radius:0;overflow:visible;}",
      ".fin-cards .fin-table{display:block;min-width:0;}",
      ".fin-cards .fin-table thead{display:none;}",
      ".fin-cards .fin-table tbody{display:block;}",
      ".fin-cards .fin-table tr{display:block;margin:0 0 10px;padding:4px 12px 8px;border:1px solid rgba(17,24,39,.10);border-radius:14px;background:#fff;box-shadow:0 6px 18px rgba(17,24,39,.05);}",
      ".fin-cards .fin-table td{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:8px 0;border-bottom:1px dashed rgba(17,24,39,.08);white-space:normal;text-align:right;}",
      ".fin-cards .fin-table td:last-child{border-bottom:0;}",
      ".fin-cards .fin-table td::before{content:attr(data-label);flex:0 0 auto;font-size:calc(11px * var(--fs, 1));font-weight:900;color:#6b7280;text-align:left;}",
      ".fin-cards .fin-table td[data-label=\"\"]::before,.fin-cards .fin-table td:not([data-label])::before{content:none;}",
      ".fin-cards .fin-table td.fin-empty{display:block;text-align:center;}",
      ".fin-cards .fin-table td.fin-empty::before{content:none;}",
      ".fin-cards .fin-table td .ops{justify-content:flex-end;flex-wrap:wrap;}",
      "}",
      ".fin-print{position:absolute;left:-99999px;top:0;width:900px;background:#fff;color:#111827;padding:24px;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;}",
      ".fin-print .hdr{display:flex;align-items:baseline;gap:12px;margin:0 0 6px;}",
      ".fin-print .hdr .community{font-size:22px;font-weight:700;color:#111827;}",
      ".fin-print h1{font-size:22px;margin:0;}",
      ".fin-print .meta{font-size:12px;color:#4b5563;margin-bottom:14px;}",
      ".fin-print table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;}",
      ".fin-print th,.fin-print td{border:1px solid #d1d5db;padding:6px 8px;text-align:left;}",
      ".fin-print th{background:#f3f4f6;}",
      ".fin-print h2{font-size:15px;margin:16px 0 8px;}"
    ].join("");
    document.head.appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /* 彈窗（沿用專案既有 mr-modal 樣式）                                   */
  /* ------------------------------------------------------------------ */

  function openModal(opts) {
    const cfg = opts || {};
    const backdrop = document.createElement("div");
    backdrop.className = "mr-modal-backdrop";
    backdrop.setAttribute("role", "presentation");
    backdrop.innerHTML =
      '<div class="mr-modal" role="dialog" aria-modal="true">' +
      '<div class="mr-modal-hd"><div class="title">' + esc(cfg.title || "") + "</div>" +
      '<button class="mr-modal-close" type="button" aria-label="關閉">×</button></div>' +
      '<div class="mr-modal-bd">' + (cfg.bodyHtml || "") + "</div>" +
      '<div class="mr-modal-ft">' + (cfg.footerHtml || "") + "</div>" +
      "</div>";
    document.body.appendChild(backdrop);
    const modal = backdrop.querySelector(".mr-modal");
    if (modal) {
      if (cfg.width) modal.style.width = cfg.width;
      modal.style.maxHeight = "88vh";
      modal.style.display = "grid";
      modal.style.gridTemplateRows = "auto 1fr auto";
      const bd = modal.querySelector(".mr-modal-bd");
      if (bd) {
        bd.style.overflowY = "auto";
        bd.style.overflowX = "hidden";
      }
    }
    const close = function () {
      document.removeEventListener("keydown", onKey);
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    };
    const onKey = function (e) {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const closeBtn = backdrop.querySelector(".mr-modal-close");
    if (closeBtn) closeBtn.onclick = close;
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) close();
    });
    return { el: backdrop, modal: modal, close: close };
  }

  function confirmDialog(opts) {
    const cfg = opts || {};
    return new Promise(function (resolve) {
      const m = openModal({
        title: cfg.title || "確認操作",
        width: "min(88vw, 460px)",
        bodyHtml:
          '<div style="display:grid;gap:12px;">' +
          '<div style="padding:12px 14px;border-radius:14px;background:rgba(220,38,38,.08);border:1.5px solid rgba(220,38,38,.22);color:#991b1b;font-weight:800;font-size:calc(13px * var(--fs, 1));line-height:1.7;">' +
          esc(cfg.message || "確定要執行此操作嗎？") + "</div></div>",
        footerHtml:
          '<button class="btn btn-ghost" type="button" id="finConfirmCancel">取消</button>' +
          '<button class="btn btn-danger" type="button" id="finConfirmOk">' + esc(cfg.okText || "確認刪除") + "</button>"
      });
      let done = false;
      const finish = function (v) {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const okBtn = m.modal && m.modal.querySelector("#finConfirmOk");
      const cancelBtn = m.modal && m.modal.querySelector("#finConfirmCancel");
      if (okBtn) okBtn.onclick = function () { finish(true); };
      if (cancelBtn) cancelBtn.onclick = function () { finish(false); };
    });
  }

  /* ------------------------------------------------------------------ */
  /* 常數                                                                */
  /* ------------------------------------------------------------------ */

  const KIND = {
    income: { key: "income", label: "收入", color: "#15803d", bg: "rgba(22,163,74,.10)" },
    expense: { key: "expense", label: "支出", color: "#b91c1c", bg: "rgba(220,38,38,.10)" }
  };

  const DEFAULT_CONFIG = {
    incomeCategories: ["管理費", "清潔費", "停車費", "水電代收", "廣告收入", "活動收入", "利息收入", "政府補助", "其他收入"],
    expenseCategories: ["人事薪資", "水電費", "清潔維護", "修繕工程", "保險費", "交際費", "稅捐規費", "設備採購", "公共基金", "其他支出"],
    bookTypes: ["活存", "定存", "現金", "其他"],
    incomeTargets: [],
    expenseTargets: [],
    /* 催收通知函的可自訂內容（空白＝沿用系統預設用語） */
    notice: {
      docTitle: "",
      signer: "",
      contact: "",
      dueDays: 15,
      subject: "",
      closing: "",
      note: ""
    }
  };

  /** 財報類型 → 類別設定的 key */
  const CATEGORY_KEYS = {
    income: "incomeCategories",
    expense: "expenseCategories"
  };

  /** 財報類型 → 對象名單設定的 key */
  const TARGET_KEYS = {
    income: "incomeTargets",
    expense: "expenseTargets"
  };

  const TABS = [
    { id: "overview", label: "總覽", desc: "當月收入、支出、餘額與管理費收繳狀況" },
    { id: "income", label: "收入明細", desc: "收入紀錄的新增、編輯與統計" },
    { id: "expense", label: "支出明細", desc: "支出紀錄的新增、編輯與統計" },
    { id: "bank", label: "銀行明細", desc: "社區帳本列表，可進入各帳本檢視存入／提出紀錄與餘額" },
    { id: "fees", label: "管理費", desc: "住戶管理費金額維護，套用於總覽的未繳管理費計算" },
    { id: "report", label: "報表匯出", desc: "期間統計、分類統計與 Excel／PDF 匯出" },
    { id: "incomeCats", label: "收入名單", desc: "自動帶入社區住戶與委員帳號作為收入對象，套用於收入明細的「對象」選項" },
    { id: "expenseCats", label: "支出名單", desc: "支出對象名單維護，套用於支出明細的「對象」選項" },
    { id: "settings", label: "設定", desc: "收入類別、支出類別與帳本類型設定" }
  ];

  /* ------------------------------------------------------------------ */
  /* Model                                                               */
  /* ------------------------------------------------------------------ */

  const Model = {
    KIND: KIND,
    DEFAULT_CONFIG: DEFAULT_CONFIG,

    /* 角色權限：admin／manager(community) 可讀寫刪；finance(財務) 可讀寫但不可刪除 */
    hasPermission: function (role, action) {
      const r = String(role || "").toLowerCase();
      const isAdmin = r === "admin" || r === "super_admin" || r === "community_admin";
      const isManager = r === "manager" || r === "community" || r === "management";
      const isFinance = r === "finance" || r === "財務" || r === "財務人員";
      switch (String(action || "")) {
        case "read":
        case "export":
          return true;
        case "write":
          return isAdmin || isManager || isFinance;
        case "delete":
          return isAdmin || isManager;
        default:
          return false;
      }
    },

    /** 角色顯示名稱（用於頁面上的權限提示） */
    roleLabel: function (role) {
      const r = String(role || "").toLowerCase();
      if (r === "admin" || r === "super_admin" || r === "community_admin") return "管理員";
      if (r === "manager" || r === "community" || r === "management") return "主管";
      if (r === "finance" || r === "財務" || r === "財務人員") return "財務";
      return "唯讀";
    },

    txCol: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeTx");
    },

    bankCol: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeBank");
    },

    bookCol: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeBooks");
    },

    configDoc: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeConfig").doc("config");
    },

    feeCol: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeFee");
    },

    budgetCol: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeBudgets");
    },

    /** 儲存類別、帳本類型與對象名單設定 */
    saveConfig: function (db, cid, payload, ctx) {
      const data = {
        incomeCategories: cleanList(payload && payload.incomeCategories),
        expenseCategories: cleanList(payload && payload.expenseCategories),
        bookTypes: cleanList(payload && payload.bookTypes),
        incomeTargets: cleanList(payload && payload.incomeTargets),
        expenseTargets: cleanList(payload && payload.expenseTargets),
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      };
      // 財報系統啟用日期（未帶入時不覆寫既有值）
      if (payload && typeof payload.enableDate === "string") {
        const ed = payload.enableDate.trim();
        data.enableDate = /^\d{4}-\d{2}-\d{2}$/.test(ed) ? ed : "";
      }
      // 定期收支項目（未帶入時不覆寫既有值）
      if (payload && Array.isArray(payload.recurring)) {
        data.recurring = Model.normalizeRecurring(payload.recurring);
      }
      // 催收通知函內容設定（未帶入時不覆寫既有值）
      if (payload && payload.notice && typeof payload.notice === "object") {
        data.notice = Model.normalizeNotice(payload.notice);
      }
      return Model.configDoc(db, cid).set(data, { merge: true });
    },

    /** 催收通知函內容設定：正規化欄位 */
    normalizeNotice: function (n) {
      const src = n || {};
      const days = toNum(src.dueDays, 15);
      return {
        docTitle: String(src.docTitle || "").trim(),
        signer: String(src.signer || "").trim(),
        contact: String(src.contact || "").trim(),
        dueDays: Math.min(120, Math.max(1, Math.round(days) || 15)),
        subject: String(src.subject || "").trim(),
        closing: String(src.closing || "").trim(),
        note: String(src.note || "").trim()
      };
    },

    /** 定期收支項目：正規化欄位（僅保留有科目且有金額者） */
    normalizeRecurring: function (list) {
      return (Array.isArray(list) ? list : []).map(function (it) {
        const day = toNum(it && it.day, 1);
        return {
          id: String((it && it.id) || "").trim() || genId("rec"),
          kind: (it && it.kind) === "income" ? "income" : "expense",
          category: String((it && it.category) || "").trim(),
          target: String((it && it.target) || "").trim(),
          amount: toNum(it && it.amount, 0),
          bookId: String((it && it.bookId) || "").trim(),
          day: Math.min(28, Math.max(1, Math.round(day) || 1)),
          note: String((it && it.note) || "").trim(),
          active: !(it && it.active === false)
        };
      }).filter(function (it) { return it.category && it.amount > 0; });
    },

    saveTx: function (db, cid, payload, ctx) {
      const col = Model.txCol(db, cid);
      const actor = { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") };
      const data = {
        kind: payload.kind === "expense" ? "expense" : "income",
        date: String(payload.date || "").trim(),
        category: String(payload.category || "").trim(),
        amount: toNum(payload.amount, 0),
        target: String(payload.target || "").trim(),
        method: String(payload.method || "").trim(),
        bookId: String(payload.bookId || "").trim(),
        months: cleanList(payload.months).filter(function (mm) { return /^\d{4}-\d{2}$/.test(mm); }).sort(),
        receiptNo: String(payload.receiptNo || "").trim(),
        receiptImg: String(payload.receiptImg || "").trim(),
        note: String(payload.note || "").trim(),
        updatedAt: serverTs(),
        updatedBy: actor
      };
      /* 異動歷程：由呼叫端帶入（含本次動作），最多保留 30 筆 */
      if (Array.isArray(payload.history) && payload.history.length) {
        data.history = payload.history.slice(-30);
      }
      if (payload.id) {
        return col.doc(String(payload.id)).set(data, { merge: true });
      }
      data.createdAt = serverTs();
      data.createdBy = actor;
      if (!data.history) data.history = [{ at: nowStamp(), by: actor.name, action: "create" }];
      return col.doc(genId("ftx")).set(data, { merge: true });
    },

    removeTx: function (db, cid, id) {
      return Model.txCol(db, cid).doc(String(id)).delete();
    },

    /** 批次新增財報明細（回傳實際寫入筆數） */
    saveTxBatch: function (db, cid, payloads, ctx) {
      const list = (Array.isArray(payloads) ? payloads : []).filter(Boolean);
      if (!list.length) return Promise.resolve(0);
      return Promise.all(list.map(function (p) {
        return Model.saveTx(db, cid, p, ctx);
      })).then(function () { return list.length; });
    },

    /** 儲存帳本 */
    saveBook: function (db, cid, payload, ctx) {
      const col = Model.bookCol(db, cid);
      const data = {
        name: String(payload.name || "").trim(),
        type: String(payload.type || "").trim(),
        openingBalance: toNum(payload.openingBalance, 0),
        note: String(payload.note || "").trim(),
        order: toNum(payload.order, 0),
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      };
      if (payload.id) {
        return col.doc(String(payload.id)).set(data, { merge: true });
      }
      data.createdAt = serverTs();
      data.createdBy = data.updatedBy;
      return col.doc(genId("fbook")).set(data, { merge: true });
    },

    removeBook: function (db, cid, id) {
      return Model.bookCol(db, cid).doc(String(id)).delete();
    },

    saveBank: function (db, cid, payload, ctx) {
      const col = Model.bankCol(db, cid);
      const data = {
        bookId: String(payload.bookId || "").trim(),
        bookName: String(payload.bookName || "").trim(),
        date: String(payload.date || "").trim(),
        summary: String(payload.summary || "").trim(),
        deposit: toNum(payload.deposit, 0),
        withdraw: toNum(payload.withdraw, 0),
        note: String(payload.note || "").trim(),
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      };
      if (payload.id) {
        return col.doc(String(payload.id)).set(data, { merge: true });
      }
      data.createdAt = serverTs();
      data.createdBy = data.updatedBy;
      return col.doc(genId("fbk")).set(data, { merge: true });
    },

    removeBank: function (db, cid, id) {
      return Model.bankCol(db, cid).doc(String(id)).delete();
    },

    /** 住戶管理費（文件 ID 即 users 文件的 uid） */
    saveFee: function (db, cid, payload, ctx) {
      const col = Model.feeCol(db, cid);
      const start = String(payload.startMonth || "").trim();
      const data = {
        userId: String(payload.userId || "").trim(),
        unit: String(payload.unit || "").trim(),
        name: String(payload.name || "").trim(),
        amount: toNum(payload.amount, 0),
        startMonth: /^\d{4}-\d{2}$/.test(start) ? start : "",
        note: String(payload.note || "").trim(),
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      };
      if (!data.userId) return Promise.reject(new Error("缺少住戶識別碼"));
      return col.doc(data.userId).set(data, { merge: true });
    },

    removeFee: function (db, cid, id) {
      return Model.feeCol(db, cid).doc(String(id)).delete();
    },

    /** 年度財務預算（文件 ID 即年度，例如 2027） */
    saveBudget: function (db, cid, payload, ctx) {
      const year = String((payload && payload.year) || "").trim();
      if (!/^\d{4}$/.test(year)) return Promise.reject(new Error("年度格式錯誤"));
      const items = (Array.isArray(payload && payload.items) ? payload.items : []).map(function (it) {
        return {
          kind: it && it.kind === "expense" ? "expense" : "income",
          category: String((it && it.category) || "").trim(),
          amount: toNum(it && it.amount, 0)
        };
      }).filter(function (it) { return it.category; });
      return Model.budgetCol(db, cid).doc(year).set({
        year: year,
        items: items,
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      }, { merge: true });
    },

    noticeCol: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeNotices");
    },

    /** 管理費催收通知函（供免登入公開頁讀取） */
    saveNotice: function (db, cid, payload, ctx) {
      const p = payload || {};
      const months = (Array.isArray(p.months) ? p.months : []).map(function (x) {
        return {
          month: String((x && x.month) || "").trim(),
          amount: toNum(x && x.amount, 0),
          paid: toNum(x && x.paid, 0),
          owe: toNum(x && x.owe, 0)
        };
      });
      const sumMonths = function (key) {
        return months.reduce(function (a, x) { return a + toNum(x && x[key], 0); }, 0);
      };
      const data = {
        communityId: String(cid || ""),
        communityName: String(p.communityName || "").trim(),
        residentId: String(p.residentId || "").trim(),
        unit: String(p.unit || "").trim(),
        name: String(p.name || "").trim(),
        issuedAt: String(p.issuedAt || "").trim(),
        deadline: String(p.deadline || "").trim(),
        contact: String(p.contact || "").trim(),
        note: String(p.note || "").trim(),
        docTitle: String(p.docTitle || "").trim(),
        signer: String(p.signer || "").trim(),
        subject: String(p.subject || "").trim(),
        closing: String(p.closing || "").trim(),
        months: months,
        channels: cleanList(p.channels),
        totalAmount: p.totalAmount != null ? toNum(p.totalAmount, 0) : sumMonths("amount"),
        totalPaid: p.totalPaid != null ? toNum(p.totalPaid, 0) : sumMonths("paid"),
        totalOwe: p.totalOwe != null ? toNum(p.totalOwe, 0) : sumMonths("owe"),
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      };
      const id = String((ctx && ctx.noticeId) || "").trim() || genId("fn");
      return Model.noticeCol(db, cid).doc(id).set(data, { merge: true }).then(function () { return id; });
    },

    /** 追加通知紀錄的發送管道（同一份通知可多次、多管道發送） */
    updateNoticeChannels: function (db, cid, id, channels) {
      return Model.noticeCol(db, cid).doc(String(id)).set({
        channels: cleanList(channels),
        notifiedAt: serverTs()
      }, { merge: true });
    },

    removeNotice: function (db, cid, id) {
      return Model.noticeCol(db, cid).doc(String(id)).delete();
    },

    auditCol: function (db, cid) {
      return db.collection("communities").doc(cid).collection("financeAudit");
    },

    /** 稽核紀錄：刪除等需留痕的動作（含當時的紀錄快照與原因） */
    saveAudit: function (db, cid, payload, ctx) {
      const p = payload || {};
      const data = {
        action: String(p.action || "").trim(),
        summary: String(p.summary || "").trim(),
        reason: String(p.reason || "").trim(),
        detail: p.detail && typeof p.detail === "object" ? p.detail : {},
        at: nowStamp(),
        atTs: serverTs(),
        by: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      };
      return Model.auditCol(db, cid).doc(genId("fa")).set(data, { merge: true });
    },

    /** 依期間彙整財報與帳本資料 */
    aggregate: function (txList, bankList, range, books) {
      const from = String((range && range.from) || "");
      const to = String((range && range.to) || "");
      const inRange = function (row) {
        const d = String((row && row.date) || "");
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      };

      const pick = (Array.isArray(txList) ? txList : []).filter(inRange);
      let income = 0;
      let expense = 0;
      const incomeByCat = {};
      const expenseByCat = {};
      const monthly = {};

      pick.forEach(function (t) {
        const amt = toNum(t.amount, 0);
        const cat = String(t.category || "未分類") || "未分類";
        const mk = String(t.date || "").slice(0, 7) || "未知";
        if (!monthly[mk]) monthly[mk] = { month: mk, income: 0, expense: 0 };
        if (t.kind === "expense") {
          expense += amt;
          expenseByCat[cat] = (expenseByCat[cat] || 0) + amt;
          monthly[mk].expense += amt;
        } else {
          income += amt;
          incomeByCat[cat] = (incomeByCat[cat] || 0) + amt;
          monthly[mk].income += amt;
        }
      });

      const toRows = function (map, total) {
        return Object.keys(map).map(function (k) {
          return {
            category: k,
            amount: map[k],
            pct: total > 0 ? (map[k] / total) * 100 : 0
          };
        }).sort(function (a, b) { return b.amount - a.amount; });
      };

      const monthlyRows = Object.keys(monthly).sort().map(function (k) {
        const m = monthly[k];
        m.net = m.income - m.expense;
        return m;
      });

      const bankRows = (Array.isArray(bankList) ? bankList : []).filter(inRange);
      let bankIn = 0;
      let bankOut = 0;
      bankRows.forEach(function (b) {
        bankIn += toNum(b.deposit, 0);
        bankOut += toNum(b.withdraw, 0);
      });
      let bankAllIn = 0;
      let bankAllOut = 0;
      (Array.isArray(bankList) ? bankList : []).forEach(function (b) {
        bankAllIn += toNum(b.deposit, 0);
        bankAllOut += toNum(b.withdraw, 0);
      });
      let bookOpening = 0;
      (Array.isArray(books) ? books : []).forEach(function (bk) {
        bookOpening += toNum(bk.openingBalance, 0);
      });

      /* 財報明細若指定收款方式（帳本），視為該帳本的存入／提出 */
      const bookIdOf = function (t) {
        const explicit = String((t && t.bookId) || "");
        if (explicit) return explicit;
        const name = String((t && t.method) || "");
        if (!name) return "";
        const bk = (Array.isArray(books) ? books : []).find(function (x) { return String(x.name || "") === name; });
        return bk ? String(bk.id) : "";
      };
      const flowIn = function (t) { return bookIdOf(t) ? (t.kind === "expense" ? 0 : toNum(t.amount, 0)) : 0; };
      const flowOut = function (t) { return bookIdOf(t) ? (t.kind === "expense" ? toNum(t.amount, 0) : 0) : 0; };
      let txAllIn = 0;
      let txAllOut = 0;
      let txIn = 0;
      let txOut = 0;
      (Array.isArray(txList) ? txList : []).forEach(function (t) {
        txAllIn += flowIn(t);
        txAllOut += flowOut(t);
      });
      pick.forEach(function (t) {
        txIn += flowIn(t);
        txOut += flowOut(t);
      });

      return {
        from: from,
        to: to,
        countIncome: pick.filter(function (t) { return t.kind !== "expense"; }).length,
        countExpense: pick.filter(function (t) { return t.kind === "expense"; }).length,
        totalIncome: income,
        totalExpense: expense,
        net: income - expense,
        incomeByCat: toRows(incomeByCat, income),
        expenseByCat: toRows(expenseByCat, expense),
        monthly: monthlyRows,
        bankIn: bankIn + txIn,
        bankOut: bankOut + txOut,
        bankOpening: bookOpening,
        bankBalance: bookOpening + bankAllIn - bankAllOut + txAllIn - txAllOut,
        transactions: pick,
        bankRows: bankRows
      };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Export（Excel / PDF）                                               */
  /* ------------------------------------------------------------------ */

  const Export = {
    buildFilename: function (communityName, label, from, to) {
      const rng = [from, to].filter(Boolean).join("_") || "全部";
      return sanitizeFilename(communityName) + "_財報系統_" + label + "_" + rng + ".xlsx";
    },

    toExcel: function (opts) {
      const cfg = opts || {};
      const XLSX = window.XLSX;
      if (!XLSX) {
        toast("Excel 元件尚未載入，請稍後再試", true);
        return false;
      }
      const txList = Array.isArray(cfg.txList) ? cfg.txList : [];
      const bankList = Array.isArray(cfg.bankList) ? cfg.bankList : [];
      const agg = cfg.agg || Model.aggregate([], [], {}, []);

      const txRows = function (kind) {
        return txList.filter(function (t) { return (kind === "expense" ? t.kind === "expense" : t.kind !== "expense"); })
          .map(function (t) {
            return {
              "日期": t.date || "",
              "沖銷月份": (t.months || []).join("、"),
              "類別": t.category || "",
              "對象": t.target || "",
              "金額": toNum(t.amount, 0),
              "收款方式": t.method || "",
              "單據編號": t.receiptNo || "",
              "備註": t.note || ""
            };
          });
      };
      const bankRows = bankList.map(function (b) {
        return {
          "日期": b.date || "",
          "帳本": b.bookName || "",
          "摘要": b.summary || "",
          "存入": toNum(b.deposit, 0),
          "提出": toNum(b.withdraw, 0),
          "餘額": toNum(b.balance, 0),
          "備註": b.note || ""
        };
      });
      const monthRows = (agg.monthly || []).map(function (m) {
        return { "月份": m.month, "收入": m.income, "支出": m.expense, "淨額": m.net };
      });
      const catRows = [];
      (agg.incomeByCat || []).forEach(function (r) {
        catRows.push({ "類型": "收入", "類別": r.category, "金額": r.amount, "佔比(%)": Number(r.pct.toFixed(2)) });
      });
      (agg.expenseByCat || []).forEach(function (r) {
        catRows.push({ "類型": "支出", "類別": r.category, "金額": r.amount, "佔比(%)": Number(r.pct.toFixed(2)) });
      });
      const summaryRows = [
        { "項目": "期間起", "值": agg.from || "全部" },
        { "項目": "期間迄", "值": agg.to || "全部" },
        { "項目": "收入合計", "值": agg.totalIncome },
        { "項目": "支出合計", "值": agg.totalExpense },
        { "項目": "淨額", "值": agg.net },
        { "項目": "銀行期末餘額", "值": agg.bankBalance }
      ];
      const fees = cfg.fees || null;
      if (fees) {
        summaryRows.splice(3, 0, { "項目": "應收收入（管理費收入）", "值": fees.due });
        summaryRows.push({ "項目": "應付支出", "值": agg.totalExpense });
        if (fees.rate !== null && fees.rate !== undefined) {
          summaryRows.push({ "項目": "管理費實收", "值": fees.received });
          summaryRows.push({ "項目": "管理費達成率", "值": fees.rate.toFixed(1) + "%" });
        }
      }

      try {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "報表摘要");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows("income"), { header: ["日期", "沖銷月份", "類別", "對象", "金額", "收款方式", "單據編號", "備註"] }), "收入明細");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows("expense"), { header: ["日期", "沖銷月份", "類別", "對象", "金額", "收款方式", "單據編號", "備註"] }), "支出明細");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bankRows, { header: ["日期", "帳本", "摘要", "存入", "提出", "餘額", "備註"] }), "銀行明細");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthRows, { header: ["月份", "收入", "支出", "淨額"] }), "月報表");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows, { header: ["類型", "類別", "金額", "佔比(%)"] }), "分類統計");
        XLSX.writeFile(wb, Export.buildFilename(cfg.communityName, "全部", agg.from, agg.to));
        return true;
      } catch (e) {
        console.warn("[finance] excel export failed", e);
        toast("匯出失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
        return false;
      }
    },

    buildPrintHtml: function (opts) {
      const cfg = opts || {};
      const agg = cfg.agg || {};
      const rows = function (list, cols) {
        if (!list || !list.length) return '<tr><td colspan="' + cols + '" style="text-align:center;color:#6b7280;">無資料</td></tr>';
        return list.join("");
      };
      const catRows = function (list, kindLabel) {
        return (list || []).map(function (r) {
          return "<tr><td>" + esc(kindLabel) + "</td><td>" + esc(r.category) + "</td><td>" +
            fmtMoney(r.amount) + "</td><td>" + r.pct.toFixed(2) + "%</td></tr>";
        });
      };
      const monthRows = (agg.monthly || []).map(function (m) {
        return "<tr><td>" + esc(m.month) + "</td><td>" + fmtMoney(m.income) + "</td><td>" +
          fmtMoney(m.expense) + "</td><td>" + fmtMoney(m.net) + "</td></tr>";
      });
      const bankRows = (agg.bankRows || []).map(function (b) {
        return "<tr><td>" + esc(b.date) + "</td><td>" + esc(b.bookName || "") + "</td><td>" + esc(b.summary) + "</td><td>" +
          fmtMoney(b.deposit) + "</td><td>" + fmtMoney(b.withdraw) + "</td><td>" + fmtMoney(b.balance) + "</td></tr>";
      });
      const communityText = esc(cfg.communityName || "—");
      /* 抬頭依所選期間類型命名：本日／本月／本年／自訂 */
      const reportTitle = { day: "日報表", month: "月報表", year: "年報表", custom: "區間報表" }[cfg.preset] || "財報系統";
      const fees = cfg.fees || null;
      const feeTable = !fees ? "" :
        "<h2>管理費與應付</h2>" +
        "<table><tr><th>應收收入（管理費收入）</th><th>管理費實收</th>" +
        (fees.rate !== null && fees.rate !== undefined ? "<th>管理費達成率</th>" : "") +
        "<th>應付支出</th></tr>" +
        "<tr><td>" + fmtMoney(fees.due) + "</td><td>" + fmtMoney(fees.received) + "</td>" +
        (fees.rate !== null && fees.rate !== undefined ? "<td>" + fees.rate.toFixed(1) + "%</td>" : "") +
        "<td>" + fmtMoney(agg.totalExpense) + "</td></tr></table>";
      return '<div class="hdr"><span class="community">' + communityText + '</span><h1>' + esc(reportTitle) + '</h1></div>' +
        '<div class="meta">期間：' + esc(cfg.rangeLabel || "全部") +
        "（" + esc(agg.from || "全部") + " ~ " + esc(agg.to || "全部") + "）" +
        "｜匯出人：" + esc(cfg.exportedBy || "—") +
        "｜產製時間：" + esc(nowStamp()) + "</div>" +
        "<h2>總覽</h2>" +
        "<table><tr><th>收入合計</th><th>支出合計</th><th>淨額</th><th>銀行期末餘額</th></tr>" +
        "<tr><td>" + fmtMoney(agg.totalIncome) + "</td><td>" + fmtMoney(agg.totalExpense) + "</td><td>" +
        fmtMoney(agg.net) + "</td><td>" + fmtMoney(agg.bankBalance) + "</td></tr></table>" +
        feeTable +
        "<h2>分類統計</h2>" +
        "<table><tr><th>類型</th><th>類別</th><th>金額</th><th>佔比</th></tr>" +
        rows(catRows(agg.incomeByCat, "收入").concat(catRows(agg.expenseByCat, "支出")), 4) + "</table>" +
        "<h2>月報表</h2>" +
        "<table><tr><th>月份</th><th>收入</th><th>支出</th><th>淨額</th></tr>" + rows(monthRows, 4) + "</table>" +
        "<h2>銀行明細</h2>" +
        "<table><tr><th>日期</th><th>帳本</th><th>摘要</th><th>存入</th><th>提出</th><th>餘額</th></tr>" + rows(bankRows, 6) + "</table>";
    },

    /** 將指定 HTML 內容繪製成 A4 PDF 並開啟預覽（自動加註頁碼、匯出人／時間與浮水印） */
    exportPdfFromHtml: async function (innerHtml, filename, opts) {
      const cfg = opts || {};
      const h2c = window.html2canvas;
      const printEl = document.createElement("div");
      printEl.className = "fin-print";
      printEl.innerHTML = innerHtml;
      document.body.appendChild(printEl);
      try {
        if (!h2c) throw new Error("html2canvas 未載入");
        const canvas = await h2c(printEl, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        const mod = await import("https://esm.sh/jspdf@2.5.1");
        const JsPDF = mod && (mod.jsPDF || mod.default);
        if (!JsPDF) throw new Error("jsPDF 載入失敗");
        const pdf = new JsPDF({ orientation: "p", unit: "mm", format: "a4" });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const imgW = pageW;
        const imgH = (canvas.height * imgW) / canvas.width;
        let offset = 0;
        pdf.addImage(imgData, "JPEG", 0, 0, imgW, imgH);
        while (imgH - (offset + pageH) > 0) {
          offset += pageH;
          pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, -offset, imgW, imgH);
        }
        /* 逐頁加註頁碼、匯出人／匯出時間與浮水印 */
        const total = pdf.internal.getNumberOfPages();
        const stamp = nowStamp();
        const by = String(cfg.exportedBy || "").trim();
        const mark = String(cfg.watermark || "").trim();
        for (let i = 1; i <= total; i++) {
          pdf.setPage(i);
          if (mark) {
            try {
              pdf.setGState(new pdf.GState({ opacity: 0.08 }));
              pdf.setFontSize(48);
              pdf.setTextColor(120, 120, 120);
              pdf.text(mark, pageW / 2, pageH / 2, { align: "center", angle: 35 });
              pdf.setGState(new pdf.GState({ opacity: 1 }));
            } catch (_) { /* 不支援 opacity 時略過浮水印 */ }
          }
          pdf.setFontSize(8);
          pdf.setTextColor(120, 120, 120);
          pdf.text("第 " + i + " 頁／共 " + total + " 頁", pageW - 10, pageH - 6, { align: "right" });
          pdf.text((by ? "匯出人：" + by + "｜" : "") + "匯出時間：" + stamp, 10, pageH - 6);
        }
        const dataUri = pdf.output("datauristring");
        if (typeof window.openPdfViewer === "function") {
          window.openPdfViewer(dataUri, filename);
        } else {
          Export.downloadDataUrl(dataUri, filename);
        }
        return true;
      } catch (e) {
        console.warn("[finance] pdf export failed", e);
        Export.printFallback(printEl);
        return false;
      } finally {
        if (printEl.parentNode) printEl.parentNode.removeChild(printEl);
      }
    },

    toPdf: function (opts) {
      const cfg = opts || {};
      const filename = sanitizeFilename(cfg.communityName) + "_財報系統_" +
        sanitize(cfg.rangeLabel || "全部") + "_" + (cfg.agg && cfg.agg.from ? cfg.agg.from : "全部") + ".pdf";
      return Export.exportPdfFromHtml(Export.buildPrintHtml(cfg), filename, {
        exportedBy: cfg.exportedBy || "",
        watermark: cfg.watermark || cfg.communityName || ""
      });
    },

    /** 年度預算表：列印／PDF 用 HTML */
    buildBudgetPrintHtml: function (opts) {
      const cfg = opts || {};
      const year = String(cfg.year || "").trim();
      const rows = Array.isArray(cfg.rows) ? cfg.rows : [];
      const income = rows.filter(function (r) { return r.kind !== "expense"; });
      const expense = rows.filter(function (r) { return r.kind === "expense"; });
      const sum = function (list) {
        return list.reduce(function (a, r) { return a + toNum(r.amount, 0); }, 0);
      };
      const bodyRows = function (list) {
        if (!list.length) return '<tr><td colspan="2" style="text-align:center;color:#6b7280;">無資料</td></tr>';
        return list.map(function (r) {
          return "<tr><td>" + esc(r.category) + "</td><td>" + fmtMoney(r.amount) + "</td></tr>";
        }).join("");
      };
      const incomeTotal = sum(income);
      const expenseTotal = sum(expense);
      const net = incomeTotal - expenseTotal;
      return '<div class="hdr"><span class="community">' + esc(cfg.communityName || "—") +
        '</span><h1>' + esc(year + " 年度預算表") + '</h1></div>' +
        '<div class="meta">年度：' + esc(year) + "｜產製時間：" + esc(nowStamp()) + "</div>" +
        "<h2>收入預算</h2>" +
        "<table><tr><th>科目</th><th>預算金額</th></tr>" + bodyRows(income) +
        '<tr><th>收入合計</th><th>' + fmtMoney(incomeTotal) + "</th></tr></table>" +
        "<h2>支出預算</h2>" +
        "<table><tr><th>科目</th><th>預算金額</th></tr>" + bodyRows(expense) +
        '<tr><th>支出合計</th><th>' + fmtMoney(expenseTotal) + "</th></tr></table>" +
        "<h2>收支結餘</h2>" +
        "<table><tr><th>收入合計</th><th>支出合計</th><th>結餘</th></tr><tr><td>" +
        fmtMoney(incomeTotal) + "</td><td>" + fmtMoney(expenseTotal) + "</td><td>" + fmtMoney(net) + "</td></tr></table>";
    },

    /** 年度預算表：匯出 Excel */
    budgetToExcel: function (opts) {
      const cfg = opts || {};
      const XLSX = window.XLSX;
      if (!XLSX) {
        toast("Excel 元件尚未載入，請稍後再試", true);
        return false;
      }
      const year = String(cfg.year || "").trim();
      const rows = (Array.isArray(cfg.rows) ? cfg.rows : []).map(function (r) {
        return {
          "類型": r.kind === "expense" ? "支出" : "收入",
          "科目": r.category,
          "預算金額": toNum(r.amount, 0)
        };
      });
      const sum = function (kind) {
        return (Array.isArray(cfg.rows) ? cfg.rows : []).reduce(function (a, r) {
          const hit = kind === "expense" ? r.kind === "expense" : r.kind !== "expense";
          return hit ? a + toNum(r.amount, 0) : a;
        }, 0);
      };
      const incomeTotal = sum("income");
      const expenseTotal = sum("expense");
      rows.push({ "類型": "", "科目": "收入合計", "預算金額": incomeTotal });
      rows.push({ "類型": "", "科目": "支出合計", "預算金額": expenseTotal });
      rows.push({ "類型": "", "科目": "收支結餘", "預算金額": incomeTotal - expenseTotal });
      try {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: ["類型", "科目", "預算金額"] }), year + "年度預算");
        XLSX.writeFile(wb, sanitizeFilename(cfg.communityName) + "_年度預算_" + sanitize(year) + ".xlsx");
        return true;
      } catch (e) {
        console.warn("[finance] budget excel export failed", e);
        toast("匯出失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
        return false;
      }
    },

    /** 年度預算表：下載 PDF */
    budgetToPdf: function (opts) {
      const cfg = opts || {};
      const filename = sanitizeFilename(cfg.communityName) + "_年度預算_" + sanitize(String(cfg.year || "")) + ".pdf";
      return Export.exportPdfFromHtml(Export.buildBudgetPrintHtml(cfg), filename, {
        exportedBy: cfg.exportedBy || "",
        watermark: cfg.watermark || cfg.communityName || ""
      });
    },

    /**
     * 資料備份：彙整所選年度的完整財務資料
     * （收支明細、帳本紀錄、帳本、管理費設定、年度預算、催收通知、稽核紀錄與參數設定）
     */
    buildBackup: function (opts) {
      const cfg = opts || {};
      const year = String(cfg.year || "").trim();
      const inYear = function (v) { return !year || String(v || "").slice(0, 4) === year; };
      const txList = (Array.isArray(cfg.txList) ? cfg.txList : []).filter(function (t) { return inYear(t.date); });
      const bankList = (Array.isArray(cfg.bankList) ? cfg.bankList : []).filter(function (b) { return inYear(b.date); });
      const notices = (Array.isArray(cfg.notices) ? cfg.notices : []).filter(function (n) { return inYear(n.issuedAt || n.notifiedAt); });
      const audits = (Array.isArray(cfg.audits) ? cfg.audits : []).filter(function (a) { return inYear(a.at); });
      const budgets = (Array.isArray(cfg.budgets) ? cfg.budgets : []).filter(function (b) { return inYear(b.year); });
      return {
        meta: {
          communityName: String(cfg.communityName || ""),
          year: year,
          exportedAt: nowStamp(),
          exportedBy: String((cfg.exportedBy || ""))
        },
        txList: txList,
        bankList: bankList,
        books: Array.isArray(cfg.books) ? cfg.books : [],
        fees: Array.isArray(cfg.fees) ? cfg.fees : [],
        budgets: budgets,
        notices: notices,
        audits: audits,
        config: cfg.config || {}
      };
    },

    /** 資料備份（Excel 多工作表） */
    backupToExcel: function (opts) {
      const XLSX = window.XLSX;
      if (!XLSX) {
        toast("Excel 元件尚未載入，請稍後再試", true);
        return false;
      }
      const bk = Export.buildBackup(opts);
      const txRows = function (kind) {
        return bk.txList.filter(function (t) { return (kind === "expense" ? t.kind === "expense" : t.kind !== "expense"); })
          .map(function (t) {
            return {
              "日期": t.date || "",
              "沖銷月份": (t.months || []).join("、"),
              "類別": t.category || "",
              "對象": t.target || "",
              "金額": toNum(t.amount, 0),
              "收款方式": t.method || "",
              "單據編號": t.receiptNo || "",
              "有單據附件": t.receiptImg ? "有" : "",
              "備註": t.note || "",
              "建立人": t.createdBy || "",
              "建立時間": t.createdAt || "",
              "最後修改人": t.updatedBy || "",
              "最後修改時間": t.updatedAt || ""
            };
          });
      };
      const bankRows = bk.bankList.map(function (b) {
        return {
          "日期": b.date || "", "帳本": b.bookName || "", "摘要": b.summary || "",
          "存入": toNum(b.deposit, 0), "提出": toNum(b.withdraw, 0), "餘額": toNum(b.balance, 0), "備註": b.note || ""
        };
      });
      const bookRows = bk.books.map(function (b) {
        return { "帳本": b.name || "", "類型": b.type || "", "期初餘額": toNum(b.openingBalance, 0), "備註": b.note || "" };
      });
      const feeRows = bk.fees.map(function (f) {
        return { "戶號": f.unit || "", "姓名": f.name || "", "每月管理費": toNum(f.amount, 0), "開始月份": f.startMonth || "", "備註": f.note || "" };
      });
      const budgetRows = [];
      bk.budgets.forEach(function (b) {
        (b.items || []).forEach(function (it) {
          budgetRows.push({ "年度": b.year || "", "類型": it.kind === "expense" ? "支出" : "收入", "科目": it.category || "", "預算金額": toNum(it.amount, 0) });
        });
      });
      const noticeRows = bk.notices.map(function (n) {
        return {
          "戶號": n.unit || "", "姓名": n.name || "", "發文日": n.issuedAt || "", "繳納期限": n.deadline || "",
          "欠繳月數": (n.months || []).length, "尚欠合計": toNum(n.totalOwe, 0),
          "已發送管道": (n.channels || []).join("、"), "最近通知": n.notifiedAt || ""
        };
      });
      const auditRows = bk.audits.map(function (a) {
        return { "動作": a.action || "", "內容": a.summary || "", "原因": a.reason || "", "人員": a.by || "", "時間": a.at || "" };
      });
      const cfgRows = [
        { "項目": "社區", "值": bk.meta.communityName },
        { "項目": "備份年度", "值": bk.meta.year },
        { "項目": "匯出時間", "值": bk.meta.exportedAt },
        { "項目": "財報系統功能啟用日期", "值": String((bk.config && bk.config.enableDate) || "") },
        { "項目": "收入類別", "值": ((bk.config && bk.config.incomeCategories) || []).join("、") },
        { "項目": "支出類別", "值": ((bk.config && bk.config.expenseCategories) || []).join("、") },
        { "項目": "帳本類型", "值": ((bk.config && bk.config.bookTypes) || []).join("、") },
        { "項目": "催收通知標題", "值": String(((bk.config && bk.config.notice) || {}).docTitle || "") },
        { "項目": "催收繳納期限（天）", "值": String(((bk.config && bk.config.notice) || {}).dueDays || "") }
      ];
      try {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cfgRows, { header: ["項目", "值"] }), "備份說明");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows("income"), { header: ["日期", "沖銷月份", "類別", "對象", "金額", "收款方式", "單據編號", "有單據附件", "備註", "建立人", "建立時間", "最後修改人", "最後修改時間"] }), "收入明細");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows("expense"), { header: ["日期", "沖銷月份", "類別", "對象", "金額", "收款方式", "單據編號", "有單據附件", "備註", "建立人", "建立時間", "最後修改人", "最後修改時間"] }), "支出明細");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bankRows, { header: ["日期", "帳本", "摘要", "存入", "提出", "餘額", "備註"] }), "銀行明細");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bookRows, { header: ["帳本", "類型", "期初餘額", "備註"] }), "帳本");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(feeRows, { header: ["戶號", "姓名", "每月管理費", "開始月份", "備註"] }), "管理費設定");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(budgetRows, { header: ["年度", "類型", "科目", "預算金額"] }), "年度預算");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noticeRows, { header: ["戶號", "姓名", "發文日", "繳納期限", "欠繳月數", "尚欠合計", "已發送管道", "最近通知"] }), "催收通知");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(auditRows, { header: ["動作", "內容", "原因", "人員", "時間"] }), "稽核紀錄");
        XLSX.writeFile(wb, sanitizeFilename(bk.meta.communityName) + "_財報備份_" + sanitize(bk.meta.year) + ".xlsx");
        return true;
      } catch (e) {
        console.warn("[finance] backup excel failed", e);
        toast("備份失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
        return false;
      }
    },

    /** 資料備份（JSON 原始資料，保留完整欄位含單據附件） */
    backupToJson: function (opts) {
      const bk = Export.buildBackup(opts);
      try {
        const json = JSON.stringify(bk, null, 2);
        const dataUrl = "data:application/json;charset=utf-8;base64," +
          window.btoa(unescape(encodeURIComponent(json)));
        Export.downloadDataUrl(dataUrl, sanitizeFilename(bk.meta.communityName) + "_財報備份_" + sanitize(bk.meta.year) + ".json");
        return true;
      } catch (e) {
        console.warn("[finance] backup json failed", e);
        toast("備份失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
        return false;
      }
    },

    /** 以隱藏 iframe 呼叫列印（避免被瀏覽器彈窗阻擋） */
    printNode: function (node) {
      return new Promise(function (resolve) {
        try {
          const frame = document.createElement("iframe");
          frame.setAttribute("aria-hidden", "true");
          frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
          document.body.appendChild(frame);
          const doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
          if (!doc) throw new Error("無法建立列印文件");
          doc.open();
          doc.write('<html><head><meta charset="utf-8"><title>年度預算表</title><style>' +
            "@page{size:A4;margin:12mm;}" +
            'body{margin:0;font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;color:#111827;}' +
            ".fin-print{position:static!important;left:auto!important;width:auto!important;padding:0!important;}" +
            ".fin-print .hdr{display:flex;align-items:baseline;gap:12px;margin:0 0 6px;}" +
            ".fin-print .hdr .community{font-size:22px;font-weight:700;}" +
            ".fin-print h1{font-size:22px;margin:0;}" +
            ".fin-print .meta{font-size:12px;color:#4b5563;margin-bottom:14px;}" +
            ".fin-print table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px;}" +
            ".fin-print th,.fin-print td{border:1px solid #d1d5db;padding:6px 8px;text-align:left;}" +
            ".fin-print th{background:#f3f4f6;}" +
            ".fin-print h2{font-size:15px;margin:16px 0 8px;}" +
            "</style></head><body>" + (node ? node.outerHTML : "") + "</body></html>");
          doc.close();
          const win = frame.contentWindow;
          setTimeout(function () {
            try { win.focus(); win.print(); } catch (e) { /* 忽略 */ }
            setTimeout(function () { if (frame.parentNode) frame.parentNode.removeChild(frame); }, 1500);
            resolve(true);
          }, 250);
        } catch (e) {
          console.warn("[finance] print failed", e);
          resolve(false);
        }
      });
    },

    printFallback: function (node) {
      try {
        const w = window.open("", "_blank");
        if (!w) {
          toast("無法開啟列印視窗，請確認瀏覽器允許彈出視窗", true);
          return;
        }
        w.document.write('<html><head><title>財報系統</title></head><body>' +
          '<button onclick="window.print()" style="padding:8px 16px;margin-bottom:12px;">列印 / 另存 PDF</button>' +
          (node ? node.outerHTML : "") + "</body></html>");
        w.document.close();
      } catch (err) {
        toast("匯出失敗，請稍後再試", true);
      }
    },

    downloadDataUrl: function (dataUrl, filename) {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      try { a.click(); } catch (e) { /* 忽略 */ }
      setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 500);
    }
  };

  function sanitize(v) {
    return sanitizeFilename(v);
  }

  function iconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M5 19.5h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M7.2 18.8V11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M12 18.8V8.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M16.8 18.8V13.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M7.2 10.3 10 7.8l2.6 2.4L16.8 6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>";
  }

  /* ------------------------------------------------------------------ */
  /* 期間工具                                                            */
  /* ------------------------------------------------------------------ */

  function ymd(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /** 將 Firestore Timestamp／數字／字串轉為 YYYY-MM-DD */
  function toDateStr(ts) {
    if (!ts) return "";
    try {
      if (typeof ts.toDate === "function") return ymd(ts.toDate());
      if (typeof ts === "number") return ymd(new Date(ts));
      if (typeof ts === "string") {
        const m = ts.match(/^\d{4}-\d{2}-\d{2}/);
        if (m) return m[0];
        const d = new Date(ts);
        return isNaN(d.getTime()) ? "" : ymd(d);
      }
    } catch (e) { /* 忽略 */ }
    return "";
  }

  /** 昨天：報表僅涵蓋已結束的期間，本日（含）之後不列入 */
  function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return ymd(d);
  }

  function dayRange() {
    const t = yesterdayStr();
    return { from: t, to: t };
  }

  /** 依月份字串（YYYY-MM）位移 n 個月 */
  function shiftMonth(month, delta) {
    const s = String(month || "").trim();
    if (!/^\d{4}-\d{2}$/.test(s)) return todayStr().slice(0, 7);
    const y = Number(s.slice(0, 4));
    const mo = Number(s.slice(5, 7)) - 1 + (delta || 0);
    const d = new Date(y, mo, 1);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  /**
   * 已結束的期間選項：日（近 90 天）／月（近 36 個月）／年（近 16 年），皆不含尚未結束的期間；
   * 若提供 minDate（報表啟用日期），早於該日期的期間不列入。
   */
  function periodOptions(kind, minDate) {
    const out = [];
    const min = String(minDate || "").trim();
    if (kind === "day") {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      for (let i = 0; i < 90; i++) {
        const s = ymd(d);
        if (min && s < min) break;
        out.push(s);
        d.setDate(d.getDate() - 1);
      }
      return out;
    }
    if (kind === "month") {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - 1);
      for (let i = 0; i < 36; i++) {
        const s = d.getFullYear() + "-" + pad2(d.getMonth() + 1);
        if (min && s < min.slice(0, 7)) break;
        out.push(s);
        d.setMonth(d.getMonth() - 1);
      }
      return out;
    }
    const y = new Date().getFullYear() - 1;
    for (let i = 0; i < 16; i++) {
      const s = String(y - i);
      if (min && s < min.slice(0, 4)) break;
      out.push(s);
    }
    return out;
  }

  /** 期間選項字串換算為起迄日 */
  function rangeOfPeriod(kind, value) {
    const v = String(value || "");
    if (kind === "month") {
      const y = Number(v.slice(0, 4));
      const m = Number(v.slice(5, 7));
      return { from: v + "-01", to: ymd(new Date(y, m, 0)) };
    }
    if (kind === "year") return { from: v + "-01-01", to: v + "-12-31" };
    return { from: v, to: v };
  }

  /** 起迄日涵蓋的月份清單（YYYY-MM） */
  function monthsOfRange(from, to) {
    const s = String(from || "").slice(0, 7);
    const e = String(to || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(s) || !/^\d{4}-\d{2}$/.test(e) || s > e) return [];
    const out = [];
    let cur = s;
    for (let i = 0; i < 240 && cur <= e; i++) {
      out.push(cur);
      cur = shiftMonth(cur, 1);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* UI                                                                  */
  /* ------------------------------------------------------------------ */

  const UI = {
    renderAdminPage: function (container, ctx) {
      if (!container) return;
      ensureStyles();

      if (typeof window.__nwFinanceCleanup === "function") {
        try { window.__nwFinanceCleanup(); } catch (e) { /* 忽略 */ }
      }

      const db = getDb();
      const context = ctx || {};
      /* 操作人員姓名：優先使用呼叫端帶入的姓名，其次登入帳號，最後由 users/{uid} 補正為真實姓名 */
      const givenName = String(context.name || "").trim();
      let accountName = "";
      try {
        const fb = window.firebase;
        const u = fb && typeof fb.auth === "function" ? fb.auth().currentUser : null;
        if (u) accountName = String(u.displayName || "").trim() || String(u.email || "").split("@")[0].trim();
      } catch (e) { /* 忽略 */ }
      context.name = givenName || accountName || "管理員";
      const cid = String(context.communityId || "").trim();
      const cName = String(context.communityName || "").trim();

      if (!db) {
        container.innerHTML = '<section class="card"><div class="card-bd"><div class="tag red">Firestore 尚未初始化，請重新整理頁面</div></div></section>';
        return;
      }
      if (!cid || cid === "default") {
        container.innerHTML = '<section class="card"><div class="card-bd"><div class="tag yellow">請先選擇社區</div></div></section>';
        return;
      }

      const role = String(context.role || "viewer").toLowerCase();
      const canWrite = Model.hasPermission(role, "write");
      const canDelete = Model.hasPermission(role, "delete");
      const subnavEl = document.getElementById("subnav");

      const state = {
        tab: "overview",
        loading: true,
        tx: [],
        bank: [],
        books: [],
        fees: [],
        budgets: {},
        activeBookId: "",
        arrearsSort: "owe",
        filters: {
          income: { month: "", category: "", q: "", target: "", from: "", to: "", noBook: false },
          expense: { month: "", category: "", q: "", target: "", from: "", to: "", noBook: false },
          bank: { month: todayStr().slice(0, 7), q: "" }
        },
        report: { preset: "day", from: dayRange().from, to: dayRange().to },
        budgetYear: String(new Date().getFullYear() + 1),
        communityCreatedAt: "",
        config: {
          incomeCategories: DEFAULT_CONFIG.incomeCategories.slice(),
          expenseCategories: DEFAULT_CONFIG.expenseCategories.slice(),
          bookTypes: DEFAULT_CONFIG.bookTypes.slice(),
          recurring: [],
          notice: Object.assign({}, DEFAULT_CONFIG.notice),
          enableDate: ""
        },
        configUpdatedAt: "",
        residents: [],
        notices: [],
        audits: [],
        unsubTx: null,
        unsubBank: null,
        unsubBooks: null,
        unsubFees: null,
        unsubBudgets: null,
        unsubCfg: null,
        unsubCommunity: null,
        unsubResidents: null,
        unsubNotices: null,
        unsubAudits: null
      };

      const cleanup = function () {
        if (state.unsubTx) { try { state.unsubTx(); } catch (e) { /* 忽略 */ } state.unsubTx = null; }
        if (state.unsubBank) { try { state.unsubBank(); } catch (e) { /* 忽略 */ } state.unsubBank = null; }
        if (state.unsubBooks) { try { state.unsubBooks(); } catch (e) { /* 忽略 */ } state.unsubBooks = null; }
        if (state.unsubFees) { try { state.unsubFees(); } catch (e) { /* 忽略 */ } state.unsubFees = null; }
        if (state.unsubBudgets) { try { state.unsubBudgets(); } catch (e) { /* 忽略 */ } state.unsubBudgets = null; }
        if (state.unsubCfg) { try { state.unsubCfg(); } catch (e) { /* 忽略 */ } state.unsubCfg = null; }
        if (state.unsubCommunity) { try { state.unsubCommunity(); } catch (e) { /* 忽略 */ } state.unsubCommunity = null; }
        if (state.unsubResidents) { try { state.unsubResidents(); } catch (e) { /* 忽略 */ } state.unsubResidents = null; }
        if (state.unsubNotices) { try { state.unsubNotices(); } catch (e) { /* 忽略 */ } state.unsubNotices = null; }
        if (state.unsubAudits) { try { state.unsubAudits(); } catch (e) { /* 忽略 */ } state.unsubAudits = null; }
      };
      window.__nwFinanceCleanup = cleanup;

      /** 讀取設定值（無自訂資料時退回預設） */
      const cfgList = function (key) {
        const arr = state.config ? state.config[key] : null;
        return Array.isArray(arr) ? arr : (DEFAULT_CONFIG[key] || []).slice();
      };

      /** 報表啟用日期：設定值優先，未設定時採社區帳號創建日期；皆無則回傳空字串（不限制） */
      const enableDate = function () {
        const v = String((state.config && state.config.enableDate) || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const c = String(state.communityCreatedAt || "").trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(c) ? c : "";
      };

      /** 設定頁顯示用：實際套用的啟用日期（無設定值時顯示社區創建日期作為預設） */
      const enableDateForInput = function () {
        const v = String((state.config && state.config.enableDate) || "").trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        return /^\d{4}-\d{2}-\d{2}$/.test(String(state.communityCreatedAt || "")) ? state.communityCreatedAt : "";
      };

      const currentConfig = function () {
        return {
          incomeCategories: cfgList("incomeCategories").slice(),
          expenseCategories: cfgList("expenseCategories").slice(),
          bookTypes: cfgList("bookTypes").slice(),
          incomeTargets: cfgList("incomeTargets").slice(),
          expenseTargets: cfgList("expenseTargets").slice(),
          recurring: cfgList("recurring").map(function (it) { return Object.assign({}, it); }),
          notice: Object.assign({}, DEFAULT_CONFIG.notice, (state.config && state.config.notice) || {}),
          enableDate: String((state.config && state.config.enableDate) || "")
        };
      };

      /* ---------------- 資料訂閱 ---------------- */

      const subscribeTx = function () {
        state.unsubTx = Model.txCol(db, cid).onSnapshot(function (snap) {
          const list = [];
          snap.forEach(function (d) {
            const v = d.data() || {};
            list.push({
              id: d.id,
              kind: v.kind === "expense" ? "expense" : "income",
              date: String(v.date || ""),
              category: String(v.category || ""),
              amount: toNum(v.amount, 0),
              target: String(v.target || ""),
              method: String(v.method || ""),
              bookId: String(v.bookId || ""),
              months: Array.isArray(v.months) ? v.months.map(String) : [],
              receiptNo: String(v.receiptNo || ""),
              receiptImg: String(v.receiptImg || ""),
              note: String(v.note || ""),
              /* 操作軌跡：建立者／最後修改者與異動歷程 */
              createdAt: tsToStr(v.createdAt),
              createdBy: String((v.createdBy && v.createdBy.name) || ""),
              updatedAt: tsToStr(v.updatedAt),
              updatedBy: String((v.updatedBy && v.updatedBy.name) || ""),
              history: Array.isArray(v.history) ? v.history.map(function (h) {
                return {
                  at: String((h && h.at) || ""),
                  by: String((h && h.by) || ""),
                  action: String((h && h.action) || "")
                };
              }) : []
            });
          });
          list.sort(function (a, b) {
            return String(b.date || "").localeCompare(String(a.date || ""));
          });
          state.tx = list;
          state.loading = false;
          render();
        }, function (err) {
          console.warn("[finance] tx subscribe failed", err);
          state.tx = [];
          state.loading = false;
          render();
          toast("財報資料讀取失敗：" + (err && err.message ? err.message : "請檢查權限"), true);
        });
      };

      const subscribeBank = function () {
        state.unsubBank = Model.bankCol(db, cid).onSnapshot(function (snap) {
          const list = [];
          snap.forEach(function (d) {
            const v = d.data() || {};
            list.push({
              id: d.id,
              bookId: String(v.bookId || ""),
              bookName: String(v.bookName || ""),
              date: String(v.date || ""),
              summary: String(v.summary || ""),
              deposit: toNum(v.deposit, 0),
              withdraw: toNum(v.withdraw, 0),
              note: String(v.note || "")
            });
          });
          list.sort(function (a, b) {
            const c = String(b.date || "").localeCompare(String(a.date || ""));
            return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
          });
          state.bank = list;
          render();
        }, function (err) {
          console.warn("[finance] bank subscribe failed", err);
          state.bank = [];
          render();
          toast("帳本紀錄讀取失敗：" + (err && err.message ? err.message : "請檢查權限"), true);
        });
      };

      const subscribeBooks = function () {
        state.unsubBooks = Model.bookCol(db, cid).onSnapshot(function (snap) {
          const list = [];
          snap.forEach(function (d) {
            const v = d.data() || {};
            list.push({
              id: d.id,
              name: String(v.name || ""),
              type: String(v.type || ""),
              openingBalance: toNum(v.openingBalance, 0),
              note: String(v.note || ""),
              order: toNum(v.order, 0)
            });
          });
          list.sort(function (a, b) {
            if (a.order !== b.order) return a.order - b.order;
            return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
          });
          state.books = list;
          if (state.activeBookId && !list.some(function (bk) { return bk.id === state.activeBookId; })) {
            state.activeBookId = "";
          }
          render();
        }, function (err) {
          console.warn("[finance] books subscribe failed", err);
          state.books = [];
          render();
          toast("帳本讀取失敗：" + (err && err.message ? err.message : "請檢查權限"), true);
        });
      };

      const subscribeFees = function () {
        state.unsubFees = Model.feeCol(db, cid).onSnapshot(function (snap) {
          const list = [];
          snap.forEach(function (d) {
            const v = d.data() || {};
            list.push({
              id: d.id,
              userId: String(v.userId || d.id || ""),
              unit: String(v.unit || ""),
              name: String(v.name || ""),
              amount: toNum(v.amount, 0),
              startMonth: String(v.startMonth || "").trim(),
              note: String(v.note || "")
            });
          });
          state.fees = list;
          render();
        }, function (err) {
          console.warn("[finance] fees subscribe failed", err);
          state.fees = [];
          render();
          toast("管理費讀取失敗：" + (err && err.message ? err.message : "請檢查權限"), true);
        });
      };

      const subscribeBudgets = function () {
        state.unsubBudgets = Model.budgetCol(db, cid).onSnapshot(function (snap) {
          const map = {};
          snap.forEach(function (d) {
            const v = d.data() || {};
            const year = String(v.year || d.id || "").trim();
            if (!year) return;
            map[year] = (Array.isArray(v.items) ? v.items : []).map(function (it) {
              return {
                kind: it && it.kind === "expense" ? "expense" : "income",
                category: String((it && it.category) || ""),
                amount: toNum(it && it.amount, 0)
              };
            });
          });
          state.budgets = map;
          render();
        }, function (err) {
          console.warn("[finance] budgets subscribe failed", err);
          state.budgets = {};
          render();
        });
      };

      /** 已發送的催收通知紀錄（供管理費列表顯示「已通知」與避免重複催收） */
      const subscribeNotices = function () {
        state.unsubNotices = Model.noticeCol(db, cid).onSnapshot(function (snap) {
          const list = [];
          snap.forEach(function (d) {
            const v = d.data() || {};
            list.push({
              id: d.id,
              residentId: String(v.residentId || ""),
              unit: String(v.unit || ""),
              name: String(v.name || ""),
              issuedAt: String(v.issuedAt || ""),
              deadline: String(v.deadline || ""),
              notifiedAt: toDateStr(v.notifiedAt),
              channels: Array.isArray(v.channels) ? v.channels.map(String) : [],
              months: Array.isArray(v.months) ? v.months.map(function (x) { return String((x && x.month) || ""); }) : [],
              totalOwe: toNum(v.totalOwe, 0)
            });
          });
          state.notices = list;
          render();
        }, function (err) {
          console.warn("[finance] notices subscribe failed", err);
          state.notices = [];
        });
      };

      /** 稽核紀錄（刪除等留痕動作） */
      const subscribeAudits = function () {
        state.unsubAudits = Model.auditCol(db, cid).onSnapshot(function (snap) {
          const list = [];
          snap.forEach(function (d) {
            const v = d.data() || {};
            list.push({
              id: d.id,
              action: String(v.action || ""),
              summary: String(v.summary || ""),
              reason: String(v.reason || ""),
              at: String(v.at || "") || tsToStr(v.atTs),
              by: String((v.by && v.by.name) || "")
            });
          });
          list.sort(function (a, b) { return String(b.at || "").localeCompare(String(a.at || "")); });
          state.audits = list;
          render();
        }, function (err) {
          console.warn("[finance] audit subscribe failed", err);
          state.audits = [];
        });
      };

      const subscribeConfig = function () {
        state.unsubCfg = Model.configDoc(db, cid).onSnapshot(function (snap) {
          const v = (snap && snap.exists && snap.data()) || null;
          state.config = {
            incomeCategories: v && Array.isArray(v.incomeCategories) ? v.incomeCategories.slice() : DEFAULT_CONFIG.incomeCategories.slice(),
            expenseCategories: v && Array.isArray(v.expenseCategories) ? v.expenseCategories.slice() : DEFAULT_CONFIG.expenseCategories.slice(),
            bookTypes: v && Array.isArray(v.bookTypes) ? v.bookTypes.slice() : DEFAULT_CONFIG.bookTypes.slice(),
            incomeTargets: v && Array.isArray(v.incomeTargets) ? v.incomeTargets.slice() : [],
            expenseTargets: v && Array.isArray(v.expenseTargets) ? v.expenseTargets.slice() : [],
            recurring: v && Array.isArray(v.recurring) ? v.recurring.map(function (it) {
              const day = toNum(it && it.day, 1);
              return {
                id: String((it && it.id) || ""),
                kind: (it && it.kind) === "income" ? "income" : "expense",
                category: String((it && it.category) || ""),
                target: String((it && it.target) || ""),
                amount: toNum(it && it.amount, 0),
                bookId: String((it && it.bookId) || ""),
                day: Math.min(28, Math.max(1, Math.round(day) || 1)),
                note: String((it && it.note) || ""),
                active: !(it && it.active === false)
              };
            }) : [],
            enableDate: v && typeof v.enableDate === "string" ? v.enableDate : "",
            notice: Object.assign({}, DEFAULT_CONFIG.notice, (v && v.notice) || {})
          };
          state.configUpdatedAt = v ? tsToStr(v.updatedAt) : "";
          render();
        }, function (err) {
          console.warn("[finance] config subscribe failed", err);
        });
      };

      /** 讀取社區文件以取得帳號創建日期（作為報表啟用日期預設值） */
      const subscribeCommunity = function () {
        state.unsubCommunity = db.collection("communities").doc(cid).onSnapshot(function (snap) {
          const v = (snap && snap.exists && snap.data()) || {};
          state.communityCreatedAt = toDateStr(v.createdAt);
          render();
        }, function (err) {
          console.warn("[finance] community subscribe failed", err);
        });
      };

      /** 是否為住戶類型帳號（比照住戶造冊的判斷） */
      const isResidentRole = function (role) {
        const r = String(role || "").trim();
        if (!r) return true;
        if (r === "community" || r === "社區") return false;
        if (r === "admin" || r === "系統管理員" || r === "系統管理者" || r === "系統") return false;
        return r === "resident" || r === "住戶" || r === "居民" || r === "住戶帳號";
      };

      /** 自動帶入目前社區的住戶與委員帳號，作為收入對象 */
      const subscribeResidents = function () {
        const byCommunity = [];
        const byIdList = [];
        const emit = function () {
          const merged = new Map();
          byCommunity.concat(byIdList).forEach(function (d) {
            if (d && d.id) merged.set(String(d.id), d);
          });
          state.residents = Array.from(merged.values())
            .map(function (d) {
              const v = (d && typeof d.data === "function") ? (d.data() || {}) : {};
              const houseNo = String(v.houseNo || v.unit || "").trim();
              const subUnit = String(v.subUnit || "").trim();
              const unit = subUnit ? (houseNo ? houseNo + "-" + subUnit : subUnit) : houseNo;
              const name = String(v.displayName || v.name || "").trim();
              const category = String(v.category || v.residentCategory || "").trim();
              const roles = Array.isArray(v.residentRoles) ? v.residentRoles.map(String) : [];
              const isCommittee = category.indexOf("委員") !== -1 ||
                roles.some(function (r) { return r.indexOf("委員") !== -1; });
              return {
                id: String(d.id || ""),
                role: String(v.role || ""),
                status: String(v.status || ""),
                unit: unit,
                subUnit: subUnit,
                name: name,
                email: String(v.email || v.username || ""),
                phone: String(v.phone || v.mobile || v.phoneNumber || ""),
                isCommittee: isCommittee,
                label: [unit, name].filter(Boolean).join(" ") || String(v.email || v.username || "").trim() || "未命名住戶"
              };
            })
            .filter(function (r) { return isResidentRole(r.role) && r.status !== "pending"; })
            .sort(function (a, b) {
              const ua = String(a.unit || "");
              const ub = String(b.unit || "");
              if (ua !== ub) return ua.localeCompare(ub, "zh-Hant");
              return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
            });
          render();
        };
        const onErr = function (which) {
          return function (err) {
            console.warn("[finance] residents subscribe failed (" + which + ")", err);
          };
        };
        const u1 = db.collection("users").where("community", "==", cid).onSnapshot(function (snap) {
          byCommunity.length = 0;
          (snap && snap.docs ? snap.docs : []).forEach(function (d) { byCommunity.push(d); });
          emit();
        }, onErr("community"));
        const u2 = db.collection("users").where("communityIds", "array-contains", cid).onSnapshot(function (snap) {
          byIdList.length = 0;
          (snap && snap.docs ? snap.docs : []).forEach(function (d) { byIdList.push(d); });
          emit();
        }, onErr("communityIds"));
        state.unsubResidents = function () {
          try { u1(); } catch (e) { /* 忽略 */ }
          try { u2(); } catch (e) { /* 忽略 */ }
        };
      };

      /** 收入對象可選清單＝住戶帳號（自動）＋自訂對象 */
      const incomeTargetOptions = function () {
        const out = [];
        state.residents.forEach(function (r) {
          if (r.label && out.indexOf(r.label) === -1) out.push(r.label);
        });
        cfgList("incomeTargets").forEach(function (v) {
          if (v && out.indexOf(v) === -1) out.push(v);
        });
        return out;
      };

      /* ---------------- 管理費 ---------------- */

      /** 該住戶的管理費設定（以 users 文件 ID 對應） */
      const feeOf = function (userId) {
        return state.fees.find(function (f) { return f.userId === String(userId || ""); }) || null;
      };

      /** 該住戶的管理費起算月份（YYYY-MM）：設定值優先，未設定時採報表啟用月份 */
      const feeStartMonth = function (userId) {
        const f = feeOf(userId);
        const s = f ? String(f.startMonth || "").trim() : "";
        if (/^\d{4}-\d{2}$/.test(s)) return s;
        const e = String(enableDate() || "").slice(0, 7);
        return /^\d{4}-\d{2}$/.test(e) ? e : "";
      };

      /** 財報紀錄是否歸屬指定月份（有填沖銷月份時以沖銷月份為準，否則看日期） */
      const coversMonth = function (t, mm) {
        const ms = Array.isArray(t.months) ? t.months : [];
        if (ms.length) return ms.indexOf(mm) !== -1;
        return String(t.date || "").slice(0, 7) === mm;
      };

      /** 依月份統計各收入對象（住戶）實收金額 */
      const paidByTarget = function (mm) {
        const map = {};
        state.tx.forEach(function (t) {
          if (t.kind === "expense") return;
          if (!coversMonth(t, mm)) return;
          const key = String(t.target || "").trim();
          if (!key) return;
          map[key] = (map[key] || 0) + toNum(t.amount, 0);
        });
        return map;
      };

      /** 指定月份的管理費應收、實收與未繳住戶明細 */
      const feeSummary = function (mm) {
        const paid = paidByTarget(mm);
        let due = 0;
        let received = 0;
        const rows = [];
        state.residents.forEach(function (r) {
          const f = feeOf(r.id);
          const amount = f ? toNum(f.amount, 0) : 0;
          if (amount <= 0) return;
          const start = feeStartMonth(r.id);
          if (start && mm < start) return;
          const got = toNum(paid[r.label] || 0, 0);
          due += amount;
          received += Math.min(got, amount);
          rows.push({
            unit: String(r.unit || ""),
            name: String(r.name || ""),
            label: String(r.label || ""),
            amount: amount,
            startMonth: start,
            paid: got,
            owe: Math.max(0, amount - got)
          });
        });
        rows.sort(function (a, b) {
          const ua = a.unit || a.name;
          const ub = b.unit || b.name;
          const c = String(ua).localeCompare(String(ub), "zh-Hant");
          return c !== 0 ? c : String(a.name).localeCompare(String(b.name), "zh-Hant");
        });
        return {
          due: due,
          received: received,
          owe: due - received,
          rows: rows,
          unpaid: rows.filter(function (x) { return x.owe > 0; })
        };
      };

      /** 上一個月（YYYY-MM）：管理費結算基準 */
      const prevMonthStr = function () {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
      };

      /** 由指定月份（預設報表啟用月份）起算至「上月」的月份清單（最多 24 個月） */
      const monthsUntilPrev = function (startMonth) {
        const end = prevMonthStr();
        const start = String(startMonth || enableDate() || "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(start)) return [end];
        const out = [];
        let y = Number(start.slice(0, 4));
        let m = Number(start.slice(5, 7));
        const ey = Number(end.slice(0, 4));
        const em = Number(end.slice(5, 7));
        while (y < ey || (y === ey && m <= em)) {
          out.push(y + "-" + pad2(m));
          m += 1;
          if (m > 12) { m = 1; y += 1; }
        }
        return out.slice(-24);
      };

      /** 逐月計算各住戶的欠繳明細：回傳 userId → [{month, amount, paid, owe}] */
      const feeArrears = function () {
        /* 起算月份取「報表啟用月份」與各住戶設定月份中最早者 */
        let from = String(enableDate() || "").slice(0, 7);
        state.residents.forEach(function (r) {
          const s = feeStartMonth(r.id);
          if (/^\d{4}-\d{2}$/.test(s) && (!from || s < from)) from = s;
        });
        const months = monthsUntilPrev(from);
        const paidMaps = {};
        months.forEach(function (mm) { paidMaps[mm] = paidByTarget(mm); });
        const out = {};
        state.residents.forEach(function (r) {
          const f = feeOf(r.id);
          const amount = f ? toNum(f.amount, 0) : 0;
          if (amount <= 0) return;
          const start = feeStartMonth(r.id);
          const list = [];
          months.forEach(function (mm) {
            if (start && mm < start) return;
            const got = toNum((paidMaps[mm] || {})[r.label] || 0, 0);
            const owe = Math.max(0, amount - got);
            if (owe > 0) list.push({ month: mm, amount: amount, paid: Math.min(got, amount), owe: owe });
          });
          if (list.length) out[r.id] = list;
        });
        return out;
      };

      /** 月份加減（YYYY-MM） */
      const shiftMonthStr = function (mm, delta) {
        const y = Number(String(mm || "").slice(0, 4));
        const m = Number(String(mm || "").slice(5, 7));
        if (!y || !m) return "";
        const d = new Date(y, m - 1 + Number(delta || 0), 1);
        return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
      };

      /**
       * 欠繳看板：彙整每戶的欠繳期數、連續欠繳月數、欠繳總額與最近欠繳月份
       * 連續欠繳月數＝自「上月」往回連續未繳的月數
       */
      const arrearsBoard = function () {
        const arr = feeArrears();
        const prev = prevMonthStr();
        return state.residents.map(function (r) {
          const list = arr[r.id] || [];
          if (!list.length) return null;
          const map = {};
          list.forEach(function (x) { map[x.month] = true; });
          let streak = 0;
          let cur = prev;
          while (map[cur] && streak < 240) {
            streak += 1;
            cur = shiftMonthStr(cur, -1);
          }
          return {
            unit: String(r.unit || ""),
            name: String(r.name || ""),
            label: String(r.label || ""),
            months: list.length,
            streak: streak,
            owe: list.reduce(function (a, x) { return a + toNum(x.owe, 0); }, 0),
            latest: list[list.length - 1] ? String(list[list.length - 1].month || "") : ""
          };
        }).filter(Boolean);
      };

      /* ---------------- 催收通知（內容、管道與紀錄） ---------------- */

      /** 通知管道代碼 → 顯示名稱 */
      const NOTICE_CHANNELS = {
        line: "LINE", email: "Email", sms: "簡訊", copy: "複製文字", pdf: "PDF", image: "圖片", print: "列印"
      };

      /** 日期字串（YYYY-MM-DD）加減天數 */
      const addDays = function (ymdStr, days) {
        const m = String(ymdStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return String(ymdStr || "");
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        d.setDate(d.getDate() + toNum(days, 0));
        return ymd(d);
      };

      /** 催收通知設定（未填欄位沿用系統預設用語） */
      const noticeCfg = function (over) {
        return Object.assign({}, DEFAULT_CONFIG.notice, (state.config && state.config.notice) || {}, over || {});
      };

      /** 組出通知函內容（含自訂用語與繳納期限天數） */
      const buildNoticePayload = function (resident, months, override) {
        const cfg = noticeCfg(override);
        const at = todayStr();
        const days = toNum(cfg.dueDays, 15);
        return {
          communityName: String(context.communityName || cName || "本社區"),
          residentId: String((resident && resident.id) || ""),
          unit: String((resident && resident.unit) || ""),
          name: String((resident && resident.name) || ""),
          issuedAt: at,
          deadline: addDays(at, days > 0 ? days : 15),
          contact: cfg.contact,
          note: cfg.note,
          docTitle: cfg.docTitle,
          signer: cfg.signer,
          subject: cfg.subject,
          closing: cfg.closing,
          months: months || []
        };
      };

      /** 各住戶最近一次的通知紀錄（供管理費列表顯示「已通知」） */
      const noticeByResident = function () {
        const map = {};
        state.notices.forEach(function (n) {
          if (!n.residentId) return;
          const cur = map[n.residentId];
          const key = String(n.notifiedAt || n.issuedAt || "");
          if (!cur || key >= String(cur.notifiedAt || cur.issuedAt || "")) map[n.residentId] = n;
        });
        return map;
      };

      /** 通知紀錄的日期標示（MM/DD） */
      const noticeDayLabel = function (n) {
        const m = String((n && (n.notifiedAt || n.issuedAt)) || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? m[2] + "/" + m[3] : "";
      };

      /** 讀取設定頁的催收通知欄位 */
      const readNoticeForm = function () {
        const read = function (k) {
          const el = container.querySelector('[data-fin-notice-field="' + k + '"]');
          return el ? String(el.value || "").trim() : "";
        };
        return Model.normalizeNotice({
          docTitle: read("docTitle"),
          signer: read("signer"),
          contact: read("contact"),
          dueDays: read("dueDays"),
          subject: read("subject"),
          closing: read("closing"),
          note: read("note")
        });
      };

      /** 報表期間（僅「本月」「本年」）的管理費應收、實收與達成率；其他期間回傳 null */
      const reportFees = function () {
        const r = state.report;
        if (r.preset !== "month" && r.preset !== "year") return null;
        const months = monthsOfRange(r.from, r.to);
        if (!months.length) return null;
        let due = 0;
        let received = 0;
        months.forEach(function (mm) {
          const s = feeSummary(mm);
          due += s.due;
          received += s.received;
        });
        return {
          due: due,
          received: received,
          rate: r.preset === "month" ? (due > 0 ? (received / due) * 100 : 0) : null
        };
      };

      /* ---------------- 資料篩選 ---------------- */

      const filterTx = function (kind) {
        const f = state.filters[kind] || {};
        const q = String(f.q || "").toLowerCase();
        return state.tx.filter(function (t) {
          if (kind === "expense" ? t.kind !== "expense" : t.kind === "expense") return false;
          if (f.month && String(t.date || "").slice(0, 7) !== f.month) return false;
          if (f.category && t.category !== f.category) return false;
          if (f.target && String(t.target || "") !== f.target) return false;
          const d = String(t.date || "");
          if (f.from && d < f.from) return false;
          if (f.to && d > f.to) return false;
          if (f.noBook && txBookId(t)) return false;
          if (q) {
            const hay = [t.date, t.category, t.target, t.receiptNo, t.note, t.method, (t.months || []).join("、")].join(" ").toLowerCase();
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });
      };

      /** 帳本名稱（以帳本清單即時查得，查不到時退回紀錄上的快照名稱） */
      const bookNameOf = function (bookId, fallback) {
        const bk = state.books.find(function (x) { return x.id === bookId; });
        if (bk && bk.name) return bk.name;
        return String(fallback || "");
      };

      /** 財報明細所對應的帳本 ID（優先用 bookId，舊資料則以帳本名稱比對） */
      const txBookId = function (t) {
        if (!t) return "";
        const explicit = String(t.bookId || "");
        if (explicit) return explicit;
        const name = String(t.method || "");
        if (!name) return "";
        const bk = state.books.find(function (x) { return String(x.name || "") === name; });
        return bk ? String(bk.id) : "";
      };

      /** 財報明細換算為帳本流水（收入＝存入、支出＝提出） */
      const txFlowRows = function (bookId) {
        return state.tx.filter(function (t) { return txBookId(t) === bookId; })
          .map(function (t) {
            const isExpense = t.kind === "expense";
            return {
              id: "tx_" + t.id,
              txId: t.id,
              txKind: t.kind,
              bookId: bookId,
              bookName: bookNameOf(bookId, ""),
              fromTx: true,
              date: String(t.date || ""),
              summary: (isExpense ? "支出" : "收入") + "：" + String(t.category || "未分類") +
                (t.target ? "（" + t.target + "）" : ""),
              deposit: isExpense ? 0 : toNum(t.amount, 0),
              withdraw: isExpense ? toNum(t.amount, 0) : 0,
              note: String(t.note || "")
            };
          });
      };

      /** 該帳本全部紀錄（帳本紀錄＋財報明細，含全量計算的逐筆餘額，新到舊） */
      const bookAllRows = function (bookId) {
        const bk = state.books.find(function (x) { return x.id === bookId; });
        const opening = bk ? toNum(bk.openingBalance, 0) : 0;
        const bankRows = state.bank.filter(function (b) { return b.bookId === bookId; });
        return computeBookBalances(bankRows.concat(txFlowRows(bookId)), opening);
      };

      /** 指定帳本在目前篩選條件下的紀錄（新到舊） */
      const bookRecords = function (bookId) {
        const f = state.filters.bank || {};
        const q = String(f.q || "").toLowerCase();
        return bookAllRows(bookId).filter(function (b) {
          if (f.month && String(b.date || "").slice(0, 7) !== f.month) return false;
          if (q) {
            const hay = [b.date, b.summary, b.note].join(" ").toLowerCase();
            if (hay.indexOf(q) === -1) return false;
          }
          return true;
        });
      };

      /** 依關鍵字過濾帳本清單 */
      const filterBookList = function () {
        const f = state.filters.bank || {};
        const q = String(f.q || "").toLowerCase();
        if (!q) return state.books.slice();
        return state.books.filter(function (bk) {
          return [bk.name, bk.type, bk.note].join(" ").toLowerCase().indexOf(q) !== -1;
        });
      };

      /** 統計各帳本在指定月份（未指定則全期間）的期初、存入、提出、筆數與期末餘額 */
      const bookAgg = function (month) {
        const mm = String(month || "").trim();
        const map = {};
        state.books.forEach(function (bk) {
          map[bk.id] = {
            bookOpening: toNum(bk.openingBalance, 0),
            opening: toNum(bk.openingBalance, 0),
            inSum: 0,
            outSum: 0,
            count: 0,
            balance: 0
          };
        });
        /* 帳本紀錄＋指定收款方式的財報明細（收入＝存入、支出＝提出） */
        const rows = state.bank.slice();
        state.tx.forEach(function (t) {
          const bid = txBookId(t);
          if (!bid || !map[bid]) return;
          const isExpense = t.kind === "expense";
          rows.push({
            bookId: bid,
            date: String(t.date || ""),
            deposit: isExpense ? 0 : toNum(t.amount, 0),
            withdraw: isExpense ? toNum(t.amount, 0) : 0
          });
        });
        rows.forEach(function (r) {
          const m = map[r.bookId];
          if (!m) return;
          const d = String(r.date || "").slice(0, 7);
          if (mm && (!d || d >= mm)) return;
          m.opening += toNum(r.deposit, 0) - toNum(r.withdraw, 0);
        });
        rows.forEach(function (r) {
          const m = map[r.bookId];
          if (!m) return;
          if (mm && String(r.date || "").slice(0, 7) !== mm) return;
          m.inSum += toNum(r.deposit, 0);
          m.outSum += toNum(r.withdraw, 0);
          m.count += 1;
        });
        Object.keys(map).forEach(function (k) {
          const m = map[k];
          m.balance = m.opening + m.inSum - m.outSum;
        });
        return map;
      };

      const sumAmount = function (list) {
        return list.reduce(function (acc, t) { return acc + toNum(t.amount, 0); }, 0);
      };

      /* ---------------- 分頁籤 ---------------- */

      const renderTabs = function () {
        if (!subnavEl) return;
        subnavEl.innerHTML = TABS.map(function (t) {
          return '<button class="btn btn-sm ' + (state.tab === t.id ? "btn-primary" : "btn-ghost") +
            '" type="button" data-fin-tab="' + esc(t.id) + '">' + esc(t.label) + "</button>";
        }).join("");
        subnavEl.querySelectorAll("[data-fin-tab]").forEach(function (btn) {
          btn.onclick = function () {
            const id = btn.getAttribute("data-fin-tab");
            if (id === state.tab) return;
            state.tab = id;
            renderTabs();
            render();
          };
        });
      };

      /* ---------------- 主渲染 ---------------- */

      const render = function () {
        renderTabs();
        const tabMeta = TABS.find(function (t) { return t.id === state.tab; }) || {};
        const tabTitle = tabMeta.label || "財報系統";
        const tabDesc = tabMeta.desc || "收入、支出、銀行往來與報表匯出";
        let body = "";
        if (state.tab === "overview") body = renderOverview();
        else if (state.tab === "income") body = renderTxPanel("income");
        else if (state.tab === "expense") body = renderTxPanel("expense");
        else if (state.tab === "bank") body = renderBankPanel();
        else if (state.tab === "fees") body = renderFeesPanel();
        else if (state.tab === "report") body = renderReportPanel();
        else if (state.tab === "incomeCats") body = renderTargetPanel("income");
        else if (state.tab === "expenseCats") body = renderTargetPanel("expense");
        else body = renderSettingsPanel();

        container.innerHTML =
          '<section class="card fin-page">' +
          '<div class="card-hd">' +
          '<div class="left">' +
          '<div class="chip" aria-hidden="true">' + iconSvg() + "</div>" +
          '<div style="min-width:0;">' +
          "<h2>財報系統</h2>" +
          "<p>" + esc(tabTitle) + "：" + esc(tabDesc) + "</p>" +
          "</div>" +
          "</div>" +
          (canWrite ? "" : '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">' +
            '<span class="fin-tag" style="background:rgba(107,114,128,.12);color:#4b5563;">唯讀</span>' +
            "</div>") +
          "</div>" +
          '<div class="card-bd">' + body + "</div>" +
          "</section>";

        bindEvents();
      };

      /* ---------------- 財報面板（收入 / 支出共用） ---------------- */

      const renderTxPanel = function (kind) {
        const meta = KIND[kind];
        const f = state.filters[kind];
        const list = filterTx(kind);
        const total = sumAmount(list);
        const monthTotal = sumAmount(list.filter(function (t) {
          return String(t.date || "").slice(0, 7) === todayStr().slice(0, 7);
        }));
        const cats = cfgList(CATEGORY_KEYS[kind] || "incomeCategories");
        /* 對象選項：由既有紀錄歸納，方便快速篩選特定住戶／廠商 */
        const targets = [];
        state.tx.forEach(function (t) {
          if (kind === "expense" ? t.kind !== "expense" : t.kind === "expense") return;
          const v = String(t.target || "").trim();
          if (v && targets.indexOf(v) === -1) targets.push(v);
        });
        targets.sort(function (a, b) { return a.localeCompare(b, "zh-Hant"); });
        return "" +
          '<div class="fin-toolbar">' +
          '<div class="field"><label>月份</label><input type="month" data-fin-filter="' + kind + '" data-fin-key="month" value="' + esc(f.month) + '"/></div>' +
          '<div class="field"><label>類別</label><select data-fin-filter="' + kind + '" data-fin-key="category">' +
          '<option value="">全部類別</option>' +
          cats.map(function (c) {
            return '<option value="' + esc(c) + '"' + (f.category === c ? " selected" : "") + ">" + esc(c) + "</option>";
          }).join("") +
          "</select></div>" +
          '<div class="field"><label>對象</label><select data-fin-filter="' + kind + '" data-fin-key="target">' +
          '<option value="">全部對象</option>' +
          targets.map(function (c) {
            return '<option value="' + esc(c) + '"' + (f.target === c ? " selected" : "") + ">" + esc(c) + "</option>";
          }).join("") +
          "</select></div>" +
          '<div class="field"><label>起始日期</label><input type="date" data-fin-filter="' + kind + '" data-fin-key="from" value="' + esc(f.from) + '"/></div>' +
          '<div class="field"><label>結束日期</label><input type="date" data-fin-filter="' + kind + '" data-fin-key="to" value="' + esc(f.to) + '"/></div>' +
          '<div class="field" style="flex:1 1 180px;position:relative;">' +
          '<label>關鍵字</label>' +
          '<input type="search" data-fin-filter="' + kind + '" data-fin-key="q" value="' + esc(f.q) + '" placeholder="類別 / 對象 / 單據 / 備註"/>' +
          "</div>" +
          '<label style="display:flex;align-items:center;gap:6px;font-size:calc(13px * var(--fs, 1));font-weight:800;color:#374151;padding:8px 2px;cursor:pointer;">' +
          '<input type="checkbox" data-fin-filter="' + kind + '" data-fin-key="noBook"' + (f.noBook ? " checked" : "") + "/>只看未指定帳本</label>" +
          '<button class="btn btn-ghost" type="button" data-fin-clear="' + kind + '">清除</button>' +
          (canWrite ? '<button class="btn btn-primary" type="button" data-fin-add="' + kind + '">＋ 新增' + esc(meta.label) + "</button>" : "") +
          '<button class="btn" type="button" data-fin-recurring="1">定期收支</button>' +
          '<button class="btn" type="button" data-fin-export="' + kind + '">匯出 Excel</button>' +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("期間合計", fmtMoney(total), meta.color) +
          statCard("本月合計", fmtMoney(monthTotal), meta.color) +
          statCard("筆數", String(list.length), "#374151") +
          statCard("平均單筆", fmtMoney(list.length ? total / list.length : 0), "#374151") +
          "</div>" +
          '<div id="fin_list_' + kind + '">' + renderTxTable(kind, list) + "</div>";
      };

      const renderTxTable = function (kind, list) {
        const meta = KIND[kind];
        if (!list.length) {
          return '<div class="fin-table-wrap"><div class="fin-empty">尚無' + esc(meta.label) + '資料' +
            (canWrite ? "，可點擊「＋ 新增" + esc(meta.label) + "」建立第一筆。" : "。") + "</div></div>";
        }
        return '<div class="fin-table-wrap fin-cards"><table class="fin-table"><thead><tr>' +
          "<th>日期</th><th>沖銷月份</th><th>類別</th><th>對象</th><th>金額</th><th>收款方式</th><th>單據編號</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          list.map(function (t) {
            return "<tr>" +
              '<td data-label="日期">' + esc(t.date) + "</td>" +
              '<td data-label="沖銷月份">' + esc((t.months && t.months.length) ? t.months.join("、") : "—") + "</td>" +
              '<td data-label="類別"><span class="fin-tag" style="background:' + meta.bg + ";color:" + meta.color + ';">' + esc(t.category || "未分類") + "</span></td>" +
              '<td data-label="對象">' + esc(t.target || "—") + "</td>" +
              '<td class="num" data-label="金額" style="color:' + meta.color + ';">' + (kind === "expense" ? "-" : "+") + fmtMoney(t.amount) + "</td>" +
              '<td data-label="收款方式">' + esc(t.method || "—") + "</td>" +
              '<td data-label="單據編號">' + (t.receiptNo ? esc(t.receiptNo) : "—") +
              (t.receiptImg ? ' <button class="btn btn-sm" type="button" data-fin-shot="' + esc(t.id) + '">看單據</button>' : "") +
              "</td>" +
              '<td data-label="備註">' + esc(t.note || "—") +
              (t.updatedBy || t.createdBy
                ? '<div style="margin-top:2px;font-size:calc(11px * var(--fs, 1));font-weight:700;color:#9ca3af;">最後修改：' +
                  esc(t.updatedBy || t.createdBy) + " " + esc(String(t.updatedAt || t.createdAt || "").slice(0, 16)) + "</div>"
                : "") +
              "</td>" +
              '<td data-label="操作"><div class="ops">' +
              (canWrite ? '<button class="btn btn-sm" type="button" data-fin-edit="' + esc(t.id) + '">編輯</button>' : "") +
              '<button class="btn btn-sm btn-ghost" type="button" data-fin-log="' + esc(t.id) + '">軌跡</button>' +
              (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-del="' + esc(t.id) + '">刪除</button>' : "") +
              (!canWrite && !canDelete ? '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">唯讀</span>' : "") +
              "</div></td>" +
              "</tr>";
          }).join("") +
          "</tbody></table></div>";
      };

      /* ---------------- 銀行面板（帳本列表 / 帳本明細） ---------------- */

      /** 依日期（舊→新）計算某帳本逐筆餘額，回傳新到舊排序的陣列 */
      const computeBookBalances = function (list, opening) {
        const asc = (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
          const c = String(a.date || "").localeCompare(String(b.date || ""));
          return c !== 0 ? c : String(a.id).localeCompare(String(b.id));
        });
        let running = toNum(opening, 0);
        asc.forEach(function (b) {
          running += toNum(b.deposit, 0) - toNum(b.withdraw, 0);
          b.balance = running;
        });
        return asc.slice().sort(function (a, b) {
          const c = String(b.date || "").localeCompare(String(a.date || ""));
          return c !== 0 ? c : String(b.id).localeCompare(String(a.id));
        });
      };

      const renderBankPanel = function () {
        const active = state.activeBookId
          ? state.books.find(function (bk) { return bk.id === state.activeBookId; })
          : null;
        return active ? renderBookDetail(active) : renderBookList();
      };

      /** 月份導覽列（預設當月，可往前／往後查看） */
      const renderMonthNav = function (month, hint) {
        const isCur = month === todayStr().slice(0, 7);
        return '<div class="field" style="gap:4px;"><label>月份' + (hint ? "（" + esc(hint) + "）" : "") + "</label>" +
          '<div style="display:flex;align-items:center;gap:6px;">' +
          '<button class="btn btn-sm btn-ghost" type="button" data-fin-month-step="-1" title="上一月">‹ 上一月</button>' +
          '<input type="month" data-fin-filter="bank" data-fin-key="month" value="' + esc(month) + '" style="' + inputStyle + 'width:auto;"/>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-fin-month-step="1" title="下一月">下一月 ›</button>' +
          (isCur ? "" : '<button class="btn btn-sm" type="button" data-fin-month-cur="1">回本月</button>') +
          "</div></div>";
      };

      /** 帳本列表 */
      const renderBookList = function () {
        const f = state.filters.bank;
        const month = String(f.month || "");
        const books = filterBookList();
        const agg = bookAgg(month);
        const balanceOf = function (bk) {
          const m = agg[bk.id];
          return m ? m.balance : toNum(bk.openingBalance, 0);
        };
        const totalBalance = state.books.reduce(function (a, bk) { return a + balanceOf(bk); }, 0);
        const monthIn = state.books.reduce(function (a, bk) { return a + (agg[bk.id] ? agg[bk.id].inSum : 0); }, 0);
        const monthOut = state.books.reduce(function (a, bk) { return a + (agg[bk.id] ? agg[bk.id].outSum : 0); }, 0);
        const typeCards = cfgList("bookTypes").map(function (t) {
          const sum = state.books.filter(function (bk) { return bk.type === t; })
            .reduce(function (a, bk) { return a + balanceOf(bk); }, 0);
          return statCard(t, fmtMoney(sum), "#1d4ed8");
        }).join("");
        return "" +
          '<div class="fin-toolbar">' +
          renderMonthNav(month, "預設當月") +
          '<div class="field" style="flex:1 1 200px;"><label>關鍵字</label>' +
          '<input type="search" data-fin-filter="bank" data-fin-key="q" value="' + esc(f.q) + '" placeholder="帳本名稱 / 類型 / 備註"/></div>' +
          '<button class="btn btn-ghost" type="button" data-fin-clear="bank">清除</button>' +
          (canWrite ? '<button class="btn btn-primary" type="button" data-fin-add-book="1">＋ 新增帳本</button>' : "") +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("帳本數", String(state.books.length), "#374151") +
          statCard("本月存入", fmtMoney(monthIn), "#15803d") +
          statCard("本月提出", fmtMoney(monthOut), "#b91c1c") +
          statCard("期末總餘額", fmtMoney(totalBalance), "#1d4ed8") +
          typeCards +
          "</div>" +
          '<div class="fin-hint">目前檢視 <b>' + esc(month || "全部期間") + '</b>；可用「‹ 上一月 / 下一月 ›」往前查看歷史月份。餘額為該月月底結餘。點擊「檢視明細」可查看該帳本的存入／提出紀錄。「收入明細／支出明細」若指定收款方式為某帳本，會自動計入該帳本的存入／提出。</div>' +
          '<div id="fin_list_books">' + renderBookTable(books, agg) + "</div>";
      };

      const renderBookTable = function (books, agg) {
        if (!books.length) {
          return '<div class="fin-table-wrap"><div class="fin-empty">尚無帳本' +
            (canWrite ? "，可點擊「＋ 新增帳本」建立第一個帳本。" : "。") + "</div></div>";
        }
        return '<div class="fin-table-wrap fin-cards"><table class="fin-table"><thead><tr>' +
          "<th>帳本名稱</th><th>類型</th><th>期初餘額</th><th>存入</th><th>提出</th><th>期末餘額</th><th>筆數</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          books.map(function (bk) {
            const m = agg[bk.id] || { opening: 0, inSum: 0, outSum: 0, count: 0, balance: 0 };
            return "<tr>" +
              '<td data-label="帳本名稱">' + esc(bk.name || "未命名帳本") + "</td>" +
              '<td data-label="類型"><span class="fin-tag" style="background:rgba(29,78,216,.12);color:#1d4ed8;">' + esc(bk.type || "未分類") + "</span></td>" +
              '<td class="num" data-label="期初餘額">' + fmtMoney(m.opening) + "</td>" +
              '<td class="num" data-label="存入" style="color:#15803d;">' + (m.inSum ? fmtMoney(m.inSum) : "—") + "</td>" +
              '<td class="num" data-label="提出" style="color:#b91c1c;">' + (m.outSum ? fmtMoney(m.outSum) : "—") + "</td>" +
              '<td class="num" data-label="期末餘額" style="font-weight:900;">' + fmtMoney(m.balance) + "</td>" +
              '<td class="num" data-label="筆數">' + m.count + "</td>" +
              '<td data-label="備註">' + esc(bk.note || "—") + "</td>" +
              '<td data-label="操作"><div class="ops">' +
              '<button class="btn btn-sm btn-primary" type="button" data-fin-book-open="' + esc(bk.id) + '">檢視明細</button>' +
              (canWrite ? '<button class="btn btn-sm" type="button" data-fin-book-edit="' + esc(bk.id) + '">編輯</button>' : "") +
              (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-book-del="' + esc(bk.id) + '">刪除</button>' : "") +
              (!canWrite && !canDelete ? '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">唯讀</span>' : "") +
              "</div></td>" +
              "</tr>";
          }).join("") +
          "</tbody></table></div>";
      };

      /** 單一帳本的存入／提出明細 */
      const renderBookDetail = function (book) {
        const f = state.filters.bank;
        const month = String(f.month || "");
        const m = (bookAgg(month)[book.id]) ||
          { opening: toNum(book.openingBalance, 0), inSum: 0, outSum: 0, count: 0, balance: toNum(book.openingBalance, 0) };
        const list = bookRecords(book.id);
        return "" +
          '<div class="fin-toolbar">' +
          '<button class="btn btn-ghost" type="button" data-fin-book-back="1">← 回帳本列表</button>' +
          renderMonthNav(month, "預設當月") +
          '<div class="field" style="flex:1 1 160px;"><label>關鍵字</label>' +
          '<input type="search" data-fin-filter="bank" data-fin-key="q" value="' + esc(f.q) + '" placeholder="摘要 / 備註"/></div>' +
          '<button class="btn btn-ghost" type="button" data-fin-clear="bank">清除</button>' +
          (canWrite ? '<button class="btn btn-primary" type="button" data-fin-add="bank">＋ 新增紀錄</button>' : "") +
          '<button class="btn" type="button" data-fin-reconcile="' + esc(book.id) + '">對帳</button>' +
          '<button class="btn" type="button" data-fin-export="bank">匯出 Excel</button>' +
          "</div>" +
          '<div class="fin-hint" style="font-weight:900;color:#111827;">' +
          esc(book.name || "未命名帳本") +
          '<span class="fin-tag" style="margin-left:8px;background:rgba(29,78,216,.12);color:#1d4ed8;">' + esc(book.type || "未分類") + "</span>" +
          (book.note ? '<span style="margin-left:8px;font-weight:700;color:#6b7280;">' + esc(book.note) + "</span>" : "") +
          '<span style="margin-left:8px;font-weight:800;color:#6b7280;">檢視期間：' + esc(month || "全部期間") + "</span>" +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("期初餘額（該月）", fmtMoney(m.opening), "#6b7280") +
          statCard("存入合計", fmtMoney(m.inSum), "#15803d") +
          statCard("提出合計", fmtMoney(m.outSum), "#b91c1c") +
          statCard("期末餘額", fmtMoney(m.balance), "#1d4ed8") +
          "</div>" +
          '<div id="fin_list_bank">' + renderBookRecordsTable(list) + "</div>";
      };

      const renderBookRecordsTable = function (list) {
        if (!list.length) {
          const mth = String((state.filters.bank || {}).month || "");
          return '<div class="fin-table-wrap"><div class="fin-empty">' + (mth ? esc(mth) + " " : "") + "此帳本尚無紀錄" +
            (canWrite ? "，可點擊「＋ 新增紀錄」建立第一筆，或用「‹ 上一月」查看其他月份。" : "。") + "</div></div>";
        }
        return '<div class="fin-table-wrap fin-cards"><table class="fin-table"><thead><tr>' +
          "<th>日期</th><th>摘要</th><th>存入</th><th>提出</th><th>餘額</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          list.map(function (b) {
            const isTx = Boolean(b.fromTx);
            const inner = isTx
              ? '<button class="btn btn-sm" type="button" data-fin-jump="' + esc(b.txId) + '">開啟財報</button>' +
                (canWrite ? '<button class="btn btn-sm" type="button" data-fin-edit="' + esc(b.txId) + '">編輯</button>' : "") +
                (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-del="' + esc(b.txId) + '">刪除</button>' : "")
              : (canWrite ? '<button class="btn btn-sm" type="button" data-fin-edit-bank="' + esc(b.id) + '">編輯</button>' : "") +
                (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-del-bank="' + esc(b.id) + '">刪除</button>' : "");
            return "<tr>" +
              '<td data-label="日期">' + esc(b.date) + "</td>" +
              '<td data-label="摘要">' + (isTx
                ? '<button class="fin-tag" type="button" data-fin-jump="' + esc(b.txId) +
                  '" style="border:0;cursor:pointer;background:rgba(29,78,216,.12);color:#1d4ed8;margin-right:6px;" title="點擊跳回對應的財報紀錄">財報</button>'
                : "") +
              esc(b.summary || "—") + "</td>" +
              '<td class="num" data-label="存入" style="color:#15803d;">' + (toNum(b.deposit, 0) ? fmtMoney(b.deposit) : "—") + "</td>" +
              '<td class="num" data-label="提出" style="color:#b91c1c;">' + (toNum(b.withdraw, 0) ? fmtMoney(b.withdraw) : "—") + "</td>" +
              '<td class="num" data-label="餘額">' + fmtMoney(b.balance) + "</td>" +
              '<td data-label="備註">' + esc(b.note || "—") + "</td>" +
              '<td data-label="操作"><div class="ops">' + (inner || '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">唯讀</span>') + "</div></td>" +
              "</tr>";
          }).join("") +
          "</tbody></table></div>";
      };

      /* ---------------- 總覽 ---------------- */

      const renderOverview = function () {
        const mm = todayStr().slice(0, 7);
        const monthTx = state.tx.filter(function (t) { return String(t.date || "").slice(0, 7) === mm; });
        const income = sumAmount(monthTx.filter(function (t) { return t.kind !== "expense"; }));
        const expense = sumAmount(monthTx.filter(function (t) { return t.kind === "expense"; }));
        const agg = bookAgg(mm);
        const totalBalance = state.books.reduce(function (a, bk) {
          const m = agg[bk.id];
          return a + (m ? m.balance : toNum(bk.openingBalance, 0));
        }, 0);
        const bankMonthIn = state.books.reduce(function (a, bk) { return a + (agg[bk.id] ? agg[bk.id].inSum : 0); }, 0);
        const bankMonthOut = state.books.reduce(function (a, bk) { return a + (agg[bk.id] ? agg[bk.id].outSum : 0); }, 0);

        const fee = feeSummary(mm);
        const collectRate = fee.due > 0 ? (fee.received / fee.due) * 100 : 0;
        /* 欠繳看板：連續欠繳月數 × 欠繳總額，支援排序以決定催收優先順序 */
        const board = arrearsBoard();
        const sortKey = String(state.arrearsSort || "owe");
        const sorted = board.slice().sort(function (a, b) {
          if (sortKey === "streak") return (b.streak - a.streak) || (b.owe - a.owe);
          if (sortKey === "months") return (b.months - a.months) || (b.owe - a.owe);
          if (sortKey === "unit") return String(a.unit || a.name).localeCompare(String(b.unit || b.name), "zh-Hant", { numeric: true });
          return (b.owe - a.owe) || (b.streak - a.streak);
        });
        const boardOwe = board.reduce(function (a, x) { return a + x.owe; }, 0);
        const sortBtn = function (key, label) {
          const on = sortKey === key;
          return '<button class="btn btn-sm' + (on ? " btn-primary" : "") + '" type="button" data-fin-sort="' + key + '">' +
            label + (on ? " ▾" : "") + "</button>";
        };
        const boardRows = sorted.slice(0, 30).map(function (x) {
          return "<tr>" +
            '<td data-label="戶號">' + esc(x.unit || "—") + "</td>" +
            '<td data-label="姓名">' + esc(x.name || "—") + "</td>" +
            '<td class="num" data-label="連續欠繳月數" style="color:#b45309;font-weight:900;">' + x.streak + " 個月</td>" +
            '<td class="num" data-label="欠繳期數">' + x.months + " 期</td>" +
            '<td class="num" data-label="欠繳總額" style="color:#b91c1c;font-weight:900;">' + fmtMoney(x.owe) + "</td>" +
            '<td data-label="最近欠繳月">' + esc(x.latest || "—") + "</td>" +
            "</tr>";
        }).join("");

        return "" +
          '<div class="fin-hint" style="font-weight:800;">統計期間：<b>' + esc(mm) + '</b>（當月）</div>' +
          '<div class="fin-stat-grid">' +
          statCard("當月總收入", fmtMoney(income), "#15803d") +
          statCard("當月總支出", fmtMoney(expense), "#b91c1c") +
          statCard("當月淨額", fmtMoney(income - expense), income - expense >= 0 ? "#15803d" : "#b91c1c") +
          statCard("總餘額（帳本期末）", fmtMoney(totalBalance), "#1d4ed8") +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("管理費應收", fmtMoney(fee.due), "#374151") +
          statCard("管理費已收", fmtMoney(fee.received), "#15803d") +
          statCard("管理費未收", fmtMoney(fee.owe), fee.owe > 0 ? "#b91c1c" : "#374151") +
          statCard("收繳率", collectRate.toFixed(1) + "%", collectRate >= 100 ? "#15803d" : "#b45309") +
          "</div>" +
          '<div class="fin-hint">當月帳本存入 <b>' + fmtMoney(bankMonthIn) + "</b>、提出 <b>" + fmtMoney(bankMonthOut) +
          "</b>；管理費以「管理費」子分頁設定的住戶金額為應收，並比對收入明細中對象為該住戶的紀錄（有填沖銷月份時以沖銷月份為準）。</div>" +
          "<h3 style=\"margin:6px 0 0;font-size:calc(14px * var(--fs, 1));\">欠繳看板（" + board.length + " 戶，合計 " + fmtMoney(boardOwe) + "）</h3>" +
          '<div class="fin-hint" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">排序：' +
          sortBtn("owe", "欠繳總額") + sortBtn("streak", "連續欠繳月數") + sortBtn("months", "欠繳期數") + sortBtn("unit", "戶號") + "</div>" +
          '<div class="fin-table-wrap fin-cards"><table class="fin-table"><thead><tr>' +
          "<th>戶號</th><th>姓名</th><th>連續欠繳月數</th><th>欠繳期數</th><th>欠繳總額</th><th>最近欠繳月</th>" +
          "</tr></thead><tbody>" +
          (boardRows || '<tr><td colspan="6" class="fin-empty">' +
            (fee.due > 0 ? "目前無欠繳住戶。" : "尚未設定住戶管理費金額，請至「管理費」子分頁設定。") + "</td></tr>") +
          "</tbody></table></div>" +
          (board.length > 30 ? '<div class="fin-hint">僅列出前 30 戶，其餘請至「管理費」子分頁查看。</div>' : "");
      };

      /* ---------------- 管理費 ---------------- */

      const renderFeesPanel = function () {
        const mm = todayStr().slice(0, 7);
        const paid = paidByTarget(mm);
        const arrears = feeArrears();
        const prevMonth = prevMonthStr();
        const rows = state.residents.map(function (r) {
          const f = feeOf(r.id);
          const amount = f ? toNum(f.amount, 0) : 0;
          return {
            id: r.id,
            unit: String(r.unit || ""),
            name: String(r.name || ""),
            committee: Boolean(r.isCommittee),
            amount: amount,
            startMonth: feeStartMonth(r.id),
            note: f ? String(f.note || "") : "",
            got: toNum(paid[r.label] || 0, 0)
          };
        });
        const total = rows.reduce(function (a, x) { return a + x.amount; }, 0);
        const setCount = rows.filter(function (x) { return x.amount > 0; }).length;
        const collected = rows.reduce(function (a, x) { return a + Math.min(x.got, x.amount); }, 0);
        /* 已發送的通知紀錄：顯示「已通知」標記與最近通知日期 */
        const noticeMap = noticeByResident();
        const unpaidCount = rows.filter(function (x) { return (arrears[x.id] || []).length; }).length;

        const body = rows.map(function (x) {
          /* 上月管理費未繳 → 提供「通知」按鈕（隔月 1 日起顯示） */
          const list = arrears[x.id] || [];
          const overdue = list.some(function (a) { return a.month === prevMonth; });
          const rec = noticeMap[x.id];
          const notifiedTag = rec
            ? '<span class="fin-tag" style="background:rgba(21,128,61,.14);color:#15803d;" title="最近通知：' +
              esc(rec.notifiedAt || rec.issuedAt || "") + '">已通知 ' + esc(noticeDayLabel(rec)) + "</span>"
            : "";
          const noticeBtn = overdue
            ? '<button class="btn btn-sm fin-btn-notice" type="button" data-fin-fee-notice="' + esc(x.id) + '">通知</button>'
            : "";
          const ops = (canWrite
            ? '<button class="btn btn-sm btn-primary" type="button" data-fin-fee-edit="' + esc(x.id) + '">' +
              (x.amount > 0 ? "編輯" : "設定") + "</button>" +
              (x.amount > 0 && canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-fee-del="' + esc(x.id) + '">清除</button>' : "")
            : '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">唯讀</span>') + noticeBtn + notifiedTag;
          return "<tr>" +
            '<td data-label="戶號">' + esc(x.unit || "—") + "</td>" +
            '<td data-label="姓名">' + esc(x.name || "—") +
            (x.committee ? ' <span class="fin-tag" style="background:rgba(245,158,11,.16);color:#b45309;">委員</span>' : "") + "</td>" +
            '<td class="num" data-label="每月管理費" style="font-weight:900;">' + (x.amount ? fmtMoney(x.amount) : "未設定") + "</td>" +
            '<td class="num" data-label="開始月份">' + esc(x.startMonth || "—") + "</td>" +
            '<td class="num" data-label="本月已繳" style="color:#15803d;">' + (x.got ? fmtMoney(x.got) : "—") + "</td>" +
            '<td data-label="備註">' + esc(x.note || "—") + "</td>" +
            '<td data-label="操作"><div class="ops">' + ops + "</div></td>" +
            "</tr>";
        }).join("");

        return "" +
          '<div class="fin-toolbar" style="justify-content:space-between;">' +
          '<div class="fin-hint" style="font-weight:800;">住戶名單由住戶造冊帳號自動帶入；每月管理費金額可個別設定。</div>' +
          (canWrite
            ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="btn btn-ghost" type="button" data-fin-notice-batch="1">批次催收通知</button>' +
              '<button class="btn btn-primary" type="button" data-fin-fee-batch="1">批次產生管理費收入</button>' +
              "</div>"
            : "") +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("住戶數", String(rows.length), "#374151") +
          statCard("已設定金額", String(setCount), "#1d4ed8") +
          statCard("每月應收合計", fmtMoney(total), "#15803d") +
          statCard("本月已收（" + mm + "）", fmtMoney(collected), "#b45309") +
          statCard("欠繳戶數", String(unpaidCount), "#b91c1c") +
          "</div>" +
          '<div class="fin-table-wrap fin-cards"><table class="fin-table"><thead><tr>' +
          "<th>戶號</th><th>姓名</th><th>每月管理費</th><th>開始月份</th><th>本月已繳</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          (body || '<tr><td colspan="7" class="fin-empty">此社區尚無住戶帳號。住戶需先於住戶造冊建立帳號後才會顯示於此。</td></tr>') +
          "</tbody></table></div>";
      };

      const openFeeModal = function (userId) {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        const r = state.residents.find(function (x) { return x.id === userId; });
        if (!r) { toast("找不到該住戶", true); return; }
        const f = feeOf(userId);
        const cur = {
          amount: f ? toNum(f.amount, 0) : "",
          startMonth: f ? String(f.startMonth || "") : "",
          note: f ? String(f.note || "") : ""
        };
        const startDefault = cur.startMonth || enableDateForInput().slice(0, 7);
        const m = openModal({
          title: "管理費設定",
          width: "min(92vw, 480px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div style="padding:10px 12px;border-radius:12px;background:rgba(17,24,39,.04);font-weight:800;font-size:calc(13px * var(--fs, 1));">' +
            esc((r.unit || "未填戶號") + "　" + (r.name || "未命名住戶")) + "</div>" +
            field("每月管理費金額 *", '<input type="number" min="0" step="1" id="fin_fee_amount" value="' + esc(cur.amount) + '" style="' + inputStyle + '"/>') +
            field("開始月份（起算月份）", '<input type="month" id="fin_fee_start" value="' + esc(startDefault) + '" style="' + inputStyle + '"/>') +
            field("備註", '<input id="fin_fee_note" value="' + esc(cur.note) + '" style="' + inputStyle + '" placeholder="例如：含車位清潔費"/>') +
            '<div id="fin_fee_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_fee_cancel">取消</button>' +
            '<button class="btn btn-primary" type="button" id="fin_fee_save">儲存</button>'
        });
        if (!m.modal) return;
        const errEl = m.modal.querySelector("#fin_fee_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const cancelBtn = m.modal.querySelector("#fin_fee_cancel");
        if (cancelBtn) cancelBtn.onclick = function () { m.close(); };
        const saveBtn = m.modal.querySelector("#fin_fee_save");
        if (saveBtn) saveBtn.onclick = function () {
          const raw = String((m.modal.querySelector("#fin_fee_amount") || {}).value || "").trim();
          const amount = toNum(raw, NaN);
          if (!raw || !Number.isFinite(amount) || amount < 0) { showErr("請填寫有效的金額（≥ 0）"); return; }
          saveBtn.disabled = true;
          saveBtn.textContent = "儲存中…";
          Model.saveFee(db, cid, {
            userId: userId,
            unit: r.unit,
            name: r.name,
            amount: amount,
            startMonth: String((m.modal.querySelector("#fin_fee_start") || {}).value || "").trim(),
            note: String((m.modal.querySelector("#fin_fee_note") || {}).value || "").trim()
          }, { uid: context.uid, name: context.name }).then(function () {
            m.close();
            toast("已儲存管理費");
          }).catch(function (e) {
            saveBtn.disabled = false;
            saveBtn.textContent = "儲存";
            showErr("儲存失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
      };

      const removeFee = function (userId) {
        const r = state.residents.find(function (x) { return x.id === userId; });
        const who = r ? ((r.unit ? r.unit + " " : "") + (r.name || "")) : "此住戶";
        confirmDialog({
          title: "清除管理費設定",
          message: "確定要清除「" + who + "」的管理費金額嗎？",
          okText: "確認清除"
        }).then(function (ok) {
          if (!ok) return;
          Model.removeFee(db, cid, userId).then(function () {
            toast("已清除");
          }).catch(function (e) {
            toast("清除失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
          });
        });
      };

      /** 批次產生指定月份的管理費收入紀錄（已存在者自動略過） */
      const openFeeBatchModal = function () {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        const incomeCats = cfgList("incomeCategories");
        const defaultCat = incomeCats.indexOf("管理費") !== -1 ? "管理費" : (incomeCats[0] || "管理費");
        const bookOpts = state.books.filter(function (bk) { return String(bk.name || "").trim(); });
        const startMonth = todayStr().slice(0, 7);

        const previewOf = function (mm) {
          const paid = paidByTarget(mm);
          const rows = state.residents.map(function (r) {
            const f = feeOf(r.id);
            const amount = f ? toNum(f.amount, 0) : 0;
            const start = feeStartMonth(r.id);
            const blocked = amount <= 0 || Boolean(start && mm < start);
            const got = toNum(paid[r.label] || 0, 0);
            return {
              label: String(r.label || ""),
              unit: String(r.unit || ""),
              name: String(r.name || ""),
              amount: amount,
              blocked: blocked,
              exists: !blocked && got > 0
            };
          });
          return { rows: rows, todo: rows.filter(function (x) { return !x.blocked && !x.exists; }) };
        };

        const m = openModal({
          title: "批次產生管理費收入",
          width: "min(94vw, 760px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">依「管理費」子分頁設定的住戶金額，一次建立指定月份的應收紀錄；該月已有紀錄的住戶會自動略過，不會重複建立。</div>' +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("月份 *", '<input type="month" id="fin_fee_batch_month" value="' + esc(startMonth) + '" style="' + inputStyle + '"/>') +
            field("認列日期 *", '<input type="date" id="fin_fee_batch_date" value="' + esc(todayStr()) + '" style="' + inputStyle + '"/>') +
            "</div>" +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("收入科目 *", '<input id="fin_fee_batch_cat" list="fin_fee_batch_cats" value="' + esc(defaultCat) + '" style="' + inputStyle + '"/>' +
              '<datalist id="fin_fee_batch_cats">' + incomeCats.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("") + "</datalist>") +
            field("存入帳本", '<select id="fin_fee_batch_book" style="' + inputStyle + '">' +
              '<option value="">未指定</option>' +
              bookOpts.map(function (bk) {
                return '<option value="' + esc(bk.id) + '">' + esc(bk.name) + (bk.type ? "（" + esc(bk.type) + "）" : "") + "</option>";
              }).join("") + "</select>") +
            "</div>" +
            '<div id="fin_fee_batch_summary" class="fin-stat-grid"></div>' +
            '<div id="fin_fee_batch_list"></div>' +
            '<div id="fin_fee_batch_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_fee_batch_cancel">關閉</button>' +
            '<button class="btn btn-primary" type="button" id="fin_fee_batch_ok">產生紀錄</button>'
        });
        if (!m.modal) return;

        const errEl = m.modal.querySelector("#fin_fee_batch_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const listEl = m.modal.querySelector("#fin_fee_batch_list");
        const sumEl = m.modal.querySelector("#fin_fee_batch_summary");
        const okBtn = m.modal.querySelector("#fin_fee_batch_ok");
        const monthInput = m.modal.querySelector("#fin_fee_batch_month");

        const paint = function () {
          const mm = String((monthInput || {}).value || "").trim() || startMonth;
          const p = previewOf(mm);
          if (sumEl) {
            sumEl.innerHTML = statCard("將產生筆數", String(p.todo.length), "#15803d") +
              statCard("將產生金額", fmtMoney(p.todo.reduce(function (a, x) { return a + x.amount; }, 0)), "#0f766e") +
              statCard("已略過（已有紀錄）", String(p.rows.filter(function (x) { return x.exists; }).length), "#b45309") +
              statCard("未設定金額／未起算", String(p.rows.filter(function (x) { return x.blocked; }).length), "#6b7280");
          }
          if (listEl) {
            listEl.innerHTML = '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
              "<th>戶號</th><th>姓名</th><th>每月管理費</th><th>狀態</th></tr></thead><tbody>" +
              (p.rows.length ? p.rows.map(function (x) {
                const tag = x.blocked
                  ? '<span class="fin-tag" style="background:rgba(107,114,128,.12);color:#4b5563;">未設定金額／未起算</span>'
                  : (x.exists
                    ? '<span class="fin-tag" style="background:rgba(245,158,11,.16);color:#b45309;">已有紀錄，略過</span>'
                    : '<span class="fin-tag" style="background:rgba(21,128,61,.12);color:#15803d;">將產生</span>');
                return "<tr>" +
                  "<td>" + esc(x.unit || "—") + "</td>" +
                  "<td>" + esc(x.name || "—") + "</td>" +
                  '<td class="num">' + (x.amount ? fmtMoney(x.amount) : "—") + "</td>" +
                  "<td>" + tag + "</td>" +
                  "</tr>";
              }).join("") : '<tr><td colspan="4" class="fin-empty">此社區尚無住戶帳號</td></tr>') +
              "</tbody></table></div>";
          }
          if (okBtn) okBtn.textContent = p.todo.length ? "產生 " + p.todo.length + " 筆紀錄" : "產生紀錄";
        };

        if (monthInput) monthInput.addEventListener("change", function () { showErr(""); paint(); });
        paint();

        const cancelBtn = m.modal.querySelector("#fin_fee_batch_cancel");
        if (cancelBtn) cancelBtn.onclick = function () { m.close(); };

        if (okBtn) okBtn.onclick = function () {
          if (okBtn.disabled) return;
          const mm = String((monthInput || {}).value || "").trim();
          if (!/^\d{4}-\d{2}$/.test(mm)) { showErr("請選擇有效月份"); return; }
          const date = String((m.modal.querySelector("#fin_fee_batch_date") || {}).value || "").trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { showErr("請選擇認列日期"); return; }
          const category = String((m.modal.querySelector("#fin_fee_batch_cat") || {}).value || "").trim();
          if (!category) { showErr("請填寫收入科目"); return; }
          const bookId = String((m.modal.querySelector("#fin_fee_batch_book") || {}).value || "").trim();
          const bk = bookId ? state.books.find(function (x) { return x.id === bookId; }) : null;
          const method = bk ? String(bk.name || "") : "";
          const todo = previewOf(mm).todo;
          if (!todo.length) { showErr("此月份沒有可產生的住戶（皆已存在紀錄或未設定金額）。"); return; }

          const payloads = todo.map(function (x) {
            return {
              kind: "income",
              date: date,
              category: category,
              amount: x.amount,
              target: x.label,
              method: method,
              bookId: bookId,
              months: [mm],
              receiptNo: "",
              note: mm + " 管理費"
            };
          });
          okBtn.disabled = true;
          const label = okBtn.textContent;
          okBtn.textContent = "產生中…";
          Model.saveTxBatch(db, cid, payloads, { uid: context.uid, name: context.name }).then(function (n) {
            m.close();
            toast("已產生 " + n + " 筆管理費收入");
          }).catch(function (e) {
            okBtn.disabled = false;
            okBtn.textContent = label;
            showErr("產生失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
      };

      /** 定期收支項目：維護清單，並可一次產生本月的定期紀錄 */
      const openRecurringModal = function () {
        const items = cfgList("recurring").map(function (it) { return Object.assign({}, it); });
        const cats = cfgList("incomeCategories").concat(cfgList("expenseCategories"));
        const targets = incomeTargetOptions().concat(cfgList("expenseTargets"));
        const bookOpts = state.books.filter(function (bk) { return String(bk.name || "").trim(); });
        let editId = "";

        const datalist = function (id, list) {
          return '<datalist id="' + id + '">' + list.map(function (v) {
            return '<option value="' + esc(v) + '"></option>';
          }).join("") + "</datalist>";
        };
        const bookOptions = function (sel) {
          return '<option value="">未指定</option>' + bookOpts.map(function (bk) {
            return '<option value="' + esc(bk.id) + '"' + (String(sel || "") === bk.id ? " selected" : "") + ">" +
              esc(bk.name) + (bk.type ? "（" + esc(bk.type) + "）" : "") + "</option>";
          }).join("");
        };

        const m = openModal({
          title: "定期收支項目",
          width: "min(96vw, 900px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">設定每月固定發生的收支（例如清潔費、薪資、租金）；按「產生本月紀錄」會依設定的日期建立本月紀錄，已存在者自動略過。</div>' +
            '<div style="padding:12px;border-radius:14px;background:rgba(17,24,39,.03);border:1px solid rgba(17,24,39,.08);display:grid;gap:10px;">' +
            '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">' +
            field("類型", '<select id="fin_rec_kind" style="' + inputStyle + '"><option value="expense">支出</option><option value="income">收入</option></select>') +
            field("科目 *", '<input id="fin_rec_cat" list="fin_rec_cats" style="' + inputStyle + '"/>' + datalist("fin_rec_cats", cats)) +
            field("金額 *", '<input type="number" min="0" step="1" id="fin_rec_amount" style="' + inputStyle + '" placeholder="0"/>') +
            field("每月日期", '<input type="number" min="1" max="28" step="1" id="fin_rec_day" value="1" style="' + inputStyle + '"/>') +
            "</div>" +
            '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">' +
            field("對象", '<input id="fin_rec_target" list="fin_rec_targets" style="' + inputStyle + '"/>' + datalist("fin_rec_targets", targets)) +
            field("帳本", '<select id="fin_rec_book" style="' + inputStyle + '">' + bookOptions("") + "</select>") +
            field("備註", '<input id="fin_rec_note" style="' + inputStyle + '" placeholder="例如：每月清潔維護費"/>') +
            "</div>" +
            '<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;">' +
            '<button class="btn btn-ghost" type="button" id="fin_rec_cancel_edit" style="display:none;">取消編輯</button>' +
            '<button class="btn btn-primary" type="button" id="fin_rec_add">新增項目</button>' +
            "</div>" +
            "</div>" +
            '<div id="fin_rec_list"></div>' +
            '<div id="fin_rec_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_rec_close">關閉</button>' +
            '<button class="btn btn-primary" type="button" id="fin_rec_generate">產生本月紀錄</button>'
        });
        if (!m.modal) return;

        const q = function (sel) { return m.modal.querySelector(sel); };
        const errEl = q("#fin_rec_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const listEl = q("#fin_rec_list");
        const addBtn = q("#fin_rec_add");
        const cancelEditBtn = q("#fin_rec_cancel_edit");
        const bookNameOfId = function (id) {
          const bk = state.books.find(function (x) { return x.id === String(id || ""); });
          return bk ? String(bk.name || "") : "";
        };

        const renderList = function () {
          if (!listEl) return;
          if (!items.length) {
            listEl.innerHTML = '<div class="fin-table-wrap"><div class="fin-empty">尚未設定任何定期項目</div></div>';
            return;
          }
          listEl.innerHTML = '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
            "<th>類型</th><th>科目</th><th>對象</th><th>金額</th><th>帳本</th><th>每月日期</th><th>狀態</th>" +
            '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
            items.map(function (it, idx) {
              const isExpense = it.kind !== "income";
              const tagColor = isExpense
                ? "background:rgba(185,28,28,.10);color:#b91c1c;"
                : "background:rgba(21,128,61,.12);color:#15803d;";
              const ops = (canWrite
                ? '<button class="btn btn-sm" type="button" data-rec-edit="' + idx + '">編輯</button>' +
                  '<button class="btn btn-sm" type="button" data-rec-toggle="' + idx + '">' + (it.active === false ? "啟用" : "停用") + "</button>" +
                  '<button class="btn btn-sm btn-danger" type="button" data-rec-del="' + idx + '">刪除</button>'
                : '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">唯讀</span>');
              return "<tr>" +
                '<td><span class="fin-tag" style="' + tagColor + '">' + (isExpense ? "支出" : "收入") + "</span></td>" +
                "<td>" + esc(it.category || "—") + "</td>" +
                "<td>" + esc(it.target || "—") + "</td>" +
                '<td class="num">' + fmtMoney(it.amount) + "</td>" +
                "<td>" + esc(bookNameOfId(it.bookId) || "—") + "</td>" +
                '<td class="num">每月 ' + esc(String(it.day || 1)) + " 日</td>" +
                "<td>" + (it.active === false
                  ? '<span class="fin-tag" style="background:rgba(107,114,128,.12);color:#4b5563;">停用</span>'
                  : '<span class="fin-tag" style="background:rgba(21,128,61,.12);color:#15803d;">啟用</span>') + "</td>" +
                '<td><div class="ops">' + ops + "</div></td>" +
                "</tr>";
            }).join("") +
            "</tbody></table></div>";

          listEl.querySelectorAll("[data-rec-edit]").forEach(function (btn) {
            btn.onclick = function () {
              const it = items[Number(btn.getAttribute("data-rec-edit"))];
              if (!it) return;
              editId = it.id;
              q("#fin_rec_kind").value = it.kind === "income" ? "income" : "expense";
              q("#fin_rec_cat").value = it.category || "";
              q("#fin_rec_amount").value = it.amount ? String(it.amount) : "";
              q("#fin_rec_day").value = String(it.day || 1);
              q("#fin_rec_target").value = it.target || "";
              q("#fin_rec_book").value = it.bookId || "";
              q("#fin_rec_note").value = it.note || "";
              if (addBtn) addBtn.textContent = "更新項目";
              if (cancelEditBtn) cancelEditBtn.style.display = "";
              showErr("");
            };
          });
          listEl.querySelectorAll("[data-rec-toggle]").forEach(function (btn) {
            btn.onclick = function () {
              const it = items[Number(btn.getAttribute("data-rec-toggle"))];
              if (!it) return;
              it.active = it.active === false;
              commit(items, it.active ? "已啟用定期項目" : "已停用定期項目");
            };
          });
          listEl.querySelectorAll("[data-rec-del]").forEach(function (btn) {
            btn.onclick = function () {
              const idx = Number(btn.getAttribute("data-rec-del"));
              const it = items[idx];
              if (!it) return;
              confirmDialog({
                title: "確認刪除定期項目",
                message: "確定要刪除「" + (it.category || "未填科目") + "」的定期項目嗎？",
                okText: "確認刪除"
              }).then(function (ok) {
                if (!ok) return;
                items.splice(idx, 1);
                if (editId === it.id) resetForm();
                commit(items, "已刪除定期項目");
              });
            };
          });
        };

        const resetForm = function () {
          editId = "";
          const kind = q("#fin_rec_kind");
          if (kind) kind.value = "expense";
          ["#fin_rec_cat", "#fin_rec_amount", "#fin_rec_target", "#fin_rec_note"].forEach(function (sel) {
            const el = q(sel);
            if (el) el.value = "";
          });
          const day = q("#fin_rec_day");
          if (day) day.value = "1";
          const bk = q("#fin_rec_book");
          if (bk) bk.value = "";
          if (addBtn) addBtn.textContent = "新增項目";
          if (cancelEditBtn) cancelEditBtn.style.display = "none";
          showErr("");
        };

        const commit = function (next, okMsg) {
          if (!canWrite) { showErr("您的角色為唯讀，無法修改。"); return; }
          const cfg = currentConfig();
          cfg.recurring = next.map(function (it) { return Object.assign({}, it); });
          saveConfig(cfg, okMsg);
          renderList();
        };

        renderList();

        if (cancelEditBtn) cancelEditBtn.onclick = function () { resetForm(); };

        if (addBtn) addBtn.onclick = function () {
          const category = String((q("#fin_rec_cat") || {}).value || "").trim();
          const amount = toNum((q("#fin_rec_amount") || {}).value, 0);
          if (!category) { showErr("請填寫科目"); return; }
          if (!(amount > 0)) { showErr("請填寫大於 0 的金額"); return; }
          const payload = {
            id: editId || genId("rec"),
            kind: String((q("#fin_rec_kind") || {}).value || "expense") === "income" ? "income" : "expense",
            category: category,
            target: String((q("#fin_rec_target") || {}).value || "").trim(),
            amount: amount,
            bookId: String((q("#fin_rec_book") || {}).value || "").trim(),
            day: Math.min(28, Math.max(1, Math.round(toNum((q("#fin_rec_day") || {}).value, 1)) || 1)),
            note: String((q("#fin_rec_note") || {}).value || "").trim(),
            active: true
          };
          const idx = items.findIndex(function (it) { return it.id === editId; });
          if (idx >= 0) items[idx] = payload;
          else items.push(payload);
          const wasEdit = idx >= 0;
          commit(items, wasEdit ? "已更新定期項目" : "已新增定期項目");
          resetForm();
        };

        const closeBtn = q("#fin_rec_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };

        const genBtn = q("#fin_rec_generate");
        if (genBtn) genBtn.onclick = function () {
          if (genBtn.disabled) return;
          if (!canWrite) { showErr("您的角色為唯讀，無法產生紀錄。"); return; }
          const mm = todayStr().slice(0, 7);
          const y = Number(mm.slice(0, 4));
          const mo = Number(mm.slice(5, 7));
          const lastDay = new Date(y, mo, 0).getDate();
          const active = items.filter(function (it) {
            return it.active !== false && it.category && toNum(it.amount, 0) > 0;
          });
          if (!active.length) { showErr("尚未設定任何啟用中的定期項目（需有科目與金額）。"); return; }
          const todo = active.filter(function (it) {
            const kind = it.kind === "income" ? "income" : "expense";
            return !state.tx.some(function (t) {
              const tk = t.kind === "expense" ? "expense" : "income";
              return tk === kind &&
                String(t.category || "") === it.category &&
                String(t.target || "") === String(it.target || "") &&
                toNum(t.amount, 0) === toNum(it.amount, 0) &&
                coversMonth(t, mm);
            });
          });
          if (!todo.length) { showErr(mm + " 的定期紀錄皆已存在，無需重複產生。"); return; }
          const payloads = todo.map(function (it) {
            const day = Math.min(Math.max(1, Math.round(toNum(it.day, 1)) || 1), lastDay);
            const bk = it.bookId ? state.books.find(function (x) { return x.id === it.bookId; }) : null;
            return {
              kind: it.kind === "income" ? "income" : "expense",
              date: ymd(new Date(y, mo - 1, day)),
              category: it.category,
              amount: toNum(it.amount, 0),
              target: it.target || "",
              method: bk ? String(bk.name || "") : "",
              bookId: bk ? String(bk.id) : "",
              months: [],
              receiptNo: "",
              note: it.note || "定期項目"
            };
          });
          genBtn.disabled = true;
          const label = genBtn.textContent;
          genBtn.textContent = "產生中…";
          Model.saveTxBatch(db, cid, payloads, { uid: context.uid, name: context.name }).then(function (n) {
            genBtn.disabled = false;
            genBtn.textContent = label;
            showErr("");
            toast("已產生 " + n + " 筆定期紀錄（" + mm + "）");
          }).catch(function (e) {
            genBtn.disabled = false;
            genBtn.textContent = label;
            showErr("產生失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
      };

      /** 管理費催收通知函：預覽、分享（LINE／Email／簡訊／複製）、下載與發送紀錄 */
      const openFeeNoticeModal = function (userId) {
        const r = state.residents.find(function (x) { return x.id === userId; });
        if (!r) { toast("找不到該住戶", true); return; }
        const months = (feeArrears()[userId] || []);
        if (!months.length) { toast("此住戶目前無欠繳紀錄", true); return; }
        const N = window.NwFeeNotice;
        if (!N || typeof N.buildNoticeHtml !== "function") { toast("通知函模組尚未載入", true); return; }
        N.ensureStyles();

        const cfg = noticeCfg();
        const payload = buildNoticePayload(r, months);
        const noticeText = function () { return N.buildNoticeText(payload); };
        const sent = [];
        let publishedId = "";

        const m = openModal({
          title: "管理費催收通知函",
          width: "min(96vw, 880px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">繳納期限依「設定」分頁的期限天數（目前 ' + esc(String(cfg.dueDays)) + " 天）計算，至 " +
            esc(N.rocDate(payload.deadline)) + "；已發送的管道會寫回通知紀錄。</div>" +
            '<div class="fn-preview">' + N.buildNoticeHtml(payload) + "</div>" +
            '<div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">' +
            field("Email 收件者", '<input type="email" id="fin_notice_email" value="' + esc(r.email || "") +
              '" placeholder="住戶 Email" style="' + inputStyle + '"/>') +
            field("簡訊收件號碼", '<input type="tel" id="fin_notice_phone" value="' + esc(r.phone || "") +
              '" placeholder="住戶手機號碼" style="' + inputStyle + '"/>') +
            "</div>" +
            '<div class="fin-hint" id="fin_notice_sent"></div>' +
            '<div id="fin_notice_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_notice_close">關閉</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_notice_img">下載圖片</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_notice_pdf">下載 PDF</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_notice_print">列印</button>' +
            '<button class="btn btn-line" type="button" id="fin_notice_line">轉發 LINE</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_notice_copy">複製文字</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_notice_mail">Email</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_notice_sms">簡訊</button>'
        });
        if (!m.modal) return;

        const errEl = m.modal.querySelector("#fin_notice_err");
        const sentEl = m.modal.querySelector("#fin_notice_sent");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const markSent = function (key) {
          if (sent.indexOf(key) === -1) sent.push(key);
          if (sentEl) {
            sentEl.textContent = sent.length
              ? "已發送管道：" + sent.map(function (k) { return NOTICE_CHANNELS[k] || k; }).join("、")
              : "";
          }
        };
        const closeBtn = m.modal.querySelector("#fin_notice_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };

        /* 建立通知紀錄並回寫發送管道（唯讀角色不寫入，仍可下載檔案） */
        const ensureNotice = function () {
          if (!canWrite) return Promise.resolve("");
          if (publishedId) return Promise.resolve(publishedId);
          return Model.saveNotice(db, cid, payload, { uid: context.uid, name: context.name }).then(function (id) {
            publishedId = id;
            return id;
          });
        };
        const recordChannel = function (key) {
          markSent(key);
          if (!canWrite) { showErr("您的角色為唯讀，發送紀錄不會寫回資料庫。"); return Promise.resolve(""); }
          return ensureNotice().then(function (id) {
            return Model.updateNoticeChannels(db, cid, id, sent).then(function () { return id; });
          }, function () { return publishedId; });
        };

        const runBusy = function (btn, busyLabel, task) {
          if (!btn || btn.disabled) return;
          const label = btn.textContent;
          btn.disabled = true;
          btn.textContent = busyLabel;
          const done = function () { btn.disabled = false; btn.textContent = label; };
          Promise.resolve().then(task).then(done, function (e) {
            done();
            showErr("操作失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };

        const imgBtn = m.modal.querySelector("#fin_notice_img");
        if (imgBtn) imgBtn.onclick = function () {
          runBusy(imgBtn, "產生中…", function () {
            return N.downloadImage(payload, N.noticeFilename(payload, "png")).then(function () {
              return recordChannel("image");
            });
          });
        };
        const pdfBtn = m.modal.querySelector("#fin_notice_pdf");
        if (pdfBtn) pdfBtn.onclick = function () {
          runBusy(pdfBtn, "產生中…", function () {
            return N.downloadPdf(payload, N.noticeFilename(payload, "pdf")).then(function () {
              return recordChannel("pdf");
            });
          });
        };
        const printBtn = m.modal.querySelector("#fin_notice_print");
        if (printBtn) printBtn.onclick = function () {
          if (typeof N.print !== "function") { showErr("此瀏覽器不支援列印。"); return; }
          runBusy(printBtn, "準備中…", function () {
            return N.print(payload).then(function (ok) {
              if (!ok) { showErr("列印視窗開啟失敗，請改用「下載 PDF」。"); return; }
              return recordChannel("print");
            });
          });
        };
        const copyBtn = m.modal.querySelector("#fin_notice_copy");
        if (copyBtn) copyBtn.onclick = function () {
          Promise.resolve(N.copyText ? N.copyText(noticeText()) : false).then(function (ok) {
            if (!ok) { showErr("複製失敗，請改用「下載圖片」自行選取內容。"); return; }
            showErr("");
            toast("已複製通知文字");
            recordChannel("copy");
          });
        };
        const mailBtn = m.modal.querySelector("#fin_notice_mail");
        if (mailBtn) mailBtn.onclick = function () {
          const el = m.modal.querySelector("#fin_notice_email");
          const to = String((el && el.value) || "").trim();
          if (!to) { showErr("請先填寫 Email 收件者。"); return; }
          showErr("");
          N.shareEmail(to, String(cfg.docTitle || "管理費催收通知函"), noticeText());
          toast("已開啟郵件軟體");
          recordChannel("email");
        };
        const smsBtn = m.modal.querySelector("#fin_notice_sms");
        if (smsBtn) smsBtn.onclick = function () {
          const el = m.modal.querySelector("#fin_notice_phone");
          const num = String((el && el.value) || "").trim();
          if (!num) { showErr("請先填寫簡訊收件號碼。"); return; }
          showErr("");
          N.shareSms(num, noticeText());
          toast("已開啟簡訊軟體");
          recordChannel("sms");
        };
        const lineBtn = m.modal.querySelector("#fin_notice_line");
        if (lineBtn) lineBtn.onclick = function () {
          if (lineBtn.disabled) return;
          if (!canWrite) { showErr("您沒有建立公開連結的權限，無法轉發。"); return; }
          const msg = payload.communityName + " 管理費催收通知";
          if (publishedId) {
            N.shareLine(N.publicUrl(cid, publishedId), msg);
            recordChannel("line");
            return;
          }
          /* 先開好視窗再寫入資料，避免瀏覽器阻擋彈出視窗 */
          const win = window.open("", "_blank");
          const label = lineBtn.textContent;
          lineBtn.disabled = true;
          lineBtn.textContent = "產生連結…";
          const restore = function () { lineBtn.disabled = false; lineBtn.textContent = label; };
          ensureNotice().then(function (id) {
            return recordChannel("line").then(function () { return id; });
          }).then(function (id) {
            restore();
            const link = N.publicUrl(cid, id);
            const share = "https://line.me/R/msg/text/?" + encodeURIComponent(msg + "\n" + link);
            if (win && !win.closed) {
              try { win.location.href = share; return; } catch (e) { /* 改用另開視窗 */ }
            }
            N.shareLine(link, msg);
          }, function (e) {
            restore();
            if (win && !win.closed) { try { win.close(); } catch (err) { /* 忽略 */ } }
            showErr("建立公開連結失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
      };

      /** 批次催收通知：勾選多戶，一次建立通知紀錄並批次下載 PDF */
      const openNoticeBatchModal = function () {
        const N = window.NwFeeNotice;
        if (!N || typeof N.buildNoticeHtml !== "function") { toast("通知函模組尚未載入", true); return; }
        N.ensureStyles();
        const arrears = feeArrears();
        const rows = state.residents.filter(function (r) {
          return (arrears[r.id] || []).length;
        }).map(function (r) {
          const list = arrears[r.id] || [];
          return {
            id: r.id,
            unit: String(r.unit || ""),
            name: String(r.name || ""),
            count: list.length,
            owe: list.reduce(function (a, x) { return a + toNum(x.owe, 0); }, 0)
          };
        });
        if (!rows.length) { toast("目前沒有欠繳管理費的住戶", true); return; }
        const cfg = noticeCfg();

        const m = openModal({
          title: "批次催收通知",
          width: "min(96vw, 760px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">勾選要催收的住戶，可一次建立通知紀錄（含免登入公開連結）並批次下載 PDF。繳納期限為發文日 +' +
            esc(String(cfg.dueDays)) + " 天（可於「設定」分頁調整）。</div>" +
            '<div class="fin-toolbar" style="justify-content:flex-start;gap:8px;">' +
            '<button class="btn btn-sm btn-ghost" type="button" id="fin_nb_all">全選</button>' +
            '<button class="btn btn-sm btn-ghost" type="button" id="fin_nb_none">取消全選</button>' +
            '<span class="fin-hint" id="fin_nb_cnt"></span>' +
            "</div>" +
            '<div class="fin-table-wrap" style="max-height:46vh;overflow:auto;"><table class="fin-table"><thead><tr>' +
            '<th style="width:52px;text-align:center;">選取</th><th>戶號</th><th>姓名</th><th>欠繳期數</th><th>尚欠合計</th>' +
            "</tr></thead><tbody>" +
            rows.map(function (x) {
              return "<tr>" +
                '<td style="text-align:center;"><input type="checkbox" data-fin-nb-row="' + esc(x.id) + '" checked/></td>' +
                "<td>" + esc(x.unit || "—") + "</td>" +
                "<td>" + esc(x.name || "—") + "</td>" +
                '<td class="num">' + esc(String(x.count)) + "</td>" +
                '<td class="num" style="font-weight:900;">' + fmtMoney(x.owe) + "</td>" +
                "</tr>";
            }).join("") +
            "</tbody></table></div>" +
            '<div id="fin_nb_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_nb_close">關閉</button>' +
            (canWrite
              ? '<button class="btn btn-ghost" type="button" id="fin_nb_save">建立通知紀錄</button>' +
                '<button class="btn btn-primary" type="button" id="fin_nb_pdf">批次下載 PDF</button>'
              : "")
        });
        if (!m.modal) return;

        const q = function (sel) { return m.modal.querySelector(sel); };
        const errEl = q("#fin_nb_err");
        const cntEl = q("#fin_nb_cnt");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const boxes = function () {
          return Array.prototype.slice.call(m.modal.querySelectorAll("[data-fin-nb-row]"));
        };
        const checkedIds = function () {
          return boxes().filter(function (b) { return b.checked; })
            .map(function (b) { return b.getAttribute("data-fin-nb-row"); });
        };
        const refresh = function () {
          if (cntEl) cntEl.textContent = "已勾選 " + checkedIds().length + " / " + rows.length + " 戶";
        };
        boxes().forEach(function (b) {
          b.addEventListener("change", function () { showErr(""); refresh(); });
        });
        const allBtn = q("#fin_nb_all");
        if (allBtn) allBtn.onclick = function () {
          boxes().forEach(function (b) { b.checked = true; });
          showErr("");
          refresh();
        };
        const noneBtn = q("#fin_nb_none");
        if (noneBtn) noneBtn.onclick = function () {
          boxes().forEach(function (b) { b.checked = false; });
          showErr("");
          refresh();
        };
        const closeBtn = q("#fin_nb_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };
        refresh();
        if (!canWrite) return;

        const runBusy = function (btn, busyLabel, task) {
          if (!btn || btn.disabled) return;
          const label = btn.textContent;
          btn.disabled = true;
          btn.textContent = busyLabel;
          const done = function () { btn.disabled = false; btn.textContent = label; };
          Promise.resolve().then(task).then(done, function (e) {
            done();
            showErr("操作失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
        const payloadOf = function (id) {
          const r = state.residents.find(function (x) { return x.id === id; }) || { id: id };
          return buildNoticePayload(r, arrears[id] || []);
        };

        const saveBtn = q("#fin_nb_save");
        if (saveBtn) saveBtn.onclick = function () {
          const ids = checkedIds();
          if (!ids.length) { showErr("請至少勾選一戶。"); return; }
          runBusy(saveBtn, "產生中…", function () {
            let n = 0;
            return ids.reduce(function (p, id) {
              return p.then(function () {
                saveBtn.textContent = "產生中 " + (n + 1) + "/" + ids.length + "…";
                return Model.saveNotice(db, cid, payloadOf(id), { uid: context.uid, name: context.name })
                  .then(function () { n += 1; });
              });
            }, Promise.resolve()).then(function () {
              toast("已建立 " + ids.length + " 筆通知紀錄");
              m.close();
            });
          });
        };

        const pdfBtn = q("#fin_nb_pdf");
        if (pdfBtn) pdfBtn.onclick = function () {
          const ids = checkedIds();
          if (!ids.length) { showErr("請至少勾選一戶。"); return; }
          runBusy(pdfBtn, "準備中…", function () {
            let n = 0;
            return ids.reduce(function (p, id) {
              return p.then(function () {
                const payload = payloadOf(id);
                pdfBtn.textContent = "下載 PDF " + (n + 1) + "/" + ids.length + "…";
                return Model.saveNotice(db, cid, payload, { uid: context.uid, name: context.name })
                  .then(function (nid) {
                    return Model.updateNoticeChannels(db, cid, nid, ["pdf"]).catch(function () { return null; })
                      .then(function () { return N.downloadPdf(payload, N.noticeFilename(payload, "pdf")); });
                  })
                  .then(function () { n += 1; });
              });
            }, Promise.resolve()).then(function () {
              toast("已產生 " + ids.length + " 份 PDF");
            });
          });
        };
      };

      /** 催收通知函內容預覽（設定頁，套用目前欄位值） */
      const openNoticePreview = function (override) {
        const N = window.NwFeeNotice;
        if (!N || typeof N.buildNoticeHtml !== "function") { toast("通知函模組尚未載入", true); return; }
        N.ensureStyles();
        const cur = todayStr().slice(0, 7);
        const sample = [
          { month: shiftMonth(cur, -2), amount: 1500, paid: 0, owe: 1500 },
          { month: shiftMonth(cur, -1), amount: 1500, paid: 500, owe: 1000 }
        ];
        const payload = buildNoticePayload({ id: "", unit: "A-12", name: "王小明" }, sample, override);
        const m = openModal({
          title: "催收通知函預覽（範例）",
          width: "min(96vw, 880px)",
          bodyHtml: '<div class="fin-preview">' + N.buildNoticeHtml(payload) + "</div>",
          footerHtml: '<button class="btn btn-ghost" type="button" id="fin_np_close">關閉</button>'
        });
        const b = m.modal && m.modal.querySelector("#fin_np_close");
        if (b) b.onclick = function () { m.close(); };
      };

      /* ---------------- 報表面板 ---------------- */

      const renderReportPanel = function () {
        const r = state.report;
        /* 報表已發生日期不得早於「財報系統功能啟用日期」 */
        const minDate = enableDate();
        if (minDate) {
          if (r.from && r.from < minDate) r.from = minDate;
          if (r.to && r.to < minDate) r.to = minDate;
          if (r.from && r.to && r.from > r.to) r.to = r.from;
        }
        const agg = Model.aggregate(state.tx, state.bank, { from: r.from, to: r.to }, state.books);
        const presets = [
          { id: "day", label: "本日" },
          { id: "month", label: "本月" },
          { id: "year", label: "本年" },
          { id: "custom", label: "自訂" }
        ];
        const catTableRow = function (row, kindLabel, color) {
          return "<tr><td>" + esc(kindLabel) + "</td><td>" + esc(row.category) + "</td>" +
            '<td class="num" style="color:' + color + ';">' + fmtMoney(row.amount) + "</td>" +
            '<td class="num">' + row.pct.toFixed(2) + "%</td></tr>";
        };
        const catRows = agg.incomeByCat.map(function (x) { return catTableRow(x, "收入", "#15803d"); })
          .concat(agg.expenseByCat.map(function (x) { return catTableRow(x, "支出", "#b91c1c"); }));
        const monthRows = agg.monthly.map(function (m) {
          return "<tr><td>" + esc(m.month) + '</td><td class="num" style="color:#15803d;">' + fmtMoney(m.income) + "</td>" +
            '<td class="num" style="color:#b91c1c;">' + fmtMoney(m.expense) + "</td>" +
            '<td class="num">' + fmtMoney(m.net) + "</td></tr>";
        });
        /* 期間內的管理費應收／實收（僅「本月」「本年」報表列入） */
        const fees = reportFees();
        const feeDue = fees ? fees.due : 0;
        const feeReceived = fees ? fees.received : 0;
        const feeRate = fees ? fees.rate : 0;
        const pickerLabels = { day: "選擇日期", month: "選擇月份", year: "選擇年份" };
        const pickerOpts = pickerLabels[r.preset] ? periodOptions(r.preset, minDate) : [];
        let pickerValue = r.preset === "month" ? String(r.from).slice(0, 7)
          : r.preset === "year" ? String(r.from).slice(0, 4)
            : String(r.from);
        if (pickerOpts.length && pickerOpts.indexOf(pickerValue) === -1) pickerValue = pickerOpts[0];
        const pickerHtml = pickerLabels[r.preset]
          ? '<div class="field"><label>' + pickerLabels[r.preset] + "</label>" +
            '<select data-fin-picker="' + r.preset + '" style="' + inputStyle + 'width:auto;">' +
            pickerOpts.map(function (v) {
              return '<option value="' + esc(v) + '"' + (v === pickerValue ? " selected" : "") + ">" + esc(v) + "</option>";
            }).join("") +
            "</select></div>"
          : "";
        const maxDate = yesterdayStr();
        /* 起日／迄日僅於「自訂」時顯示 */
        const rangeFields = r.preset === "custom"
          ? '<div class="field"><label>起日</label><input type="date" data-fin-range="from" max="' + maxDate + '"' +
            (minDate ? ' min="' + minDate + '"' : "") + ' value="' + esc(r.from) + '"/></div>' +
            '<div class="field"><label>迄日</label><input type="date" data-fin-range="to" max="' + maxDate + '"' +
            (minDate ? ' min="' + minDate + '"' : "") + ' value="' + esc(r.to) + '"/></div>'
          : "";
        return "" +
          '<div class="fin-toolbar">' +
          presets.map(function (p) {
            return '<button class="btn btn-sm ' + (r.preset === p.id ? "btn-primary" : "btn-ghost") +
              '" type="button" data-fin-preset="' + esc(p.id) + '">' + esc(p.label) + "</button>";
          }).join("") +
          pickerHtml +
          rangeFields +
          (canWrite ? '<button class="btn" type="button" data-fin-import="1">批次匯入</button>' : "") +
          '<button class="btn" type="button" data-fin-export="report">匯出 Excel</button>' +
          '<button class="btn" type="button" data-fin-pdf="1">匯出 PDF</button>' +
          '<button class="btn" type="button" data-fin-budget="1">年度預算</button>' +
          '<button class="btn" type="button" data-fin-backup="1">資料備份</button>' +
          '<button class="btn btn-ghost" type="button" data-fin-audit="1">稽核紀錄</button>' +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("收入合計", fmtMoney(agg.totalIncome), "#15803d") +
          (fees ? statCard("應收收入（管理費收入）", fmtMoney(feeDue), "#0f766e") : "") +
          statCard("支出合計", fmtMoney(agg.totalExpense), "#b91c1c") +
          (fees ? statCard("應付支出", fmtMoney(agg.totalExpense), "#b45309") : "") +
          (r.preset === "month"
            ? statCard("管理費達成率", feeDue > 0 ? feeRate.toFixed(1) + "%" : "—", feeRate >= 100 ? "#15803d" : (feeRate >= 80 ? "#b45309" : "#b91c1c"))
            : "") +
          statCard("淨額", fmtMoney(agg.net), agg.net >= 0 ? "#15803d" : "#b91c1c") +
          statCard("銀行期末餘額", fmtMoney(agg.bankBalance), "#1d4ed8") +
          "</div>" +
          (fees
            ? '<div class="fin-hint">「應收收入（管理費收入）」＝期間內各住戶「管理費」子分頁設定的應收總額；「應付支出」＝期間支出明細合計' +
              (r.preset === "month" ? "；「管理費達成率」＝管理費實收 " + fmtMoney(feeReceived) + " ÷ 應收 " + fmtMoney(feeDue) : "") + "。</div>"
            : "") +
          "<h3 style=\"margin:6px 0 0;font-size:calc(14px * var(--fs, 1));\">分類統計</h3>" +
          '<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>類型</th><th>類別</th><th>金額</th><th>佔比</th></tr></thead>' +
          "<tbody>" + (catRows.length ? catRows.join("") : '<tr><td colspan="4" class="fin-empty">無資料</td></tr>') + "</tbody></table></div>" +
          "<h3 style=\"margin:6px 0 0;font-size:calc(14px * var(--fs, 1));\">月報表</h3>" +
          '<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>月份</th><th>收入</th><th>支出</th><th>淨額</th></tr></thead>' +
          "<tbody>" + (monthRows.length ? monthRows.join("") : '<tr><td colspan="4" class="fin-empty">無資料</td></tr>') + "</tbody></table></div>";
      };

      const statCard = function (k, v, color) {
        return '<div class="fin-stat"><div class="k">' + esc(k) + '</div><div class="v" style="color:' +
          esc(color || "#111827") + ';">' + esc(v) + "</div></div>";
      };

      /* ---------------- 年度預算 ---------------- */

      /** 目前檢視的預算年度（預設明年度，可切換回看歷年） */
      const budgetYear = function () {
        return String(state.budgetYear || (new Date().getFullYear() + 1));
      };

      /** 可選的預算年度清單（今年前 4 年至後 3 年） */
      const budgetYearOptions = function () {
        const base = new Date().getFullYear();
        const list = [];
        for (let y = base - 4; y <= base + 3; y += 1) list.push(String(y));
        return list;
      };

      /** 該年度的預算科目列（科目取自設定子分頁的分類，金額預設 0） */
      const budgetRows = function (year) {
        const saved = state.budgets[String(year || "")] || [];
        const find = function (kind, cat) {
          const hit = saved.find(function (x) { return x.kind === kind && x.category === cat; });
          return hit ? toNum(hit.amount, 0) : 0;
        };
        const income = cfgList("incomeCategories").map(function (c) {
          return { kind: "income", category: c, amount: find("income", c) };
        });
        const expense = cfgList("expenseCategories").map(function (c) {
          return { kind: "expense", category: c, amount: find("expense", c) };
        });
        return income.concat(expense);
      };

      /** 依「上一年度」（預算年度的前一年）實際收支，產生各科目的建議預算 */
      const suggestBudgetRows = function (year) {
        const refYear = String(Number(year) - 1);
        const sumByCat = function (kind) {
          const map = {};
          state.tx.forEach(function (t) {
            const isExpense = t.kind === "expense";
            if (kind === "expense" ? !isExpense : isExpense) return;
            if (String(t.date || "").slice(0, 4) !== refYear) return;
            const c = String(t.category || "").trim();
            if (!c) return;
            map[c] = (map[c] || 0) + toNum(t.amount, 0);
          });
          return map;
        };
        const incomeMap = sumByCat("income");
        const expenseMap = sumByCat("expense");
        const income = cfgList("incomeCategories").map(function (c) {
          return { kind: "income", category: c, amount: toNum(incomeMap[c], 0) };
        });
        const expense = cfgList("expenseCategories").map(function (c) {
          return { kind: "expense", category: c, amount: toNum(expenseMap[c], 0) };
        });
        const rows = income.concat(expense);
        const hasAny = rows.some(function (r) { return r.amount > 0; });
        return { year: refYear, rows: rows, hasAny: hasAny };
      };

      /** 預算合計卡片 */
      const budgetTotalsHtml = function (list) {
        const sum = function (kind) {
          return (Array.isArray(list) ? list : []).reduce(function (a, r) {
            const hit = kind === "expense" ? r.kind === "expense" : r.kind !== "expense";
            return hit ? a + toNum(r.amount, 0) : a;
          }, 0);
        };
        const inc = sum("income");
        const exp = sum("expense");
        return statCard("收入預算合計", fmtMoney(inc), "#15803d") +
          statCard("支出預算合計", fmtMoney(exp), "#b91c1c") +
          statCard("收支結餘", fmtMoney(inc - exp), inc - exp >= 0 ? "#15803d" : "#b91c1c");
      };

      /** 指定年度各科目的實際收支（依已登錄明細彙整） */
      const actualByCat = function (year) {
        const y = String(year || "");
        const income = {};
        const expense = {};
        state.tx.forEach(function (t) {
          if (String(t.date || "").slice(0, 4) !== y) return;
          const c = String(t.category || "").trim();
          if (!c) return;
          const map = t.kind === "expense" ? expense : income;
          map[c] = (map[c] || 0) + toNum(t.amount, 0);
        });
        return { income: income, expense: expense };
      };

      /** 預算 vs 實際對照表（含差異與執行率） */
      const budgetCompareHtml = function (year, list) {
        const act = actualByCat(year);
        const rows = (Array.isArray(list) ? list : []).map(function (r) {
          const isExpense = r.kind === "expense";
          const map = isExpense ? act.expense : act.income;
          const budget = toNum(r.amount, 0);
          const real = toNum(map[r.category], 0);
          return { kind: r.kind, category: r.category, budget: budget, real: real };
        });
        if (!rows.length) return '<div class="fin-empty">尚未設定任何科目</div>';
        const sumOf = function (kind, key) {
          return rows.reduce(function (a, r) {
            const hit = kind === "expense" ? r.kind === "expense" : r.kind !== "expense";
            return hit ? a + toNum(r[key], 0) : a;
          }, 0);
        };
        const line = function (r) {
          const isExpense = r.kind === "expense";
          const tagColor = isExpense
            ? "background:rgba(185,28,28,.10);color:#b91c1c;"
            : "background:rgba(21,128,61,.12);color:#15803d;";
          const diff = r.budget - r.real;
          const rate = r.budget > 0 ? Math.round((r.real / r.budget) * 1000) / 10 : null;
          const diffColor = diff < 0 ? "#b91c1c" : (diff > 0 ? "#15803d" : "#6b7280");
          return "<tr>" +
            '<td><span class="fin-tag" style="' + tagColor + '">' + (isExpense ? "支出" : "收入") + "</span></td>" +
            "<td>" + esc(r.category) + "</td>" +
            '<td class="num">' + esc(fmtMoney(r.budget)) + "</td>" +
            '<td class="num">' + esc(fmtMoney(r.real)) + "</td>" +
            '<td class="num" style="color:' + diffColor + ';font-weight:800;">' + esc(fmtMoney(diff)) + "</td>" +
            '<td class="num">' + (rate === null ? "—" : esc(rate + "%")) + "</td>" +
            "</tr>";
        };
        const totalRow = function (label, kind) {
          const b = sumOf(kind, "budget");
          const a = sumOf(kind, "real");
          const diff = b - a;
          const rate = b > 0 ? Math.round((a / b) * 1000) / 10 : null;
          const diffColor = diff < 0 ? "#b91c1c" : (diff > 0 ? "#15803d" : "#6b7280");
          return '<tr style="background:rgba(17,24,39,.04);font-weight:800;">' +
            '<td colspan="2">' + esc(label) + "</td>" +
            '<td class="num">' + esc(fmtMoney(b)) + "</td>" +
            '<td class="num">' + esc(fmtMoney(a)) + "</td>" +
            '<td class="num" style="color:' + diffColor + ';">' + esc(fmtMoney(diff)) + "</td>" +
            '<td class="num">' + (rate === null ? "—" : esc(rate + "%")) + "</td>" +
            "</tr>";
        };
        return '<table class="fin-table"><thead><tr>' +
          "<th>類型</th><th>科目</th><th>預算金額</th><th>實際金額</th><th>差異</th><th>執行率</th>" +
          "</tr></thead><tbody>" +
          rows.map(line).join("") +
          totalRow("收入合計", "income") +
          totalRow("支出合計", "expense") +
          "</tbody></table>";
      };

      /** 年度財務預算表：編輯、儲存、列印與匯出 */
      const openBudgetModal = function () {
        const year = budgetYear();
        const refYear = String(Number(year) - 1);
        const rows = budgetRows(year);
        const rowHtml = function (row) {
          const isExpense = row.kind === "expense";
          const tagColor = isExpense
            ? "background:rgba(185,28,28,.10);color:#b91c1c;"
            : "background:rgba(21,128,61,.12);color:#15803d;";
          return "<tr>" +
            '<td><span class="fin-tag" style="' + tagColor + '">' + (isExpense ? "支出" : "收入") + "</span></td>" +
            "<td>" + esc(row.category) + "</td>" +
            '<td class="num"><input type="number" inputmode="decimal" min="0" step="1" ' +
            'data-budget-amount data-kind="' + esc(row.kind) + '" data-cat="' + esc(row.category) + '" ' +
            'value="' + (row.amount ? esc(String(row.amount)) : "") + '" placeholder="0" ' +
            'style="width:100%;min-width:110px;padding:8px 10px;border-radius:10px;border:1px solid rgba(17,24,39,.12);font-weight:800;text-align:right;"/></td>' +
            "</tr>";
        };
        const m = openModal({
          title: year + " 年度財務預算表",
          width: "min(96vw, 920px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<label for="fin_budget_year" style="font-weight:800;font-size:calc(13px * var(--fs, 1));color:#374151;">預算年度</label>' +
            '<select id="fin_budget_year" style="padding:8px 12px;border-radius:10px;border:1px solid rgba(17,24,39,.14);font-weight:800;background:#fff;">' +
            budgetYearOptions().map(function (y) {
              return '<option value="' + y + '"' + (y === year ? " selected" : "") + ">" + y + " 年</option>";
            }).join("") +
            "</select>" +
            '<span class="fin-hint" style="flex:1 1 auto;">切換年度會重新載入該年度預算（未儲存的變更將不保留）。</span>' +
            "</div>" +
            '<div class="fin-hint">' + esc(year) + ' 年度的財務預算表，科目依「設定」子分頁的分類帶入；金額請自行輸入，未填寫視為 0。按「建議」會依上一年度（' + esc(refYear) + '）實際收支自動帶入建議金額。</div>' +
            '<div id="fin_budget_totals" class="fin-stat-grid">' + budgetTotalsHtml(rows) + "</div>" +
            '<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>類型</th><th>科目</th><th>預算金額</th></tr></thead>' +
            "<tbody>" + (rows.length ? rows.map(rowHtml).join("") : '<tr><td colspan="3" class="fin-empty">尚未設定任何科目</td></tr>') + "</tbody></table></div>" +
            '<div style="font-weight:800;font-size:calc(13px * var(--fs, 1));color:#374151;margin-top:2px;">預算 vs 實際（' + esc(year) + " 年度，實際值取自已登錄明細）</div>" +
            '<div class="fin-table-wrap" id="fin_budget_cmp">' + budgetCompareHtml(year, rows) + "</div>" +
            '<div id="fin_budget_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_budget_close">關閉</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_budget_excel">匯出 Excel</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_budget_pdf">下載 PDF</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_budget_print">列印</button>' +
            '<button class="btn btn-ghost" type="button" id="fin_budget_suggest">建議</button>' +
            '<button class="btn btn-primary" type="button" id="fin_budget_save"' + (canWrite ? "" : " disabled") + ">儲存</button>"
        });
        if (!m.modal) return;

        const errEl = m.modal.querySelector("#fin_budget_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const collect = function () {
          return Array.prototype.map.call(m.modal.querySelectorAll("[data-budget-amount]"), function (el) {
            return {
              kind: el.getAttribute("data-kind") === "expense" ? "expense" : "income",
              category: el.getAttribute("data-cat"),
              amount: toNum(el.value, 0)
            };
          });
        };
        const totalsEl = m.modal.querySelector("#fin_budget_totals");
        const cmpEl = m.modal.querySelector("#fin_budget_cmp");
        m.modal.querySelectorAll("[data-budget-amount]").forEach(function (el) {
          el.addEventListener("input", function () {
            if (totalsEl) totalsEl.innerHTML = budgetTotalsHtml(collect());
            if (cmpEl) cmpEl.innerHTML = budgetCompareHtml(year, collect());
          });
        });

        const yearSel = m.modal.querySelector("#fin_budget_year");
        if (yearSel) yearSel.onchange = function () {
          state.budgetYear = String(yearSel.value || year);
          m.close();
          openBudgetModal();
        };

        const closeBtn = m.modal.querySelector("#fin_budget_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };

        const runBusy = function (btn, busyLabel, task) {
          if (!btn || btn.disabled) return;
          const label = btn.textContent;
          btn.disabled = true;
          btn.textContent = busyLabel;
          Promise.resolve().then(task).then(function () {
            btn.disabled = false;
            btn.textContent = label;
          }, function (e) {
            btn.disabled = false;
            btn.textContent = label;
            showErr("操作失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };

        const saveBtn = m.modal.querySelector("#fin_budget_save");
        if (saveBtn) saveBtn.onclick = function () {
          if (saveBtn.disabled) return;
          if (!canWrite) { showErr("您的角色為唯讀，無法儲存。"); return; }
          runBusy(saveBtn, "儲存中…", function () {
            return Model.saveBudget(db, cid, { year: year, items: collect() }, { uid: context.uid, name: context.name })
              .then(function () { toast("已儲存 " + year + " 年度預算"); });
          });
        };
        const excelBtn = m.modal.querySelector("#fin_budget_excel");
        if (excelBtn) excelBtn.onclick = function () {
          if (Export.budgetToExcel({ communityName: cName, year: year, rows: collect() })) toast("已匯出 Excel");
        };
        const pdfBtn = m.modal.querySelector("#fin_budget_pdf");
        if (pdfBtn) pdfBtn.onclick = function () {
          runBusy(pdfBtn, "產生中…", function () {
            return Export.budgetToPdf({
              communityName: cName, year: year, rows: collect(),
              exportedBy: String(context.name || "").trim()
            }).then(function (ok) {
              if (ok) toast("已產生 PDF");
            });
          });
        };
        const printBtn = m.modal.querySelector("#fin_budget_print");
        if (printBtn) printBtn.onclick = function () {
          runBusy(printBtn, "準備中…", function () {
            const printEl = document.createElement("div");
            printEl.className = "fin-print";
            printEl.innerHTML = Export.buildBudgetPrintHtml({ communityName: cName, year: year, rows: collect() });
            return Export.printNode(printEl).then(function (ok) {
              if (!ok) showErr("列印視窗開啟失敗，請改用「下載 PDF」。");
            });
          });
        };

        const suggestBtn = m.modal.querySelector("#fin_budget_suggest");
        if (suggestBtn) suggestBtn.onclick = function () {
          const s = suggestBudgetRows(year);
          if (!s.hasAny) {
            showErr(s.year + " 年度查無實際收支資料，無法產生建議金額。");
            return;
          }
          m.modal.querySelectorAll("[data-budget-amount]").forEach(function (el) {
            const kind = el.getAttribute("data-kind") === "expense" ? "expense" : "income";
            const cat = el.getAttribute("data-cat");
            const hit = s.rows.find(function (r) { return r.kind === kind && r.category === cat; });
            el.value = hit && hit.amount ? String(hit.amount) : "";
          });
          if (totalsEl) totalsEl.innerHTML = budgetTotalsHtml(collect());
          showErr("");
          toast("已依 " + s.year + " 年度實際收支帶入建議金額");
        };
      };

      /* ---------------- 對象名單 / 設定 ---------------- */

      /** 統計某類型（收入 / 支出）各對象的使用筆數與金額 */
      const targetUsage = function (kind) {
        const wantExpense = kind === "expense";
        const map = {};
        state.tx.forEach(function (t) {
          const isExpense = t.kind === "expense";
          if (wantExpense ? !isExpense : isExpense) return;
          const v = String(t.target || "").trim() || "未填對象";
          if (!map[v]) map[v] = { count: 0, amount: 0 };
          map[v].count += 1;
          map[v].amount += toNum(t.amount, 0);
        });
        return map;
      };

      const renderTargetPanel = function (kind) {
        const meta = KIND[kind];
        const key = TARGET_KEYS[kind];
        const manual = cfgList(key);
        // 收入名單自動帶入目前社區的住戶與委員帳號
        const autoRows = kind === "income"
          ? state.residents.map(function (r) {
            return { label: r.label, tag: r.isCommittee ? "委員" : "住戶", auto: true, idx: -1 };
          })
          : [];
        const autoLabels = autoRows.map(function (r) { return r.label; });
        const rows = autoRows.concat(
          manual
            .map(function (v, i) { return { label: v, tag: "自訂", auto: false, idx: i }; })
            .filter(function (r) { return autoLabels.indexOf(r.label) === -1; })
        );

        const usage = targetUsage(kind);
        const totalAmt = Object.keys(usage).reduce(function (a, k) { return a + usage[k].amount; }, 0);
        const knownLabels = rows.map(function (r) { return r.label; });
        const unusedExtra = Object.keys(usage)
          .filter(function (v) { return v !== "未填對象" && knownLabels.indexOf(v) === -1; })
          .sort();

        const targetRowHtml = function (row) {
          const u = usage[row.label] || { count: 0, amount: 0 };
          const pct = totalAmt > 0 ? (u.amount / totalAmt) * 100 : 0;
          const tagColor = row.auto
            ? (row.tag === "委員" ? "background:rgba(245,158,11,.16);color:#b45309;" : "background:rgba(29,78,216,.12);color:#1d4ed8;")
            : "background:rgba(17,24,39,.06);color:#6b7280;";
          let ops = "";
          if (row.auto) {
            ops = '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">住戶帳號</span>';
          } else if (canWrite) {
            ops = '<button class="btn btn-sm" type="button" data-fin-tgt-up="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '"' + (row.idx === 0 ? " disabled" : "") + ">↑</button>" +
              '<button class="btn btn-sm" type="button" data-fin-tgt-down="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '"' + (row.idx === manual.length - 1 ? " disabled" : "") + ">↓</button>" +
              '<button class="btn btn-sm" type="button" data-fin-tgt-rename="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '">改名</button>' +
              '<button class="btn btn-sm btn-danger" type="button" data-fin-tgt-del="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '">刪除</button>';
          } else {
            ops = '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">唯讀</span>';
          }
          return "<tr>" +
            '<td><span class="fin-tag" style="' + tagColor + '">' + esc(row.tag) + "</span> " + esc(row.label) + "</td>" +
            '<td class="num">' + u.count + "</td>" +
            '<td class="num" style="color:' + meta.color + ';">' + fmtMoney(u.amount) + "</td>" +
            '<td class="num">' + pct.toFixed(2) + "%</td>" +
            '<td><div class="ops">' + ops + "</div></td>" +
            "</tr>";
        };

        const extraRowHtml = function (v) {
          const u = usage[v];
          const pct = totalAmt > 0 ? (u.amount / totalAmt) * 100 : 0;
          return "<tr>" +
            '<td><span class="fin-tag" style="background:rgba(245,158,11,.16);color:#b45309;">名單外</span> ' + esc(v) + "</td>" +
            '<td class="num">' + u.count + "</td>" +
            '<td class="num">' + fmtMoney(u.amount) + "</td>" +
            '<td class="num">' + pct.toFixed(2) + "%</td>" +
            '<td><div class="ops">' +
            (canWrite ? '<button class="btn btn-sm btn-primary" type="button" data-fin-tgt-addname="' + esc(kind) + '" data-fin-tgt-name="' + esc(v) + '">加入名單</button>'
              : '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));">唯讀</span>') +
            "</div></td>" +
            "</tr>";
        };

        const rowsHtml = rows.map(targetRowHtml).join("") + unusedExtra.map(extraRowHtml).join("");

        return "" +
          '<div class="fin-toolbar">' +
          '<div class="field" style="flex:1 1 240px;"><label>新增自訂' + esc(meta.label) + '對象</label>' +
          '<input type="text" data-fin-cfg-input="' + esc(key) + '" placeholder="' +
          (kind === "income" ? "非住戶對象，例如：管委會基金" : "例如：大大清潔公司") + '"/>' +
          "</div>" +
          (canWrite ? '<button class="btn btn-primary" type="button" data-fin-cfg-add="' + esc(key) + '">＋ 新增</button>' : "") +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard(kind === "income" ? "住戶對象（自動）" : "對象數", String(kind === "income" ? autoRows.length : manual.length), meta.color) +
          statCard("自訂對象", String(manual.length), "#374151") +
          statCard("未在名單的對象", String(unusedExtra.length), unusedExtra.length ? "#b45309" : "#374151") +
          statCard("累計金額", fmtMoney(totalAmt), meta.color) +
          "</div>" +
          '<div class="fin-hint">' +
          (kind === "income"
            ? "「住戶」與「委員」對象由住戶造冊帳號自動帶入並即時同步，無法在此新增或刪除；自訂對象可自由維護。"
            : "對象名單可自行維護，並套用於支出明細的「對象」輸入選項。") +
          (canWrite ? "調整後立即儲存。" : "") +
          "</div>" +
          '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
          "<th>對象</th><th>筆數</th><th>金額</th><th>佔比</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          (rowsHtml || '<tr><td colspan="5" class="fin-empty">尚無對象，請於上方新增，或由既有紀錄按「加入名單」帶入。</td></tr>') +
          "</tbody></table></div>";
      };

      const renderChipEditor = function (title, key, placeholder, color, hint) {
        const list = cfgList(key);
        return "" +
          '<div class="fin-cfg-block">' +
          '<div class="fin-cfg-hd">' +
          '<span class="fin-cfg-title">' + esc(title) + "</span>" +
          '<span class="fin-tag" style="background:' + esc(color) + '1f;color:' + esc(color) + ';">' + list.length + " 項</span>" +
          "</div>" +
          '<div class="fin-chips">' +
          (list.length
            ? list.map(function (v, i) {
              return '<span class="fin-chip">' + esc(v) +
                (canWrite ? '<button class="fin-chip-x" type="button" title="移除" aria-label="移除" data-fin-cfg-del="' + esc(key) + '" data-fin-cfg-idx="' + i + '">×</button>' : "") +
                "</span>";
            }).join("")
            : '<span class="fin-empty" style="padding:8px 0;">尚無項目</span>') +
          "</div>" +
          (canWrite
            ? '<div class="fin-cfg-add">' +
              '<input type="text" data-fin-cfg-input="' + esc(key) + '" placeholder="' + esc(placeholder) + '"/>' +
              '<button class="btn btn-sm btn-primary" type="button" data-fin-cfg-add="' + esc(key) + '">＋ 新增</button>' +
              "</div>"
            : "") +
          (hint ? '<div class="fin-hint">' + esc(hint) + "</div>" : "") +
          "</div>";
      };

      /** 催收通知函內容設定（留空時沿用系統預設用語） */
      const renderNoticeSettings = function () {
        const n = noticeCfg();
        const dis = canWrite ? "" : " disabled";
        const keys = window.NwFeeNotice && window.NwFeeNotice.tplKeys;
        const ta = "min-height:56px;resize:vertical;";
        return "" +
          '<section style="border:1px solid rgba(17,24,39,.1);border-radius:14px;padding:12px;">' +
          '<div style="font-weight:800;">催收通知函內容</div>' +
          '<div class="fin-hint">套用於「管理費」子分頁的催收通知函；留空時沿用系統預設用語' +
          (keys ? "。" + esc(keys.join(" ")) : "") + "</div>" +
          '<div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:8px;">' +
          field("通知函標題", '<input type="text" data-fin-notice-field="docTitle" value="' + esc(n.docTitle) +
            '" placeholder="管理費催收通知函"' + dis + ' style="' + inputStyle + '"/>') +
          field("署名單位", '<input type="text" data-fin-notice-field="signer" value="' + esc(n.signer) +
            '" placeholder="預設：社區名稱 管理委員會"' + dis + ' style="' + inputStyle + '"/>') +
          field("洽詢方式", '<input type="text" data-fin-notice-field="contact" value="' + esc(n.contact) +
            '" placeholder="例如：管理中心 02-1234-5678"' + dis + ' style="' + inputStyle + '"/>') +
          field("繳納期限天數", '<input type="number" min="1" max="120" data-fin-notice-field="dueDays" value="' +
            esc(String(n.dueDays)) + '"' + dis + ' style="' + inputStyle + '"/>') +
          "</div>" +
          '<div style="display:grid;gap:10px;margin-top:10px;">' +
          field("主旨用語", '<textarea rows="2" data-fin-notice-field="subject" placeholder="留空：台端積欠本社區管理費計新台幣 {owe} 元整…"' +
            dis + ' style="' + inputStyle + ta + '">' + esc(n.subject) + "</textarea>") +
          field("第三點說明用語", '<textarea rows="2" data-fin-notice-field="closing" placeholder="留空：請於 {deadline} 前完成繳納…"' +
            dis + ' style="' + inputStyle + ta + '">' + esc(n.closing) + "</textarea>") +
          field("備註", '<textarea rows="2" data-fin-notice-field="note" placeholder="例如：可至管理中心臨櫃繳納"' +
            dis + ' style="' + inputStyle + ta + '">' + esc(n.note) + "</textarea>") +
          "</div>" +
          (canWrite
            ? '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">' +
              '<button class="btn btn-ghost" type="button" data-fin-notice-preview="1">預覽通知函</button>' +
              '<button class="btn btn-primary" type="button" data-fin-notice-save="1">儲存通知設定</button>' +
              "</div>"
            : '<div class="fin-hint">您的角色為唯讀，無法修改通知函內容。</div>') +
          "</section>";
      };

      const renderSettingsPanel = function () {
        const updated = state.configUpdatedAt
          ? "最後更新：" + esc(state.configUpdatedAt)
          : "尚未儲存自訂設定，目前使用系統預設值";
        const enableVal = enableDateForInput();
        const enableHint = state.communityCreatedAt
          ? "目前套用：<b>" + esc(enableDate() || "未限制") + "</b>（未設定時預設為社區帳號創建日期 " + esc(state.communityCreatedAt) + "）"
          : "目前套用：<b>" + esc(enableDate() || "未限制") + "</b>";
        return "" +
          '<div class="fin-toolbar" style="justify-content:space-between;">' +
          '<div class="fin-hint" style="font-weight:800;">' + updated + "</div>" +
          "</div>" +
          '<div style="display:grid;gap:12px;">' +
          '<section style="border:1px solid rgba(17,24,39,.1);border-radius:14px;padding:12px;">' +
          '<div style="font-weight:800;">財報系統功能啟用日期</div>' +
          '<div class="fin-hint">所有報表的「已發生日期」自啟用日期起算，早於啟用日期的期間不會列在報表選項中；未設定時預設為社區帳號創建日期。</div>' +
          '<div class="field" style="max-width:240px;margin-top:8px;"><label>啟用日期</label>' +
          '<input type="date" data-fin-enable-date value="' + esc(enableVal) + '"' + (canWrite ? "" : " disabled") + ' style="' + inputStyle + '"/></div>' +
          '<div class="fin-hint" style="margin-top:4px;">' + enableHint + "</div>" +
          "</section>" +
          renderNoticeSettings() +
          renderChipEditor("收入類別", "incomeCategories", "例如：管理費", "#15803d", "套用於收入明細的類別選項。") +
          renderChipEditor("支出類別", "expenseCategories", "例如：水電費", "#b91c1c", "套用於支出明細的類別選項。") +
          renderChipEditor("帳本類型", "bookTypes", "例如：活存", "#7c3aed", "套用於「銀行明細」新增／編輯帳本的「類型」選項。移除既有類型不會改動已建立的帳本。") +
          "</div>" +
          '<div class="fin-hint">「收入名單」會自動帶入住戶造冊中的住戶與委員帳號；財報對象名單請至「收入名單」「支出名單」子分頁維護。以上設定於修改後立即寫入雲端並同步至所有裝置' +
          (canWrite ? "。" : "；您的角色為唯讀，無法修改。") + "</div>";
      };

      /* ---------------- 事件綁定 ---------------- */

      const bindEvents = function () {
        container.querySelectorAll("[data-fin-filter]").forEach(function (el) {
          const kind = el.getAttribute("data-fin-filter");
          const key = el.getAttribute("data-fin-key");
          const handler = function () {
            if (!state.filters[kind]) state.filters[kind] = {};
            state.filters[kind][key] = el.type === "checkbox" ? !!el.checked : String(el.value || "");
            if (key === "q") {
              refreshList(kind);
            } else {
              render();
            }
          };
          if (key === "q") el.addEventListener("input", handler);
          else el.addEventListener("change", handler);
        });

        container.querySelectorAll("[data-fin-clear]").forEach(function (btn) {
          btn.onclick = function () {
            const kind = btn.getAttribute("data-fin-clear");
            state.filters[kind] = kind === "bank"
              ? { month: todayStr().slice(0, 7), q: "" }
              : { month: "", category: "", q: "", target: "", from: "", to: "", noBook: false };
            render();
          };
        });

        /* 欠繳看板排序 */
        container.querySelectorAll("[data-fin-sort]").forEach(function (btn) {
          btn.onclick = function () {
            state.arrearsSort = btn.getAttribute("data-fin-sort") || "owe";
            render();
          };
        });

        /* 帳本明細「財報」紀錄 → 跳回收支明細編輯 */
        container.querySelectorAll("[data-fin-jump]").forEach(function (btn) {
          btn.onclick = function () {
            const txId = btn.getAttribute("data-fin-jump");
            const row = state.tx.find(function (x) { return String(x.id) === String(txId); });
            if (!row) { toast("找不到對應的財報紀錄", true); return; }
            const kind = row.kind === "expense" ? "expense" : "income";
            state.tab = kind;
            state.filters[kind].q = "";
            render();
            setTimeout(function () { openTxModal(kind, row); }, 30);
          };
        });

        container.querySelectorAll("[data-fin-month-step]").forEach(function (btn) {
          btn.onclick = function () {
            const step = Number(btn.getAttribute("data-fin-month-step")) || 0;
            const cur = String((state.filters.bank || {}).month || "") || todayStr().slice(0, 7);
            state.filters.bank.month = shiftMonth(cur, step);
            render();
          };
        });
        container.querySelectorAll("[data-fin-month-cur]").forEach(function (btn) {
          btn.onclick = function () {
            state.filters.bank.month = todayStr().slice(0, 7);
            render();
          };
        });

        container.querySelectorAll("[data-fin-preset]").forEach(function (btn) {
          btn.onclick = function () {
            const id = btn.getAttribute("data-fin-preset");
            state.report.preset = id;
            const e = enableDate();
            if (id === "custom") {
              const y = yesterdayStr();
              let to = state.report.to && state.report.to <= y ? state.report.to : y;
              let from = state.report.from && state.report.from <= to ? state.report.from : to;
              if (e && from < e) from = e;
              if (from > to) to = from;
              state.report.from = from;
              state.report.to = to;
            } else {
              const opts = periodOptions(id, e);
              if (opts.length) Object.assign(state.report, rangeOfPeriod(id, opts[0]));
              else {
                const d = e || yesterdayStr();
                state.report.from = d;
                state.report.to = d;
              }
            }
            render();
          };
        });

        container.querySelectorAll("[data-fin-picker]").forEach(function (el) {
          el.addEventListener("change", function () {
            const kind = el.getAttribute("data-fin-picker");
            state.report.preset = kind;
            Object.assign(state.report, rangeOfPeriod(kind, String(el.value || "")));
            render();
          });
        });

        container.querySelectorAll("[data-fin-range]").forEach(function (el) {
          el.addEventListener("change", function () {
            const key = el.getAttribute("data-fin-range");
            const y = yesterdayStr();
            const e = enableDate();
            let v = String(el.value || "");
            if (v > y) v = y;
            if (e && v < e) v = e;
            state.report[key] = v;
            if (state.report.from && state.report.to && state.report.from > state.report.to) {
              if (key === "from") state.report.to = state.report.from;
              else state.report.from = state.report.to;
            }
            state.report.preset = "custom";
            render();
          });
        });

        container.querySelectorAll("[data-fin-enable-date]").forEach(function (el) {
          el.addEventListener("change", function () {
            const v = String(el.value || "").trim();
            const next = currentConfig();
            next.enableDate = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
            saveConfig(next, next.enableDate ? "已設定報表啟用日期" : "已清除報表啟用日期");
          });
        });

        container.querySelectorAll("[data-fin-add]").forEach(function (btn) {
          btn.onclick = function () {
            const kind = btn.getAttribute("data-fin-add");
            if (kind === "bank") openBankModal(null);
            else openTxModal(kind, null);
          };
        });
        container.querySelectorAll("[data-fin-edit]").forEach(function (btn) {
          btn.onclick = function () {
            const id = btn.getAttribute("data-fin-edit");
            const row = state.tx.find(function (t) { return t.id === id; });
            if (row) openTxModal(row.kind, row);
          };
        });
        container.querySelectorAll("[data-fin-del]").forEach(function (btn) {
          btn.onclick = function () { removeTx(btn.getAttribute("data-fin-del")); };
        });
        container.querySelectorAll("[data-fin-shot]").forEach(function (btn) {
          btn.onclick = function () { openShotModal(btn.getAttribute("data-fin-shot")); };
        });
        container.querySelectorAll("[data-fin-log]").forEach(function (btn) {
          btn.onclick = function () { openTxLogModal(btn.getAttribute("data-fin-log")); };
        });

        container.querySelectorAll("[data-fin-edit-bank]").forEach(function (btn) {
          btn.onclick = function () {
            const id = btn.getAttribute("data-fin-edit-bank");
            const row = state.bank.find(function (b) { return b.id === id; });
            if (row) openBankModal(row);
          };
        });
        container.querySelectorAll("[data-fin-del-bank]").forEach(function (btn) {
          btn.onclick = function () { removeBank(btn.getAttribute("data-fin-del-bank")); };
        });

        container.querySelectorAll("[data-fin-fee-edit]").forEach(function (btn) {
          btn.onclick = function () { openFeeModal(btn.getAttribute("data-fin-fee-edit")); };
        });
        container.querySelectorAll("[data-fin-fee-del]").forEach(function (btn) {
          btn.onclick = function () { removeFee(btn.getAttribute("data-fin-fee-del")); };
        });
        container.querySelectorAll("[data-fin-fee-notice]").forEach(function (btn) {
          btn.onclick = function () { openFeeNoticeModal(btn.getAttribute("data-fin-fee-notice")); };
        });

        /* 帳本 */

        container.querySelectorAll("[data-fin-add-book]").forEach(function (btn) {
          btn.onclick = function () { openBookModal(null); };
        });
        container.querySelectorAll("[data-fin-book-open]").forEach(function (btn) {
          btn.onclick = function () {
            state.activeBookId = btn.getAttribute("data-fin-book-open");
            state.filters.bank.q = "";
            render();
          };
        });
        container.querySelectorAll("[data-fin-book-back]").forEach(function (btn) {
          btn.onclick = function () {
            state.activeBookId = "";
            state.filters.bank.q = "";
            render();
          };
        });
        container.querySelectorAll("[data-fin-book-edit]").forEach(function (btn) {
          btn.onclick = function () {
            const id = btn.getAttribute("data-fin-book-edit");
            const row = state.books.find(function (bk) { return bk.id === id; });
            if (row) openBookModal(row);
          };
        });
        container.querySelectorAll("[data-fin-book-del]").forEach(function (btn) {
          btn.onclick = function () { removeBookConfirm(btn.getAttribute("data-fin-book-del")); };
        });

        container.querySelectorAll("[data-fin-export]").forEach(function (btn) {
          btn.onclick = function () { doExportExcel(btn.getAttribute("data-fin-export")); };
        });
        const pdfBtn = container.querySelector("[data-fin-pdf]");
        if (pdfBtn) pdfBtn.onclick = function () { doExportPdf(); };

        const budgetBtn = container.querySelector("[data-fin-budget]");
        if (budgetBtn) budgetBtn.onclick = function () { openBudgetModal(); };

        const backupBtn = container.querySelector("[data-fin-backup]");
        if (backupBtn) backupBtn.onclick = function () { openBackupModal(); };

        const auditBtn = container.querySelector("[data-fin-audit]");
        if (auditBtn) auditBtn.onclick = function () { openAuditModal(); };

        const feeBatchBtn = container.querySelector("[data-fin-fee-batch]");
        if (feeBatchBtn) feeBatchBtn.onclick = function () { openFeeBatchModal(); };

        const noticeBatchBtn = container.querySelector("[data-fin-notice-batch]");
        if (noticeBatchBtn) noticeBatchBtn.onclick = function () { openNoticeBatchModal(); };

        const noticeSaveBtn = container.querySelector("[data-fin-notice-save]");
        if (noticeSaveBtn) noticeSaveBtn.onclick = function () {
          const next = currentConfig();
          next.notice = readNoticeForm();
          saveConfig(next, "已儲存催收通知設定");
        };
        const noticePreviewBtn = container.querySelector("[data-fin-notice-preview]");
        if (noticePreviewBtn) noticePreviewBtn.onclick = function () {
          openNoticePreview(readNoticeForm());
        };

        const recurringBtn = container.querySelector("[data-fin-recurring]");
        if (recurringBtn) recurringBtn.onclick = function () { openRecurringModal(); };

        const importBtn = container.querySelector("[data-fin-import]");
        if (importBtn) importBtn.onclick = function () { openImportModal(); };

        container.querySelectorAll("[data-fin-reconcile]").forEach(function (btn) {
          btn.onclick = function () {
            const id = btn.getAttribute("data-fin-reconcile");
            const row = state.books.find(function (bk) { return bk.id === id; });
            if (row) openReconcileModal(row);
          };
        });

        /* 設定 / 類別名單 */

        const findCfgInput = function (key) {
          return container.querySelector('[data-fin-cfg-input="' + key + '"]');
        };
        container.querySelectorAll("[data-fin-cfg-add]").forEach(function (btn) {
          btn.onclick = function () {
            const key = btn.getAttribute("data-fin-cfg-add");
            const input = findCfgInput(key);
            cfgAddItem(key, input ? input.value : "");
          };
        });
        container.querySelectorAll("[data-fin-cfg-input]").forEach(function (input) {
          input.addEventListener("keydown", function (e) {
            if (e.key !== "Enter") return;
            e.preventDefault();
            cfgAddItem(input.getAttribute("data-fin-cfg-input"), input.value);
          });
        });
        container.querySelectorAll("[data-fin-cfg-del]").forEach(function (btn) {
          btn.onclick = function () {
            cfgRemoveAt(btn.getAttribute("data-fin-cfg-del"), Number(btn.getAttribute("data-fin-cfg-idx")));
          };
        });
        container.querySelectorAll("[data-fin-cat-up]").forEach(function (btn) {
          btn.onclick = function () { cfgMove(targetKeyOf(btn.getAttribute("data-fin-cat-up")), Number(btn.getAttribute("data-fin-cat-idx")), -1); };
        });
        container.querySelectorAll("[data-fin-cat-down]").forEach(function (btn) {
          btn.onclick = function () { cfgMove(targetKeyOf(btn.getAttribute("data-fin-cat-down")), Number(btn.getAttribute("data-fin-cat-idx")), 1); };
        });
        container.querySelectorAll("[data-fin-cat-rename]").forEach(function (btn) {
          btn.onclick = function () { cfgRename(targetKeyOf(btn.getAttribute("data-fin-cat-rename")), Number(btn.getAttribute("data-fin-cat-idx"))); };
        });
        container.querySelectorAll("[data-fin-cat-del]").forEach(function (btn) {
          btn.onclick = function () { cfgRemoveAt(targetKeyOf(btn.getAttribute("data-fin-cat-del")), Number(btn.getAttribute("data-fin-cat-idx"))); };
        });
        container.querySelectorAll("[data-fin-cat-addname]").forEach(function (btn) {
          btn.onclick = function () { cfgAddItem(targetKeyOf(btn.getAttribute("data-fin-cat-addname")), btn.getAttribute("data-fin-cat-name")); };
        });
      };

      /* ---------------- 設定寫入 ---------------- */

      const targetKeyOf = function (kind) {
        return TARGET_KEYS[kind] || "incomeTargets";
      };

      /** 立即寫入設定（樂觀更新 UI，失敗時還原） */
      const saveConfig = function (next, okMsg) {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        const prev = currentConfig();
        state.config = {
          incomeCategories: (next.incomeCategories || []).slice(),
          expenseCategories: (next.expenseCategories || []).slice(),
          bookTypes: (next.bookTypes || cfgList("bookTypes")).slice(),
          incomeTargets: (next.incomeTargets || []).slice(),
          expenseTargets: (next.expenseTargets || []).slice(),
          recurring: (Array.isArray(next.recurring) ? next.recurring : cfgList("recurring")).map(function (it) { return Object.assign({}, it); }),
          notice: Model.normalizeNotice(Object.assign({}, (state.config && state.config.notice) || {}, next.notice || {})),
          enableDate: String(next.enableDate != null ? next.enableDate : ((state.config && state.config.enableDate) || ""))
        };
        render();
        Model.saveConfig(db, cid, next, { uid: context.uid, name: context.name }).then(function () {
          toast(okMsg || "已儲存設定");
        }).catch(function (e) {
          state.config = prev;
          render();
          toast("儲存失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
        });
      };

      const cfgAddItem = function (key, rawValue) {
        const v = String(rawValue == null ? "" : rawValue).trim();
        if (!v) { toast("請輸入名稱", true); return; }
        const list = cfgList(key).slice();
        if (list.indexOf(v) !== -1) { toast("「" + v + "」已存在", true); return; }
        list.push(v);
        const next = currentConfig();
        next[key] = list;
        saveConfig(next, "已新增「" + v + "」");
      };

      const cfgRemoveAt = function (key, idx) {
        const list = cfgList(key).slice();
        if (idx < 0 || idx >= list.length) return;
        const v = list[idx];
        confirmDialog({
          title: "確認移除",
          message: "確定要從名單移除「" + v + "」嗎？既有紀錄不會被刪除，但表單將不再提供此選項。",
          okText: "確認移除"
        }).then(function (ok) {
          if (!ok) return;
          list.splice(idx, 1);
          const next = currentConfig();
          next[key] = list;
          saveConfig(next, "已移除「" + v + "」");
        });
      };

      const cfgMove = function (key, idx, dir) {
        const list = cfgList(key).slice();
        const target = idx + dir;
        if (idx < 0 || idx >= list.length || target < 0 || target >= list.length) return;
        const tmp = list[idx];
        list[idx] = list[target];
        list[target] = tmp;
        const next = currentConfig();
        next[key] = list;
        saveConfig(next, "已調整順序");
      };

      const cfgRename = function (key, idx) {
        const list = cfgList(key).slice();
        const cur = list[idx];
        if (cur == null) return;
        const m = openModal({
          title: "重新命名對象",
          width: "min(88vw, 440px)",
          bodyHtml:
            '<div style="display:grid;gap:10px;">' +
            field("對象名稱", '<input id="fin_cfg_rename" value="' + esc(cur) + '" style="' + inputStyle + '"/>') +
            '<div class="fin-hint">既有紀錄的對象名稱不會被同步修改。</div>' +
            '<div id="fin_cfg_rename_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_cfg_rename_cancel">取消</button>' +
            '<button class="btn btn-primary" type="button" id="fin_cfg_rename_ok">確定</button>'
        });
        if (!m.modal) return;
        const input = m.modal.querySelector("#fin_cfg_rename");
        const errEl = m.modal.querySelector("#fin_cfg_rename_err");
        const cancelBtn = m.modal.querySelector("#fin_cfg_rename_cancel");
        if (cancelBtn) cancelBtn.onclick = function () { m.close(); };
        const okBtn = m.modal.querySelector("#fin_cfg_rename_ok");
        if (okBtn) okBtn.onclick = function () {
          const v = String((input || {}).value || "").trim();
          const fail = function (msg) {
            if (!errEl) return;
            errEl.style.display = "block";
            errEl.textContent = msg;
          };
          if (!v) { fail("請輸入類別名稱"); return; }
          if (v === cur) { m.close(); return; }
          if (list.indexOf(v) !== -1) { fail("「" + v + "」已存在"); return; }
          list[idx] = v;
          const next = currentConfig();
          next[key] = list;
          m.close();
          saveConfig(next, "已更新為「" + v + "」");
        };
      };

      const refreshList = function (kind) {
        if (kind === "bank") {
          if (state.activeBookId) {
            const t = container.querySelector("#fin_list_bank");
            if (t) t.innerHTML = renderBookRecordsTable(bookRecords(state.activeBookId));
          } else {
            const t = container.querySelector("#fin_list_books");
            if (t) t.innerHTML = renderBookTable(filterBookList(), bookAgg(String((state.filters.bank || {}).month || "")));
          }
          return;
        }
        const target = container.querySelector("#fin_list_" + kind);
        if (!target) return;
        target.innerHTML = renderTxTable(kind, filterTx(kind));
      };

      /* ---------------- 新增 / 編輯 ---------------- */

      const openTxModal = function (kind, row) {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        const isEdit = Boolean(row);
        const meta = KIND[kind];
        const cats = cfgList(CATEGORY_KEYS[kind] || "incomeCategories");
        const targets = kind === "income" ? incomeTargetOptions() : cfgList(TARGET_KEYS[kind] || "expenseTargets");
        const cur = row || {
          date: todayStr(), category: cats[0] || "", amount: "", target: "", method: "", months: [], receiptNo: "", note: ""
        };
        const bookOpts = state.books.filter(function (bk) { return String(bk.name || "").trim(); });
        const curBookId = row ? txBookId(row) : "";
        const legacyMethod = (row && !curBookId) ? String(row.method || "").trim() : "";
        const methodSelect =
          '<option value="">未指定</option>' +
          (legacyMethod ? '<option value="__legacy__" selected>' + esc(legacyMethod) + "（舊資料）</option>" : "") +
          (bookOpts.length
            ? bookOpts.map(function (bk) {
                return '<option value="' + esc(bk.id) + '"' + (curBookId === bk.id ? " selected" : "") + ">" +
                  esc(bk.name) + (bk.type ? "（" + esc(bk.type) + "）" : "") + "</option>";
              }).join("")
            : (legacyMethod ? "" : '<option value="" disabled>（尚未建立帳本，請先至「銀行明細」新增帳本）</option>'));
        const m = openModal({
          title: (isEdit ? "編輯" : "新增") + meta.label + "明細",
          width: "min(92vw, 560px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("日期 *", '<input type="date" id="fin_tx_date" value="' + esc(cur.date) + '" style="' + inputStyle + '"/>') +
            field("類別 *", '<input id="fin_tx_cat" list="fin_cat_list" value="' + esc(cur.category) + '" style="' + inputStyle + '"/>' +
              '<datalist id="fin_cat_list">' + cats.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("") + "</datalist>") +
            "</div>" +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("金額 *", '<input type="number" min="0" step="1" id="fin_tx_amount" value="' + esc(isEdit ? cur.amount : "") + '" style="' + inputStyle + '"/>') +
            field("收款方式（帳本）", '<select id="fin_tx_method" style="' + inputStyle + '">' +
              methodSelect +
              "</select>") +
            "</div>" +
            field("對象（" + (kind === "income" ? "住戶戶號 / 繳費人" : "受款廠商 / 個人") + "）",
              '<input id="fin_tx_target" list="fin_target_list" value="' + esc(cur.target) + '" style="' + inputStyle + '" placeholder="' +
              (kind === "income" ? "例如：A-12-3 王先生" : "例如：大大清潔公司") + '"/>' +
              '<datalist id="fin_target_list">' + targets.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join("") + "</datalist>") +
            '<div class="field" style="gap:6px;margin:0;">' +
            '<label style="font-size:calc(11px * var(--fs, 1));font-weight:800;color:#6b7280;">沖銷月份（可單選或複選）</label>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<input type="month" id="fin_tx_month_pick" style="' + inputStyle + '"/>' +
            '<button class="btn btn-sm" type="button" id="fin_tx_month_add" style="white-space:nowrap;">加入</button>' +
            "</div>" +
            '<div class="fin-chips" id="fin_tx_month_chips"></div>' +
            "</div>" +
            field("單據編號", '<input id="fin_tx_receipt" value="' + esc(cur.receiptNo) + '" style="' + inputStyle + '"/>') +
            '<div class="field" style="gap:6px;margin:0;">' +
            '<label style="font-size:calc(11px * var(--fs, 1));font-weight:800;color:#6b7280;">單據附件（照片，自動壓縮後存入資料庫）</label>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-sm" type="button" id="fin_tx_img_pick">上傳圖片</button>' +
            '<button class="btn btn-sm" type="button" id="fin_tx_img_cam">拍照</button>' +
            '<button class="btn btn-sm btn-danger" type="button" id="fin_tx_img_del">移除附件</button>' +
            "</div>" +
            '<input type="file" id="fin_tx_img_file" accept="image/*" style="display:none;"/>' +
            '<input type="file" id="fin_tx_img_file_cam" accept="image/*" capture="environment" style="display:none;"/>' +
            '<div id="fin_tx_img_prev"></div>' +
            '<div class="fin-hint" id="fin_tx_img_msg"></div>' +
            "</div>" +
            field("備註", '<textarea id="fin_tx_note" rows="3" style="' + inputStyle + 'resize:vertical;">' + esc(cur.note) + "</textarea>") +
            '<div id="fin_tx_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_tx_cancel">取消</button>' +
            '<button class="btn btn-primary" type="button" id="fin_tx_save">' + (isEdit ? "儲存" : "建立") + "</button>"
        });
        if (!m.modal) return;
        const errEl = m.modal.querySelector("#fin_tx_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const cancelBtn = m.modal.querySelector("#fin_tx_cancel");
        if (cancelBtn) cancelBtn.onclick = function () { m.close(); };

        /* 沖銷月份：可單選或複選 */
        const months = Array.isArray(cur.months) ? cur.months.slice() : [];
        const chipsEl = m.modal.querySelector("#fin_tx_month_chips");
        const renderMonthChips = function () {
          if (!chipsEl) return;
          if (!months.length) {
            chipsEl.innerHTML = '<span style="color:#9ca3af;font-size:calc(12px * var(--fs, 1));font-weight:800;">尚未選擇</span>';
            return;
          }
          chipsEl.innerHTML = months.map(function (mm, i) {
            return '<span class="fin-chip">' + esc(mm) + '<button type="button" class="fin-chip-x" data-fin-month-x="' + i + '">×</button></span>';
          }).join("");
          chipsEl.querySelectorAll("[data-fin-month-x]").forEach(function (btn) {
            btn.onclick = function () {
              months.splice(Number(btn.getAttribute("data-fin-month-x")), 1);
              renderMonthChips();
            };
          });
        };
        const monthAddBtn = m.modal.querySelector("#fin_tx_month_add");
        if (monthAddBtn) monthAddBtn.onclick = function () {
          const inp = m.modal.querySelector("#fin_tx_month_pick");
          const v = String((inp || {}).value || "").trim();
          if (!v) { showErr("請先選擇要沖銷的月份"); return; }
          if (months.indexOf(v) === -1) months.push(v);
          months.sort();
          if (inp) inp.value = "";
          showErr("");
          renderMonthChips();
        };
        renderMonthChips();

        /* 單據附件：上傳／拍照（壓縮為 Base64 後存入 Firestore） */
        let receiptImg = String(cur.receiptImg || "");
        const imgPrev = m.modal.querySelector("#fin_tx_img_prev");
        const imgMsg = m.modal.querySelector("#fin_tx_img_msg");
        const imgDelBtn = m.modal.querySelector("#fin_tx_img_del");
        const imgFile = m.modal.querySelector("#fin_tx_img_file");
        const imgCamFile = m.modal.querySelector("#fin_tx_img_file_cam");
        const refreshImg = function () {
          if (imgPrev) {
            imgPrev.innerHTML = receiptImg
              ? '<img src="' + esc(receiptImg) + '" alt="單據附件" style="max-width:100%;max-height:180px;border-radius:12px;border:1px solid rgba(17,24,39,.12);"/>'
              : "";
          }
          if (imgDelBtn) imgDelBtn.style.display = receiptImg ? "" : "none";
        };
        const takeImage = function (file) {
          if (!file) return;
          if (imgMsg) imgMsg.textContent = "圖片壓縮中…";
          compressImageFile(file, 1024, 0.72).then(function (dataUrl) {
            receiptImg = dataUrl;
            refreshImg();
            if (imgMsg) imgMsg.textContent = "已附加單據照片（約 " + Math.round(String(dataUrl).length / 1024) + " KB）";
          }).catch(function (e) {
            if (imgMsg) imgMsg.textContent = "";
            showErr("圖片處理失敗：" + (e && e.message ? e.message : "請換一張圖片"));
          });
        };
        const imgPickBtn = m.modal.querySelector("#fin_tx_img_pick");
        if (imgPickBtn) imgPickBtn.onclick = function () { if (imgFile) imgFile.click(); };
        const imgCamBtn = m.modal.querySelector("#fin_tx_img_cam");
        if (imgCamBtn) imgCamBtn.onclick = function () { if (imgCamFile) imgCamFile.click(); };
        [imgFile, imgCamFile].forEach(function (inp) {
          if (!inp) return;
          inp.addEventListener("change", function () {
            takeImage(inp.files && inp.files[0]);
            inp.value = "";
          });
        });
        if (imgDelBtn) imgDelBtn.onclick = function () {
          receiptImg = "";
          refreshImg();
          if (imgMsg) imgMsg.textContent = "";
        };
        refreshImg();

        const saveBtn = m.modal.querySelector("#fin_tx_save");
        if (saveBtn) saveBtn.onclick = function () {
          const date = String((m.modal.querySelector("#fin_tx_date") || {}).value || "").trim();
          const category = String((m.modal.querySelector("#fin_tx_cat") || {}).value || "").trim();
          const amountRaw = String((m.modal.querySelector("#fin_tx_amount") || {}).value || "").trim();
          const amount = toNum(amountRaw, NaN);
          if (!date) { showErr("請填寫日期"); return; }
          if (!category) { showErr("請填寫類別"); return; }
          if (!amountRaw || !Number.isFinite(amount) || amount < 0) { showErr("請填寫有效的金額（≥ 0）"); return; }
          const selMethod = String((m.modal.querySelector("#fin_tx_method") || {}).value || "").trim();
          let bookId = "";
          let method = "";
          if (selMethod === "__legacy__") {
            method = legacyMethod;
          } else if (selMethod) {
            const bk = state.books.find(function (x) { return x.id === selMethod; });
            bookId = selMethod;
            method = bk ? String(bk.name || "") : "";
          }
          /* 異動歷程：保留既有軌跡並附加本次動作（最多 30 筆） */
          const history = (Array.isArray(cur.history) ? cur.history : []).slice(-29);
          history.push({
            at: nowStamp(),
            by: String(context.name || ""),
            action: isEdit ? "update" : "create"
          });
          const payload = {
            id: isEdit ? row.id : "",
            kind: kind,
            date: date,
            category: category,
            amount: amount,
            target: String((m.modal.querySelector("#fin_tx_target") || {}).value || "").trim(),
            method: method,
            bookId: bookId,
            months: months.slice(),
            receiptNo: String((m.modal.querySelector("#fin_tx_receipt") || {}).value || "").trim(),
            receiptImg: receiptImg,
            note: String((m.modal.querySelector("#fin_tx_note") || {}).value || "").trim(),
            history: history
          };
          saveBtn.disabled = true;
          saveBtn.textContent = "儲存中…";
          Model.saveTx(db, cid, payload, { uid: context.uid, name: context.name }).then(function () {
            m.close();
            toast(isEdit ? "已更新" : "已新增");
          }).catch(function (e) {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? "儲存" : "建立";
            showErr("儲存失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
      };

      /** 新增 / 編輯帳本 */
      const openBookModal = function (row) {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        const isEdit = Boolean(row);
        const types = cfgList("bookTypes");
        const cur = row || { name: "", type: types[0] || "", openingBalance: "", note: "" };
        const typeOptions = types.slice();
        if (cur.type && typeOptions.indexOf(cur.type) === -1) typeOptions.push(cur.type);
        const nextOrder = state.books.reduce(function (a, bk) { return Math.max(a, toNum(bk.order, 0)); }, -1) + 1;
        const m = openModal({
          title: (isEdit ? "編輯" : "新增") + "帳本",
          width: "min(92vw, 560px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("帳本名稱 *", '<input id="fin_book_name" value="' + esc(cur.name) + '" style="' + inputStyle + '" placeholder="例如：管理費專戶"/>') +
            field("類型 *", '<select id="fin_book_type" style="' + inputStyle + '">' +
              (typeOptions.length ? "" : '<option value="">請先至「設定」新增帳本類型</option>') +
              typeOptions.map(function (t) {
                return '<option value="' + esc(t) + '"' + (cur.type === t ? " selected" : "") + ">" + esc(t) + "</option>";
              }).join("") +
              "</select>") +
            "</div>" +
            field("期初餘額", '<input type="number" step="1" id="fin_book_opening" value="' + esc(isEdit ? cur.openingBalance : "") + '" style="' + inputStyle + '" placeholder="0"/>') +
            field("備註", '<textarea id="fin_book_note" rows="3" style="' + inputStyle + 'resize:vertical;">' + esc(cur.note) + "</textarea>") +
            '<div class="fin-hint">目前餘額＝期初餘額＋存入－提出；期初餘額請填本帳本開始記錄前的餘額。</div>' +
            '<div id="fin_book_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_book_cancel">取消</button>' +
            '<button class="btn btn-primary" type="button" id="fin_book_save">' + (isEdit ? "儲存" : "建立") + "</button>"
        });
        if (!m.modal) return;
        const errEl = m.modal.querySelector("#fin_book_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const cancelBtn = m.modal.querySelector("#fin_book_cancel");
        if (cancelBtn) cancelBtn.onclick = function () { m.close(); };
        const saveBtn = m.modal.querySelector("#fin_book_save");
        if (saveBtn) saveBtn.onclick = function () {
          const name = String((m.modal.querySelector("#fin_book_name") || {}).value || "").trim();
          const type = String((m.modal.querySelector("#fin_book_type") || {}).value || "").trim();
          if (!name) { showErr("請填寫帳本名稱"); return; }
          const payload = {
            id: isEdit ? row.id : "",
            name: name,
            type: type,
            openingBalance: toNum((m.modal.querySelector("#fin_book_opening") || {}).value, 0),
            note: String((m.modal.querySelector("#fin_book_note") || {}).value || "").trim(),
            order: isEdit ? toNum(row.order, 0) : nextOrder
          };
          saveBtn.disabled = true;
          saveBtn.textContent = "儲存中…";
          Model.saveBook(db, cid, payload, { uid: context.uid, name: context.name }).then(function () {
            m.close();
            toast(isEdit ? "已更新帳本" : "已新增帳本");
          }).catch(function (e) {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? "儲存" : "建立";
            showErr("儲存失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
      };

      const openBankModal = function (row) {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        const isEdit = Boolean(row);
        const book = state.books.find(function (bk) { return bk.id === (isEdit ? row.bookId : state.activeBookId); });
        if (!book) { toast("請先選擇帳本", true); return; }
        const cur = row || { date: todayStr(), summary: "", deposit: "", withdraw: "", note: "" };
        const m = openModal({
          title: (isEdit ? "編輯" : "新增") + "帳本紀錄",
          width: "min(92vw, 560px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint" style="font-weight:900;color:#111827;">' + esc(book.name || "未命名帳本") +
            '<span class="fin-tag" style="margin-left:8px;background:rgba(29,78,216,.12);color:#1d4ed8;">' + esc(book.type || "未分類") + "</span></div>" +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("日期 *", '<input type="date" id="fin_bk_date" value="' + esc(cur.date) + '" style="' + inputStyle + '"/>') +
            field("摘要", '<input id="fin_bk_summary" value="' + esc(cur.summary) + '" style="' + inputStyle + '" placeholder="例如：管理費入帳"/>') +
            "</div>" +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("存入", '<input type="number" min="0" step="1" id="fin_bk_deposit" value="' + esc(isEdit ? cur.deposit : "") + '" style="' + inputStyle + '"/>') +
            field("提出", '<input type="number" min="0" step="1" id="fin_bk_withdraw" value="' + esc(isEdit ? cur.withdraw : "") + '" style="' + inputStyle + '"/>') +
            "</div>" +
            field("備註", '<textarea id="fin_bk_note" rows="3" style="' + inputStyle + 'resize:vertical;">' + esc(cur.note) + "</textarea>") +
            '<div id="fin_bk_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_bk_cancel">取消</button>' +
            '<button class="btn btn-primary" type="button" id="fin_bk_save">' + (isEdit ? "儲存" : "建立") + "</button>"
        });
        if (!m.modal) return;
        const errEl = m.modal.querySelector("#fin_bk_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const cancelBtn = m.modal.querySelector("#fin_bk_cancel");
        if (cancelBtn) cancelBtn.onclick = function () { m.close(); };
        const saveBtn = m.modal.querySelector("#fin_bk_save");
        if (saveBtn) saveBtn.onclick = function () {
          const date = String((m.modal.querySelector("#fin_bk_date") || {}).value || "").trim();
          const deposit = toNum((m.modal.querySelector("#fin_bk_deposit") || {}).value, 0);
          const withdraw = toNum((m.modal.querySelector("#fin_bk_withdraw") || {}).value, 0);
          if (!date) { showErr("請填寫日期"); return; }
          if (deposit <= 0 && withdraw <= 0) { showErr("請至少填寫存入或提出金額"); return; }
          const payload = {
            id: isEdit ? row.id : "",
            bookId: book.id,
            bookName: book.name || "",
            date: date,
            summary: String((m.modal.querySelector("#fin_bk_summary") || {}).value || "").trim(),
            deposit: deposit,
            withdraw: withdraw,
            note: String((m.modal.querySelector("#fin_bk_note") || {}).value || "").trim()
          };
          saveBtn.disabled = true;
          saveBtn.textContent = "儲存中…";
          Model.saveBank(db, cid, payload, { uid: context.uid, name: context.name }).then(function () {
            m.close();
            toast(isEdit ? "已更新" : "已新增");
          }).catch(function (e) {
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? "儲存" : "建立";
            showErr("儲存失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };
      };

      /* ---------------- 稽核與資料備份 ---------------- */

      /** 檢視單據附件（Base64 大圖） */
      const openShotModal = function (id) {
        const row = state.tx.find(function (t) { return t.id === id; });
        if (!row) return;
        if (!row.receiptImg) { toast("此筆紀錄沒有單據附件", true); return; }
        const m = openModal({
          title: "單據附件",
          width: "min(94vw, 760px)",
          bodyHtml:
            '<div style="display:grid;gap:10px;justify-items:center;">' +
            '<img src="' + esc(row.receiptImg) + '" alt="單據附件" style="max-width:100%;max-height:62vh;border-radius:12px;border:1px solid rgba(17,24,39,.12);"/>' +
            '<div class="fin-hint">' + esc(row.date + "｜" + (row.category || "未分類") + "｜NT$ " + fmtMoney(row.amount) +
              (row.receiptNo ? "｜單據編號 " + row.receiptNo : "")) + "</div>" +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_shot_close">關閉</button>' +
            '<button class="btn" type="button" id="fin_shot_dl">下載圖片</button>'
        });
        const closeBtn = m.modal && m.modal.querySelector("#fin_shot_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };
        const dlBtn = m.modal && m.modal.querySelector("#fin_shot_dl");
        if (dlBtn) dlBtn.onclick = function () {
          Export.downloadDataUrl(row.receiptImg, "單據_" + sanitize(row.date + "_" + (row.category || "未分類")) + ".jpg");
        };
      };

      /** 操作軌跡：建立者／最後修改者與異動歷程 */
      const openTxLogModal = function (id) {
        const row = state.tx.find(function (t) { return t.id === id; });
        if (!row) return;
        const actionLabel = { create: "建立", update: "修改", delete: "刪除" };
        /* 既有資料未記錄人員時，顯示目前登入者姓名，避免欄位顯示「—」 */
        const meName = String(context.name || "").trim() || "—";
        const hist = Array.isArray(row.history) ? row.history.slice().reverse() : [];
        const m = openModal({
          title: "操作軌跡",
          width: "min(94vw, 620px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">' + esc(row.date + "｜" + (row.category || "未分類") + "｜NT$ " + fmtMoney(row.amount) +
              "（" + esc((KIND[row.kind] || {}).label || "") + "）") + "</div>" +
            '<div class="fin-stat-grid">' +
            statCard("建立人員", row.createdBy || meName, "#374151") +
            statCard("建立時間", row.createdAt || "—", "#374151") +
            statCard("最後修改人", row.updatedBy || meName, "#1d4ed8") +
            statCard("最後修改時間", row.updatedAt || "—", "#1d4ed8") +
            "</div>" +
            "<h3 style=\"margin:2px 0 0;font-size:calc(14px * var(--fs, 1));\">異動歷程（新→舊）</h3>" +
            '<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>動作</th><th>人員</th><th>時間</th></tr></thead>' +
            "<tbody>" + (hist.length
              ? hist.map(function (h) {
                  return "<tr><td>" + esc(actionLabel[h.action] || h.action || "—") + "</td><td>" +
                    esc(h.by || meName) + "</td><td>" + esc(h.at || "—") + "</td></tr>";
                }).join("")
              : '<tr><td colspan="3" class="fin-empty">此筆紀錄尚無異動歷程（既有資料未記錄）</td></tr>') +
            "</tbody></table></div>" +
            "</div>",
          footerHtml: '<button class="btn btn-ghost" type="button" id="fin_log_close">關閉</button>'
        });
        const closeBtn = m.modal && m.modal.querySelector("#fin_log_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };
      };

      /** 稽核紀錄（刪除等留痕動作） */
      const openAuditModal = function () {
        const list = state.audits || [];
        const actionLabel = { delete: "刪除紀錄" };
        const m = openModal({
          title: "稽核紀錄",
          width: "min(96vw, 820px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">刪除等需留痕的財務動作會自動記錄於此，供內部控制與事後查核使用。</div>' +
            '<div class="fin-table-wrap" style="max-height:56vh;overflow:auto;"><table class="fin-table"><thead><tr>' +
            "<th>動作</th><th>內容</th><th>原因</th><th>人員</th><th>時間</th></tr></thead>" +
            "<tbody>" + (list.length
              ? list.map(function (a) {
                  return "<tr><td>" + esc(actionLabel[a.action] || a.action || "—") + "</td><td>" +
                    esc(a.summary || "—") + "</td><td>" + esc(a.reason || "—") + "</td><td>" +
                    esc(a.by || "—") + "</td><td>" + esc(a.at || "—") + "</td></tr>";
                }).join("")
              : '<tr><td colspan="5" class="fin-empty">尚無稽核紀錄</td></tr>') +
            "</tbody></table></div>" +
            "</div>",
          footerHtml: '<button class="btn btn-ghost" type="button" id="fin_audit_close">關閉</button>'
        });
        const closeBtn = m.modal && m.modal.querySelector("#fin_audit_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };
      };

      /** 資料匯出備份：整年度完整備份（Excel 多工作表／JSON 原始資料） */
      const openBackupModal = function () {
        const years = {};
        state.tx.forEach(function (t) { const y = String(t.date || "").slice(0, 4); if (y) years[y] = true; });
        state.bank.forEach(function (b) { const y = String(b.date || "").slice(0, 4); if (y) years[y] = true; });
        Object.keys(state.budgets || {}).forEach(function (y) { if (y) years[y] = true; });
        const list = Object.keys(years).sort().reverse();
        if (!list.length) list.push(String(new Date().getFullYear()));
        const backupOpts = function () {
          const sel = m.modal && m.modal.querySelector("#fin_bk_year");
          const year = String((sel || {}).value || list[0]).trim();
          return {
            communityName: cName,
            year: year,
            txList: state.tx,
            bankList: state.bank,
            books: state.books,
            fees: state.fees,
            budgets: Object.keys(state.budgets || {}).map(function (y) {
              return { year: y, items: state.budgets[y] || [] };
            }),
            notices: state.notices,
            audits: state.audits,
            config: currentConfig()
          };
        };
        const m = openModal({
          title: "資料匯出備份",
          width: "min(94vw, 560px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">將所選年度的財務資料完整備份留存：帳本、收支明細、管理費設定、年度預算、催收通知、稽核紀錄與參數設定。</div>' +
            field("備份年度", '<select id="fin_bk_year" style="' + inputStyle + '">' +
              list.map(function (y) { return '<option value="' + esc(y) + '">' + esc(y) + " 年</option>"; }).join("") +
              "</select>") +
            '<div class="fin-hint">Excel 備份分為多個工作表，方便以試算表檢視；JSON 備份保留完整欄位（含單據附件），建議長期留存。</div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_bk_close">關閉</button>' +
            '<button class="btn" type="button" id="fin_bk_json">匯出 JSON 備份</button>' +
            '<button class="btn btn-primary" type="button" id="fin_bk_xlsx">匯出 Excel 備份</button>'
        });
        const closeBtn = m.modal && m.modal.querySelector("#fin_bk_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };
        const xlsxBtn = m.modal && m.modal.querySelector("#fin_bk_xlsx");
        if (xlsxBtn) xlsxBtn.onclick = function () { if (Export.backupToExcel(backupOpts())) toast("已匯出 Excel 備份"); };
        const jsonBtn = m.modal && m.modal.querySelector("#fin_bk_json");
        if (jsonBtn) jsonBtn.onclick = function () { if (Export.backupToJson(backupOpts())) toast("已匯出 JSON 備份"); };
      };

      /** 刪除需二次授權：必填刪除原因後才可執行，並留下稽核紀錄 */
      const askDeleteReason = function (row) {
        return new Promise(function (resolve) {
          const m = openModal({
            title: "刪除確認（需填寫原因）",
            width: "min(92vw, 520px)",
            bodyHtml:
              '<div style="display:grid;gap:12px;">' +
              '<div style="padding:12px 14px;border-radius:14px;background:rgba(220,38,38,.08);border:1.5px solid rgba(220,38,38,.22);color:#991b1b;font-weight:800;font-size:calc(13px * var(--fs, 1));line-height:1.7;">' +
              "即將刪除「" + esc((KIND[row.kind] || {}).label || "") + "｜" + esc(row.category || "未分類") + "｜NT$ " +
              fmtMoney(row.amount) + "（" + esc(row.date) + "）」。此操作無法復原。" +
              "</div>" +
              field("刪除原因 *", '<textarea id="fin_del_reason" rows="3" placeholder="例如：重複登錄、金額誤 key、附件錯誤…" style="' +
                inputStyle + 'resize:vertical;"></textarea>') +
              '<div class="fin-hint">為避免誤刪與舞弊風險，請簡述刪除原因（至少 2 個字），紀錄與原資料將保存於「稽核紀錄」。</div>' +
              '<div id="fin_del_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
              "</div>",
            footerHtml:
              '<button class="btn btn-ghost" type="button" id="fin_del_cancel">取消</button>' +
              '<button class="btn btn-danger" type="button" id="fin_del_ok">確認刪除</button>'
          });
          const errEl = m.modal && m.modal.querySelector("#fin_del_err");
          const showErr = function (msg) {
            if (!errEl) return;
            errEl.style.display = msg ? "block" : "none";
            errEl.textContent = msg || "";
          };
          let done = false;
          const finish = function (v) {
            if (done) return;
            done = true;
            m.close();
            resolve(v);
          };
          const cancelBtn = m.modal && m.modal.querySelector("#fin_del_cancel");
          if (cancelBtn) cancelBtn.onclick = function () { finish(""); };
          const okBtn = m.modal && m.modal.querySelector("#fin_del_ok");
          if (okBtn) okBtn.onclick = function () {
            const reason = String((m.modal.querySelector("#fin_del_reason") || {}).value || "").trim();
            if (reason.length < 2) { showErr("請填寫刪除原因（至少 2 個字）"); return; }
            finish(reason);
          };
        });
      };

      const removeTx = function (id) {
        if (!canDelete) { toast("您沒有刪除權限", true); return; }
        const row = state.tx.find(function (t) { return t.id === id; });
        if (!row) return;
        askDeleteReason(row).then(function (reason) {
          if (!reason) return;
          const snapshot = {
            id: row.id,
            kind: row.kind,
            date: row.date,
            category: row.category,
            amount: row.amount,
            target: row.target,
            method: row.method,
            months: row.months,
            receiptNo: row.receiptNo,
            note: row.note
          };
          Model.removeTx(db, cid, id).then(function () {
            toast("已刪除，並留下稽核紀錄");
            return Model.saveAudit(db, cid, {
              action: "delete",
              summary: (KIND[row.kind] || {}).label + "｜" + (row.category || "未分類") + "｜NT$ " +
                fmtMoney(row.amount) + "（" + row.date + "）",
              reason: reason,
              detail: snapshot
            }, { uid: context.uid, name: context.name });
          }).catch(function (e) {
            toast("刪除失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
          });
        });
      };

      const removeBank = function (id) {
        if (!canDelete) { toast("您沒有刪除權限", true); return; }
        const row = state.bank.find(function (b) { return b.id === id; });
        if (!row) return;
        confirmDialog({
          title: "確認刪除帳本紀錄",
          message: "確定要刪除「" + (row.date) + "｜" + (row.summary || "未填摘要") + "」這筆帳本紀錄嗎？此操作無法復原。",
          okText: "確認刪除"
        }).then(function (ok) {
          if (!ok) return;
          Model.removeBank(db, cid, id).then(function () {
            toast("已刪除");
          }).catch(function (e) {
            toast("刪除失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
          });
        });
      };

      const removeBookConfirm = function (id) {
        if (!canDelete) { toast("您沒有刪除權限", true); return; }
        const book = state.books.find(function (bk) { return bk.id === id; });
        if (!book) return;
        const used = state.bank.filter(function (r) { return r.bookId === id; }).length;
        confirmDialog({
          title: "確認刪除帳本",
          message: "確定要刪除帳本「" + (book.name || "未命名帳本") + "」嗎？" +
            (used ? "此帳本下仍有 " + used + " 筆紀錄，刪除帳本後這些紀錄將不再顯示。" : "此操作無法復原。"),
          okText: "確認刪除"
        }).then(function (ok) {
          if (!ok) return;
          Model.removeBook(db, cid, id).then(function () {
            if (state.activeBookId === id) state.activeBookId = "";
            toast("已刪除帳本");
            render();
          }).catch(function (e) {
            toast("刪除失敗：" + (e && e.message ? e.message : "請稍後再試"), true);
          });
        });
      };

      /* ---------------- 帳本對帳 ---------------- */

      /** 帳本對帳：輸入對帳單餘額，自動比對系統餘額與差額 */
      const openReconcileModal = function (book) {
        const rowsAll = bookAllRows(book.id);
        const opening = toNum(book.openingBalance, 0);

        const m = openModal({
          title: "帳本對帳：" + String(book.name || "未命名帳本"),
          width: "min(94vw, 820px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">輸入銀行對帳單上「截至對帳基準日」的餘額，系統會以帳本紀錄（含財報明細）計算系統餘額並比對差額。</div>' +
            '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">' +
            field("對帳基準日", '<input type="date" id="fin_recon_date" max="' + esc(todayStr()) + '" value="' + esc(todayStr()) + '" style="' + inputStyle + '"/>') +
            field("對帳單餘額", '<input type="number" step="1" id="fin_recon_balance" style="' + inputStyle + '" placeholder="0"/>') +
            "</div>" +
            '<div id="fin_recon_result"></div>' +
            "</div>",
          footerHtml: '<button class="btn btn-ghost" type="button" id="fin_recon_close">關閉</button>'
        });
        if (!m.modal) return;

        const q = function (sel) { return m.modal.querySelector(sel); };
        const resultEl = q("#fin_recon_result");
        const dateInput = q("#fin_recon_date");
        const balInput = q("#fin_recon_balance");

        const paint = function () {
          if (!resultEl) return;
          const asOf = String((dateInput || {}).value || "").trim() || todayStr();
          const raw = String((balInput || {}).value || "").trim();
          const within = rowsAll.filter(function (r) { return String(r.date || "") <= asOf; });
          const after = rowsAll.filter(function (r) { return String(r.date || "") > asOf; });
          const sys = within.length ? toNum(within[0].balance, opening) : opening;
          const has = raw !== "" && Number.isFinite(toNum(raw, NaN));
          const statement = has ? toNum(raw, 0) : 0;
          const diff = has ? statement - sys : null;
          const diffColor = !has ? "#6b7280" : (Math.abs(diff) < 0.005 ? "#15803d" : "#b91c1c");

          const afterRows = after.slice(0, 60).map(function (r) {
            return "<tr>" +
              "<td>" + esc(r.date || "—") + "</td>" +
              "<td>" + esc(r.summary || "—") + "</td>" +
              '<td class="num" style="color:#15803d;">' + (toNum(r.deposit, 0) ? fmtMoney(r.deposit) : "—") + "</td>" +
              '<td class="num" style="color:#b91c1c;">' + (toNum(r.withdraw, 0) ? fmtMoney(r.withdraw) : "—") + "</td>" +
              "</tr>";
          }).join("");

          resultEl.innerHTML =
            '<div class="fin-stat-grid">' +
            statCard("系統累計餘額（至 " + asOf + "）", fmtMoney(sys), "#1d4ed8") +
            statCard("對帳單餘額", has ? fmtMoney(statement) : "—", "#374151") +
            statCard("差額", diff == null ? "—" : fmtMoney(diff), diffColor) +
            "</div>" +
            (diff == null
              ? '<div class="fin-hint">請輸入對帳單餘額以比對差額。</div>'
              : (Math.abs(diff) < 0.005
                ? '<div class="fin-hint" style="color:#15803d;font-weight:900;">帳目相符，系統餘額與對帳單一致。</div>'
                : '<div class="fin-hint" style="color:#b45309;font-weight:800;">差額 ' + fmtMoney(diff) +
                  '（對帳單 − 系統）。請確認是否有未登錄、重複登錄或日期不符的款項；下方列出基準日之後才登錄的紀錄供核對。</div>')) +
            (after.length
              ? "<h3 style=\"margin:6px 0 0;font-size:calc(14px * var(--fs, 1));\">基準日之後的已登錄紀錄（" + after.length + " 筆）</h3>" +
                '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
                "<th>日期</th><th>摘要</th><th>存入</th><th>提出</th></tr></thead><tbody>" +
                afterRows + "</tbody></table></div>"
              : "");
        };

        if (dateInput) dateInput.addEventListener("change", paint);
        if (balInput) balInput.addEventListener("input", paint);
        paint();

        const closeBtn = q("#fin_recon_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };
      };

      /* ---------------- 批次匯入 ---------------- */

      /** 批次匯入財報明細：提供 Excel 範本、解析檔案並一次性寫入 */
      const openImportModal = function () {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        let parsed = [];

        const pick = function (obj, keys) {
          for (let i = 0; i < keys.length; i++) {
            const v = obj[keys[i]];
            if (v != null && String(v).trim() !== "") return v;
          }
          return "";
        };
        const toYmd = function (v) {
          if (v instanceof Date) return ymd(v);
          const s = String(v == null ? "" : v).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          const t = s.replace(/[/.]/g, "-");
          const m1 = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (m1) return m1[1] + "-" + pad2(m1[2]) + "-" + pad2(m1[3]);
          const m2 = t.match(/^(\d{4})-(\d{1,2})$/);
          if (m2) return m2[1] + "-" + pad2(m2[2]) + "-01";
          return "";
        };
        const parseMonths = function (v) {
          return String(v == null ? "" : v).split(/[、,，;；\s]+/).map(function (x) {
            const t = x.trim().replace(/[/.]/g, "-").replace(/^(\d{4})-(\d)$/, "$1-0$2");
            return t;
          }).filter(function (t) { return /^\d{4}-\d{2}$/.test(t); });
        };

        const normalize = function (raw, i) {
          const kindText = String(pick(raw, ["類型", "类型", "收支", "kind"])).trim();
          const kind = /支|expense/i.test(kindText) ? "expense" : "income";
          const date = toYmd(pick(raw, ["日期", "date"]));
          const category = String(pick(raw, ["類別", "类别", "科目", "category"])).trim();
          const target = String(pick(raw, ["對象", "对象", "繳費人", "target"])).trim();
          const amountText = String(pick(raw, ["金額", "金额", "amount"])).replace(/[,\s$]/g, "");
          const amount = Number(amountText);
          const bookName = String(pick(raw, ["帳本", "帐本", "帳戶", "book"])).trim();
          const months = parseMonths(pick(raw, ["沖銷月份", "冲销月份", "月份", "months"]));
          const receiptNo = String(pick(raw, ["單據編號", "单据编号", "receipt"])).trim();
          const note = String(pick(raw, ["備註", "备注", "note"])).trim();
          const errs = [];
          if (!date) errs.push("日期格式錯誤");
          if (!category) errs.push("缺少類別");
          if (!amountText || !Number.isFinite(amount) || amount < 0) errs.push("金額無效");
          let bk = null;
          if (bookName) {
            bk = state.books.find(function (x) { return String(x.name || "") === bookName; });
            if (!bk) errs.push("找不到帳本「" + bookName + "」");
          }
          return {
            no: i + 1, kind: kind, date: date, category: category, target: target,
            amount: Number.isFinite(amount) ? amount : 0,
            bookId: bk ? String(bk.id) : "", bookName: bk ? String(bk.name || "") : "",
            months: months, receiptNo: receiptNo, note: note, errs: errs
          };
        };

        const m = openModal({
          title: "批次匯入財報明細",
          width: "min(96vw, 900px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div class="fin-hint">支援 Excel（.xlsx／.xls）與 CSV。欄位：類型（收入／支出）、日期、類別、對象、金額、帳本、沖銷月份（選填）、單據編號（選填）、備註（選填）。「帳本」請填帳本名稱，找不到對應帳本者該列不匯入。</div>' +
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
            '<button class="btn btn-ghost" type="button" id="fin_imp_tpl">下載匯入範本</button>' +
            '<input type="file" id="fin_imp_file" accept=".xlsx,.xls,.csv" style="' + inputStyle + 'flex:1 1 260px;"/>' +
            "</div>" +
            '<div id="fin_imp_summary" class="fin-stat-grid"></div>' +
            '<div id="fin_imp_list"></div>' +
            '<div id="fin_imp_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:calc(12px * var(--fs, 1));font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
            "</div>",
          footerHtml:
            '<button class="btn btn-ghost" type="button" id="fin_imp_close">關閉</button>' +
            '<button class="btn btn-primary" type="button" id="fin_imp_ok" disabled>開始匯入</button>'
        });
        if (!m.modal) return;

        const q = function (sel) { return m.modal.querySelector(sel); };
        const errEl = q("#fin_imp_err");
        const showErr = function (msg) {
          if (!errEl) return;
          errEl.style.display = msg ? "block" : "none";
          errEl.textContent = msg || "";
        };
        const okBtn = q("#fin_imp_ok");
        const sumEl = q("#fin_imp_summary");
        const listEl = q("#fin_imp_list");

        const paint = function () {
          const good = parsed.filter(function (r) { return !r.errs.length; });
          const bad = parsed.filter(function (r) { return r.errs.length; });
          if (sumEl) {
            sumEl.innerHTML = statCard("讀取筆數", String(parsed.length), "#374151") +
              statCard("可匯入", String(good.length), "#15803d") +
              statCard("有錯誤（略過）", String(bad.length), bad.length ? "#b91c1c" : "#6b7280") +
              statCard("可匯入金額", fmtMoney(good.reduce(function (a, r) { return a + r.amount; }, 0)), "#0f766e");
          }
          if (listEl) {
            const show = parsed.slice(0, 200);
            listEl.innerHTML = parsed.length
              ? '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
                "<th>列</th><th>類型</th><th>日期</th><th>類別</th><th>對象</th><th>金額</th><th>帳本</th><th>狀態</th>" +
                "</tr></thead><tbody>" +
                show.map(function (r) {
                  return "<tr>" +
                    "<td>" + esc(String(r.no)) + "</td>" +
                    "<td>" + (r.kind === "expense" ? "支出" : "收入") + "</td>" +
                    "<td>" + esc(r.date || "—") + "</td>" +
                    "<td>" + esc(r.category || "—") + "</td>" +
                    "<td>" + esc(r.target || "—") + "</td>" +
                    '<td class="num">' + fmtMoney(r.amount) + "</td>" +
                    "<td>" + esc(r.bookName || "—") + "</td>" +
                    "<td>" + (r.errs.length
                      ? '<span class="fin-tag" style="background:rgba(185,28,28,.10);color:#b91c1c;">' + esc(r.errs.join("；")) + "</span>"
                      : '<span class="fin-tag" style="background:rgba(21,128,61,.12);color:#15803d;">可匯入</span>') + "</td>" +
                    "</tr>";
                }).join("") +
                "</tbody></table></div>" +
                (parsed.length > show.length ? '<div class="fin-hint">僅顯示前 200 列，其餘將一併匯入。</div>' : "")
              : "";
          }
          if (okBtn) {
            okBtn.disabled = !good.length;
            okBtn.textContent = good.length ? "匯入 " + good.length + " 筆" : "開始匯入";
          }
        };

        const tplBtn = q("#fin_imp_tpl");
        if (tplBtn) tplBtn.onclick = function () {
          const XLSX = window.XLSX;
          if (!XLSX) { showErr("Excel 元件尚未載入，請稍後再試"); return; }
          const bkName = state.books.length ? String(state.books[0].name || "") : "";
          const rows = [
            ["類型", "日期", "類別", "對象", "金額", "帳本", "沖銷月份", "單據編號", "備註"],
            ["收入", todayStr(), "管理費", "A-1-1 王大明", 1500, bkName, todayStr().slice(0, 7), "R0001", "當月管理費"],
            ["支出", todayStr(), "清潔維護", "大大清潔公司", 8000, bkName, "", "P0001", "每月清潔"]
          ];
          try {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "匯入範本");
            XLSX.writeFile(wb, "財報系統_批次匯入範本.xlsx");
          } catch (e) {
            showErr("範本產生失敗：" + (e && e.message ? e.message : "請稍後再試"));
          }
        };

        const fileInput = q("#fin_imp_file");
        if (fileInput) fileInput.addEventListener("change", function () {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          const XLSX = window.XLSX;
          if (!XLSX) { showErr("Excel 元件尚未載入，請稍後再試"); return; }
          const reader = new FileReader();
          reader.onload = function () {
            try {
              const wb = XLSX.read(new Uint8Array(reader.result), { type: "array", cellDates: true });
              const sheet = wb.Sheets[wb.SheetNames[0]];
              const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
              parsed = json.map(normalize).filter(function (r) {
                return r.category || r.date || r.amount;
              });
              showErr(parsed.length ? "" : "檔案中沒有可讀取的資料列。");
              paint();
            } catch (e) {
              parsed = [];
              paint();
              showErr("檔案解析失敗：" + (e && e.message ? e.message : "請確認格式"));
            }
          };
          reader.onerror = function () { showErr("檔案讀取失敗，請再試一次。"); };
          reader.readAsArrayBuffer(file);
        });

        if (okBtn) okBtn.onclick = function () {
          if (okBtn.disabled) return;
          const good = parsed.filter(function (r) { return !r.errs.length; });
          const payloads = good.map(function (r) {
            return {
              kind: r.kind,
              date: r.date,
              category: r.category,
              amount: r.amount,
              target: r.target,
              method: r.bookName,
              bookId: r.bookId,
              months: r.months,
              receiptNo: r.receiptNo,
              note: r.note
            };
          });
          okBtn.disabled = true;
          okBtn.textContent = "匯入中…";
          Model.saveTxBatch(db, cid, payloads, { uid: context.uid, name: context.name }).then(function (n) {
            m.close();
            toast("已匯入 " + n + " 筆財報明細");
          }).catch(function (e) {
            okBtn.disabled = false;
            okBtn.textContent = "匯入 " + payloads.length + " 筆";
            showErr("匯入失敗：" + (e && e.message ? e.message : "請稍後再試"));
          });
        };

        const closeBtn = q("#fin_imp_close");
        if (closeBtn) closeBtn.onclick = function () { m.close(); };
        paint();
      };

      /* ---------------- 匯出 ---------------- */

      const doExportExcel = function (which) {
        if (which === "bank") {
          const list = state.activeBookId
            ? bookRecords(state.activeBookId)
            : state.books.reduce(function (acc, bk) {
                return acc.concat(bookRecords(bk.id));
              }, []);
          Export.toExcel({
            communityName: cName,
            txList: [],
            bankList: list,
            agg: Model.aggregate([], list, { from: "", to: "" }, state.books)
          });
          return;
        }
        if (which === "report") {
          const r = state.report;
          Export.toExcel({
            communityName: cName,
            txList: state.tx,
            bankList: state.bank,
            fees: reportFees(),
            agg: Model.aggregate(state.tx, state.bank, { from: r.from, to: r.to }, state.books)
          });
          return;
        }
        Export.toExcel({
          communityName: cName,
          txList: filterTx(which),
          bankList: [],
          agg: Model.aggregate(filterTx(which), [], { from: "", to: "" }, state.books)
        });
      };

      const doExportPdf = function () {
        const r = state.report;
        const presetLabel = { day: "本日", month: "本月", year: "本年", custom: "自訂" }[r.preset] || "自訂";
        Export.toPdf({
          communityName: cName,
          preset: r.preset,
          rangeLabel: presetLabel,
          exportedBy: String(context.name || "").trim(),
          fees: reportFees(),
          agg: Model.aggregate(state.tx, state.bank, { from: r.from, to: r.to }, state.books)
        }).then(function (ok) {
          if (ok) toast("已產生 PDF");
        });
      };

      /* ---------------- 啟動 ---------------- */

      /* 姓名補正：呼叫端未帶姓名時，查詢 users/{uid} 取回真實姓名後重繪 */
      const loadActorName = function () {
        const uid = String(context.uid || "").trim();
        if (givenName || !uid) return;
        db.collection("users").doc(uid).get().then(function (doc) {
          const d = (doc && doc.exists && doc.data()) || {};
          const real = String(d.displayName || d.name || d.realName || d.userName || "").trim();
          if (!real || real === context.name) return;
          context.name = real;
          render();
        }).catch(function () { /* 忽略（無權限或查無資料） */ });
      };

      render();
      loadActorName();
      subscribeTx();
      subscribeBank();
      subscribeBooks();
      subscribeConfig();
      subscribeCommunity();
      subscribeResidents();
      subscribeFees();
      subscribeBudgets();
      subscribeNotices();
      subscribeAudits();
    }
  };

  const inputStyle = "padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:700;";

  function field(label, controlHtml) {
    return '<div class="field" style="gap:2px;margin:0;"><label style="font-size:calc(11px * var(--fs, 1));font-weight:800;color:#6b7280;">' +
      esc(label) + "</label>" + controlHtml + "</div>";
  }

  window.NwFinance = {
    Model: Model,
    UI: UI,
    Export: Export
  };
})();
