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

  /* 「全部戶號」總覽文件的保留 docId（需與 admin 端發佈時一致；不可使用 __xxx__ 保留形式） */
  const OVERVIEW_DOC_ID = "all-units-overview";

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

  /* 以「日期」為單位分組（YYYY-MM-DD） */
  const dayOf = (rec) => {
    const t = rec && (rec.inAt || rec.createdAt);
    if (t == null || !Number.isFinite(Number(t))) return "";
    const d = new Date(Number(t));
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  const dayText = (day) => {
    const parts = String(day || "").split("-");
    if (parts.length !== 3) return String(day || "");
    return `${parts[0]} 年 ${Number(parts[1])} 月 ${Number(parts[2])} 日`;
  };

  const state = { records: [], byDay: new Map(), days: [], current: "", overview: false, unit: "", units: [] };

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
    const rows = state.byDay.get(state.current) || [];
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "vh-empty";
      empty.textContent = state.unit ? "此戶號當日尚無訪客紀錄。" : "當日尚無訪客紀錄。";
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
      if (state.overview) meta.appendChild(metaRow("戶號", String(r.unit || "")));
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

  const renderUnitSelect = () => {
    const sel = qs("vhUnit");
    const wrap = qs("vhUnitWrap");
    if (!sel) return;
    const show = state.overview && state.units.length > 0;
    if (wrap) wrap.hidden = !show;
    if (!show) return;
    sel.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部戶號";
    sel.appendChild(all);
    state.units.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      sel.appendChild(opt);
    });
    sel.value = state.unit;
  };

  const renderDateSelect = () => {
    const sel = qs("vhDate");
    if (!sel) return;
    sel.innerHTML = "";
    state.days.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = dayText(d);
      sel.appendChild(opt);
    });
    sel.value = state.current;
  };

  const updateDateButtons = () => {
    const idx = state.days.indexOf(state.current);
    const prev = qs("vhPrev");
    const next = qs("vhNext");
    if (prev) prev.disabled = idx < 0 || idx >= state.days.length - 1;
    if (next) next.disabled = idx <= 0;
  };

  const syncUrl = (d) => {
    try {
      const url = new URL(location.href);
      if (d) url.searchParams.set("d", d);
      else url.searchParams.delete("d");
      history.replaceState(null, "", url.toString());
    } catch {}
  };

  /* 依目前戶號篩選重建日期分組 */
  const rebuild = () => {
    const rows = state.unit
      ? state.records.filter((r) => String(r.unit || "").trim() === state.unit)
      : state.records;
    state.byDay = new Map();
    rows.forEach((r) => {
      const d = dayOf(r);
      if (!d) return;
      if (!state.byDay.has(d)) state.byDay.set(d, []);
      state.byDay.get(d).push(r);
    });
    state.byDay.forEach((arr) => arr.sort((a, b) => ((b.inAt || b.createdAt || 0) - (a.inAt || a.createdAt || 0))));
    state.days = Array.from(state.byDay.keys()).sort().reverse();
  };

  const renderAll = () => {
    renderUnitSelect();
    renderDateSelect();
    updateDateButtons();
    renderList();
  };

  const setDay = (d) => {
    if (!state.byDay.has(d)) return;
    state.current = d;
    const sel = qs("vhDate");
    if (sel) sel.value = d;
    updateDateButtons();
    renderList();
    syncUrl(d);
  };

  const setUnit = (u) => {
    state.unit = String(u || "").trim();
    rebuild();
    state.current = state.days[0] || "";
    setStatus(state.days.length ? "" : (state.unit ? "此戶號尚無歷史訪客紀錄。" : "此社區尚無歷史訪客紀錄。"), false);
    renderAll();
    syncUrl(state.current);
  };

  const main = async () => {
    const c = String(getParam("c") || "").trim();
    const u = String(getParam("u") || "").trim();
    const d = String(getParam("d") || "").trim();
    const isOverview = !u;
    state.overview = isOverview;
    const sub = qs("vhSub");
    if (sub) sub.textContent = isOverview ? "全部戶號" : `戶號：${u}`;

    if (!c) {
      setStatus("缺少社區代碼，請確認連結是否完整。", true);
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

      const docId = isOverview ? OVERVIEW_DOC_ID : docIdForUnit(u);
      const collRef = db.collection("communities").doc(c).collection("visitor_history");
      const doc = await collRef.doc(docId).get();
      if (!doc || !doc.exists) {
        setStatus(isOverview ? "查無此社區的歷史訪客資料。" : "查無此戶號的歷史訪客資料。", true);
        return;
      }

      const data = doc.data() || {};
      const unitName = String(data.name || "").trim();
      if (sub) {
        if (isOverview) {
          const cname = String(data.cname || data.communityName || "").trim();
          sub.textContent = cname ? `${cname}／全部戶號` : `社區 ${c}／全部戶號`;
        } else {
          sub.textContent = unitName ? `戶號：${u}（${unitName}）` : `戶號：${u}`;
        }
      }

      /* 資料量大時 admin 會拆成分片文件（{OVERVIEW_DOC_ID}_c0、_c1…），需依序合併 */
      const chunkCount = Number(data.chunks || 0);
      let records = Array.isArray(data.records) ? data.records : [];
      if (chunkCount > 0) {
        const snaps = await Promise.all(
          Array.from({ length: chunkCount }, (_, i) => collRef.doc(`${OVERVIEW_DOC_ID}_c${i}`).get())
        );
        records = snaps.reduce((acc, s) => {
          if (!s || !s.exists) return acc;
          const arr = (s.data() || {}).records;
          return acc.concat(Array.isArray(arr) ? arr : []);
        }, []);
      }

      state.records = records;
      state.unit = "";
      state.units = isOverview
        ? Array.from(new Set(records.map((r) => String(r.unit || "").trim()).filter(Boolean)))
            .sort((a, b) => String(a).localeCompare(String(b), "zh-Hant", { numeric: true }))
        : [];

      rebuild();
      if (!state.days.length) {
        setStatus(isOverview ? "此社區尚無歷史訪客紀錄。" : "此戶號尚無歷史訪客紀錄。", false);
        renderAll();
        return;
      }

      setStatus("", false);
      state.current = state.days.includes(d) ? d : state.days[0];
      renderAll();
      if (state.current !== d) syncUrl(state.current);
    } catch (err) {
      const code = String(err && err.code ? err.code : "");
      setStatus(code.includes("permission-denied") ? "沒有權限讀取資料。" : "讀取失敗，請稍後再試。", true);
    }
  };

  const bind = () => {
    const dateSel = qs("vhDate");
    if (dateSel) dateSel.addEventListener("change", () => setDay(String(dateSel.value || "")));
    const unitSel = qs("vhUnit");
    if (unitSel) unitSel.addEventListener("change", () => setUnit(String(unitSel.value || "")));
    const prev = qs("vhPrev");
    if (prev) prev.addEventListener("click", () => {
      const idx = state.days.indexOf(state.current);
      if (idx >= 0 && idx < state.days.length - 1) setDay(state.days[idx + 1]);
    });
    const next = qs("vhNext");
    if (next) next.addEventListener("click", () => {
      const idx = state.days.indexOf(state.current);
      if (idx > 0) setDay(state.days[idx - 1]);
    });
    main();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
