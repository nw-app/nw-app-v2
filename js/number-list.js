/* global firebase */
(function () {
  "use strict";

  const MR = (typeof window.NwMeterReading !== "undefined" && window.NwMeterReading) || null;

  function normalizeMeterTypes(raw) {
    if (!raw || typeof raw !== "object") return null;
    const vals = Object.values(raw);
    if (!vals.length) return null;
    const first = vals[0];
    if (first && typeof first.id === "string") {
      const out = {};
      const shortMap = { electric: "電", water: "水", gas: "瓦斯" };
      const dotMap = { electric: "橘", water: "藍", gas: "紅" };
      for (const v of vals) {
        const k = String(v.id || "").trim().toLowerCase();
        if (!k) continue;
        out[k] = {
          key: k,
          label: `${v.icon || ""} ${v.name || k}`.trim(),
          short: shortMap[k] || (v.name || k).slice(0, 1),
          digits: Number(v.digits) || (k === "electric" ? 6 : 5),
          dot: dotMap[k] || "—",
          accent: String(v.color || "#6b7280"),
        };
      }
      return Object.keys(out).length ? out : null;
    }
    return raw;
  }

  const FALLBACK_METER_TYPES = {
    electric: { key: "electric", label: "⚡ 電錶", short: "電", digits: 6, dot: "橘", accent: "#ea580c" },
    water: { key: "water", label: "💧 自來水錶", short: "水", digits: 5, dot: "藍", accent: "#2563eb" },
    gas: { key: "gas", label: "🔥 天然氣瓦斯錶", short: "瓦斯", digits: 5, dot: "紅", accent: "#dc2626" },
  };

  const METER_TYPES = normalizeMeterTypes(MR ? MR.METER_TYPES : null) || FALLBACK_METER_TYPES;

  const state = {
    user: null,
    communityId: (sessionStorage.getItem("csp_last_cid") || "").trim() || "default",
    houseNo: "—",
    displayName: "",
    uid: "",
    records: [],
    lastByType: {},
    selectedDetailId: null,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const pad2 = (n) => String(n).padStart(2, "0");
  const ymd = (d) => { const dt = d || new Date(); return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`; };
  const ym = (d) => { const dt = d || new Date(); return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`; };
  const numOr = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

  function toast(msg, ms) {
    let t = document.getElementById("toastInline");
    if (!t) {
      t = document.createElement("div");
      t.id = "toastInline";
      Object.assign(t.style, {
        position: "fixed", left: "50%", bottom: "88px", transform: "translateX(-50%)",
        background: "rgba(17,24,39,0.92)", color: "#fff", padding: "10px 16px", borderRadius: "999px",
        fontSize: "13px", fontWeight: "800", zIndex: "9999", opacity: "0", transition: "opacity 180ms ease",
        maxWidth: "90vw", textAlign: "center", pointerEvents: "none",
      });
      document.body.appendChild(t);
    }
    t.textContent = String(msg || "");
    t.style.opacity = "1";
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => { t.style.opacity = "0"; }, Number.isFinite(ms) ? ms : 1800);
  }

  function statusBox(el, msg, isError) {
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = String(msg || "");
    el.style.background = isError ? "rgba(185,28,28,0.10)" : "rgba(46,125,50,0.10)";
    el.style.color = isError ? "#9f1c1c" : "#15803d";
    el.style.borderRadius = "12px";
    el.style.padding = "10px 12px";
    el.style.fontWeight = "800";
    el.style.fontSize = "13px";
  }

  async function loadUserProfile(user) {
    const auth = firebase.auth();
    const db = firebase.firestore();
    const uid = user ? String(user.uid || "") : "";
    state.uid = uid;
    state.user = user || null;
    state.displayName = String((user && user.displayName) || "").trim();
    if (!uid) return;
    try {
      const snap = await db.collection("users").doc(uid).get();
      const d = (snap && snap.exists && snap.data()) || {};
      state.communityId = String(d.community || state.communityId || sessionStorage.getItem("csp_last_cid") || "default").trim() || "default";
      state.houseNo = String(d.houseNo || d.unit || state.houseNo || "").trim() || "—";
      state.displayName = String(d.displayName || d.name || state.displayName || (user && user.displayName) || "").trim();
      try { sessionStorage.setItem("csp_last_cid", state.communityId); } catch {}
    } catch (e) {
      console.warn("[number-list] loadUserProfile failed", e);
    }
  }

  function defaultMeterId(type) {
    const prefix = type === "electric" ? "E" : type === "water" ? "W" : "G";
    const safe = String(state.houseNo || "X").replace(/[^A-Za-z0-9\-]/g, "") || "X";
    return `${prefix}-${safe}-01`;
  }

  async function loadLastRecords() {
    if (!MR || !MR.listRecordsByHouse || !state.uid) return;
    const db = firebase.firestore();
    try {
      const list = await MR.listRecordsByHouse(db, state.communityId, state.houseNo, { limit: 200 });
      state.records = Array.isArray(list) ? list : [];
      const last = {};
      for (const r of state.records) {
        const t = String(r.meterType || "");
        if (!t) continue;
        if (!last[t] || (r.readingDate && last[t].readingDate && new Date(r.readingDate) > new Date(last[t].readingDate))) {
          last[t] = r;
        }
      }
      state.lastByType = last;
    } catch (e) {
      console.warn("[number-list] loadLastRecords failed", e);
    }
  }

  function meterCardHtml(typeKey) {
    const mt = METER_TYPES[typeKey] || METER_TYPES.electric;
    const last = state.lastByType[typeKey] || null;
    const meterId = last && last.meterId ? String(last.meterId) : defaultMeterId(typeKey);
    const prev = last && Number.isFinite(numOr(last.currentValue)) ? numOr(last.currentValue) : 0;
    return `
      <div class="nl-meter-card" data-meter="${esc(typeKey)}">
        <div class="nl-meter-head">
          <div class="nl-meter-title">
            <div class="dot" style="background:${esc(mt.accent)};"></div>
            <div>${esc(mt.label)}</div>
          </div>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:13px; color:#6b7280; font-weight:800;">
            <input type="checkbox" data-meter-skip="${esc(typeKey)}" />
            本期不申報
          </label>
        </div>
        <div class="nl-meter-fields">
          <div class="field">
            <label>儀表編號</label>
            <input type="text" data-meter-id="${esc(typeKey)}" value="${esc(meterId)}" placeholder="${esc(defaultMeterId(typeKey))}" autocomplete="off" />
          </div>
          <div class="field">
            <label>對應門牌號</label>
            <input type="text" value="${esc(state.houseNo)}" readonly style="background:#f3f4f6; color:#374151;" />
          </div>
          <div class="field">
            <label>上次抄表數值</label>
            <input type="number" min="0" step="1" data-meter-prev="${esc(typeKey)}" value="${prev}" readonly style="background:#f3f4f6; color:#374151;" />
          </div>
          <div class="field">
            <label>本次抄表數字（${esc(mt.digits)}位以內）</label>
            <input type="number" min="0" step="1" data-meter-cur="${esc(typeKey)}" maxlength="${esc(mt.digits)}" placeholder="請輸入本次抄見的${esc(mt.short)}數字" autocomplete="off" />
          </div>
        </div>
        <div class="nl-preview-box" data-meter-preview="${esc(typeKey)}" hidden></div>
      </div>
    `;
  }

  function renderMeterArea() {
    const area = $("nlMeterArea");
    if (!area) return;
    if (!state.uid || !state.user) {
      area.innerHTML = `<div class="nl-empty">請先登入社區帳號，再進行抄錶申報。</div>`;
      return;
    }
    area.innerHTML = Object.keys(METER_TYPES).map(meterCardHtml).join("");
  }

  function readSubmitForm() {
    const period = String($("nlPeriod") && $("nlPeriod").value || ym()).trim() || ym();
    const dateStr = String($("nlReadDate") && $("nlReadDate").value || ymd()).trim() || ymd();
    const readingDate = new Date(`${dateStr}T00:00:00`);
    const out = [];
    for (const t of Object.keys(METER_TYPES)) {
      const skip = document.querySelector(`[data-meter-skip="${CSS.escape(t)}"]`);
      if (skip && skip.checked) continue;
      const curEl = document.querySelector(`[data-meter-cur="${CSS.escape(t)}"]`);
      if (!curEl) continue;
      const curVal = curEl.value === "" ? null : numOr(curEl.value, NaN);
      if (curVal == null || !Number.isFinite(curVal)) continue;
      const idEl = document.querySelector(`[data-meter-id="${CSS.escape(t)}"]`);
      const prevEl = document.querySelector(`[data-meter-prev="${CSS.escape(t)}"]`);
      out.push({
        meterType: t,
        meterId: String(idEl && idEl.value ? idEl.value : defaultMeterId(t)).trim() || defaultMeterId(t),
        previousValue: numOr(prevEl && prevEl.value, 0),
        currentValue: curVal,
        houseNo: String(state.houseNo || "—").trim() || "—",
        period,
        readingDate,
        operatorId: state.uid,
        source: "resident_app",
      });
    }
    return out;
  }

  function setPreviewBox(t, row) {
    const box = document.querySelector(`[data-meter-preview="${CSS.escape(t)}"]`);
    if (!box) return;
    if (!row) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `
      <div>本期用量：${row.usage} 度</div>
      <div>計算費用：<span class="fee-total">NT$ ${row.feeText}</span></div>
      ${row.abnormal && row.abnormal.length ? `<div style="color:#9f1c1c;">⚠ ${esc(row.abnormal.join("、"))}</div>` : ""}
    `;
  }

  function previewAll() {
    if (!MR) { toast("抄錶模組尚未載入"); return; }
    const rows = readSubmitForm();
    if (!rows.length) { toast("尚未填寫任何儀表數字"); return; }
    for (const r of rows) {
      const u = MR.calcUsage ? MR.calcUsage(r.previousValue, r.currentValue, { meterType: r.meterType }) : Math.max(0, r.currentValue - r.previousValue);
      const f = MR.calcFee ? MR.calcFee(u, r.meterType) : 0;
      const ab = MR.detectAbnormal ? MR.detectAbnormal({ ...r, usage: u }, null) || [] : [];
      setPreviewBox(r.meterType, {
        usage: u,
        feeText: Number.isFinite(f) ? f.toFixed(2) : "0.00",
        abnormal: ab,
      });
    }
    statusBox($("nlSubmitStatus"), "已更新費用預覽", false);
  }

  async function submitAll() {
    if (!MR || !MR.createRecord) { toast("抄錶模組尚未載入"); return; }
    if (!state.uid) { toast("請先登入"); return; }
    const rows = readSubmitForm();
    if (!rows.length) { toast("請至少填寫一項儀表數字再送出"); return; }
    const statusEl = $("nlSubmitStatus");
    const btn = $("btnSubmitReadings");
    if (btn) { btn.disabled = true; btn.style.opacity = "0.7"; btn.style.cursor = "wait"; }
    statusBox(statusEl, "申報中，請稍候...", false);
    const db = firebase.firestore();
    let ok = 0;
    let fail = 0;
    const errs = [];
    try {
      for (const r of rows) {
        try {
          const patch = {
            meterId: r.meterId,
            houseNo: r.houseNo,
            meterType: r.meterType,
            previousValue: r.previousValue,
            currentValue: r.currentValue,
            readingDate: r.readingDate,
            period: r.period,
            operatorId: r.operatorId,
            residentUid: state.uid,
            residentName: state.displayName,
            source: r.source || "resident_app",
          };
          await MR.createRecord(db, state.communityId, patch);
          ok += 1;
        } catch (e) {
          fail += 1;
          errs.push(`${METER_TYPES[r.meterType].short}：${(e && e.message) ? e.message : "儲存失敗"}`);
        }
      }
    } catch (e) {
      console.warn(e);
    }
    if (btn) { btn.disabled = false; btn.style.opacity = ""; btn.style.cursor = ""; }
    await loadLastRecords();
    if (fail === 0) {
      statusBox(statusEl, `申報成功：共 ${ok} 筆已送交後台管理員審核`, false);
      toast(`已送出 ${ok} 筆抄錶申報`);
      switchTab("history");
      renderHistoryList();
    } else {
      statusBox(statusEl, `部分失敗：成功 ${ok} / 失敗 ${fail}\n${errs.join("\n")}`, true);
    }
  }

  function switchTab(name) {
    const root = $("nlTabs");
    if (!root) return;
    root.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", String(b.getAttribute("data-tab") || "") === name));
    ["submit", "history", "fee"].forEach((k) => {
      const el = $(`${k}Tab`);
      if (el) el.classList.toggle("hidden", k !== name);
    });
  }

  function bindTopTabs() {
    const root = $("nlTabs");
    if (!root) return;
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      const tab = String(btn.getAttribute("data-tab") || "");
      switchTab(tab);
      if (tab === "history") renderHistoryList();
      if (tab === "fee") renderFeeArea();
    });
  }

  function currentHistoryFilters() {
    const tabBtns = Array.from(document.querySelectorAll("#historyTab [data-meter-filter]"));
    const active = tabBtns.find((b) => b.classList.contains("active"));
    const meterType = active ? String(active.getAttribute("data-meter-filter") || "all") : "all";
    const f = String($("nlHistFrom") && $("nlHistFrom").value || "").trim();
    const t = String($("nlHistTo") && $("nlHistTo").value || "").trim();
    return { meterType, dateFrom: f ? `${f}-01` : "", dateTo: t ? `${t}-28` : "" };
  }

  function renderHistoryList() {
    const el = $("nlHistoryList");
    if (!el) return;
    if (!state.uid) {
      el.innerHTML = `<div class="nl-empty">請先登入</div>`;
      return;
    }
    const f = currentHistoryFilters();
    let rows = state.records.slice();
    if (f.meterType && f.meterType !== "all") rows = rows.filter((r) => String(r.meterType || "") === f.meterType);
    if (f.dateFrom) {
      const from = new Date(`${f.dateFrom}T00:00:00`).getTime();
      rows = rows.filter((r) => r.readingDate && new Date(r.readingDate).getTime() >= from);
    }
    if (f.dateTo) {
      const to = new Date(`${f.dateTo}T23:59:59`).getTime();
      rows = rows.filter((r) => r.readingDate && new Date(r.readingDate).getTime() <= to);
    }
    rows.sort((a, b) => (new Date(b.readingDate || 0) - new Date(a.readingDate || 0)));
    if (!rows.length) {
      el.innerHTML = `<div class="nl-empty">尚無符合條件的抄錶申報紀錄</div>`;
      return;
    }
    el.innerHTML = rows.map((r) => renderRecordCard(r)).join("");
    el.querySelectorAll("[data-record-id]").forEach((card) => {
      const id = String(card.getAttribute("data-record-id") || "");
      card.style.cursor = "pointer";
      card.addEventListener("click", () => openDetail(id));
    });
  }

  function renderRecordCard(r) {
    const mt = METER_TYPES[r.meterType] || METER_TYPES.electric;
    const statusBadge = (() => {
      const s = String(r.validationStatus || "pending");
      if (s === "valid" || s === "approved") return `<span class="tag green" style="display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font-size:12px; background:rgba(46,125,50,0.12); color:#15803d; border:1px solid rgba(46,125,50,0.25);">已審核</span>`;
      if (s === "abnormal") return `<span class="tag red" style="display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font-size:12px; background:rgba(211,47,47,0.10); color:#9f1c1c; border:1px solid rgba(211,47,47,0.24);">異常</span>`;
      if (s === "disputed") return `<span class="tag yellow" style="display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font-size:12px; background:rgba(245,158,11,0.12); color:#92400e; border:1px solid rgba(245,158,11,0.25);">核異中</span>`;
      if (s === "resolved") return `<span class="tag green" style="display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font-size:12px; background:rgba(37,99,235,0.12); color:#1d4ed8; border:1px solid rgba(37,99,235,0.25);">已處理</span>`;
      return `<span class="tag yellow" style="display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font-size:12px; background:rgba(245,158,11,0.12); color:#92400e; border:1px solid rgba(245,158,11,0.25);">待審核</span>`;
    })();
    const fee = MR && MR.calcFee ? MR.calcFee(numOr(r.usage, 0), r.meterType) : 0;
    const feeText = Number.isFinite(fee) ? fee.toFixed(2) : "0.00";
    const dt = r.readingDate ? (r.readingDate instanceof Date ? r.readingDate : new Date(r.readingDate)) : null;
    const dateText = dt && Number.isFinite(dt.getTime()) ? ymd(dt) : (r.period || ym());
    return `
      <div class="parcel-item" data-record-id="${esc(r.id)}">
        <div style="display:grid; gap:6px; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <div style="display:inline-flex; align-items:center; gap:6px; font-weight:900; min-width:0;">
              <div style="width:10px; height:10px; border-radius:999px; background:${esc(mt.accent)};"></div>
              <div>${esc(mt.label)}</div>
            </div>
            ${statusBadge}
            <div style="font-size:12px; color:#6b7280; font-weight:800;">週期 ${esc(String(r.period || ""))}</div>
          </div>
          <div class="row" style="display:flex; justify-content:space-between; gap:10px; align-items:center; flex-wrap:wrap;">
            <div style="display:grid; gap:2px;">
              <div style="font-size:12px; color:#6b7280;">上次 ${esc(String(r.previousValue||0))} → 本次 <b style="color:#111827;">${esc(String(r.currentValue||0))}</b></div>
              <div style="font-size:12px; color:#6b7280;">用量 ${esc(String(numOr(r.usage, 0)))} 度・抄見日 ${esc(dateText)}</div>
            </div>
            <div style="font-size:18px; font-weight:900; color:#9f1c1c;">NT$ ${esc(feeText)}</div>
          </div>
        </div>
        <div style="font-size:12px; color:#6b7280; font-weight:800; text-align:right;">
          戶號 ${esc(String(r.houseNo||"—"))}
        </div>
      </div>
    `;
  }

  function openDetail(recordId) {
    const r = state.records.find((x) => String(x.id || "") === String(recordId || ""));
    if (!r) return;
    state.selectedDetailId = recordId;
    const body = $("nlDetailBody");
    if (body) {
      const mt = METER_TYPES[r.meterType] || METER_TYPES.electric;
      const fee = MR && MR.calcFee ? MR.calcFee(numOr(r.usage, 0), r.meterType) : 0;
      const dt = r.readingDate && !(r.readingDate instanceof Date) ? new Date(r.readingDate) : r.readingDate;
      body.innerHTML = `
        <div class="field"><label>儀表類型</label><input value="${esc(mt.label)}（${esc(String(r.meterType||""))}）" readonly /></div>
        <div class="field"><label>儀表編號</label><input value="${esc(String(r.meterId||""))}" readonly /></div>
        <div class="field"><label>對應門牌號</label><input value="${esc(String(r.houseNo||""))}" readonly /></div>
        <div class="field"><label>上次抄表數值</label><input value="${esc(String(r.previousValue||0))}" readonly /></div>
        <div class="field"><label>本次抄表數字</label><input value="${esc(String(r.currentValue||0))}" readonly /></div>
        <div class="field"><label>本期用量</label><input value="${esc(String(numOr(r.usage, 0)))} 度" readonly /></div>
        <div class="field"><label>本期應繳費用</label><input value="NT$ ${esc(Number.isFinite(fee) ? fee.toFixed(2) : "0.00")}" readonly /></div>
        <div class="field"><label>抄表日期</label><input value="${esc(dt && Number.isFinite(dt.getTime()) ? ymd(dt) : (r.period || ""))}" readonly /></div>
        <div class="field"><label>繳費週期</label><input value="${esc(String(r.period || ""))}" readonly /></div>
        <div class="field"><label>校驗狀態</label><input value="${esc(String(r.validationStatus || "pending"))}" readonly /></div>
        ${r.abnormalReasons && r.abnormalReasons.length ? `<div class="field"><label>異常標記</label><textarea rows="2" readonly>${esc(r.abnormalReasons.join("、"))}</textarea></div>` : ""}
      `;
    }
    const m = $("nlDetailModal");
    if (m) m.hidden = false;
  }

  let disputePhotos = [];

  function resetDisputeForm() {
    disputePhotos = [];
    const reason = $("nlDisputeReason");
    const photo = $("nlDisputePhoto");
    const preview = $("nlDisputePreview");
    if (reason) reason.value = "";
    if (photo) photo.value = "";
    if (preview) preview.innerHTML = "";
    statusBox($("nlDisputeStatus"), "", false);
  }

  function openDispute() {
    if (!state.selectedDetailId) { toast("尚未選擇明細"); return; }
    resetDisputeForm();
    const m = $("nlDisputeModal");
    if (m) m.hidden = false;
  }

  function bindHistoryMeterFilter() {
    const tab = $("historyTab");
    if (!tab) return;
    tab.addEventListener("click", (e) => {
      const b = e.target.closest("[data-meter-filter]");
      if (!b) return;
      tab.querySelectorAll("[data-meter-filter]").forEach((x) => x.classList.toggle("active", x === b));
      renderHistoryList();
    });
    const from = $("nlHistFrom"); const to = $("nlHistTo"); const reset = $("btnHistReset");
    if (from) from.addEventListener("change", renderHistoryList);
    if (to) to.addEventListener("change", renderHistoryList);
    if (reset) reset.addEventListener("click", () => {
      if (from) from.value = ""; if (to) to.value = "";
      const first = tab.querySelector("[data-meter-filter]");
      tab.querySelectorAll("[data-meter-filter]").forEach((x) => x.classList.toggle("active", x === first));
      renderHistoryList();
    });
  }

  function bindDisputePhoto() {
    const input = $("nlDisputePhoto");
    if (!input) return;
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      const preview = $("nlDisputePreview");
      if (!preview) return;
      preview.innerHTML = "";
      disputePhotos = [];
      files.forEach((f, idx) => {
        if (!f.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = () => {
          const b64 = String(reader.result || "");
          disputePhotos.push(b64);
          const img = document.createElement("img");
          img.src = b64;
          Object.assign(img.style, { width: "88px", height: "88px", objectFit: "cover", borderRadius: "12px", border: "1px solid rgba(17,24,39,0.12)" });
          preview.appendChild(img);
        };
        try { reader.readAsDataURL(f); } catch {}
      });
    });
  }

  async function submitDispute() {
    if (!MR || !MR.submitDispute) { toast("抄錶模組尚未載入"); return; }
    if (!state.selectedDetailId) { toast("尚未選擇明細"); return; }
    const reasonEl = $("nlDisputeReason");
    const reason = String(reasonEl && reasonEl.value || "").trim();
    if (!reason) { toast("請填寫核異說明"); return; }
    const btn = $("btnDisputeSubmit");
    const st = $("nlDisputeStatus");
    if (btn) { btn.disabled = true; btn.style.opacity = "0.7"; }
    statusBox(st, "送出核異中...", false);
    try {
      const photoKeys = [];
      disputePhotos.forEach((b64, i) => {
        const key = `nwapp:meter:cache:dispute:${state.selectedDetailId}:${Date.now()}-${i}`;
        try { localStorage.setItem(key, b64); photoKeys.push(key); } catch (e) { console.warn(e); }
      });
      const db = firebase.firestore();
      await MR.submitDispute(db, state.communityId, state.selectedDetailId, {
        reason,
        photos: photoKeys,
        reporterUid: state.uid,
        reporterName: state.displayName,
        reporterHouseNo: state.houseNo,
      });
      statusBox(st, "核異已送出，管理員將儘速與您聯繫", false);
      toast("已送出核異申請");
      window.setTimeout(() => {
        const m = $("nlDisputeModal"); if (m) m.hidden = true;
        const dm = $("nlDetailModal"); if (dm) dm.hidden = true;
        loadLastRecords().then(renderHistoryList);
      }, 700);
    } catch (e) {
      statusBox(st, `送出失敗：${(e && e.message) ? e.message : "請稍後再試"}`, true);
    } finally {
      if (btn) btn.disabled = false; btn.style.opacity = "";
    }
  }

  function renderFeeArea() {
    const el = $("nlFeeArea");
    if (!el) return;
    if (!state.uid) { el.innerHTML = `<div class="nl-empty">請先登入</div>`; return; }
    const period = String($("nlFeePeriod") && $("nlFeePeriod").value || ym()).trim() || ym();
    const rows = state.records.filter((r) => String(r.period || "") === period);
    const byType = {};
    Object.keys(METER_TYPES).forEach((k) => (byType[k] = []));
    rows.forEach((r) => { if (byType[r.meterType]) byType[r.meterType].push(r); });
    let total = 0;
    const rowHtml = Object.keys(METER_TYPES).map((k) => {
      const mt = METER_TYPES[k];
      const list = (byType[k] || []).sort((a, b) => new Date(b.readingDate || 0) - new Date(a.readingDate || 0));
      const latest = list[0] || null;
      const usage = latest ? numOr(latest.usage, 0) : 0;
      const fee = MR && MR.calcFee ? MR.calcFee(usage, k) : 0;
      total += Number.isFinite(fee) ? fee : 0;
      const status = latest ? String(latest.validationStatus || "pending") : "尚未申報";
      return `
        <div class="nl-fee-row">
          <div style="display:inline-flex; align-items:center; gap:6px; font-weight:900;">
            <div style="width:10px; height:10px; border-radius:999px; background:${esc(mt.accent)};"></div>
            <div>${esc(mt.short)}</div>
          </div>
          <div style="color:#374151;">
            ${latest ? `上次 ${esc(String(latest.previousValue||0))} → 本次 ${esc(String(latest.currentValue||0))}（用量 ${esc(String(usage))} 度）` : `<span style="color:#6b7280;">本期尚未申報</span>`}
          </div>
          <div style="font-size:12px; color:#6b7280; font-weight:800;">${esc(status)}</div>
          <div style="font-weight:900; color:#9f1c1c;">NT$ ${esc(Number.isFinite(fee) ? fee.toFixed(2) : "0.00")}</div>
        </div>
      `;
    }).join("");
    el.innerHTML = `
      <div class="nl-fee-card">
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; flex-wrap:wrap;">
          <div style="font-weight:900; font-size:15px;">${esc(period)} 應繳總計</div>
          <div class="nl-fee-total">NT$ ${esc(total.toFixed(2))}</div>
        </div>
        <div style="height:1px; background:rgba(17,24,39,0.08); margin:4px 0 6px;"></div>
        ${rowHtml}
      </div>
      <div class="nl-empty">※ 費用依台電、自來水公司、瓦斯公司公告級距試算，最終金額以繳費通知單為準</div>
    `;
  }

  function bindFeePeriod() {
    const el = $("nlFeePeriod");
    if (el) el.addEventListener("change", renderFeeArea);
  }

  function bindModals() {
    document.querySelectorAll("[data-modal-close='1']").forEach((el) => {
      if (el._boundClose) return; el._boundClose = true;
      el.addEventListener("click", () => {
        const m = el.closest(".modal"); if (m) m.hidden = true;
      });
    });
    const bDetail = $("btnFileDispute");
    if (bDetail && !bDetail._bound) { bDetail._bound = true; bDetail.addEventListener("click", openDispute); }
    const bDis = $("btnDisputeSubmit");
    if (bDis && !bDis._bound) { bDis._bound = true; bDis.addEventListener("click", submitDispute); }
  }

  function bindMainForm() {
    const period = $("nlPeriod"); const date = $("nlReadDate");
    if (period && !period.value) period.value = ym();
    if (date && !date.value) date.value = ymd();
    const fp = $("nlFeePeriod");
    if (fp && !fp.value) fp.value = ym();
    const p = $("btnPreviewFee");
    if (p && !p._bound) { p._bound = true; p.addEventListener("click", previewAll); }
    const s = $("btnSubmitReadings");
    if (s && !s._bound) { s._bound = true; s.addEventListener("click", submitAll); }
    document.addEventListener("input", (e) => {
      const cur = e.target.closest("[data-meter-cur]");
      if (!cur) return;
      const t = String(cur.getAttribute("data-meter-cur") || "");
      const prevEl = document.querySelector(`[data-meter-prev="${CSS.escape(t)}"]`);
      const skipEl = document.querySelector(`[data-meter-skip="${CSS.escape(t)}"]`);
      if (skipEl && skipEl.checked) { setPreviewBox(t, null); return; }
      if (!MR || !MR.calcUsage || !MR.calcFee) return;
      const prev = numOr(prevEl && prevEl.value, 0);
      const curr = cur.value === "" ? NaN : numOr(cur.value, NaN);
      if (!Number.isFinite(curr)) { setPreviewBox(t, null); return; }
      const u = MR.calcUsage(prev, curr, { meterType: t });
      const f = MR.calcFee(u, t);
      const ab = MR.detectAbnormal ? MR.detectAbnormal({ meterType: t, previousValue: prev, currentValue: curr, usage: u }, null) || [] : [];
      setPreviewBox(t, { usage: u, feeText: Number.isFinite(f) ? f.toFixed(2) : "0.00", abnormal: ab });
    });
  }

  async function boot() {
    if (!window.firebase || !firebase.auth || !firebase.firestore) {
      const area = $("nlMeterArea");
      if (area) area.innerHTML = `<div class="nl-empty">Firebase 尚未載入，請稍後再試</div>`;
      return;
    }
    bindTopTabs();
    bindMainForm();
    bindHistoryMeterFilter();
    bindFeePeriod();
    bindDisputePhoto();
    bindModals();
    renderMeterArea();
    const db = firebase.firestore();
    try { db.settings({ ignoreUndefinedProperties: true }); } catch {}
    firebase.auth().onAuthStateChanged(async (user) => {
      await loadUserProfile(user || null);
      if (!user) {
        try {
          const url = `member.html?redirect=${encodeURIComponent("number-list.html")}`;
          toast("請先登入住戶帳號，3 秒後跳轉...");
          window.setTimeout(() => { location.href = url; }, 2200);
        } catch {}
      }
      await loadLastRecords();
      renderMeterArea();
      renderHistoryList();
      renderFeeArea();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
