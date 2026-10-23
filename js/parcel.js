(function () {
  'use strict';

  // 初始化 Firebase
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) {
    console.error("Missing FIREBASE_CONFIG");
  }

  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    // 如果已经初始化过，会抛出错误，我们可以忽略
    console.log("Firebase already initialized or error:", e);
  }

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

  const tabBtns = document.querySelectorAll('.tab-btn');
  const unclaimedList = document.getElementById('unclaimedList');
  const claimedList = document.getElementById('claimedList');
  const tempList = document.getElementById('tempList');
  const communityParcelTitle = document.getElementById('communityParcelTitle');
  const parcelBody = document.querySelector('.parcel-bd');

  const PARCEL_OVERDUE_DEFAULT = 3;

  /* 頁面狀態（清單／篩選／逾期設定／連線狀態） */
  const state = {
    userData: null,
    cid: '',
    parcels: [],
    tempItems: [],
    overdueDays: PARCEL_OVERDUE_DEFAULT,
    query: '',
    loading: true,
    error: '',
    hint: '',
    tab: 'unclaimed',
  };

  const SEARCH_PLACEHOLDER = {
    unclaimed: '搜尋物流單號／物流公司',
    claimed: '搜尋物流單號／物流公司',
    temp: '搜尋物品／暫寄人',
  };

  let parcelUnsubs = [];
  let reloadTimer = null;

  function switchTab(tab) {
    state.tab = tab === 'claimed' || tab === 'temp' ? tab : 'unclaimed';

    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === state.tab);
    });

    if (unclaimedList) unclaimedList.classList.toggle('hidden', state.tab !== 'unclaimed');
    if (claimedList) claimedList.classList.toggle('hidden', state.tab !== 'claimed');
    if (tempList) tempList.classList.toggle('hidden', state.tab !== 'temp');

    const input = document.getElementById('parcelSearchInput');
    if (input) input.placeholder = SEARCH_PLACEHOLDER[state.tab] || SEARCH_PLACEHOLDER.unclaimed;

    renderSummary(state.parcels.filter((p) => !isReceivedParcel(p)));
    if (parcelBody) parcelBody.scrollTop = 0;
  }

  function goBack() {
    if (window.opener && !window.opener.closed) {
      window.close();
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'member.html';
    }
  }

  function loadUserInfo() {
    communityParcelTitle.textContent = '戶號 姓名';
  }

  function nameFromEmail(email) {
    const e = String(email || '').trim();
    if (!e) return '';
    const part = e.split('@')[0] || '';
    return String(part || '').trim();
  }

  function pickInitial(displayName, email) {
    const s = String(displayName || '').trim() || String(email || '').trim();
    return s ? s.slice(0, 1).toUpperCase() : 'U';
  }

  function ensureDb() {
    return db;
  }

  function fromFirestoreValue(v) {
    if (!v || typeof v !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(v, "stringValue")) return String(v.stringValue || "");
    if (Object.prototype.hasOwnProperty.call(v, "integerValue")) return Number(v.integerValue);
    if (Object.prototype.hasOwnProperty.call(v, "doubleValue")) return Number(v.doubleValue);
    if (Object.prototype.hasOwnProperty.call(v, "booleanValue")) return Boolean(v.booleanValue);
    if (Object.prototype.hasOwnProperty.call(v, "nullValue")) return null;
    if (Object.prototype.hasOwnProperty.call(v, "timestampValue")) {
      const s = String(v.timestampValue || "").trim();
      const d = s ? new Date(s) : null;
      return d && !Number.isNaN(d.getTime()) ? d : s;
    }
    if (Object.prototype.hasOwnProperty.call(v, "mapValue")) {
      const fields = v.mapValue && v.mapValue.fields ? v.mapValue.fields : {};
      const out = {};
      for (const k of Object.keys(fields || {})) out[k] = fromFirestoreValue(fields[k]);
      return out;
    }
    if (Object.prototype.hasOwnProperty.call(v, "arrayValue")) {
      const values = v.arrayValue && Array.isArray(v.arrayValue.values) ? v.arrayValue.values : [];
      return values.map(fromFirestoreValue);
    }
    return null;
  }

  async function fetchParcelsViaRest(communityId) {
    const cfg = window.FIREBASE_CONFIG || {};
    const projectId = String(cfg.projectId || "").trim();
    const user = auth.currentUser;
    if (!projectId || !user || typeof user.getIdToken !== "function") throw new Error("rest-precheck-failed");
    const idToken = await user.getIdToken();
    const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
    const url = `${base}/communities/${encodeURIComponent(String(communityId || ""))}/parcels?pageSize=200`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!res.ok) {
      const err = new Error(`rest-${res.status}`);
      if (res.status === 401 || res.status === 403) err.code = "permission-denied";
      throw err;
    }
    const json = await res.json();
    const docs = Array.isArray(json && json.documents) ? json.documents : [];
    return docs.map((d) => {
      const name = String(d && d.name ? d.name : "");
      const id = name ? name.split("/").pop() : "";
      const fields = d && d.fields ? d.fields : {};
      const data = {};
      for (const k of Object.keys(fields || {})) data[k] = fromFirestoreValue(fields[k]);
      return { id, ...data };
    });
  }

  async function resolveCommunityId(keyOverride) {
    const STORAGE_ACTIVE_COMMUNITY = 'csp_active_community_v1';
    const keyFromUrl = (() => {
      try {
        const urlParams = new URLSearchParams(location.search);
        return String(urlParams.get('c') || '').trim();
      } catch {
        return '';
      }
    })();
    const saved = (() => {
      try { return String(localStorage.getItem(STORAGE_ACTIVE_COMMUNITY) || '').trim(); } catch { return ''; }
    })();
    const key = String(keyOverride || '').trim() || keyFromUrl || saved;
    if (!key) return 'default';
    if (saved && saved === key) return saved;

    try {
      const byIdSnap = await db.collection('communities').where('id', '==', key).limit(1).get();
      const byId = byIdSnap && byIdSnap.docs && byIdSnap.docs[0] ? byIdSnap.docs[0] : null;
      if (byId && byId.exists) {
        const v = byId.data() || {};
        const cid = String(v.id || byId.id || '').trim() || 'default';
        try { localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid); } catch {}
        return cid;
      }
    } catch {}
    try {
      const byUserSnap = await db.collection('communities').where('username', '==', key).limit(1).get();
      const byUser = byUserSnap && byUserSnap.docs && byUserSnap.docs[0] ? byUserSnap.docs[0] : null;
      if (byUser && byUser.exists) {
        const v = byUser.data() || {};
        const cid = String(v.id || byUser.id || '').trim() || 'default';
        try { localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid); } catch {}
        return cid;
      }
    } catch {}
    return key;
  }

  function readCommunityCandidates(userData) {
    const out = [];
    const push = (v) => {
      const s = String(v || '').trim();
      if (!s) return;
      if (out.includes(s)) return;
      out.push(s);
    };
    push(userData?.__communityId);
    push(userData?.community);
    try { push(new URLSearchParams(location.search).get('c')); } catch {}
    try { push(localStorage.getItem('csp_active_community_v1')); } catch {}
    return out.length ? out : ['default'];
  }

  /* ===================== 住戶端查件：共用工具 ===================== */

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function toDateValue(v) {
    if (!v) return null;
    try {
      if (typeof v.toDate === 'function') return v.toDate();
      const d = v instanceof Date ? v : new Date(v);
      return d && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fmtMD(d) {
    return d ? `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}` : '—';
  }

  function parcelAgeDays(p) {
    const d = toDateValue(p && p.createdAt);
    if (!d) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }

  function isReceivedParcel(p) {
    return Boolean(p) && (p.status === 'received' || Boolean(p.claimed));
  }

  function searchHaystack(p) {
    return [p.company, p.trackNo, p.internalSerial, p.type, p.note, p.shelf, p.recipient]
      .map((x) => String(x || ''))
      .join(' ')
      .toLowerCase();
  }

  /* ===================== 住戶端查件：渲染 ===================== */

  function renderParcelItem(p) {
    const company = String(p.company || '').trim() || '其他物流';
    const trackNo = String(p.trackNo || '').trim() || '—';
    const type = String(p.type || '').trim() || '一般包裹';
    const serial = String(p.internalSerial || '').trim();
    const shelf = String(p.shelf || '').trim();
    const note = String(p.note || '').trim();
    const proxy = String(p.receivedForProxy || '').trim();
    const received = isReceivedParcel(p);
    const age = parcelAgeDays(p);
    const overdue = !received && age >= state.overdueDays;

    const meta = [];
    if (serial) meta.push(`<span class="parcel-meta-item"><b>編號</b>${escapeHtml(serial)}</span>`);
    if (shelf) meta.push(`<span class="parcel-meta-item"><b>儲位</b>${escapeHtml(shelf)}</span>`);
    meta.push(`<span class="parcel-meta-item"><b>類型</b>${escapeHtml(type)}</span>`);

    return `
      <div class="parcel-item${overdue ? ' is-overdue' : ''}">
        <div class="parcel-item-hd">
          <div class="parcel-company">${escapeHtml(company)}</div>
          <div class="parcel-status ${received ? 'claimed' : 'unclaimed'}">${received ? '已領取' : (overdue ? '逾期未領' : '未領取')}</div>
        </div>
        <div class="parcel-track">${escapeHtml(trackNo)}</div>
        <div class="parcel-meta">${meta.join('')}</div>
        ${note ? `<div class="parcel-note">備註：${escapeHtml(note)}</div>` : ''}
        <div class="parcel-times">
          <span>到貨：${fmtDateTime(toDateValue(p.createdAt))}</span>
          ${received
            ? `<span>領取：${fmtDateTime(toDateValue(p.receivedAt || p.claimedAt))}</span>`
            : `<span class="parcel-age${overdue ? ' over' : ''}">已到貨 ${age} 天</span>`}
        </div>
        ${received && proxy ? `<div class="parcel-proxy">代領人：${escapeHtml(proxy)}</div>` : ''}
      </div>
    `;
  }

  function tempDirectionLabel(v) {
    return String(v || '').trim() === 'resident_to_guest' ? '住戶暫寄 → 訪客' : '訪客暫寄 → 住戶';
  }

  function isTempDone(t) {
    return String((t && t.status) || 'pending') === 'done';
  }

  function tempHaystack(t) {
    return [t.itemName, t.guestName, t.guestPhone, t.note, t.residentName, t.unit]
      .map((x) => String(x || ''))
      .join(' ')
      .toLowerCase();
  }

  function renderTempItem(t) {
    const done = isTempDone(t);
    const itemName = String(t.itemName || '').trim() || '未填物品';
    const qty = String(t.itemQty || '').trim();
    const unit = String(t.unit || '').trim();
    const residentName = String(t.residentName || '').trim();
    const guest = [String(t.guestName || '').trim(), String(t.guestPhone || '').trim()].filter(Boolean).join(' ');
    const note = String(t.note || '').trim();
    const handler = String(t.doneByName || t.doneByAccount || '').trim();

    const meta = [];
    if (unit) meta.push(`<span class="parcel-meta-item"><b>戶號</b>${escapeHtml(unit)}</span>`);
    if (residentName) meta.push(`<span class="parcel-meta-item"><b>住戶</b>${escapeHtml(residentName)}</span>`);

    return `
      <div class="parcel-item">
        <div class="parcel-item-hd">
          <div class="parcel-company">${escapeHtml(tempDirectionLabel(t.direction))}</div>
          <div class="parcel-status ${done ? 'claimed' : 'unclaimed'}">${done ? '已結案' : '待領取'}</div>
        </div>
        <div class="parcel-track">${escapeHtml(itemName)}${qty ? ` ×${escapeHtml(qty)}` : ''}</div>
        ${meta.length ? `<div class="parcel-meta">${meta.join('')}</div>` : ''}
        ${guest ? `<div class="parcel-meta"><span class="parcel-meta-item"><b>暫寄人</b>${escapeHtml(guest)}</span></div>` : ''}
        ${note ? `<div class="parcel-note">備註：${escapeHtml(note)}</div>` : ''}
        <div class="parcel-times">
          <span>暫寄：${fmtDateTime(toDateValue(t.createdAt))}</span>
          ${done ? `<span>結案：${fmtDateTime(toDateValue(t.doneAt))}</span>` : ''}
        </div>
        ${done && handler ? `<div class="parcel-proxy">經手：${escapeHtml(handler)}</div>` : ''}
      </div>
    `;
  }

  const EMPTY_ICON = `<svg class="parcel-empty-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M3 8.5 12 13l9-4.5M12 13v7" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;

  function emptyHtml(title, desc) {
    return `<div class="parcel-empty">${EMPTY_ICON}
      <div class="parcel-empty-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="parcel-empty-desc">${escapeHtml(desc)}</div>` : ''}
    </div>`;
  }

  function skeletonHtml(count) {
    return new Array(count || 3).fill(0).map(() => `
      <div class="parcel-skeleton">
        <div class="sk-line w40"></div>
        <div class="sk-line tall w80"></div>
        <div class="sk-line w60"></div>
      </div>
    `).join('');
  }

  function setTabCount(el, n) {
    if (!el) return;
    const num = Number(n) || 0;
    el.hidden = num <= 0;
    el.textContent = String(num);
  }

  function renderSummary(unclaimed) {
    const el = document.getElementById('parcelSummary');
    if (!el) return;
    if (state.tab === 'temp' || state.loading || state.error) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    const overdue = (unclaimed || []).filter((p) => parcelAgeDays(p) >= state.overdueDays).length;
    const latest = (unclaimed || [])
      .map((p) => toDateValue(p.createdAt))
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    el.innerHTML = `
      <div class="psum-item"><span class="psum-num">${(unclaimed || []).length}</span><span class="psum-label">未領取</span></div>
      <div class="psum-item${overdue ? ' danger' : ''}"><span class="psum-num">${overdue}</span><span class="psum-label">逾期未領</span></div>
      <div class="psum-item"><span class="psum-num">${fmtMD(latest)}</span><span class="psum-label">最近到貨</span></div>
    `;
    el.hidden = false;
  }

  function renderLists() {
    if (!unclaimedList || !claimedList) return;

    if (state.loading) {
      unclaimedList.innerHTML = skeletonHtml(3);
      claimedList.innerHTML = skeletonHtml(2);
      if (tempList) tempList.innerHTML = skeletonHtml(2);
      return;
    }

    if (state.error) {
      unclaimedList.innerHTML = `<div class="status error">${escapeHtml(state.error)}</div>`;
      claimedList.innerHTML = '';
      if (tempList) tempList.innerHTML = '';
      setTabCount(document.getElementById('unclaimedCount'), 0);
      setTabCount(document.getElementById('claimedCount'), 0);
      setTabCount(document.getElementById('tempCount'), 0);
      renderSummary([]);
      return;
    }

    const q = String(state.query || '').trim().toLowerCase();
    const all = Array.isArray(state.parcels) ? state.parcels : [];
    const filtered = q ? all.filter((p) => searchHaystack(p).indexOf(q) >= 0) : all;
    const unclaimed = filtered.filter((p) => !isReceivedParcel(p));
    const claimed = filtered.filter((p) => isReceivedParcel(p));

    unclaimedList.innerHTML = unclaimed.length
      ? unclaimed.map(renderParcelItem).join('')
      : emptyHtml(
          q ? '沒有符合的包裹' : (state.hint || '目前沒有未領取的包裹'),
          q ? '試試其他關鍵字，或清除搜尋條件。'
            : (state.hint ? '設定完成後重新整理即可看到包裹動態。' : '有新包裹到貨時會顯示在這裡。')
        );

    claimedList.innerHTML = claimed.length
      ? claimed.map(renderParcelItem).join('')
      : emptyHtml(q ? '沒有符合的包裹' : '目前沒有已領取的包裹', q ? '試試其他關鍵字，或清除搜尋條件。' : '');

    if (tempList) {
      const allTemp = Array.isArray(state.tempItems) ? state.tempItems : [];
      const tempFiltered = q ? allTemp.filter((t) => tempHaystack(t).indexOf(q) >= 0) : allTemp;
      tempList.innerHTML = tempFiltered.length
        ? tempFiltered.map(renderTempItem).join('')
        : emptyHtml(
            q ? '沒有符合的暫寄物' : (state.hint || '目前沒有暫寄物'),
            q ? '試試其他關鍵字，或清除搜尋條件。'
              : (state.hint ? '設定完成後重新整理即可看到暫寄物。' : '有物品暫寄時會顯示在這裡。')
          );
      setTabCount(document.getElementById('tempCount'), tempFiltered.length);
    }

    setTabCount(document.getElementById('unclaimedCount'), unclaimed.length);
    setTabCount(document.getElementById('claimedCount'), claimed.length);
    renderSummary(unclaimed);
  }

  /* ===================== 住戶端查件：即時更新 ===================== */

  function stopParcelWatch() {
    (parcelUnsubs || []).forEach((fn) => {
      try { fn(); } catch {}
    });
    parcelUnsubs = [];
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  }

  function scheduleReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      if (state.userData) loadParcels(state.userData, { silent: true });
    }, 600);
  }

  /**
   * 監聽本戶包裹的即時變化（僅以 unit 等值查詢，符合 Firestore 安全規則）。
   * 有變化時以去抖方式重新載入一次，避免頻繁重繪。
   */
  function watchParcelChanges(cid, keys) {
    stopParcelWatch();
    const communityId = String(cid || '').trim();
    const watchKeys = Array.from(new Set((keys || [])
      .map((k) => String(k || '').trim())
      .filter(Boolean))).slice(0, 3);
    if (!communityId || !watchKeys.length) return;

    ['parcels', 'tempItems'].forEach((colName) => {
      watchKeys.forEach((key) => {
        try {
          let prev = null;
          const unsub = db.collection('communities').doc(communityId).collection(colName)
            .where('unit', '==', key)
            .limit(200)
            .onSnapshot((snap) => {
              const docs = snap && snap.docs ? snap.docs : [];
              const sig = docs
                .map((d) => `${d.id}:${String((d.data() || {}).status || 'pending')}`)
                .sort()
                .join('|');
              if (prev === null) { prev = sig; return; }
              if (sig === prev) return;
              prev = sig;
              scheduleReload();
            }, () => {});
          parcelUnsubs.push(unsub);
        } catch {}
      });
    });
  }

  async function loadParcelConfig(cid) {
    const communityId = String(cid || '').trim();
    if (!communityId) return PARCEL_OVERDUE_DEFAULT;
    try {
      const doc = await db.collection('communities').doc(communityId).collection('settings').doc('parcel_config').get();
      const v = doc && doc.exists ? (doc.data() || {}) : {};
      const n = Number(v.overdueDays);
      return Number.isFinite(n) && n > 0 ? Math.min(60, Math.round(n)) : PARCEL_OVERDUE_DEFAULT;
    } catch {
      return PARCEL_OVERDUE_DEFAULT;
    }
  }

  /* ===================== 住戶端查件：資料載入 ===================== */

  async function loadParcels(userData, opts) {
    const silent = Boolean(opts && opts.silent);
    state.userData = userData || state.userData || {};

    if (!silent) {
      state.loading = true;
      state.error = '';
      state.hint = '';
      renderLists();
    }

    const data = state.userData;
    const candidates = readCommunityCandidates(data);
    const normalizeDash = (s) => String(s || "").replace(/[－–—]/g, "-").trim();
    const normalizeKey = (s) => normalizeDash(s).replace(/\s+/g, "");
    const houseNo = normalizeDash(data?.houseNo || data?.unit || '');
    const subHouseNo = normalizeDash(data?.subHouseNo || data?.subUnit || data?.sub || '');
    const fullHouseNo = houseNo ? (subHouseNo ? `${houseNo}-${subHouseNo}` : houseNo) : "";
    const variants = new Set();
    [houseNo, fullHouseNo].forEach((x) => {
      const v = normalizeDash(x);
      if (!v) return;
      variants.add(v);
      const idx = v.indexOf("-");
      if (idx > 0) {
        const base = normalizeDash(v.slice(0, idx));
        if (base) variants.add(base);
      }
    });
    const houseKeys = Array.from(variants);
    const houseQueryKeys = Array.from(new Set(houseKeys.flatMap((k) => {
      const v = String(k || "").trim();
      if (!v) return [];
      return [v, v.replace(/-/g, "－")];
    })));
    const houseMatchKeys = Array.from(new Set(houseKeys.flatMap((k) => {
      const v = normalizeKey(k);
      if (!v) return [];
      return [v, normalizeKey(String(k || "").replace(/-/g, "－"))];
    })));
    const recipientKey = normalizeDash(data?.__displayName || data?.displayName || data?.name || '');
    const baseKey = (() => {
      const base = String(houseNo || fullHouseNo || "").trim();
      const idx = base.indexOf("-");
      const v = idx > 0 ? base.slice(0, idx) : base;
      return normalizeKey(v);
    })();

    if (!houseKeys.length) {
      state.loading = false;
      state.parcels = [];
      state.error = '';
      state.hint = '尚未設定戶號';
      renderLists();
      return;
    }

    const tryLoadByCommunityId = async (communityId) => {
      const parcelsRef = db.collection('communities').doc(communityId).collection('parcels');

      let lastCode = "";
      let pendingTotal = 0;
      let didFetch = false;

      const matchesParcel = (d) => {
        const unitRaw = d ? (d.unit || d.houseNo || "") : "";
        const unitKey = normalizeKey(unitRaw);
        const unitUpper = normalizeDash(unitRaw).toUpperCase().replace(/\s+/g, "");
        const recipientRaw = d ? String(d.recipient || "") : "";
        const recipientNorm = normalizeDash(recipientRaw);
        const recipientMatch = Boolean(recipientKey) && recipientNorm === recipientKey;
        const baseUpper = String(baseKey || "").toUpperCase();
        const fullUpper = normalizeDash(fullHouseNo).toUpperCase().replace(/\s+/g, "");

        const containsKey = (hay, needle) => {
          const h = String(hay || "");
          const n = String(needle || "");
          if (!h || !n) return false;
          const idx = h.indexOf(n);
          if (idx < 0) return false;
          const prev = idx > 0 ? h.charAt(idx - 1) : "";
          const next = idx + n.length < h.length ? h.charAt(idx + n.length) : "";
          if (prev && /[A-Z0-9]/.test(prev)) return false;
          if (next && /[0-9]/.test(next)) return false;
          return true;
        };

        if (unitKey && houseMatchKeys.includes(unitKey)) return true;
        if (baseKey && (unitKey === baseKey || unitKey.startsWith(`${baseKey}-`))) return true;
        if (baseKey && unitKey.startsWith(baseKey) && unitKey.length > baseKey.length) {
          const ch = unitKey.charAt(baseKey.length);
          if (ch && !/[0-9]/.test(ch)) return true;
        }
        if (containsKey(unitUpper, fullUpper)) return true;
        if (containsKey(unitUpper, baseUpper)) return true;
        if (recipientMatch) {
          if (!unitKey) return true;
          if (baseKey && unitKey.startsWith(baseKey)) return true;
        }
        return false;
      };

      const parcels = [];
      const seen = new Set();
      const push = (doc) => {
        if (!doc || !doc.id || seen.has(doc.id)) return;
        const d = doc.data ? (doc.data() || {}) : {};
        if (!matchesParcel(d)) return;
        seen.add(doc.id);
        if (String(d.status || "") === "pending") pendingTotal += 1;
        parcels.push({ id: doc.id, ...d });
      };

      const fetchByFieldEq = async (field, value) => {
        try {
          const snap = await parcelsRef.where(field, '==', value).limit(200).get();
          didFetch = true;
          if (snap && snap.forEach) snap.forEach(push);
        } catch (err) {
          lastCode = String(err && err.code ? err.code : lastCode);
        }
      };

      for (const k of houseQueryKeys) {
        await fetchByFieldEq('unit', k);
        await fetchByFieldEq('houseNo', k);
      }
      if (recipientKey) {
        await fetchByFieldEq('recipient', recipientKey);
      }

      if (!parcels.length) {
        try {
          const restDocs = await fetchParcelsViaRest(communityId);
          restDocs.forEach((d) => {
            const fake = { id: String(d.id || ""), data: () => d };
            push(fake);
          });
        } catch (e) {
          lastCode = String(e && (e.code || e.message) ? (e.code || e.message) : lastCode);
        }
      }

      // 暫寄物（規則僅允許以 unit 等值查詢）
      const tempRef = db.collection("communities").doc(communityId).collection("tempItems");
      const tempItems = [];
      const seenTemp = new Set();
      for (const k of houseQueryKeys) {
        try {
          const snap = await tempRef.where('unit', '==', k).limit(200).get();
          const docs = snap && snap.docs ? snap.docs : [];
          docs.forEach((doc) => {
            if (!doc || !doc.id || seenTemp.has(doc.id)) return;
            seenTemp.add(doc.id);
            tempItems.push({ id: doc.id, ...(doc.data() || {}) });
          });
        } catch {}
      }

      if (!parcels.length && String(lastCode || "").includes("permission-denied")) {
        return { parcels: [], tempItems, pendingTotal, error: "permission-denied" };
      }
      return { parcels, tempItems, pendingTotal, error: "" };
    };

    try {
      let resolvedCommunityId = "";
      let result = { parcels: [], tempItems: [], pendingTotal: 0, error: "" };
      for (const key of candidates) {
        const cid = await resolveCommunityId(key);
        if (!cid) continue;
        const r = await tryLoadByCommunityId(cid);
        if (r.error === "permission-denied") {
          result = r;
          resolvedCommunityId = cid;
          break;
        }
        if (!resolvedCommunityId) {
          result = r;
          resolvedCommunityId = cid;
        }
        if ((r.parcels && r.parcels.length) || (r.tempItems && r.tempItems.length)) {
          result = r;
          resolvedCommunityId = cid;
          break;
        }
      }

      const parcels = result.parcels || [];
      if (!parcels.length && !(result.tempItems || []).length && result.error === "permission-denied") {
        state.loading = false;
        state.error = '沒有權限讀取包裹資料';
        renderLists();
        return;
      }

      // 按建立時間排序（最新在前）
      parcels.sort((a, b) => {
        const ta = toDateValue(a.createdAt) || toDateValue(a.arrivedAt);
        const tb = toDateValue(b.createdAt) || toDateValue(b.arrivedAt);
        return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
      });

      const tempItems = result.tempItems || [];
      tempItems.sort((a, b) => {
        const ta = toDateValue(a.createdAt);
        const tb = toDateValue(b.createdAt);
        return (tb ? tb.getTime() : 0) - (ta ? ta.getTime() : 0);
      });

      state.parcels = parcels;
      state.tempItems = tempItems;
      state.cid = resolvedCommunityId;
      state.error = '';
      state.hint = '';
      state.loading = false;
      state.overdueDays = await loadParcelConfig(resolvedCommunityId);
      renderLists();

      if (!silent) watchParcelChanges(resolvedCommunityId, houseKeys);
    } catch (e) {
      console.error('Error loading parcels:', e);
      state.loading = false;
      state.error = '載入包裹失敗，請稍後再試';
      state.parcels = [];
      renderLists();
    }
  }

  async function loadProfile(user) {
    if (!user) return;

    const nameTextEl = document.getElementById('profileNameText');
    const profileAvatarImg = document.getElementById('profileAvatarImg');
    const profileAvatar = document.getElementById('profileAvatarFallback');
    const houseNoTextEl = document.getElementById('profileHouseNoText');

    const initial = pickInitial(user.displayName, user.email);
    if (profileAvatar) profileAvatar.textContent = initial;

    // 先用基本信息更新标题
    const basicName = String(user.displayName || nameFromEmail(user.email) || '姓名').trim();
    communityParcelTitle.textContent = `戶號 ${basicName}`;

    let data = {};
    try {
      const doc = await db.collection('users').doc(String(user.uid)).get();
      if (doc.exists) {
        data = doc.data() || {};
      }

      // 如果从 uid 没找到，尝试通过 email 查找
      if (!data || !Object.keys(data).length) {
        const email = String(user.email || '').trim();
        if (email) {
          const snap = await db.collection('users').where('email', '==', email).limit(1).get();
          if (snap.size > 0) {
            data = snap.docs[0].data() || {};
          }
        }
      }
    } catch (e) {
      console.error('Error fetching user data:', e);
      data = {};
    }

    const displayName = String(
      data.displayName ||
      data.name ||
      data.fullName ||
      user.displayName ||
      nameFromEmail(user.email) ||
      ''
    ).trim();
    if (nameTextEl) nameTextEl.textContent = displayName || '—';
    const initial2 = pickInitial(displayName, user.email);
    if (profileAvatar) profileAvatar.textContent = initial2;

    const houseNo = String(data.houseNo || data.unit || '').trim();
    const subHouseNo = String(data.subHouseNo || data.subUnit || data.sub || '').trim();
    let fullHouseNo = houseNo;
    if (subHouseNo) {
      fullHouseNo = `${houseNo}-${subHouseNo}`;
    }

    communityParcelTitle.textContent = `${fullHouseNo || '戶號'} ${displayName || '姓名'}`;

    if (houseNoTextEl) {
      houseNoTextEl.textContent = fullHouseNo || '—';
    }

    const avatarUrl = String(data.avatarDataUrl || data.photoDataUrl || data.photoURL || user.photoURL || '').trim();
    if (avatarUrl && profileAvatarImg) {
      profileAvatarImg.src = avatarUrl;
      profileAvatarImg.style.display = 'block';
      if (profileAvatar) profileAvatar.style.display = 'none';
    }

    // 載入包裹資料
    await loadParcels({ ...data, __displayName: displayName || '', __communityId: String(data.community || '').trim() });
  }

  function showToast(message, isError) {
    const statusEl = document.getElementById('profileStatus');
    if (!statusEl) return;
    statusEl.textContent = String(message || '');
    statusEl.hidden = !message;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  function bindUpdateHouseNo() {
    const btnUpdateHouseNo = document.getElementById('btnUpdateHouseNo');
    const houseNoInput = document.getElementById('profileHouseNoInput');
    if (!btnUpdateHouseNo || !houseNoInput) return;
    if (btnUpdateHouseNo._boundUpdate) return;
    btnUpdateHouseNo._boundUpdate = true;

    btnUpdateHouseNo.addEventListener('click', async () => {
      const newVal = houseNoInput.value.trim();
      if (!newVal) {
        showToast('請輸入戶號', true);
        return;
      }
      const user = auth.currentUser;
      if (!user) return;

      try {
        btnUpdateHouseNo.disabled = true;
        btnUpdateHouseNo.textContent = '更新中...';
        await db.collection('users').doc(user.uid).update({
          houseNo: newVal
        });
        showToast('戶號已更新', false);

        // 重新載入包裹資料
        await loadParcels({ houseNo: newVal });
      } catch (e) {
        console.error(e);
        showToast('更新失敗: ' + (e.message || '未知錯誤'), true);
      } finally {
        btnUpdateHouseNo.disabled = false;
        btnUpdateHouseNo.textContent = '更新';
      }
    });
  }

  /* 頁尾按鈕與搜尋列 */
  function bindParcelActions() {
    const backBtn = document.getElementById('btnParcelBack');
    if (backBtn && !backBtn._boundParcel) {
      backBtn._boundParcel = true;
      backBtn.addEventListener('click', goBack);
    }

    const refreshBtn = document.getElementById('btnParcelRefresh');
    if (refreshBtn && !refreshBtn._boundParcel) {
      refreshBtn._boundParcel = true;
      refreshBtn.addEventListener('click', async () => {
        if (refreshBtn.disabled) return;
        refreshBtn.disabled = true;
        const label = refreshBtn.textContent;
        refreshBtn.textContent = '更新中...';
        try {
          await loadParcels(state.userData, { silent: false });
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.textContent = label;
        }
      });
    }

    const input = document.getElementById('parcelSearchInput');
    const clearBtn = document.getElementById('btnParcelSearchClear');
    if (input && !input._boundParcel) {
      input._boundParcel = true;
      input.addEventListener('input', () => {
        state.query = input.value;
        if (clearBtn) clearBtn.hidden = !String(input.value || '').trim();
        renderLists();
      });
    }
    if (clearBtn && !clearBtn._boundParcel) {
      clearBtn._boundParcel = true;
      clearBtn.addEventListener('click', () => {
        if (input) input.value = '';
        state.query = '';
        clearBtn.hidden = true;
        renderLists();
        if (input) { try { input.focus(); } catch {} }
      });
    }
  }

  function bindSignOut() {
    const btn = document.getElementById('btnSignOut');
    if (!btn || btn._boundSignOut) return;
    btn._boundSignOut = true;
    btn.addEventListener('click', async () => {
      stopParcelWatch();
      try {
        sessionStorage.removeItem('csp_role');
        sessionStorage.removeItem('csp_sysadmin');
        await auth.signOut();
      } catch {}
      location.href = 'index.html';
    });
  }

  let authWaitTimer = null;

  function init() {
    loadUserInfo();

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    bindSignOut();
    bindUpdateHouseNo();
    bindParcelActions();

    window.addEventListener('pagehide', stopParcelWatch);

    // 檢查登入狀態
    auth.onAuthStateChanged(async (user) => {
      const isEmbedded = (() => {
        try {
          const qs = new URLSearchParams(location.search || "");
          if (String(qs.get("embed") || "") === "1") return true;
        } catch {}
        try { return window.self !== window.top; } catch { return true; }
      })();

      const showNeedLogin = () => {
        const html = `<div class="status error">請先在主頁登入後再開啟此頁面</div>`;
        state.loading = false;
        state.error = '請先在主頁登入後再開啟此頁面';
        if (unclaimedList) unclaimedList.innerHTML = html;
        if (claimedList) claimedList.innerHTML = "";
      };

      const redirectToIndex = () => {
        if (window.__nw_redirecting) return;
        window.__nw_redirecting = true;
        location.replace('index.html');
      };

      if (!user) {
        if (authWaitTimer) return;
        authWaitTimer = setTimeout(() => {
          authWaitTimer = null;
          const u = auth.currentUser;
          if (u) {
            try { loadProfile(u); } catch {}
            return;
          }
          if (isEmbedded) showNeedLogin();
          else redirectToIndex();
        }, 2500);
        return;
      }
      if (authWaitTimer) {
        clearTimeout(authWaitTimer);
        authWaitTimer = null;
      }

      try {
        await loadProfile(user);
      } catch (e) {
        console.error('Error loading profile:', e);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
