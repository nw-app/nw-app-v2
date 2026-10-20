(() => {
  const qs = (id) => document.getElementById(id);
  const getParam = (k) => {
    try { return new URL(location.href).searchParams.get(k) || ""; } catch { return ""; }
  };
  const pad2 = (n) => String(n).padStart(2, "0");

  const docIdForUnit = (unit) => {
    let s = String(unit || "").trim().replace(/\//g, "_");
    if (!s || s === "." || s === "..") s = `_${s}`;
    return s;
  };

  const setStatus = (msg, isError) => {
    const el = qs("vhStatus");
    if (!el) return;
    const t = String(msg || "").trim();
    el.textContent = t;
    el.hidden = !t;
    el.classList.toggle("error", Boolean(isError));
  };

  const formatMs = (ms, withTime = true) => {
    if (ms == null || !Number.isFinite(Number(ms))) return "";
    const d = new Date(Number(ms));
    if (!Number.isFinite(d.getTime())) return "";
    const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    return withTime ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date;
  };

  const statusLabel = (raw) => {
    const k = String(raw || "").toLowerCase();
    if (k === "approved") return "已核准";
    if (k === "pending") return "待審核";
    if (k === "cancelled" || k === "canceled") return "已取消";
    if (k === "rejected") return "已拒絕";
    return String(raw || "") || "—";
  };

  const monthOf = (rec) => {
    const t = rec && (rec.inAt || rec.createdAt);
    if (t == null || !Number.isFinite(Number(t))) return "";
    const d = new Date(Number(t));
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  };

  const state = { byMonth: new Map(), months: [], current: "" };

  const metaRow = (k, v) => {
    const row = document.createElement("div");
    row.className = "vh-meta-row";
    const kk = document.createElement("span");
    kk.className = "vh-k";
    kk.textContent = k;
    const vv = document.createElement("span");
    vv.className = "vh-v";
    vv.textContent = String(v == null || v === "" ? "—" : v);
    row.appendChild(kk);
    row.appendChild(vv);
    return row;
  };

  const renderList = () => {
    const list = qs("vhList");
    if (!list) return;
    list.innerHTML = "";
    const rows = state.byMonth.get(state.current) || [];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "vh-empty";
      empty.textContent = "此月份尚無訪客紀錄。";
      list.appendChild(empty);
      return;
    }
    rows.forEach((r) => {
      const card = document.createElement("article");
      card.className = "vh-item";

      const top = document.createElement("div");
      top.className = "vh-item-top";
      const name = document.createElement("div");
      name.className = "vh-name";
      name.textContent = String(r.name || "—");
      top.appendChild(name);
      const badge = document.createElement("span");
      badge.className = "vh-badge";
      badge.textContent = statusLabel(r.status);
      top.appendChild(badge);
      card.appendChild(top);

      const meta = document.createElement("div");
      meta.className = "vh-meta";
      meta.appendChild(metaRow("來訪", formatMs(r.inAt)));
      meta.appendChild(metaRow("離開", formatMs(r.outAt)));
      meta.appendChild(metaRow("事由", String(r.purpose || "")));
      meta.appendChild(metaRow("人數", r.partySize != null ? String(r.partySize) : "1"));
      meta.appendChild(metaRow("手機", String(r.phone || "")));
      meta.appendChild(metaRow("車牌", String(r.plate || "")));
      card.appendChild(meta);

      list.appendChild(card);
    });
  };

  const renderMonthSelect = () => {
    const sel = qs("vhMonth");
    if (!sel) return;
    sel.innerHTML = "";
    state.months.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = `${m.replace("-", " 年 ")} 月`;
      sel.appendChild(opt);
    });
    sel.value = state.current;
  };

  const updateMonthButtons = () => {
    const idx = state.months.indexOf(state.current);
    const prev = qs("vhPrev");
    const next = qs("vhNext");
    if (prev) prev.disabled = idx < 0 || idx >= state.months.length - 1;
    if (next) next.disabled = idx <= 0;
  };

  const syncUrl = (m) => {
    try {
      const url = new URL(location.href);
      url.searchParams.set("m", m);
      history.replaceState(null, "", url.toString());
    } catch {}
  };

  const setMonth = (m) => {
    if (!state.byMonth.has(m)) return;
    state.current = m;
    const sel = qs("vhMonth");
    if (sel) sel.value = m;
    updateMonthButtons();
    renderList();
    syncUrl(m);
  };

  const main = async () => {
    const c = String(getParam("c") || "").trim();
    const u = String(getParam("u") || "").trim();
    const m = String(getParam("m") || "").trim();
    const sub = qs("vhSub");
    if (sub) sub.textContent = u ? `戶號：${u}` : "—";

    if (!c || !u) {
      setStatus("缺少社區代碼或戶號，請確認連結是否完整。", true);
      return;
    }
    if (!window.firebase || !firebase.apps) {
      setStatus("系統尚未就緒，請稍後再試。", true);
      return;
    }

    try {
      if (!firebase.apps.length) {
        if (!window.FIREBASE_CONFIG) {
          setStatus("缺少系統設定。", true);
          return;
        }
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      const db = firebase.firestore();
      setStatus("讀取中...", false);

      const doc = await db.collection("communities").doc(c).collection("visitor_history").doc(docIdForUnit(u)).get();
      if (!doc || !doc.exists) {
        setStatus("查無此戶號的歷史訪客資料。", true);
        return;
      }

      const data = doc.data() || {};
      const unitName = String(data.name || "").trim();
      if (sub) sub.textContent = unitName ? `戶號：${u}（${unitName}）` : `戶號：${u}`;

      const records = Array.isArray(data.records) ? data.records : [];
      state.byMonth = new Map();
      records.forEach((r) => {
        const mm = monthOf(r);
        if (!mm) return;
        if (!state.byMonth.has(mm)) state.byMonth.set(mm, []);
        state.byMonth.get(mm).push(r);
      });
      state.byMonth.forEach((arr) => arr.sort((a, b) => ((b.inAt || b.createdAt || 0) - (a.inAt || a.createdAt || 0))));
      state.months = Array.from(state.byMonth.keys()).sort().reverse();

      if (!state.months.length) {
        setStatus("此戶號尚無歷史訪客紀錄。", false);
        renderMonthSelect();
        updateMonthButtons();
        renderList();
        return;
      }

      setStatus("", false);
      state.current = state.months.includes(m) ? m : state.months[0];
      renderMonthSelect();
      updateMonthButtons();
      renderList();
      if (state.current !== m) syncUrl(state.current);
    } catch (err) {
      const code = String(err && err.code ? err.code : "");
      setStatus(code.includes("permission-denied") ? "沒有權限讀取資料。" : "讀取失敗，請稍後再試。", true);
    }
  };

  const bind = () => {
    const sel = qs("vhMonth");
    if (sel) sel.addEventListener("change", () => setMonth(String(sel.value || "")));
    const prev = qs("vhPrev");
    if (prev) prev.addEventListener("click", () => {
      const idx = state.months.indexOf(state.current);
      if (idx >= 0 && idx < state.months.length - 1) setMonth(state.months[idx + 1]);
    });
    const next = qs("vhNext");
    if (next) next.addEventListener("click", () => {
      const idx = state.months.indexOf(state.current);
      if (idx > 0) setMonth(state.months[idx - 1]);
    });
    main();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
