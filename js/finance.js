/*
 * 收支報表模組（finance）
 * 命名空間：window.NwFinance = { Model, UI, Export }
 * 子分頁：總覽 / 收入明細 / 支出明細 / 銀行明細 / 管理費 / 報表匯出 / 收入名單 / 支出名單 / 設定
 * Firestore：
 *   communities/{cid}/financeTx/{id}          收支明細（kind: income | expense）
 *   communities/{cid}/financeBooks/{id}       帳本（活存／定存／現金／其他）
 *   communities/{cid}/financeBank/{id}        帳本存入／提出紀錄（bookId 指向帳本）
 *   communities/{cid}/financeFee/{userId}     住戶每月管理費金額
 *   communities/{cid}/financeConfig/config    類別、帳本類型與對象名單設定
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
      ".fin-toolbar .field > label{font-size:11px;font-weight:800;color:#6b7280;}",
      ".fin-toolbar input,.fin-toolbar select{padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);font-weight:700;width:100%;}",
      ".fin-stat-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));}",
      ".fin-stat{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(17,24,39,.10);box-shadow:0 8px 22px rgba(17,24,39,.05);}",
      ".fin-stat .k{font-size:11px;font-weight:800;color:#6b7280;}",
      ".fin-stat .v{margin-top:4px;font-size:20px;font-weight:900;letter-spacing:.3px;}",
      ".fin-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:14px;border:1px solid rgba(17,24,39,.10);background:#fff;}",
      ".fin-table{width:100%;border-collapse:collapse;min-width:640px;}",
      ".fin-table th,.fin-table td{padding:10px 12px;font-size:13px;text-align:left;border-bottom:1px solid rgba(17,24,39,.08);white-space:nowrap;}",
      ".fin-table th{background:#f9fafb;font-weight:900;color:#374151;font-size:12px;}",
      ".fin-table tbody tr:last-child td{border-bottom:none;}",
      ".fin-table td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:800;}",
      ".fin-table .ops{display:flex;gap:6px;}",
      ".fin-tag{display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:999px;font-size:12px;font-weight:900;}",
      ".fin-empty{padding:26px;text-align:center;color:#6b7280;font-weight:700;}",
      ".fin-cfg-block{border:1px solid rgba(17,24,39,.10);border-radius:16px;background:#fff;padding:12px 14px;display:grid;gap:10px;box-shadow:0 8px 22px rgba(17,24,39,.04);}",
      ".fin-cfg-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
      ".fin-cfg-title{font-size:13px;font-weight:900;color:#374151;}",
      ".fin-chips{display:flex;flex-wrap:wrap;gap:8px;}",
      ".fin-chip{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 6px 0 12px;border-radius:999px;background:#f3f4f6;border:1px solid rgba(17,24,39,.10);font-size:12px;font-weight:800;color:#374151;}",
      ".fin-chip-x{width:20px;height:20px;border:0;padding:0;border-radius:50%;background:rgba(220,38,38,.12);color:#b91c1c;font-size:14px;line-height:1;font-weight:900;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}",
      ".fin-chip-x:hover{background:rgba(220,38,38,.24);}",
      ".fin-cfg-add{display:flex;gap:8px;align-items:center;}",
      ".fin-cfg-add input{flex:1 1 auto;min-width:0;padding:9px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);font-weight:700;}",
      ".fin-hint{font-size:12px;color:#6b7280;font-weight:700;line-height:1.75;}",
      ".fin-table td .ops .btn[disabled]{opacity:.35;pointer-events:none;}",
      "@media (max-width:768px){",
      ".fin-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr));}",
      ".fin-toolbar .field{flex:1 1 140px;}",
      ".fin-table th,.fin-table td{padding:9px 10px;font-size:12px;}",
      "}",
      ".fin-print{position:absolute;left:-99999px;top:0;width:900px;background:#fff;color:#111827;padding:24px;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;}",
      ".fin-print h1{font-size:22px;margin:0 0 6px;}",
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
          '<div style="padding:12px 14px;border-radius:14px;background:rgba(220,38,38,.08);border:1.5px solid rgba(220,38,38,.22);color:#991b1b;font-weight:800;font-size:13px;line-height:1.7;">' +
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
    expenseTargets: []
  };

  /** 收支類型 → 類別設定的 key */
  const CATEGORY_KEYS = {
    income: "incomeCategories",
    expense: "expenseCategories"
  };

  /** 收支類型 → 對象名單設定的 key */
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

    hasPermission: function (role, action) {
      const r = String(role || "").toLowerCase();
      const isAdmin = r === "admin";
      const isManager = r === "manager" || r === "community";
      switch (String(action || "")) {
        case "read":
        case "export":
          return true;
        case "write":
        case "delete":
          return isAdmin || isManager;
        default:
          return false;
      }
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

    /** 儲存類別、帳本類型與對象名單設定 */
    saveConfig: function (db, cid, payload, ctx) {
      return Model.configDoc(db, cid).set({
        incomeCategories: cleanList(payload && payload.incomeCategories),
        expenseCategories: cleanList(payload && payload.expenseCategories),
        bookTypes: cleanList(payload && payload.bookTypes),
        incomeTargets: cleanList(payload && payload.incomeTargets),
        expenseTargets: cleanList(payload && payload.expenseTargets),
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      }, { merge: true });
    },

    saveTx: function (db, cid, payload, ctx) {
      const col = Model.txCol(db, cid);
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
        note: String(payload.note || "").trim(),
        updatedAt: serverTs(),
        updatedBy: { uid: String((ctx && ctx.uid) || ""), name: String((ctx && ctx.name) || "") }
      };
      if (payload.id) {
        return col.doc(String(payload.id)).set(data, { merge: true });
      }
      data.createdAt = serverTs();
      data.createdBy = data.updatedBy;
      return col.doc(genId("ftx")).set(data, { merge: true });
    },

    removeTx: function (db, cid, id) {
      return Model.txCol(db, cid).doc(String(id)).delete();
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
      const data = {
        userId: String(payload.userId || "").trim(),
        unit: String(payload.unit || "").trim(),
        name: String(payload.name || "").trim(),
        amount: toNum(payload.amount, 0),
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

    /** 依期間彙整收支與帳本資料 */
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

      /* 收支明細若指定收款方式（帳本），視為該帳本的存入／提出 */
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
      return sanitizeFilename(communityName) + "_收支報表_" + label + "_" + rng + ".xlsx";
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
      return '<h1>收支報表</h1>' +
        '<div class="meta">社區：' + esc(cfg.communityName || "—") +
        "｜期間：" + esc(cfg.rangeLabel || "全部") +
        "（" + esc(agg.from || "全部") + " ~ " + esc(agg.to || "全部") + "）" +
        "｜產製時間：" + esc(nowStamp()) + "</div>" +
        "<h2>總覽</h2>" +
        "<table><tr><th>收入合計</th><th>支出合計</th><th>淨額</th><th>銀行期末餘額</th></tr>" +
        "<tr><td>" + fmtMoney(agg.totalIncome) + "</td><td>" + fmtMoney(agg.totalExpense) + "</td><td>" +
        fmtMoney(agg.net) + "</td><td>" + fmtMoney(agg.bankBalance) + "</td></tr></table>" +
        "<h2>分類統計</h2>" +
        "<table><tr><th>類型</th><th>類別</th><th>金額</th><th>佔比</th></tr>" +
        rows(catRows(agg.incomeByCat, "收入").concat(catRows(agg.expenseByCat, "支出")), 4) + "</table>" +
        "<h2>月報表</h2>" +
        "<table><tr><th>月份</th><th>收入</th><th>支出</th><th>淨額</th></tr>" + rows(monthRows, 4) + "</table>" +
        "<h2>銀行明細</h2>" +
        "<table><tr><th>日期</th><th>帳本</th><th>摘要</th><th>存入</th><th>提出</th><th>餘額</th></tr>" + rows(bankRows, 6) + "</table>";
    },

    toPdf: async function (opts) {
      const cfg = opts || {};
      const h2c = window.html2canvas;
      const printEl = document.createElement("div");
      printEl.className = "fin-print";
      printEl.innerHTML = Export.buildPrintHtml(cfg);
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
        const dataUri = pdf.output("datauristring");
        const filename = sanitizeFilename(cfg.communityName) + "_收支報表_" +
          sanitize(cfg.rangeLabel || "全部") + "_" + (cfg.agg && cfg.agg.from ? cfg.agg.from : "全部") + ".pdf";
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

    printFallback: function (node) {
      try {
        const w = window.open("", "_blank");
        if (!w) {
          toast("無法開啟列印視窗，請確認瀏覽器允許彈出視窗", true);
          return;
        }
        w.document.write('<html><head><title>收支報表</title></head><body>' +
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

  function monthRange(offset) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + (offset || 0));
    const from = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-01";
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const to = end.getFullYear() + "-" + pad2(end.getMonth() + 1) + "-" + pad2(end.getDate());
    return { from: from, to: to };
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

  function quarterRange() {
    const d = new Date();
    const q = Math.floor(d.getMonth() / 3);
    const start = new Date(d.getFullYear(), q * 3, 1);
    const end = new Date(d.getFullYear(), q * 3 + 3, 0);
    return {
      from: start.getFullYear() + "-" + pad2(start.getMonth() + 1) + "-01",
      to: end.getFullYear() + "-" + pad2(end.getMonth() + 1) + "-" + pad2(end.getDate())
    };
  }

  function yearRange() {
    const y = new Date().getFullYear();
    return { from: y + "-01-01", to: y + "-12-31" };
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
        activeBookId: "",
        filters: {
          income: { month: "", category: "", q: "" },
          expense: { month: "", category: "", q: "" },
          bank: { month: todayStr().slice(0, 7), q: "" }
        },
        report: { preset: "month", from: monthRange(0).from, to: monthRange(0).to },
        config: {
          incomeCategories: DEFAULT_CONFIG.incomeCategories.slice(),
          expenseCategories: DEFAULT_CONFIG.expenseCategories.slice(),
          bookTypes: DEFAULT_CONFIG.bookTypes.slice()
        },
        configUpdatedAt: "",
        residents: [],
        unsubTx: null,
        unsubBank: null,
        unsubBooks: null,
        unsubFees: null,
        unsubCfg: null,
        unsubResidents: null
      };

      const cleanup = function () {
        if (state.unsubTx) { try { state.unsubTx(); } catch (e) { /* 忽略 */ } state.unsubTx = null; }
        if (state.unsubBank) { try { state.unsubBank(); } catch (e) { /* 忽略 */ } state.unsubBank = null; }
        if (state.unsubBooks) { try { state.unsubBooks(); } catch (e) { /* 忽略 */ } state.unsubBooks = null; }
        if (state.unsubFees) { try { state.unsubFees(); } catch (e) { /* 忽略 */ } state.unsubFees = null; }
        if (state.unsubCfg) { try { state.unsubCfg(); } catch (e) { /* 忽略 */ } state.unsubCfg = null; }
        if (state.unsubResidents) { try { state.unsubResidents(); } catch (e) { /* 忽略 */ } state.unsubResidents = null; }
      };
      window.__nwFinanceCleanup = cleanup;

      /** 讀取設定值（無自訂資料時退回預設） */
      const cfgList = function (key) {
        const arr = state.config ? state.config[key] : null;
        return Array.isArray(arr) ? arr : (DEFAULT_CONFIG[key] || []).slice();
      };

      const currentConfig = function () {
        return {
          incomeCategories: cfgList("incomeCategories").slice(),
          expenseCategories: cfgList("expenseCategories").slice(),
          bookTypes: cfgList("bookTypes").slice(),
          incomeTargets: cfgList("incomeTargets").slice(),
          expenseTargets: cfgList("expenseTargets").slice()
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
              note: String(v.note || "")
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
          toast("收支資料讀取失敗：" + (err && err.message ? err.message : "請檢查權限"), true);
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

      const subscribeConfig = function () {
        state.unsubCfg = Model.configDoc(db, cid).onSnapshot(function (snap) {
          const v = (snap && snap.exists && snap.data()) || null;
          state.config = {
            incomeCategories: v && Array.isArray(v.incomeCategories) ? v.incomeCategories.slice() : DEFAULT_CONFIG.incomeCategories.slice(),
            expenseCategories: v && Array.isArray(v.expenseCategories) ? v.expenseCategories.slice() : DEFAULT_CONFIG.expenseCategories.slice(),
            bookTypes: v && Array.isArray(v.bookTypes) ? v.bookTypes.slice() : DEFAULT_CONFIG.bookTypes.slice(),
            incomeTargets: v && Array.isArray(v.incomeTargets) ? v.incomeTargets.slice() : [],
            expenseTargets: v && Array.isArray(v.expenseTargets) ? v.expenseTargets.slice() : []
          };
          state.configUpdatedAt = v ? tsToStr(v.updatedAt) : "";
          render();
        }, function (err) {
          console.warn("[finance] config subscribe failed", err);
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

      /** 收支紀錄是否歸屬指定月份（有填沖銷月份時以沖銷月份為準，否則看日期） */
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
          const got = toNum(paid[r.label] || 0, 0);
          due += amount;
          received += Math.min(got, amount);
          rows.push({
            unit: String(r.unit || ""),
            name: String(r.name || ""),
            label: String(r.label || ""),
            amount: amount,
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

      /* ---------------- 資料篩選 ---------------- */

      const filterTx = function (kind) {
        const f = state.filters[kind] || {};
        const q = String(f.q || "").toLowerCase();
        return state.tx.filter(function (t) {
          if (kind === "expense" ? t.kind !== "expense" : t.kind === "expense") return false;
          if (f.month && String(t.date || "").slice(0, 7) !== f.month) return false;
          if (f.category && t.category !== f.category) return false;
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

      /** 收支明細所對應的帳本 ID（優先用 bookId，舊資料則以帳本名稱比對） */
      const txBookId = function (t) {
        if (!t) return "";
        const explicit = String(t.bookId || "");
        if (explicit) return explicit;
        const name = String(t.method || "");
        if (!name) return "";
        const bk = state.books.find(function (x) { return String(x.name || "") === name; });
        return bk ? String(bk.id) : "";
      };

      /** 收支明細換算為帳本流水（收入＝存入、支出＝提出） */
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

      /** 該帳本全部紀錄（帳本紀錄＋收支明細，含全量計算的逐筆餘額，新到舊） */
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
        /* 帳本紀錄＋指定收款方式的收支明細（收入＝存入、支出＝提出） */
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
        const tabTitle = tabMeta.label || "收支報表";
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
          "<h2>收支報表" + (cName ? "｜" + esc(cName) : "") + "</h2>" +
          "<p>" + esc(tabTitle) + "：" + esc(tabDesc) + "</p>" +
          "</div>" +
          "</div>" +
          '<div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">' +
          '<div class="tag red" title="記錄筆數">' + (state.tx.length + state.bank.length + state.books.length + state.fees.length) + "</div>" +
          (canWrite ? "" : '<span class="fin-tag" style="background:rgba(107,114,128,.12);color:#4b5563;">唯讀</span>') +
          "</div>" +
          "</div>" +
          '<div class="card-bd">' + body + "</div>" +
          "</section>";

        bindEvents();
      };

      /* ---------------- 收支面板（收入 / 支出共用） ---------------- */

      const renderTxPanel = function (kind) {
        const meta = KIND[kind];
        const f = state.filters[kind];
        const list = filterTx(kind);
        const total = sumAmount(list);
        const monthTotal = sumAmount(list.filter(function (t) {
          return String(t.date || "").slice(0, 7) === todayStr().slice(0, 7);
        }));
        const cats = cfgList(CATEGORY_KEYS[kind] || "incomeCategories");
        return "" +
          '<div class="fin-toolbar">' +
          '<div class="field"><label>月份</label><input type="month" data-fin-filter="' + kind + '" data-fin-key="month" value="' + esc(f.month) + '"/></div>' +
          '<div class="field"><label>類別</label><select data-fin-filter="' + kind + '" data-fin-key="category">' +
          '<option value="">全部類別</option>' +
          cats.map(function (c) {
            return '<option value="' + esc(c) + '"' + (f.category === c ? " selected" : "") + ">" + esc(c) + "</option>";
          }).join("") +
          "</select></div>" +
          '<div class="field" style="flex:1 1 180px;position:relative;">' +
          '<label>關鍵字</label>' +
          '<input type="search" data-fin-filter="' + kind + '" data-fin-key="q" value="' + esc(f.q) + '" placeholder="類別 / 對象 / 單據 / 備註"/>' +
          "</div>" +
          '<button class="btn btn-ghost" type="button" data-fin-clear="' + kind + '">清除</button>' +
          (canWrite ? '<button class="btn btn-primary" type="button" data-fin-add="' + kind + '">＋ 新增' + esc(meta.label) + "</button>" : "") +
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
        return '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
          "<th>日期</th><th>沖銷月份</th><th>類別</th><th>對象</th><th>金額</th><th>收款方式</th><th>單據編號</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          list.map(function (t) {
            return "<tr>" +
              "<td>" + esc(t.date) + "</td>" +
              "<td>" + esc((t.months && t.months.length) ? t.months.join("、") : "—") + "</td>" +
              '<td><span class="fin-tag" style="background:' + meta.bg + ";color:" + meta.color + ';">' + esc(t.category || "未分類") + "</span></td>" +
              "<td>" + esc(t.target || "—") + "</td>" +
              '<td class="num" style="color:' + meta.color + ';">' + (kind === "expense" ? "-" : "+") + fmtMoney(t.amount) + "</td>" +
              "<td>" + esc(t.method || "—") + "</td>" +
              "<td>" + esc(t.receiptNo || "—") + "</td>" +
              "<td>" + esc(t.note || "—") + "</td>" +
              '<td><div class="ops">' +
              (canWrite ? '<button class="btn btn-sm" type="button" data-fin-edit="' + esc(t.id) + '">編輯</button>' : "") +
              (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-del="' + esc(t.id) + '">刪除</button>' : "") +
              (!canWrite && !canDelete ? '<span style="color:#9ca3af;font-size:12px;">唯讀</span>' : "") +
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
        return '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
          "<th>帳本名稱</th><th>類型</th><th>期初餘額</th><th>存入</th><th>提出</th><th>期末餘額</th><th>筆數</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          books.map(function (bk) {
            const m = agg[bk.id] || { opening: 0, inSum: 0, outSum: 0, count: 0, balance: 0 };
            return "<tr>" +
              "<td>" + esc(bk.name || "未命名帳本") + "</td>" +
              '<td><span class="fin-tag" style="background:rgba(29,78,216,.12);color:#1d4ed8;">' + esc(bk.type || "未分類") + "</span></td>" +
              '<td class="num">' + fmtMoney(m.opening) + "</td>" +
              '<td class="num" style="color:#15803d;">' + (m.inSum ? fmtMoney(m.inSum) : "—") + "</td>" +
              '<td class="num" style="color:#b91c1c;">' + (m.outSum ? fmtMoney(m.outSum) : "—") + "</td>" +
              '<td class="num" style="font-weight:900;">' + fmtMoney(m.balance) + "</td>" +
              '<td class="num">' + m.count + "</td>" +
              "<td>" + esc(bk.note || "—") + "</td>" +
              '<td><div class="ops">' +
              '<button class="btn btn-sm btn-primary" type="button" data-fin-book-open="' + esc(bk.id) + '">檢視明細</button>' +
              (canWrite ? '<button class="btn btn-sm" type="button" data-fin-book-edit="' + esc(bk.id) + '">編輯</button>' : "") +
              (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-book-del="' + esc(bk.id) + '">刪除</button>' : "") +
              (!canWrite && !canDelete ? '<span style="color:#9ca3af;font-size:12px;">唯讀</span>' : "") +
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
        return '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
          "<th>日期</th><th>摘要</th><th>存入</th><th>提出</th><th>餘額</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          list.map(function (b) {
            const isTx = Boolean(b.fromTx);
            const inner = isTx
              ? (canWrite ? '<button class="btn btn-sm" type="button" data-fin-edit="' + esc(b.txId) + '">編輯</button>' : "") +
                (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-del="' + esc(b.txId) + '">刪除</button>' : "")
              : (canWrite ? '<button class="btn btn-sm" type="button" data-fin-edit-bank="' + esc(b.id) + '">編輯</button>' : "") +
                (canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-del-bank="' + esc(b.id) + '">刪除</button>' : "");
            return "<tr>" +
              "<td>" + esc(b.date) + "</td>" +
              '<td>' + (isTx ? '<span class="fin-tag" style="background:rgba(29,78,216,.12);color:#1d4ed8;margin-right:6px;">收支</span>' : "") +
              esc(b.summary || "—") + "</td>" +
              '<td class="num" style="color:#15803d;">' + (toNum(b.deposit, 0) ? fmtMoney(b.deposit) : "—") + "</td>" +
              '<td class="num" style="color:#b91c1c;">' + (toNum(b.withdraw, 0) ? fmtMoney(b.withdraw) : "—") + "</td>" +
              '<td class="num">' + fmtMoney(b.balance) + "</td>" +
              "<td>" + esc(b.note || "—") + "</td>" +
              '<td><div class="ops">' + (inner || '<span style="color:#9ca3af;font-size:12px;">唯讀</span>') + "</div></td>" +
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
        const unpaidRows = fee.unpaid.slice(0, 30).map(function (x) {
          return "<tr>" +
            "<td>" + esc(x.unit || "—") + "</td>" +
            "<td>" + esc(x.name || "—") + "</td>" +
            '<td class="num">' + fmtMoney(x.amount) + "</td>" +
            '<td class="num" style="color:#15803d;">' + (x.paid ? fmtMoney(x.paid) : "—") + "</td>" +
            '<td class="num" style="color:#b91c1c;font-weight:900;">' + fmtMoney(x.owe) + "</td>" +
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
          "<h3 style=\"margin:6px 0 0;font-size:14px;\">未繳管理費住戶（" + fee.unpaid.length + " 戶）</h3>" +
          '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
          "<th>戶號</th><th>姓名</th><th>管理費</th><th>已繳</th><th>尚欠</th>" +
          "</tr></thead><tbody>" +
          (unpaidRows || '<tr><td colspan="5" class="fin-empty">' +
            (fee.due > 0 ? "本月管理費已全數收齊。" : "尚未設定住戶管理費金額，請至「管理費」子分頁設定。") + "</td></tr>") +
          "</tbody></table></div>" +
          (fee.unpaid.length > 30 ? '<div class="fin-hint">僅列出前 30 戶，其餘請至「管理費」子分頁查看。</div>' : "");
      };

      /* ---------------- 管理費 ---------------- */

      const renderFeesPanel = function () {
        const mm = todayStr().slice(0, 7);
        const paid = paidByTarget(mm);
        const rows = state.residents.map(function (r) {
          const f = feeOf(r.id);
          const amount = f ? toNum(f.amount, 0) : 0;
          return {
            id: r.id,
            unit: String(r.unit || ""),
            name: String(r.name || ""),
            committee: Boolean(r.isCommittee),
            amount: amount,
            note: f ? String(f.note || "") : "",
            got: toNum(paid[r.label] || 0, 0)
          };
        });
        const total = rows.reduce(function (a, x) { return a + x.amount; }, 0);
        const setCount = rows.filter(function (x) { return x.amount > 0; }).length;
        const collected = rows.reduce(function (a, x) { return a + Math.min(x.got, x.amount); }, 0);

        const body = rows.map(function (x) {
          const ops = canWrite
            ? '<button class="btn btn-sm btn-primary" type="button" data-fin-fee-edit="' + esc(x.id) + '">' +
              (x.amount > 0 ? "編輯" : "設定") + "</button>" +
              (x.amount > 0 && canDelete ? '<button class="btn btn-sm btn-danger" type="button" data-fin-fee-del="' + esc(x.id) + '">清除</button>' : "")
            : '<span style="color:#9ca3af;font-size:12px;">唯讀</span>';
          return "<tr>" +
            "<td>" + esc(x.unit || "—") + "</td>" +
            "<td>" + esc(x.name || "—") +
            (x.committee ? ' <span class="fin-tag" style="background:rgba(245,158,11,.16);color:#b45309;">委員</span>' : "") + "</td>" +
            '<td class="num" style="font-weight:900;">' + (x.amount ? fmtMoney(x.amount) : "未設定") + "</td>" +
            '<td class="num" style="color:#15803d;">' + (x.got ? fmtMoney(x.got) : "—") + "</td>" +
            "<td>" + esc(x.note || "—") + "</td>" +
            '<td><div class="ops">' + ops + "</div></td>" +
            "</tr>";
        }).join("");

        return "" +
          '<div class="fin-toolbar" style="justify-content:space-between;">' +
          '<div class="fin-hint" style="font-weight:800;">住戶名單由住戶造冊帳號自動帶入；每月管理費金額可個別設定。</div>' +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("住戶數", String(rows.length), "#374151") +
          statCard("已設定金額", String(setCount), "#1d4ed8") +
          statCard("每月應收合計", fmtMoney(total), "#15803d") +
          statCard("本月已收（" + mm + "）", fmtMoney(collected), "#b45309") +
          "</div>" +
          '<div class="fin-table-wrap"><table class="fin-table"><thead><tr>' +
          "<th>戶號</th><th>姓名</th><th>每月管理費</th><th>本月已繳</th><th>備註</th>" +
          '<th style="text-align:left;">操作</th></tr></thead><tbody>' +
          (body || '<tr><td colspan="6" class="fin-empty">此社區尚無住戶帳號。住戶需先於住戶造冊建立帳號後才會顯示於此。</td></tr>') +
          "</tbody></table></div>";
      };

      const openFeeModal = function (userId) {
        if (!canWrite) { toast("您沒有修改權限", true); return; }
        const r = state.residents.find(function (x) { return x.id === userId; });
        if (!r) { toast("找不到該住戶", true); return; }
        const f = feeOf(userId);
        const cur = { amount: f ? toNum(f.amount, 0) : "", note: f ? String(f.note || "") : "" };
        const m = openModal({
          title: "管理費設定",
          width: "min(92vw, 480px)",
          bodyHtml:
            '<div style="display:grid;gap:12px;">' +
            '<div style="padding:10px 12px;border-radius:12px;background:rgba(17,24,39,.04);font-weight:800;font-size:13px;">' +
            esc((r.unit || "未填戶號") + "　" + (r.name || "未命名住戶")) + "</div>" +
            field("每月管理費金額 *", '<input type="number" min="0" step="1" id="fin_fee_amount" value="' + esc(cur.amount) + '" style="' + inputStyle + '"/>') +
            field("備註", '<input id="fin_fee_note" value="' + esc(cur.note) + '" style="' + inputStyle + '" placeholder="例如：含車位清潔費"/>') +
            '<div id="fin_fee_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
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

      /* ---------------- 報表面板 ---------------- */

      const renderReportPanel = function () {
        const r = state.report;
        const agg = Model.aggregate(state.tx, state.bank, { from: r.from, to: r.to }, state.books);
        const presets = [
          { id: "month", label: "本月" },
          { id: "lastMonth", label: "上月" },
          { id: "quarter", label: "本季" },
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
        return "" +
          '<div class="fin-toolbar">' +
          presets.map(function (p) {
            return '<button class="btn btn-sm ' + (r.preset === p.id ? "btn-primary" : "btn-ghost") +
              '" type="button" data-fin-preset="' + esc(p.id) + '">' + esc(p.label) + "</button>";
          }).join("") +
          '<div class="field"><label>起日</label><input type="date" data-fin-range="from" value="' + esc(r.from) + '"/></div>' +
          '<div class="field"><label>迄日</label><input type="date" data-fin-range="to" value="' + esc(r.to) + '"/></div>' +
          '<button class="btn" type="button" data-fin-export="report">匯出 Excel</button>' +
          '<button class="btn" type="button" data-fin-pdf="1">匯出 PDF</button>' +
          "</div>" +
          '<div class="fin-stat-grid">' +
          statCard("收入合計", fmtMoney(agg.totalIncome), "#15803d") +
          statCard("支出合計", fmtMoney(agg.totalExpense), "#b91c1c") +
          statCard("淨額", fmtMoney(agg.net), agg.net >= 0 ? "#15803d" : "#b91c1c") +
          statCard("銀行期末餘額", fmtMoney(agg.bankBalance), "#1d4ed8") +
          "</div>" +
          "<h3 style=\"margin:6px 0 0;font-size:14px;\">分類統計</h3>" +
          '<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>類型</th><th>類別</th><th>金額</th><th>佔比</th></tr></thead>' +
          "<tbody>" + (catRows.length ? catRows.join("") : '<tr><td colspan="4" class="fin-empty">無資料</td></tr>') + "</tbody></table></div>" +
          "<h3 style=\"margin:6px 0 0;font-size:14px;\">月報表</h3>" +
          '<div class="fin-table-wrap"><table class="fin-table"><thead><tr><th>月份</th><th>收入</th><th>支出</th><th>淨額</th></tr></thead>' +
          "<tbody>" + (monthRows.length ? monthRows.join("") : '<tr><td colspan="4" class="fin-empty">無資料</td></tr>') + "</tbody></table></div>";
      };

      const statCard = function (k, v, color) {
        return '<div class="fin-stat"><div class="k">' + esc(k) + '</div><div class="v" style="color:' +
          esc(color || "#111827") + ';">' + esc(v) + "</div></div>";
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
            ops = '<span style="color:#9ca3af;font-size:12px;">住戶帳號</span>';
          } else if (canWrite) {
            ops = '<button class="btn btn-sm" type="button" data-fin-tgt-up="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '"' + (row.idx === 0 ? " disabled" : "") + ">↑</button>" +
              '<button class="btn btn-sm" type="button" data-fin-tgt-down="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '"' + (row.idx === manual.length - 1 ? " disabled" : "") + ">↓</button>" +
              '<button class="btn btn-sm" type="button" data-fin-tgt-rename="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '">改名</button>' +
              '<button class="btn btn-sm btn-danger" type="button" data-fin-tgt-del="' + esc(kind) + '" data-fin-tgt-idx="' + row.idx + '">刪除</button>';
          } else {
            ops = '<span style="color:#9ca3af;font-size:12px;">唯讀</span>';
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
              : '<span style="color:#9ca3af;font-size:12px;">唯讀</span>') +
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

      const renderSettingsPanel = function () {
        const updated = state.configUpdatedAt
          ? "最後更新：" + esc(state.configUpdatedAt)
          : "尚未儲存自訂設定，目前使用系統預設值";
        return "" +
          '<div class="fin-toolbar" style="justify-content:space-between;">' +
          '<div class="fin-hint" style="font-weight:800;">' + updated + "</div>" +
          "</div>" +
          '<div style="display:grid;gap:12px;">' +
          renderChipEditor("收入類別", "incomeCategories", "例如：管理費", "#15803d", "套用於收入明細的類別選項。") +
          renderChipEditor("支出類別", "expenseCategories", "例如：水電費", "#b91c1c", "套用於支出明細的類別選項。") +
          renderChipEditor("帳本類型", "bookTypes", "例如：活存", "#7c3aed", "套用於「銀行明細」新增／編輯帳本的「類型」選項。移除既有類型不會改動已建立的帳本。") +
          "</div>" +
          '<div class="fin-hint">「收入名單」會自動帶入住戶造冊中的住戶與委員帳號；收支對象名單請至「收入名單」「支出名單」子分頁維護。以上設定於修改後立即寫入雲端並同步至所有裝置' +
          (canWrite ? "。" : "；您的角色為唯讀，無法修改。") + "</div>";
      };

      /* ---------------- 事件綁定 ---------------- */

      const bindEvents = function () {
        container.querySelectorAll("[data-fin-filter]").forEach(function (el) {
          const kind = el.getAttribute("data-fin-filter");
          const key = el.getAttribute("data-fin-key");
          const handler = function () {
            if (!state.filters[kind]) state.filters[kind] = {};
            state.filters[kind][key] = String(el.value || "");
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
              : { month: "", category: "", q: "" };
            render();
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
            if (id === "month") Object.assign(state.report, monthRange(0));
            else if (id === "lastMonth") Object.assign(state.report, monthRange(-1));
            else if (id === "quarter") Object.assign(state.report, quarterRange());
            else if (id === "year") Object.assign(state.report, yearRange());
            render();
          };
        });

        container.querySelectorAll("[data-fin-range]").forEach(function (el) {
          el.addEventListener("change", function () {
            const key = el.getAttribute("data-fin-range");
            state.report[key] = String(el.value || "");
            state.report.preset = "custom";
            render();
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
          expenseTargets: (next.expenseTargets || []).slice()
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
            '<div id="fin_cfg_rename_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
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
            '<label style="font-size:11px;font-weight:800;color:#6b7280;">沖銷月份（可單選或複選）</label>' +
            '<div style="display:flex;gap:8px;align-items:center;">' +
            '<input type="month" id="fin_tx_month_pick" style="' + inputStyle + '"/>' +
            '<button class="btn btn-sm" type="button" id="fin_tx_month_add" style="white-space:nowrap;">加入</button>' +
            "</div>" +
            '<div class="fin-chips" id="fin_tx_month_chips"></div>' +
            "</div>" +
            field("單據編號", '<input id="fin_tx_receipt" value="' + esc(cur.receiptNo) + '" style="' + inputStyle + '"/>') +
            field("備註", '<textarea id="fin_tx_note" rows="3" style="' + inputStyle + 'resize:vertical;">' + esc(cur.note) + "</textarea>") +
            '<div id="fin_tx_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
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
            chipsEl.innerHTML = '<span style="color:#9ca3af;font-size:12px;font-weight:800;">尚未選擇</span>';
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
            note: String((m.modal.querySelector("#fin_tx_note") || {}).value || "").trim()
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
            '<div id="fin_book_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
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
            '<div id="fin_bk_err" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;background:rgba(211,47,47,.08);color:#9f1c1c;border:1px solid rgba(211,47,47,.22);"></div>' +
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

      const removeTx = function (id) {
        if (!canDelete) { toast("您沒有刪除權限", true); return; }
        const row = state.tx.find(function (t) { return t.id === id; });
        if (!row) return;
        confirmDialog({
          title: "確認刪除收支記錄",
          message: "確定要刪除「" + (KIND[row.kind] || {}).label + "｜" + (row.category || "未分類") + "｜NT$ " +
            fmtMoney(row.amount) + "（" + row.date + "）」嗎？此操作無法復原。",
          okText: "確認刪除"
        }).then(function (ok) {
          if (!ok) return;
          Model.removeTx(db, cid, id).then(function () {
            toast("已刪除");
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
        const presetLabel = { month: "本月", lastMonth: "上月", quarter: "本季", year: "本年", custom: "自訂" }[r.preset] || "自訂";
        Export.toPdf({
          communityName: cName,
          rangeLabel: presetLabel,
          agg: Model.aggregate(state.tx, state.bank, { from: r.from, to: r.to }, state.books)
        }).then(function (ok) {
          if (ok) toast("已產生 PDF");
        });
      };

      /* ---------------- 啟動 ---------------- */

      render();
      subscribeTx();
      subscribeBank();
      subscribeBooks();
      subscribeConfig();
      subscribeResidents();
      subscribeFees();
    }
  };

  const inputStyle = "padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:700;";

  function field(label, controlHtml) {
    return '<div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;font-weight:800;color:#6b7280;">' +
      esc(label) + "</label>" + controlHtml + "</div>";
  }

  window.NwFinance = {
    Model: Model,
    UI: UI,
    Export: Export
  };
})();
