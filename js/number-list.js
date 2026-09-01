/* global firebase */
(function () {
  "use strict";

  const MR = (typeof window.NwMeterReading !== "undefined" && window.NwMeterReading) || null;

  function refreshMeterTypesFromMR() {
    const normalized = normalizeMeterTypes(MR ? MR.METER_TYPES : null);
    const raw = normalized || FALLBACK_METER_TYPES;
    const filtered = {};
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      if (!v) continue;
      if (v.enabled === false) continue;
      if (raw[k].enabled === false) continue;
      filtered[k] = v;
    }
    const ordered = {};
    ["electric", "water", "gas"].forEach((k) => {
      if (filtered[k]) ordered[k] = filtered[k];
      else if (raw[k] && !(raw[k].enabled === false)) ordered[k] = raw[k];
    });
    Object.keys(filtered).forEach((k) => { if (!ordered[k]) ordered[k] = filtered[k]; });
    return ordered;
  }

  function getUrlCid() {
    try {
      const p = new URLSearchParams(window.location.search || "");
      const c = p.get("c") || p.get("community") || "";
      return c.trim();
    } catch { return ""; }
  }

  function normalizeMeterTypes(raw) {
    if (!raw || typeof raw !== "object") return null;
    const vals = Object.values(raw);
    if (!vals.length) return null;
    const nonNull = vals.find(v => v && typeof v === "object" && typeof v.id === "string");
    if (!nonNull) return raw;
    const out = {};
    const shortMap = { electric: "電", water: "水", gas: "瓦斯" };
    const dotMap = { electric: "橘", water: "藍", gas: "紅" };
    for (const v of vals) {
      const k = String(v.id || "").trim().toLowerCase();
      if (!k) continue;
      const digits = Number.isFinite(Number(v.digits)) ? Math.max(2, Math.min(8, Math.floor(Number(v.digits)))) : 4;
      out[k] = {
        key: k,
        label: `${v.icon || ""} ${v.name || k}`.trim(),
        short: shortMap[k] || ((typeof v.name === "string" && v.name) ? v.name.slice(0, 1) : k.slice(0, 1)),
        digits,
        dot: dotMap[k] || "—",
        accent: String(v.color || "#6b7280"),
        enabled: typeof v.enabled === "boolean" ? v.enabled : true,
        unit: String(v.unit || "度"),
      };
    }
    return Object.keys(out).length ? out : null;
  }

  const FALLBACK_METER_TYPES = {
    electric: { key: "electric", label: "⚡ 電錶", short: "電", digits: 4, dot: "橘", accent: "#ea580c", enabled: true, unit: "度" },
    water: { key: "water", label: "💧 自來水錶", short: "水", digits: 4, dot: "藍", accent: "#2563eb", enabled: true, unit: "度" },
    gas: { key: "gas", label: "🔥 天然氣瓦斯錶", short: "瓦斯", digits: 4, dot: "紅", accent: "#dc2626", enabled: true, unit: "度" },
  };

  let METER_TYPES = refreshMeterTypesFromMR();

  function getMeterTypesCopy() {
    const raw = refreshMeterTypesFromMR();
    METER_TYPES = raw;
    return METER_TYPES;
  }

  const state = {
    user: null,
    communityId: (getUrlCid() || sessionStorage.getItem("csp_last_cid") || "").trim() || "default",
    houseNo: "—",
    subHouseNo: "",
    displayName: "",
    uid: "",
    records: [],
    lastByType: {},
    periodSubmittedByType: {},
    selectedDetailId: null,
  };

  const LS_PREFIX = "nwapp:meter";
  const draftKey = (uid, cid, hn) => `${LS_PREFIX}:draft:u=${String(uid || "")}:c=${String(cid || "")}:h=${String(hn || "")}`;
  const recentKey = (uid, cid, hn) => `${LS_PREFIX}:recent:u=${String(uid || "")}:c=${String(cid || "")}:h=${String(hn || "")}`;
  const LS_MAX_RECORDS = 500;
  let __debounceDraft = 0;
  function lsGet(key, fb) { try { const v = localStorage.getItem(key); if (v == null) return fb; return JSON.parse(v); } catch { return fb; } }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  function lsRemove(key) { try { localStorage.removeItem(key); } catch {} }
  function lsRemovePattern(prefix) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(prefix) === 0) keys.push(k); }
      keys.forEach(k => localStorage.removeItem(k));
    } catch {}
  }
  function saveDraftImmediate() {
    if (!state.uid) return;
    const ts = Date.now();
    const out = { period: "", readDate: "", values: {}, skips: {}, savedAt: ts };
    const p = $("nlPeriod"); const d = $("nlReadDate");
    if (p) out.period = String(p.value || "");
    if (d) out.readDate = String(d.value || "");
    for (const t of Object.keys(METER_TYPES)) {
      syncPrevBoxesFor(t);
      syncDigitBoxesFor(t);
      const hidden = document.querySelector(`[data-meter-cur-hidden="${CSS.escape(t)}"]`);
      const idEl = document.querySelector(`[data-meter-id="${CSS.escape(t)}"]`);
      const prevHidden = document.querySelector(`[data-meter-prev-hidden="${CSS.escape(t)}"]`);
      const skipEl = document.querySelector(`[data-meter-skip="${CSS.escape(t)}"]`);
      out.values[t] = {
        cur: hidden && hidden.value !== "" ? String(hidden.value) : "",
        id: idEl ? String(idEl.value || "") : "",
        prev: prevHidden ? String(prevHidden.value || "") : "",
      };
      out.skips[t] = !!(skipEl && skipEl.checked);
    }
    lsSet(draftKey(state.uid, state.communityId, state.houseNo), out);
    setLastEditedAt(ts);
  }
  function saveDraftDebounced() {
    if (__debounceDraft) { window.clearTimeout(__debounceDraft); }
    __debounceDraft = window.setTimeout(saveDraftImmediate, 250);
  }
  function loadDraftAndApply() {
    if (!state.uid) return;
    const d = lsGet(draftKey(state.uid, state.communityId, state.houseNo), null);
    if (!d || typeof d !== "object") return;
    try {
      if (d.period) { const p = $("nlPeriod"); if (p) p.value = String(d.period); }
      if (d.readDate) { const rd = $("nlReadDate"); if (rd) rd.value = String(d.readDate); }
      const values = d.values || {}; const skips = d.skips || {};
      for (const t of Object.keys(METER_TYPES)) {
        const v = values[t];
        if (!v) continue;
        if (typeof v.id === "string") { const idEl = document.querySelector(`[data-meter-id="${CSS.escape(t)}"]`); if (idEl) idEl.value = v.id; }
        if (typeof v.prev === "string" && v.prev !== "") {
          const anyPrevInput = document.querySelector(`[data-meter-prev="${CSS.escape(t)}"]`);
          if (anyPrevInput && !anyPrevInput.hasAttribute("readonly")) {
            applyPrevValueFromString(t, v.prev);
          }
        }
        if (typeof v.cur === "string" && v.cur !== "") {
          applyDigitValueFromString(t, v.cur);
        }
        if (skips[t]) { const skipEl = document.querySelector(`[data-meter-skip="${CSS.escape(t)}"]`); if (skipEl) skipEl.checked = true; }
      }
    } catch (e) { console.warn("[number-list] loadDraftAndApply failed:", e); }
  }
  function clearDraft() {
    if (!state.uid) return;
    lsRemove(draftKey(state.uid, state.communityId, state.houseNo));
  }
  function computePeriodSubmittedMap(records) {
    const out = {};
    const list = Array.isArray(records) ? records : [];
    for (const r of list) {
      const t = String(r.meterType || "");
      const p = String(r.period || "").trim();
      if (!t || !p) continue;
      if (!out[t]) out[t] = {};
      const isVoid = String(r.voidStatus || "") === "voided";
      if (isVoid) continue;
      if (!out[t][p]) out[t][p] = { id: String(r.id || ""), status: String(r.validationStatus || "pending"), readingDate: r.readingDate || null };
    }
    return out;
  }
  function isPeriodSubmitted(typeKey, period) {
    const map = state.periodSubmittedByType || {};
    const t = String(typeKey || "");
    const p = String(period || "").trim();
    return !!(map[t] && map[t][p]);
  }
  function saveRecentRecords() {
    if (!state.uid) return;
    try {
      const arr = Array.isArray(state.records) ? state.records.slice(0, LS_MAX_RECORDS) : [];
      lsSet(recentKey(state.uid, state.communityId, state.houseNo), { records: arr, lastByType: state.lastByType || {}, periodSubmittedByType: state.periodSubmittedByType || {}, savedAt: Date.now() });
    } catch {}
  }
  function loadRecentRecords() {
    if (!state.uid) return false;
    try {
      const r = lsGet(recentKey(state.uid, state.communityId, state.houseNo), null);
      if (!r || typeof r !== "object") return false;
      if (Array.isArray(r.records)) state.records = r.records.slice(0, LS_MAX_RECORDS);
      if (r.lastByType && typeof r.lastByType === "object") state.lastByType = { ...(r.lastByType || {}) };
      if (r.periodSubmittedByType && typeof r.periodSubmittedByType === "object") state.periodSubmittedByType = { ...(r.periodSubmittedByType || {}) };
      else state.periodSubmittedByType = computePeriodSubmittedMap(state.records || []);
      return true;
    } catch { return false; }
  }
  function resetStateOnUidChanged(newUid) {
    const prevUid = String(state.uid || "");
    const nextUid = String(newUid || "");
    if (prevUid !== nextUid && prevUid) {
      state.records = [];
      state.lastByType = {};
      state.periodSubmittedByType = {};
      state.selectedDetailId = null;
    }
  }
  function clearRecentRecords(uid, cid, hn) {
    try { lsRemove(recentKey(String(uid || ""), String(cid || ""), String(hn || ""))); } catch {}
    try { lsRemove(draftKey(String(uid || ""), String(cid || ""), String(hn || ""))); } catch {}
  }
  function formatDateTime(value) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return "尚未輸入資料";
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return "尚未輸入資料";
    return `最後輸入：${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function setLastEditedAt(tsOrNull) {
    const el = $("nlLastEdited");
    if (!el) return;
    const ts = tsOrNull == null ? (() => {
      const dk = state.uid ? draftKey(state.uid, state.communityId, state.houseNo) : "";
      const rk = state.uid ? recentKey(state.uid, state.communityId, state.houseNo) : "";
      const draft = dk ? lsGet(dk, null) : null;
      const recent = rk ? lsGet(rk, null) : null;
      const a = (draft && draft.savedAt) ? Number(draft.savedAt) : 0;
      const b = (recent && recent.savedAt) ? Number(recent.savedAt) : 0;
      return Math.max(a, b) || 0;
    })() : Number(tsOrNull);
    el.textContent = formatDateTime(ts);
  }

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

  function updateHeaderTitle() {
    const titleEl = $("nlTitle");
    if (!titleEl) return;
    const houseNo = String(state.houseNo || "").trim();
    const displayName = String(state.displayName || "").trim();
    const fullHouseNo = (() => {
      const sub = String(state.subHouseNo || state.subUnit || "").trim();
      if (!houseNo) return "";
      return sub ? `${houseNo}-${sub}` : houseNo;
    })();
    titleEl.textContent = `${fullHouseNo || "戶號"} ${displayName || "姓名"}`;
  }

  async function loadUserProfile(user) {
    const auth = firebase.auth();
    const db = firebase.firestore();
    const uid = user ? String(user.uid || "") : "";
    const uidBefore = String(state.uid || "");
    const cidBefore = String(state.communityId || "");
    const hnBefore = String(state.houseNo || "");
    resetStateOnUidChanged(uid);
    state.uid = uid;
    state.user = user || null;
    state.displayName = String((user && user.displayName) || "").trim();
    updateHeaderTitle();
    if (!uid) {
      if (uidBefore) { try { clearRecentRecords(uidBefore, cidBefore, hnBefore); } catch {} }
      return;
    }
    try {
      const snap = await db.collection("users").doc(uid).get();
      const d = (snap && snap.exists && snap.data()) || {};
      state.communityId = String(getUrlCid() || d.community || state.communityId || sessionStorage.getItem("csp_last_cid") || "default").trim() || "default";
      state.houseNo = String(d.houseNo || d.unit || state.houseNo || "").trim() || "—";
      state.subHouseNo = String(d.subHouseNo || d.subUnit || d.sub || state.subHouseNo || "").trim();
      state.displayName = String(d.displayName || d.name || state.displayName || (user && user.displayName) || "").trim();
      try { sessionStorage.setItem("csp_last_cid", state.communityId); } catch {}
      updateHeaderTitle();
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
    if (!state.uid) {
      state.records = [];
      state.lastByType = {};
      return;
    }
    const db = firebase.firestore();
    if (MR && MR.loadCommunityMeterSettings && db) { try { await MR.loadCommunityMeterSettings(db, state.communityId, true); getMeterTypesCopy(); } catch(e) { console.warn('[number-list] meterSettings load failed', e); } }
    const hadCache = loadRecentRecords();
    renderHistoryList();
    if (!MR || !MR.listRecordsByHouse) return;
    try {
      const list = await MR.listRecordsByHouse(db, state.communityId, state.houseNo, { limit: 500, uid: state.uid });
      const finalList = Array.isArray(list) && list.length ? list : (hadCache ? (Array.isArray(state.records) ? state.records.slice() : []) : []);
      state.records = finalList;
      const last = {};
      for (const r of state.records) {
        const t = String(r.meterType || "");
        if (!t) continue;
        if (!METER_TYPES[t]) continue;
        const rd = r.readingDate ? new Date(r.readingDate) : null;
        const prevRd = last[t] && last[t].readingDate ? new Date(last[t].readingDate) : null;
        if (!prevRd || (rd && Number.isFinite(rd.getTime()) && rd.getTime() >= prevRd.getTime())) last[t] = r;
      }
      state.lastByType = last;
      state.periodSubmittedByType = computePeriodSubmittedMap(state.records);
      saveRecentRecords();
      setLastEditedAt();
      renderHistoryFilterButtons();
      renderMeterArea();
      renderHistoryList();
      renderFeeArea();
    } catch (e) {
      console.warn("[number-list] loadLastRecords failed (using cache if any):", e);
      setLastEditedAt();
      renderMeterArea();
    }
  }

  function meterCardHtml(typeKey) {
    const mt = METER_TYPES[typeKey] || METER_TYPES.electric;
    const last = state.lastByType[typeKey] || null;
    const meterId = last && last.meterId ? String(last.meterId) : defaultMeterId(typeKey);
    const hasLast = !!(last && Number.isFinite(numOr(last.currentValue)));
    const prevRaw = hasLast ? numOr(last.currentValue) : 0;
    const digits = Math.max(2, Math.min(8, Number.isFinite(Number(mt.digits)) ? Math.floor(Number(mt.digits)) : 4));
    const color = String(mt.accent || "#1f2937");
    const periodEl = $("nlPeriod");
    const period = periodEl ? String(periodEl.value || ym()).trim() : ym();
    const submitted = isPeriodSubmitted(typeKey, period);
    const readonlyStyle = 'background:linear-gradient(180deg,#f3f4f6,#e5e7eb); color:#374151; border-color:rgba(17,24,39,.12);';
    const editableStyle = 'background:linear-gradient(180deg,#fff,#fafafa); color:' + color + ';';
    const hasPrevReadonly = hasLast || submitted;
    const digitInputStyle = hasPrevReadonly ? readonlyStyle : editableStyle;
    const wrapBorderColor = hasPrevReadonly ? 'rgba(17,24,39,.08)' : (color + '55');
    const readonlyAttr = hasPrevReadonly ? ' readonly tabindex="-1"' : '';
    const prevArr = String(Math.max(0, Math.min(Math.pow(10, digits) - 1, Math.floor(Number.isFinite(prevRaw) ? prevRaw : 0)))).padStart(digits, '0').split('');
    const cardFooterHtml = submitted
      ? `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; padding-top:12px; border-top:1px dashed rgba(17,24,39,.12); flex-wrap:wrap;">
           <div style="display:inline-flex; align-items:center; gap:6px; padding:6px 12px; border-radius:999px; background:rgba(46,125,50,0.10); border:1px solid rgba(46,125,50,0.22); color:#15803d; font-size:12px; font-weight:900;">✓ 本期 ${esc(period)} 已送出申報</div>
           <div style="font-size:11px; color:#6b7280; font-weight:800;">每期僅能申報乙次；需修改請洽管理中心。</div>
         </div>`
      : `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; padding-top:12px; border-top:1px dashed rgba(17,24,39,.12); flex-wrap:wrap;">
           <div style="font-size:11px; color:#6b7280; font-weight:800;">每期僅能申報乙次；送出確認後無法修改。</div>
           <button class="btn btn-primary btn-submit" type="button" data-meter-submit="${esc(typeKey)}" style="min-width:120px;">送出申報</button>
         </div>`;
    return `
      <div class="nl-meter-card" data-meter="${esc(typeKey)}"${submitted ? ' style="opacity:0.96;"' : ''}>
        <div class="nl-meter-head">
          <div class="nl-meter-title">
            <div class="dot" style="background:${esc(color)};"></div>
            <div>${esc(mt.label)}</div>
          </div>
          <label style="display:inline-flex; align-items:center; gap:6px; font-size:13px; color:#6b7280; font-weight:800;">
            <input type="checkbox" data-meter-skip="${esc(typeKey)}" ${submitted ? 'disabled checked' : ''} />
            ${submitted ? '本期已申報' : '本期不申報'}
          </label>
        </div>
        <div class="nl-meter-fields">
          <div class="field">
            <label>儀表編號</label>
            <input type="text" data-meter-id="${esc(typeKey)}" value="${esc(meterId)}" placeholder="${esc(defaultMeterId(typeKey))}" autocomplete="off" ${submitted ? 'readonly style="background:#f3f4f6;color:#374151;"' : ''} />
          </div>
          <div class="field">
            <label>對應門牌號</label>
            <input type="text" value="${esc(state.houseNo)}" readonly style="background:#f3f4f6; color:#374151;" />
          </div>
          <div class="field">
            <label>上次抄表數值${submitted ? "（本期已申報）" : (hasLast ? "" : "（首次可輸入）")}（${esc(digits)} 位，每格單獨輸入）</label>
            <div data-meter-prev-boxes="${esc(typeKey)}" class="nl-digit-grid" style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding-top:4px;">
              ${prevArr.map((ch, i) => `
                <div class="nl-digit" style="width:48px; height:60px; border:1.5px solid ${esc(wrapBorderColor)}; border-radius:14px; ${hasPrevReadonly ? '' : 'box-shadow:inset 0 -2px 0 rgba(17,24,39,.05);'} position:relative; overflow:hidden;">
                  <input inputmode="numeric" pattern="[0-9]*" maxlength="1" data-meter-prev="${esc(typeKey)}" data-previdx="${i}" value="${esc(ch)}" aria-label="${esc(mt.short)}上次第${i+1}位" style="width:100%; height:100%; border:0; outline:none; text-align:center; font:900 28px/1 'SF Mono',Consolas,monospace; padding:0; ${digitInputStyle}"${readonlyAttr} />
                </div>
              `).join('')}
              <span class="pill" style="margin-left:4px; background:rgba(17,24,39,.05); border-radius:999px; color:#374151; padding:2px 10px; font-size:11px; font-weight:800;">${esc(digits)}位</span>
            </div>
            <input type="hidden" data-meter-prev-hidden="${esc(typeKey)}" value="${esc(prevArr.join(''))}" />
            <div style="font-size:11px; color:#6b7280; font-weight:700; margin-top:4px;">${submitted ? "※ 本期已完成申報，無法修改。" : (hasLast ? "※ 依上期自動帶入，不得手動修改。" : "※ 首次無上期資料可輸入；輸入後自動跳至下一格，Backspace 空值可回到上一格。")}</div>
          </div>
          <div class="field">
            <label>本次抄表數字（${esc(digits)} 位，每格單獨輸入）</label>
            <div data-meter-cur-boxes="${esc(typeKey)}" class="nl-digit-grid" style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding-top:4px;">
              ${Array.from({length: digits}).map((_, i) => `
                <div class="nl-digit" style="width:48px; height:60px; border:1.5px solid ${esc(color)}55; border-radius:14px; ${submitted ? 'background:linear-gradient(180deg,#f3f4f6,#e5e7eb); border-color:rgba(17,24,39,.12);' : 'background:linear-gradient(180deg,#fff,#fafafa); box-shadow:inset 0 -2px 0 rgba(17,24,39,.05);'} position:relative; overflow:hidden;">
                  <input inputmode="numeric" pattern="[0-9]*" maxlength="1" data-meter-cur="${esc(typeKey)}" data-digidx="${i}" aria-label="${esc(mt.short)}第${i+1}位" style="width:100%; height:100%; background:transparent; border:0; outline:none; text-align:center; font:900 28px/1 'SF Mono',Consolas,monospace; ${submitted ? 'color:#374151;' : 'color:' + color + ';'} padding:0;"${submitted ? ' readonly tabindex="-1"' : ''} />
                </div>
              `).join('')}
              <span class="pill" style="margin-left:4px; background:rgba(17,24,39,.05); border-radius:999px; color:#374151; padding:2px 10px; font-size:11px; font-weight:800;">${esc(digits)}位</span>
            </div>
            <input type="hidden" data-meter-cur-hidden="${esc(typeKey)}" />
            <div style="font-size:11px; color:#6b7280; font-weight:700; margin-top:4px;">${submitted ? "※ 本期已完成申報，無法修改。" : "※ 輸入後自動跳至下一格，Backspace 空值可回到上一格。"}</div>
          </div>
        </div>
        ${cardFooterHtml}
      </div>
    `;
  }

  function syncPrevBoxesFor(typeKey) {
    const wrap = document.querySelector(`[data-meter-prev-boxes="${CSS.escape(typeKey)}"]`);
    const hidden = document.querySelector(`[data-meter-prev-hidden="${CSS.escape(typeKey)}"]`);
    if (!wrap || !hidden) return;
    const val = Array.from(wrap.querySelectorAll(`input[data-meter-prev="${CSS.escape(typeKey)}"]`)).map(i => (i.value || '').slice(-1)).join('').trim();
    hidden.value = val || '';
  }

  function applyPrevValueFromString(typeKey, value, opts) {
    opts = opts || {};
    const grid = document.querySelector(`[data-meter-prev-boxes="${CSS.escape(typeKey)}"]`);
    if (!grid) return;
    const inputs = Array.from(grid.querySelectorAll(`input[data-meter-prev="${CSS.escape(typeKey)}"]`)).filter(i => i.hasAttribute('data-previdx'));
    if (!inputs.length) return;
    const digits = inputs.length;
    const n = Math.max(0, Math.min(Math.pow(10, digits) - 1, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));
    const arr = String(n).padStart(digits, '0').split('');
    inputs.forEach((inp, i) => { inp.value = arr[i] || '0'; });
    syncPrevBoxesFor(typeKey);
    if (opts.saveDraft) saveDraftDebounced();
  }

  function syncDigitBoxesFor(typeKey) {
    const wrap = document.querySelector(`[data-meter-cur-boxes="${CSS.escape(typeKey)}"]`);
    const hidden = document.querySelector(`[data-meter-cur-hidden="${CSS.escape(typeKey)}"]`);
    if (!wrap || !hidden) return;
    const val = Array.from(wrap.querySelectorAll(`input[data-meter-cur="${CSS.escape(typeKey)}"]`)).map(i => (i.value || '').slice(-1)).join('').trim();
    hidden.value = val || '';
    const curInputs = Array.from(document.querySelectorAll(`input[data-meter-cur="${CSS.escape(typeKey)}"]`)).filter(i => !i.hasAttribute('data-digidx'));
    if (curInputs.length) { curInputs.forEach(ci => { ci.value = val; try { ci.dispatchEvent(new Event('input', { bubbles: true })); } catch {} }); }
  }

  function bindDigitBoxEvents() {
    const grids = document.querySelectorAll("[data-meter-cur-boxes]");
    grids.forEach((grid) => {
      const typeKey = String(grid.getAttribute("data-meter-cur-boxes") || "");
      const inputs = Array.from(grid.querySelectorAll(`input[data-meter-cur="${CSS.escape(typeKey)}"]`)).filter(i => i.hasAttribute('data-digidx'));
      inputs.forEach((inp, idx, arr) => {
        inp.oninput = () => {
          const v = (inp.value || "").replace(/[^0-9]/g, "");
          const fst = v.charAt(0) || "";
          const remain = v.slice(1);
          inp.value = fst;
          if (remain) {
            for (let j = 0; j < remain.length; j++) {
              const next = idx + 1 + j;
              if (next >= arr.length) break;
              const n = arr[next];
              if (n) n.value = remain.charAt(j);
            }
            const last = Math.min(arr.length - 1, idx + Math.max(1, remain.length) - 1);
            arr[last] && arr[last].focus && arr[last].focus();
            arr[last] && arr[last].setSelectionRange && arr[last].setSelectionRange((arr[last].value || '').length, (arr[last].value || '').length);
          } else if (fst && idx + 1 < arr.length) {
            const nxt = arr[idx + 1];
            nxt && nxt.focus();
            try { nxt.setSelectionRange((nxt.value || '').length, (nxt.value || '').length); } catch {}
          }
          syncDigitBoxesFor(typeKey);
          saveDraftDebounced();
        };
        inp.onkeydown = (e) => {
          const k = e.key;
          if (k === 'Backspace' && !(inp.value) && idx > 0) {
            const prev = arr[idx - 1];
            if (prev) { prev.value = ''; prev.focus(); e.preventDefault(); }
            syncDigitBoxesFor(typeKey);
            saveDraftDebounced();
          } else if (k === 'ArrowLeft' && idx > 0) {
            e.preventDefault(); arr[idx-1].focus();
          } else if (k === 'ArrowRight' && idx < arr.length - 1) {
            e.preventDefault(); arr[idx+1].focus();
          }
        };
        inp.onpaste = (e) => {
          e.preventDefault();
          const txt = (e.clipboardData || window.clipboardData || {}).getData ? (e.clipboardData || window.clipboardData).getData('text') : '';
          if (!txt) return;
          const digits = txt.replace(/[^0-9]/g, '').slice(0, Math.max(0, arr.length - idx));
          for (let j = 0; j < digits.length; j++) { if (arr[idx + j]) arr[idx + j].value = digits.charAt(j); }
          const lastFocus = Math.min(arr.length - 1, idx + Math.max(1, digits.length || 1) - 1);
          arr[lastFocus] && arr[lastFocus].focus && arr[lastFocus].focus();
          syncDigitBoxesFor(typeKey);
          saveDraftDebounced();
        };
      });
    });

    const prevGrids = document.querySelectorAll("[data-meter-prev-boxes]");
    prevGrids.forEach((grid) => {
      const typeKey = String(grid.getAttribute("data-meter-prev-boxes") || "");
      const inputs = Array.from(grid.querySelectorAll(`input[data-meter-prev="${CSS.escape(typeKey)}"]`)).filter(i => i.hasAttribute('data-previdx'));
      inputs.forEach((inp, idx, arr) => {
        inp.oninput = () => {
          const v = (inp.value || "").replace(/[^0-9]/g, "");
          const fst = v.charAt(0) || "";
          const remain = v.slice(1);
          inp.value = fst;
          if (remain) {
            for (let j = 0; j < remain.length; j++) {
              const next = idx + 1 + j;
              if (next >= arr.length) break;
              const n = arr[next];
              if (n) n.value = remain.charAt(j);
            }
            const last = Math.min(arr.length - 1, idx + Math.max(1, remain.length) - 1);
            arr[last] && arr[last].focus && arr[last].focus();
            arr[last] && arr[last].setSelectionRange && arr[last].setSelectionRange((arr[last].value || '').length, (arr[last].value || '').length);
          } else if (fst && idx + 1 < arr.length) {
            const nxt = arr[idx + 1];
            nxt && nxt.focus();
            try { nxt.setSelectionRange((nxt.value || '').length, (nxt.value || '').length); } catch {}
          }
          syncPrevBoxesFor(typeKey);
          saveDraftDebounced();
        };
        inp.onkeydown = (e) => {
          const k = e.key;
          if (k === 'Backspace' && !(inp.value) && idx > 0) {
            const prev = arr[idx - 1];
            if (prev) { prev.value = ''; prev.focus(); e.preventDefault(); }
            syncPrevBoxesFor(typeKey);
            saveDraftDebounced();
          } else if (k === 'ArrowLeft' && idx > 0) {
            e.preventDefault(); arr[idx-1].focus();
          } else if (k === 'ArrowRight' && idx < arr.length - 1) {
            e.preventDefault(); arr[idx+1].focus();
          }
        };
        inp.onpaste = (e) => {
          e.preventDefault();
          const txt = (e.clipboardData || window.clipboardData || {}).getData ? (e.clipboardData || window.clipboardData).getData('text') : '';
          if (!txt) return;
          const digits = txt.replace(/[^0-9]/g, '').slice(0, Math.max(0, arr.length - idx));
          for (let j = 0; j < digits.length; j++) { if (arr[idx + j]) arr[idx + j].value = digits.charAt(j); }
          const lastFocus = Math.min(arr.length - 1, idx + Math.max(1, digits.length || 1) - 1);
          arr[lastFocus] && arr[lastFocus].focus && arr[lastFocus].focus();
          syncPrevBoxesFor(typeKey);
          saveDraftDebounced();
        };
      });
    });
  }

  function applyDigitValueFromString(typeKey, value) {
    const grid = document.querySelector(`[data-meter-cur-boxes="${CSS.escape(typeKey)}"]`);
    if (!grid) return;
    const inputs = Array.from(grid.querySelectorAll(`input[data-meter-cur="${CSS.escape(typeKey)}"]`)).filter(i => i.hasAttribute('data-digidx'));
    if (!inputs.length) return;
    const digits = inputs.length;
    const n = Math.max(0, Math.min(Math.pow(10, digits) - 1, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));
    const arr = String(n).padStart(digits, '0').split('');
    inputs.forEach((inp, i) => { inp.value = arr[i] || '0'; });
    syncDigitBoxesFor(typeKey);
  }

  function renderHistoryFilterButtons() {
    const tab = document.getElementById("historyTab");
    if (!tab) return;
    const bar = tab.querySelector("#historyTab [data-meter-filter]");
    if (!bar) return;
    const wrap = bar.parentNode;
    const filters = [{ id: "all", label: "全部" }].concat(
      Object.keys(METER_TYPES).map(k => {
        const m = METER_TYPES[k];
        return { id: k, label: m.label };
      })
    );
    const existing = Array.from(tab.querySelectorAll("[data-meter-filter]"));
    const current = (existing.find(b => b.classList.contains("active")) || {}).getAttribute("data-meter-filter") || "all";
    const currentValid = filters.some(f => f.id === current);
    const newHtml = filters.map(f => {
      const active = currentValid ? (f.id === current) : (f.id === "all");
      const minw = f.id === "all" ? 64 : 96;
      return `<button class="tab-btn ${active?'active':''}" type="button" data-meter-filter="${esc(f.id)}" style="min-width:${minw}px; flex:0 0 auto; padding:0 14px;">${esc(f.label)}</button>`;
    }).join("");
    existing.forEach(n => n.remove());
    wrap.insertAdjacentHTML("afterbegin", newHtml);
  }

  function renderMeterArea() {
    const area = $("nlMeterArea");
    if (!area) return;
    if (!state.uid || !state.user) {
      area.innerHTML = `<div class="nl-empty">請先登入社區帳號，再進行抄錶申報。</div>`;
      return;
    }
    const keys = Object.keys(METER_TYPES);
    if (!keys.length) {
      area.innerHTML = `<div class="nl-empty">本社區目前未開放任何抄錶申報項目，請聯繫管理員。</div>`;
      return;
    }
    area.innerHTML = keys.map(meterCardHtml).join("");
    window.setTimeout(() => { loadDraftAndApply(); bindDigitBoxEvents(); }, 0);
  }

  function readSubmitForm(typeKeyOrNull) {
    const period = String($("nlPeriod") && $("nlPeriod").value || ym()).trim() || ym();
    const dateStr = String($("nlReadDate") && $("nlReadDate").value || ymd()).trim() || ymd();
    const readingDate = new Date(`${dateStr}T00:00:00`);
    const out = [];
    const types = typeKeyOrNull && METER_TYPES[typeKeyOrNull] ? [String(typeKeyOrNull)] : Object.keys(METER_TYPES);
    for (const t of types) {
      const skip = document.querySelector(`[data-meter-skip="${CSS.escape(t)}"]`);
      if (skip && skip.checked) continue;
      syncPrevBoxesFor(t);
      syncDigitBoxesFor(t);
      const hidden = document.querySelector(`[data-meter-cur-hidden="${CSS.escape(t)}"]`);
      const curValStr = hidden && hidden.value !== "" ? String(hidden.value) : "";
      const curVal = curValStr === "" ? NaN : numOr(curValStr, NaN);
      if (!Number.isFinite(curVal)) continue;
      const idEl = document.querySelector(`[data-meter-id="${CSS.escape(t)}"]`);
      const prevHidden = document.querySelector(`[data-meter-prev-hidden="${CSS.escape(t)}"]`);
      out.push({
        meterType: t,
        meterId: String(idEl && idEl.value ? idEl.value : defaultMeterId(t)).trim() || defaultMeterId(t),
        previousValue: numOr(prevHidden && prevHidden.value, 0),
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

  function setCardSubmitButtonDisabled(typeKey, disabled) {
    const card = document.querySelector(`[data-meter="${CSS.escape(typeKey)}"]`);
    if (!card) return;
    const btn = card.querySelector(`[data-meter-submit="${CSS.escape(typeKey)}"]`);
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.classList.toggle("is-loading", !!disabled);
    if (disabled) { btn.dataset._orig = btn.textContent || ""; btn.textContent = "申報中…"; }
    else if (btn.dataset._orig) { btn.textContent = btn.dataset._orig; delete btn.dataset._orig; }
  }

  function openSubmitConfirm(typeKey) {
    if (!MR || !MR.createRecord) { toast("抄錶模組尚未載入"); return; }
    if (!state.uid) { toast("請先登入"); return; }
    const periodEl = $("nlPeriod");
    const period = periodEl ? String(periodEl.value || ym()).trim() : ym();
    if (isPeriodSubmitted(typeKey, period)) { toast(METER_TYPES[typeKey] && METER_TYPES[typeKey].label || typeKey + "本期已申報，每期僅能申報乙次。"); return; }
    const rows = readSubmitForm(typeKey);
    if (!rows || !rows.length) { toast("尚未填寫本次抄表數字，無法送出"); return; }
    const r = rows[0];
    const mt = METER_TYPES[r.meterType] || METER_TYPES.electric;
    const u = MR.calcUsage ? MR.calcUsage(r.previousValue, r.currentValue, { meterType: r.meterType }) : Math.max(0, r.currentValue - r.previousValue);
    const f = MR.calcFee ? MR.calcFee(u, r.meterType) : 0;
    const ab = MR.detectAbnormal ? MR.detectAbnormal({ ...r, usage: u }, null) || [] : [];
    const feeText = Number.isFinite(f) ? f.toFixed(2) : "0.00";
    const rd = r.readingDate ? (r.readingDate instanceof Date ? r.readingDate : new Date(r.readingDate)) : null;
    const dateText = rd && Number.isFinite(rd.getTime()) ? ymd(rd) : ymd();
    const modal = $("nlConfirmSubmitModal");
    const body = $("nlConfirmSubmitBody");
    const okBtn = $("btnConfirmSubmitOk");
    const statusEl = $("nlConfirmSubmitStatus");
    statusEl.hidden = true; statusEl.textContent = "";
    okBtn.disabled = false;
    okBtn.classList.remove("is-loading");
    okBtn.textContent = "確認送出";
    body.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:14px; background:linear-gradient(180deg,#fff,#fafafa); border:1px solid rgba(17,24,39,.08);">
        <div style="width:10px;height:10px;border-radius:999px;background:${esc(mt.accent)};"></div>
        <div style="font-weight:900;font-size:16px;">${esc(mt.label)} 抄表申報</div>
        <div style="margin-left:auto;font-size:12px;color:#6b7280;font-weight:800;">申報週期 ${esc(r.period || period)}</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px;">
        <div class="field" style="margin:0;">
          <label>儀表編號</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">${esc(r.meterId)}</div>
        </div>
        <div class="field" style="margin:0;">
          <label>對應門牌號</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">${esc(r.houseNo)}</div>
        </div>
        <div class="field" style="margin:0;">
          <label>抄見日</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">${esc(dateText)}</div>
        </div>
        <div class="field" style="margin:0;">
          <label>申報來源</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">住戶自行申報</div>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px;">
        <div style="padding:12px 14px; border-radius:14px; background:rgba(243,244,246); border:1px solid rgba(17,24,39,.06);">
          <div style="font-size:11px; color:#6b7280; font-weight:800;">上次抄表數值</div>
          <div style="margin-top:6px; font:900 24px/1 'SF Mono',Consolas,monospace; color:#374151;">${esc(String(r.previousValue))}</div>
        </div>
        <div style="padding:12px 14px; border-radius:14px; background:rgba(31,41,55); color:#fff; border:1px solid rgba(31,41,55,.3);">
          <div style="font-size:11px; color:#d1d5db; font-weight:800;">本次抄表數值</div>
          <div style="margin-top:6px; font:900 24px/1 'SF Mono',Consolas,monospace;">${esc(String(r.currentValue))}</div>
        </div>
        <div style="padding:12px 14px; border-radius:14px; background:rgba(194,24,91,0.10); border:1.5px solid rgba(194,24,91,0.22);">
          <div style="font-size:11px; color:#9f1c1c; font-weight:800;">本期用量（度)</div>
          <div style="margin-top:6px; font:900 24px/1 'SF Mono',Consolas,monospace; color:#9f1c1c;">${esc(String(u))}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border-radius:14px; background:#fff; border:1.5px solid rgba(46,125,50,0.25);">
        <div style="font-size:13px; color:#374151; font-weight:900;">計算費用</div>
        <div style="font:900 28px/1 'SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif; color:#9f1c1c;">NT$ ${esc(feeText)}</div>
      </div>
      ${ab && ab.length ? `<div style="padding:10px 12px; border-radius:12px; background:rgba(211,47,47,0.08); border:1.5px solid rgba(211,47,47,0.22); color:#9f1c1c; font-size:12px; font-weight:900;">⚠ 異常提醒：${esc(ab.join("、"))}</div>` : ""}
    `;
    modal.hidden = false;
    modal._pendingType = String(typeKey);
    modal._pendingRow = r;
  }

  async function submitOneConfirmed() {
    const modal = $("nlConfirmSubmitModal");
    if (!modal || modal.hidden) return;
    const typeKey = String(modal._pendingType || "");
    const r = modal._pendingRow || null;
    const okBtn = $("btnConfirmSubmitOk");
    const statusEl = $("nlConfirmSubmitStatus");
    if (!typeKey || !r || !METER_TYPES[typeKey] || !MR || !MR.createRecord) { toast("資料遺失，請重新操作"); return; }
    const period = String(r.period || ym()).trim();
    if (isPeriodSubmitted(typeKey, period)) {
      statusBox(statusEl, "本期已申報過，每期僅能申報乙次。", true);
      return;
    }
    okBtn.disabled = true;
    okBtn.classList.add("is-loading");
    okBtn.textContent = "申報中…";
    statusBox(statusEl, "申報中，請稍候...", false);
    setCardSubmitButtonDisabled(typeKey, true);
    const db = firebase.firestore();
    const operatorInfo = {
      uid: state.uid,
      name: state.displayName,
      role: 'resident',
      houseNo: state.houseNo
    };
    let submittedData = null;
    let submitOk = false;
    let errText = "";
    try {
      try {
        const dupSnap = await db.collection("meterReadings")
          .where("communityId", "==", String(state.communityId || ""))
          .where("houseNo", "==", String(r.houseNo || ""))
          .where("meterType", "==", String(r.meterType || ""))
          .where("period", "==", String(r.period || ""))
          .limit(2)
          .get();
        if (dupSnap && !dupSnap.empty) {
          const validExists = dupSnap.docs.some(ds => {
            const d = (ds && ds.exists && ds.data()) || null;
            if (!d) return false;
            const isVoid = String(d.voidStatus || "") === "voided";
            if (isVoid) return false;
            return true;
          });
          if (validExists) {
            state.periodSubmittedByType = computePeriodSubmittedMap(state.records || []);
            saveRecentRecords();
            statusBox(statusEl, "本期已申報過，每期僅能申報乙次。", true);
            okBtn.disabled = false; okBtn.classList.remove("is-loading"); okBtn.textContent = "確認送出";
            setCardSubmitButtonDisabled(typeKey, false);
            return;
          }
        }
      } catch (dupErr) {
        try { console.warn("[number-list] duplicate-check soft failed, continuing submit", dupErr); } catch {}
      }
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
      try { console.log('[number-list] 單項提交抄表:', r.meterType, 'meterId=', r.meterId, 'prev=', r.previousValue, 'cur=', r.currentValue, 'period=', r.period); } catch {}
      const res = await MR.createRecord(db, state.communityId, patch, operatorInfo);
      if (res && res.ok && res.data) {
        submittedData = res.data;
        submitOk = true;
        try { console.log('[number-list] 寫入成功 id=', res.id, 'status=', res.data && res.data.validationStatus); } catch {}
      } else {
        errText = (res && res.errors && res.errors.length) ? res.errors.join("；") : "儲存失敗";
        try { console.error('[number-list] 寫入失敗:', r.meterType, errText, res); } catch {}
      }
    } catch (e) {
      errText = (e && e.message) ? e.message : "儲存失敗";
      try { console.error('[number-list] 異常錯誤:', r.meterType, e); } catch {}
    }
    setLastEditedAt(Date.now());
    if (submitOk && submittedData) {
      try {
        state.records = Array.isArray(state.records) ? state.records : [];
        const existIds = new Set(state.records.map(x => String(x.id || "")));
        const nid = String(submittedData.id || "");
        if (nid && !existIds.has(nid)) state.records.unshift(submittedData);
        const last = state.lastByType || {};
        const nr = submittedData;
        const rd = nr.readingDate ? new Date(nr.readingDate) : null;
        const prevRd = last[typeKey] && last[typeKey].readingDate ? new Date(last[typeKey].readingDate) : null;
        if (!prevRd || (rd && Number.isFinite(rd.getTime()) && rd.getTime() >= prevRd.getTime())) last[typeKey] = nr;
        state.lastByType = last;
        state.periodSubmittedByType = computePeriodSubmittedMap(state.records);
        saveRecentRecords();
      } catch {}
      // 若草稿中其它儀表仍要保留，只清除當前儀表的 cur 避免再次誤帶入
      try {
        const d = lsGet(draftKey(state.uid, state.communityId, state.houseNo), null);
        if (d && d.values && d.values[typeKey]) { d.values[typeKey].cur = ""; delete d.values[typeKey].prev; lsSet(draftKey(state.uid, state.communityId, state.houseNo), d); }
      } catch {}
      statusBox(statusEl, `申報成功：已送交後台管理員審核。每期僅能申報乙次。`, false);
      toast(`已送出 ${METER_TYPES[typeKey].label || typeKey} 抄表申報`);
      window.setTimeout(() => {
        modal.hidden = true;
        renderMeterArea();
        renderHistoryList();
      }, 450);
    } else {
      okBtn.disabled = false;
      okBtn.classList.remove("is-loading");
      okBtn.textContent = "確認送出";
      setCardSubmitButtonDisabled(typeKey, false);
      saveDraftDebounced();
      statusBox(statusEl, `申報失敗：${errText || "請檢查網路或聯絡管理員"}`, true);
      toast(`申報失敗，請檢查輸入或聯絡管理員`);
    }
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

  function setSubmitButtonDisabled(disabled) {
    const btn = $("btnSubmitReadings");
    if (!btn) return;
    btn.disabled = !!disabled;
    btn.classList.toggle("is-loading", !!disabled);
  }

  async function submitAll() {
    if (!MR || !MR.createRecord) { toast("抄錶模組尚未載入"); return; }
    if (!state.uid) { toast("請先登入"); return; }
    const rows = readSubmitForm();
    if (!rows.length) { toast("請至少填寫一項儀表數字再送出"); return; }
    const statusEl = $("nlSubmitStatus");
    setSubmitButtonDisabled(true);
    statusBox(statusEl, "申報中，請稍候...", false);
    const db = firebase.firestore();
    let ok = 0;
    let fail = 0;
    const errs = [];
    const submittedResults = [];
    const operatorInfo = {
      uid: state.uid,
      name: state.displayName,
      role: 'resident',
      houseNo: state.houseNo
    };
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
          try { console.log('[number-list] 提交抄表:', r.meterType, 'meterId=', r.meterId, 'prev=', r.previousValue, 'cur=', r.currentValue); } catch {}
          const res = await MR.createRecord(db, state.communityId, patch, operatorInfo);
          submittedResults.push(res);
          if (res && res.ok) {
            ok += 1;
            try { console.log('[number-list] 寫入成功 id=', res.id, 'status=', res.data && res.data.validationStatus); } catch {}
          } else {
            fail += 1;
            const errMsgs = (res && res.errors && res.errors.length) ? res.errors : ["儲存失敗"];
            const joined = errMsgs.join("；");
            errs.push(`${METER_TYPES[r.meterType].short}：${joined}`);
            try { console.error('[number-list] 寫入失敗:', r.meterType, joined, res); } catch {}
          }
        } catch (e) {
          fail += 1;
          const msg = (e && e.message) ? e.message : "儲存失敗";
          errs.push(`${METER_TYPES[r.meterType].short}：${msg}`);
          try { console.error('[number-list] 異常錯誤:', r.meterType, e); } catch {}
        }
      }
    } catch (e) {
      console.warn('[number-list] submitAll outer error:', e);
    }
    setSubmitButtonDisabled(false);
    setLastEditedAt(Date.now());
    const newlyAdded = [];
    // 先把成功寫入的 record 手動加入前端快取，避免 loadLastRecords 延遲/失敗時歷史空白
    for (let i = submittedResults.length - 1; i >= 0; i--) {
      const sr = submittedResults[i];
      if (sr && sr.ok && sr.data) {
        newlyAdded.push(sr.data);
      }
    }
    await loadLastRecords();
    if (newlyAdded.length) {
      const existIds = new Set(state.records.map(r => String(r.id || "")));
      for (const nr of newlyAdded) {
        const nid = String(nr.id || "");
        if (nid && !existIds.has(nid)) {
          state.records.unshift(nr);
          existIds.add(nid);
        }
      }
      const last = state.lastByType || {};
      for (const nr of newlyAdded) {
        const t = String(nr.meterType || "");
        if (!t) continue;
        const rd = nr.readingDate ? new Date(nr.readingDate) : null;
        const prevRd = last[t] && last[t].readingDate ? new Date(last[t].readingDate) : null;
        if (!prevRd || (rd && Number.isFinite(rd.getTime()) && rd.getTime() >= prevRd.getTime())) {
          last[t] = nr;
        }
      }
      state.lastByType = last;
    }
    if (fail === 0 && ok > 0) {
      clearDraft();
      saveRecentRecords();
      statusBox(statusEl, `申報成功：共 ${ok} 筆已送交後台管理員審核`, false);
      toast(`已送出 ${ok} 筆抄錶申報`);
      switchTab("history");
      renderHistoryList();
    } else if (ok === 0 && fail > 0) {
      saveRecentRecords();
      saveDraftDebounced();
      statusBox(statusEl, `申報失敗（${fail} 筆）：\n${errs.join("\n")}`, true);
      toast(`申報失敗，請檢查輸入`);
    } else {
      saveRecentRecords();
      if (ok > 0) clearDraft(); else saveDraftDebounced();
      statusBox(statusEl, `部分完成：成功 ${ok} / 失敗 ${fail}\n${errs.join("\n")}`, true);
      if (ok > 0) { switchTab("history"); renderHistoryList(); }
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
    const m = String($("nlHistMonth") && $("nlHistMonth").value || "").trim();
    return { meterType, month: m };
  }

  function renderHistoryList() {
    const el = $("nlHistoryList");
    if (!el) return;
    if (!state.uid) {
      el.innerHTML = `<div class="nl-empty">請先登入</div>`;
      return;
    }
    const f = currentHistoryFilters();
    let rows = (Array.isArray(state.records) ? state.records.slice() : []).filter(r => !!METER_TYPES[String(r.meterType || "")]);
    if (f.meterType && f.meterType !== "all") rows = rows.filter((r) => String(r.meterType || "") === f.meterType);
    if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
      rows = rows.filter((r) => {
        const ymText = (() => {
          const rd = r.readingDate;
          const dt = rd ? new Date(rd instanceof Date ? rd : String(rd)) : null;
          if (dt && Number.isFinite(dt.getTime())) return ym(dt);
          const p = String(r.period || "").trim();
          if (p && /^\d{4}-\d{2}/.test(p)) return p.slice(0, 7);
          return "";
        })();
        return ymText === f.month;
      });
    }
    rows.sort((a, b) => (new Date(b.readingDate || 0) - new Date(a.readingDate || 0)));
    if (!rows.length) {
      el.innerHTML = `<div class="nl-empty">尚無符合條件的抄錶申報紀錄</div>`;
      return;
    }
    el.innerHTML = rows.map((r) => renderRecordCard(r)).join("");
    el.querySelectorAll("[data-record-id]").forEach((card) => {
      const id = String(card.getAttribute("data-record-id") || "");
      card.addEventListener("click", (e) => {
        if (e.target && e.target.closest && e.target.closest("[data-record-action]")) return;
        openDetail(id);
      });
      const delBtn = card.querySelector("[data-record-action='delete']");
      if (delBtn) delBtn.addEventListener("click", (e) => { e.stopPropagation(); openDeleteConfirm(id); });
    });
  }

  function renderRecordCard(r) {
    const mt = METER_TYPES[r.meterType] || METER_TYPES.electric;
    const isVoid = String(r.voidStatus || "") === "voided";
    const statusBadge = (() => {
      if (isVoid) return `<span class="tag" style="display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font-size:12px; background:rgba(107,114,128,0.12); color:#4b5563; border:1px solid rgba(107,114,128,0.25);">已作廢</span>`;
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
    const canDelete = !isVoid;
    const delBtnHtml = canDelete
      ? `<button class="btn btn-danger" type="button" data-record-action="delete" style="font-size:12px; padding:4px 10px; border-radius:999px; min-width:64px; font-weight:900;">刪除</button>`
      : `<span style="font-size:11px; color:#9ca3af; font-weight:800;">刪除作廢完成</span>`;
    return `
      <div class="parcel-item" data-record-id="${esc(r.id)}"${isVoid ? ' style="opacity:0.72; filter:grayscale(.25);"' : ''}>
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
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="font-size:18px; font-weight:900; color:#9f1c1c;">NT$ ${esc(feeText)}</div>
              ${delBtnHtml}
            </div>
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

  function openDeleteConfirm(recordId) {
    const modal = $("nlDeleteConfirmModal");
    if (!modal) return;
    const r = state.records.find((x) => String(x.id || "") === String(recordId || ""));
    if (!r) { toast("找不到此筆抄錶紀錄"); return; }
    if (String(r.voidStatus || "") === "voided") { toast("此筆抄錶紀錄已作廢"); return; }
    if (!state.uid) { toast("請先登入"); return; }
    if (String(r.residentUid || r.operatorId || "") !== String(state.uid || "")) {
      toast("您無權刪除此筆抄錶紀錄"); return;
    }
    const mt = METER_TYPES[r.meterType] || METER_TYPES.electric;
    const u = MR && MR.calcUsage ? MR.calcUsage(numOr(r.previousValue,0), numOr(r.currentValue,0), { meterType: r.meterType }) : numOr(r.usage, 0);
    const f = MR && MR.calcFee ? MR.calcFee(u, r.meterType) : 0;
    const feeText = Number.isFinite(f) ? f.toFixed(2) : "0.00";
    const rd = r.readingDate ? (r.readingDate instanceof Date ? r.readingDate : new Date(r.readingDate)) : null;
    const dateText = rd && Number.isFinite(rd.getTime()) ? ymd(rd) : (String(r.period || ym()));
    const body = $("nlDeleteConfirmBody");
    const statusEl = $("nlDeleteConfirmStatus");
    const okBtn = $("btnConfirmDeleteOk");
    statusEl.hidden = true; statusEl.textContent = "";
    okBtn.disabled = false;
    okBtn.classList.remove("is-loading");
    okBtn.textContent = "確認刪除";
    body.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; padding:12px 14px; border-radius:14px; background:linear-gradient(180deg,#fff,#fafafa); border:1px solid rgba(17,24,39,.08);">
        <div style="width:10px;height:10px;border-radius:999px;background:${esc(mt.accent)};"></div>
        <div style="font-weight:900;font-size:16px;">${esc(mt.label)} 抄錶紀錄（${esc(String(r.period || ""))}）</div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px;">
        <div class="field" style="margin:0;">
          <label>儀表編號</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">${esc(String(r.meterId || ""))}</div>
        </div>
        <div class="field" style="margin:0;">
          <label>對應門牌號</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">${esc(String(r.houseNo || ""))}</div>
        </div>
        <div class="field" style="margin:0;">
          <label>抄見日</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">${esc(dateText)}</div>
        </div>
        <div class="field" style="margin:0;">
          <label>建立時間</label>
          <div style="padding:10px 12px; border-radius:12px; background:#f9fafb; border:1px solid rgba(17,24,39,.08); font-weight:800; color:#111827;">${esc(formatDateTime(r.createdAt || r.readingDate))}</div>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px;">
        <div style="padding:12px 14px; border-radius:14px; background:rgba(243,244,246); border:1px solid rgba(17,24,39,.06);">
          <div style="font-size:11px; color:#6b7280; font-weight:800;">上次抄表數值</div>
          <div style="margin-top:6px; font:900 24px/1 'SF Mono',Consolas,monospace; color:#374151;">${esc(String(r.previousValue || 0))}</div>
        </div>
        <div style="padding:12px 14px; border-radius:14px; background:rgba(31,41,55); color:#fff; border:1px solid rgba(31,41,55,.3);">
          <div style="font-size:11px; color:#d1d5db; font-weight:800;">本次抄表數值</div>
          <div style="margin-top:6px; font:900 24px/1 'SF Mono',Consolas,monospace;">${esc(String(r.currentValue || 0))}</div>
        </div>
        <div style="padding:12px 14px; border-radius:14px; background:rgba(194,24,91,0.10); border:1.5px solid rgba(194,24,91,0.22);">
          <div style="font-size:11px; color:#9f1c1c; font-weight:800;">本期用量（度)</div>
          <div style="margin-top:6px; font:900 24px/1 'SF Mono',Consolas,monospace; color:#9f1c1c;">${esc(String(u))}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 14px; border-radius:14px; background:#fff; border:1.5px solid rgba(46,125,50,0.25);">
        <div style="font-size:13px; color:#374151; font-weight:900;">計算費用</div>
        <div style="font:900 28px/1 'SF Pro Display',-apple-system,BlinkMacSystemFont,sans-serif; color:#9f1c1c;">NT$ ${esc(feeText)}</div>
      </div>
    `;
    modal._pendingRecordId = String(recordId || "");
    modal.hidden = false;
  }

  async function deleteOneConfirmed() {
    const modal = $("nlDeleteConfirmModal");
    if (!modal || modal.hidden) return;
    const recordId = String(modal._pendingRecordId || "");
    const okBtn = $("btnConfirmDeleteOk");
    const statusEl = $("nlDeleteConfirmStatus");
    if (!recordId || !state.uid || !window.firebase || !firebase.firestore) return;
    const ridx = (Array.isArray(state.records) ? state.records : []).findIndex(x => String(x.id || "") === recordId);
    if (ridx < 0) { toast("找不到此筆抄錶紀錄"); return; }
    const r = state.records[ridx];
    if (String(r.voidStatus || "") === "voided") { toast("此筆抄錶紀錄已作廢"); return; }
    if (String(r.residentUid || r.operatorId || "") !== String(state.uid || "")) { toast("您無權刪除此筆抄錶紀錄"); return; }
    okBtn.disabled = true;
    okBtn.classList.add("is-loading");
    okBtn.textContent = "刪除中…";
    statusBox(statusEl, "刪除中，請稍候...", false);
    const db = firebase.firestore();
    let opOk = false;
    let errText = "";
    try {
      const recRef = db.collection("communities").doc(String(state.communityId || "")).collection("meterReadings").doc(recordId);
      const patch = {
        voidStatus: "voided",
        voidReason: "resident_self_delete",
        voidAt: firebase.firestore.FieldValue.serverTimestamp(),
        voidByUid: String(state.uid || ""),
        voidByName: String(state.displayName || ""),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      await recRef.set(patch, { merge: true });
      opOk = true;
    } catch (e) {
      errText = (e && e.message) ? e.message : "刪除失敗";
      try { console.error("[number-list] delete failed", recordId, e); } catch {}
    }
    if (opOk) {
      try {
        const newRecords = (Array.isArray(state.records) ? state.records.slice() : []);
        if (newRecords[ridx]) {
          newRecords[ridx] = { ...newRecords[ridx], voidStatus: "voided", voidReason: "resident_self_delete", updatedAt: new Date(), voidAt: new Date(), voidByUid: String(state.uid || ""), voidByName: String(state.displayName || "") };
        }
        state.records = newRecords;
        const last = {};
        for (const rec of state.records) {
          const isVoid = String(rec.voidStatus || "") === "voided";
          if (isVoid) continue;
          const t = String(rec.meterType || "");
          if (!t || !METER_TYPES[t]) continue;
          const rd = rec.readingDate ? new Date(rec.readingDate) : null;
          const prevRd = last[t] && last[t].readingDate ? new Date(last[t].readingDate) : null;
          if (!prevRd || (rd && Number.isFinite(rd.getTime()) && rd.getTime() >= prevRd.getTime())) last[t] = rec;
        }
        state.lastByType = last;
        state.periodSubmittedByType = computePeriodSubmittedMap(state.records);
        saveRecentRecords();
      } catch {}
      statusBox(statusEl, "已刪除 / 作廢此筆抄錶紀錄。若本期需重新申報，可回到申報頁籤輸入即可。", false);
      toast("已刪除抄錶紀錄");
      window.setTimeout(() => {
        modal.hidden = true;
        renderHistoryList();
        renderMeterArea();
        renderFeeArea();
      }, 450);
    } else {
      okBtn.disabled = false;
      okBtn.classList.remove("is-loading");
      okBtn.textContent = "確認刪除";
      statusBox(statusEl, `刪除失敗：${errText || "請檢查網路或聯絡管理員"}`, true);
      toast("刪除失敗，請稍後再試");
    }
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
    const month = $("nlHistMonth");
    const monthReset = $("btnHistMonthReset");
    const reset = $("btnHistReset");
    if (month) {
      if (!month.value) month.value = ym();
      month.addEventListener("change", renderHistoryList);
    }
    if (monthReset) {
      monthReset.addEventListener("click", () => {
        if (month) month.value = "";
        renderHistoryList();
      });
    }
    if (reset) {
      reset.addEventListener("click", () => {
        if (month) month.value = ym();
        const first = tab.querySelector("[data-meter-filter]");
        tab.querySelectorAll("[data-meter-filter]").forEach((x) => x.classList.toggle("active", x === first));
        renderHistoryList();
      });
    }
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
      try { console.log('[number-list] 送出核異 recordId=', state.selectedDetailId, 'reasonLen=', reason.length, 'photos=', photoKeys.length); } catch {}
      const res = await MR.submitDispute(db, state.communityId, state.selectedDetailId, {
        reason,
        photos: photoKeys,
        reporterUid: state.uid,
        reporterName: state.displayName,
        reporterHouseNo: state.houseNo,
      });
      if (res && res.ok) {
        statusBox(st, "核異已送出，管理員將儘速與您聯繫", false);
        toast("已送出核異申請");
        try { console.log('[number-list] 核異送出成功 disputeId=', res.dispute && res.dispute.id); } catch {}
        window.setTimeout(() => {
          const m = $("nlDisputeModal"); if (m) m.hidden = true;
          const dm = $("nlDetailModal"); if (dm) dm.hidden = true;
          loadLastRecords().then(renderHistoryList);
        }, 700);
      } else {
        const errs = (res && res.errors && res.errors.length) ? res.errors.join("；") : "請稍後再試";
        statusBox(st, `送出失敗：${errs}`, true);
        try { console.error('[number-list] 核異送出失敗:', errs, res); } catch {}
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : "請稍後再試";
      statusBox(st, `送出失敗：${msg}`, true);
      try { console.error('[number-list] 核異送出異常:', e); } catch {}
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ""; }
    }
  }

  function renderFeeArea() {
    const el = $("nlFeeArea");
    if (!el) return;
    if (!state.uid) { el.innerHTML = `<div class="nl-empty">請先登入</div>`; return; }
    const period = String($("nlFeePeriod") && $("nlFeePeriod").value || ym()).trim() || ym();
    const rows = state.records.filter((r) => String(r.period || "") === period && String(r.voidStatus || "") !== "voided");
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
    const bConf = $("btnConfirmSubmitOk");
    if (bConf && !bConf._bound) { bConf._bound = true; bConf.addEventListener("click", submitOneConfirmed); }
    const bDel = $("btnConfirmDeleteOk");
    if (bDel && !bDel._bound) { bDel._bound = true; bDel.addEventListener("click", deleteOneConfirmed); }
  }

  function bindMainForm() {
    const period = $("nlPeriod"); const date = $("nlReadDate");
    if (period && !period.value) period.value = ym();
    if (date && !date.value) date.value = ymd();
    const fp = $("nlFeePeriod");
    if (fp && !fp.value) fp.value = ym();
    if (!document.body._meterSubmitBound) {
      document.body._meterSubmitBound = true;
      document.body.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest && e.target.closest("[data-meter-submit]");
        if (!btn) return;
        const t = String(btn.getAttribute("data-meter-submit") || "");
        if (!t || !METER_TYPES[t]) return;
        openSubmitConfirm(t);
      });
    }
    document.addEventListener("input", (e) => {
      const isMeterInput = e.target && e.target.matches && (e.target.matches("[data-meter-cur], [data-meter-id], [data-meter-skip]"));
      if (isMeterInput || e.target === period || e.target === date) {
        saveDraftDebounced();
      }
    });
    document.addEventListener("change", (e) => {
      const chk = e.target && e.target.closest && e.target.closest("[data-meter-skip]");
      if (chk) saveDraftDebounced();
      if (e.target === period || e.target === date) { saveDraftDebounced(); renderMeterArea(); }
    });
  }

  async function boot() {
    updateHeaderTitle();
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
    setLastEditedAt();
    const initialHistMonth = $("nlHistMonth");
    if (initialHistMonth && !initialHistMonth.value) initialHistMonth.value = ym();
    renderMeterArea();
    const db = firebase.firestore();
    try { db.settings({ ignoreUndefinedProperties: true }); } catch {}
    window.addEventListener("message", (ev) => {
      try {
        const p = ev && ev.data;
        if (!p || typeof p !== "object") return;
        if (p.type !== "nwapp:meterSettingsSaved") return;
        if (p.communityId && String(p.communityId) !== String(state.communityId)) return;
        (async () => {
          try {
            if (MR && MR.loadCommunityMeterSettings) {
              await MR.loadCommunityMeterSettings(db, state.communityId, true);
            }
            getMeterTypesCopy();
            renderHistoryFilterButtons();
            renderMeterArea();
            renderHistoryList();
            renderFeeArea();
          } catch(e) { console.warn("[number-list] meterSettings postMessage reload failed", e); }
        })();
      } catch {}
    });
    let __lastSettingsSyncAt = 0;
    window.addEventListener("storage", (ev) => {
      try {
        if (!ev || ev.key !== "nwapp:meterSettingsChanged") return;
        const raw = ev && ev.newValue;
        if (!raw) return;
        const d = JSON.parse(raw);
        if (!d || !d.communityId) return;
        if (String(d.communityId) !== String(state.communityId)) return;
        const at = Number(d.at) || 0;
        if (at && at <= __lastSettingsSyncAt) return;
        __lastSettingsSyncAt = at;
        (async () => {
          try {
            if (MR && MR.loadCommunityMeterSettings) {
              await MR.loadCommunityMeterSettings(db, state.communityId, true);
            }
            getMeterTypesCopy();
            renderHistoryFilterButtons();
            renderMeterArea();
            renderHistoryList();
            renderFeeArea();
          } catch(e) { console.warn("[number-list] meterSettings storage reload failed", e); }
        })();
      } catch {}
    });
    firebase.auth().onAuthStateChanged(async (user) => {
      await loadUserProfile(user || null);
      if (!user) {
        try {
          const url = `member.html?redirect=${encodeURIComponent("number-list.html")}`;
          toast("請先登入住戶帳號，3 秒後跳轉...");
          window.setTimeout(() => { location.href = url; }, 2200);
        } catch {}
        return;
      }
      setLastEditedAt();
      await loadLastRecords();
      const historyMonthEl = $("nlHistMonth");
      if (historyMonthEl && !historyMonthEl.value) historyMonthEl.value = ym();
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
  window.__nlDebug = {
    getMeterTypes: () => { try { return JSON.parse(JSON.stringify(METER_TYPES)); } catch(e) { return {}; } },
    forceReloadSettings: async () => {
      try {
        const db = firebase.firestore();
        if (MR && MR.loadCommunityMeterSettings) {
          await MR.loadCommunityMeterSettings(db, state.communityId, true);
        }
        getMeterTypesCopy();
        renderHistoryFilterButtons();
        renderMeterArea();
        renderHistoryList();
        renderFeeArea();
        return { ok: true, METER_TYPES: JSON.parse(JSON.stringify(METER_TYPES)) };
      } catch(e) { return { ok: false, err: String(e && e.message || e) }; }
    },
    getState: () => { try { return JSON.parse(JSON.stringify({ communityId: state.communityId, uid: state.uid, houseNo: state.houseNo })); } catch(e){ return {}; } }
  };
})();
