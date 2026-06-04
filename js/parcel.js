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
  const communityParcelTitle = document.getElementById('communityParcelTitle');

  function switchTab(tab) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    if (tab === 'unclaimed') {
      unclaimedList.classList.remove('hidden');
      claimedList.classList.add('hidden');
    } else {
      unclaimedList.classList.add('hidden');
      claimedList.classList.remove('hidden');
    }
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

  function renderParcelItem(parcel) {
    // 調試：輸出完整的包裹對象
    console.log('Rendering parcel:', parcel);
    
    // 物流單號 - 正確的字段是 trackNo
    const trackingNo = String(
      parcel.trackNo ||
      parcel['單號'] ||
      parcel['物流單號'] ||
      parcel.trackingNo || 
      parcel.parcelNo || 
      parcel.trackingNumber ||
      parcel.number ||
      parcel.no ||
      ''
    ).trim() || '—';
    
    // 物流公司 - 正確的字段是 company
    const logisticsCompany = String(
      parcel.company || 
      parcel['物流公司'] || 
      parcel.logisticsCompany || 
      parcel.carrier || 
      ''
    ).trim() || '其他物流';
    
    // 類型 - 包裹數據中沒有 type 字段，我們預設為"包裹"
    const type = String(
      parcel.type || 
      parcel['類型'] || 
      parcel.category || 
      ''
    ).trim() || '包裹';
    
    // 建立日期時間 - 使用 createdAt
    const date = parcel.createdAt || parcel['建立日期'] || parcel['送達日期'] || parcel.arrivedAt || parcel.date;
    let dateTimeStr = '';
    if (date) {
      try {
        let dateObj;
        if (date.toDate) {
          dateObj = date.toDate();
        } else if (typeof date === 'string') {
          dateObj = new Date(date);
        } else {
          dateObj = new Date(date);
        }
        
        if (dateObj && !isNaN(dateObj.getTime())) {
          dateTimeStr = dateObj.toLocaleString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      } catch {}
    }
    if (!dateTimeStr) {
      dateTimeStr = '—';
    }

    const receivedDate = parcel.receivedAt || parcel.claimedAt || parcel['領取日期'] || parcel['領取時間'] || parcel.receivedTime;
    let receivedDateTimeStr = '';
    if (receivedDate) {
      try {
        let dateObj;
        if (receivedDate.toDate) {
          dateObj = receivedDate.toDate();
        } else if (typeof receivedDate === 'string') {
          dateObj = new Date(receivedDate);
        } else {
          dateObj = new Date(receivedDate);
        }
        if (dateObj && !isNaN(dateObj.getTime())) {
          receivedDateTimeStr = dateObj.toLocaleString('zh-TW', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
        }
      } catch {}
    }
    if (!receivedDateTimeStr) {
      receivedDateTimeStr = '—';
    }
    const isReceived = (parcel.status === 'received' || parcel.claimed);
    
    return `
      <div class="parcel-item">
        <div class="parcel-info">
          <div class="parcel-no">物流單號：${trackingNo}</div>
          <div class="parcel-desc">物流公司：${logisticsCompany}</div>
          <div class="parcel-type">類型：${type}</div>
          <div class="parcel-date">建立日期時間：${dateTimeStr}</div>
          ${isReceived ? `<div class="parcel-date">領取日期時間：${receivedDateTimeStr}</div>` : ''}
        </div>
        <div class="parcel-status ${isReceived ? 'claimed' : 'unclaimed'}">
          ${isReceived ? '已領取' : '未領取'}
        </div>
      </div>
    `;
  }

  async function loadParcels(userData) {
    const candidates = readCommunityCandidates(userData);
    const normalizeDash = (s) => String(s || "").replace(/[－–—]/g, "-").trim();
    const normalizeKey = (s) => normalizeDash(s).replace(/\s+/g, "");
    const houseNo = normalizeDash(userData?.houseNo || userData?.unit || '');
    const subHouseNo = normalizeDash(userData?.subHouseNo || userData?.subUnit || userData?.sub || '');
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
    const recipientKey = normalizeDash(userData?.__displayName || userData?.displayName || userData?.name || '');
    const baseKey = (() => {
      const base = String(houseNo || fullHouseNo || "").trim();
      const idx = base.indexOf("-");
      const v = idx > 0 ? base.slice(0, idx) : base;
      return normalizeKey(v);
    })();
    
    console.log('Loading parcels candidates:', candidates, 'houseNo:', houseNo);
    
    if (!houseKeys.length) {
      unclaimedList.innerHTML = '<div class="status">請先設定戶號</div>';
      claimedList.innerHTML = '';
      return;
    }

    const tryLoadByCommunityId = async (communityId) => {
      const parcelsRef = db.collection('communities').doc(communityId).collection('parcels');
      
      let lastCode = "";
      let pendingTotal = 0;
      let didFetch = false;

      const matchesParcel = (data) => {
        const unitRaw = data ? (data.unit || data.houseNo || "") : "";
        const unitKey = normalizeKey(unitRaw);
        const unitUpper = normalizeDash(unitRaw).toUpperCase().replace(/\s+/g, "");
        const recipientRaw = data ? String(data.recipient || "") : "";
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
        const data = doc.data ? (doc.data() || {}) : {};
        if (!matchesParcel(data)) return;
        seen.add(doc.id);
        if (String(data.status || "") === "pending") pendingTotal += 1;
        parcels.push({ id: doc.id, ...data });
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
      
      console.log('Total matching parcels found:', parcels.length);
      if (!parcels.length && String(lastCode || "").includes("permission-denied")) {
        return { parcels: [], pendingTotal, error: "permission-denied" };
      }
      return { parcels, pendingTotal, error: "" };
    };
    
    try {
      let resolvedCommunityId = "";
      let result = { parcels: [], pendingTotal: 0, error: "" };
      for (const key of candidates) {
        const cid = await resolveCommunityId(key);
        if (!cid) continue;
        const r = await tryLoadByCommunityId(cid);
        if (r.error === "permission-denied") {
          result = r;
          resolvedCommunityId = cid;
          break;
        }
        if (r.parcels && r.parcels.length) {
          result = r;
          resolvedCommunityId = cid;
          break;
        }
        if (!resolvedCommunityId) {
          result = r;
          resolvedCommunityId = cid;
        }
      }
      const parcels = result.parcels || [];
      const pendingTotal = result.pendingTotal || 0;
      if (!parcels.length && result.error === "permission-denied") {
        unclaimedList.innerHTML = '<div class="status error">沒有權限讀取包裹資料</div>';
        claimedList.innerHTML = '';
        return;
      }
      
      // 按建立時間排序（最新在前）
      parcels.sort((a, b) => {
        const getTime = (item) => {
          if (item.createdAt?.toDate) return item.createdAt.toDate().getTime();
          if (item.createdAt) return new Date(item.createdAt).getTime();
          if (item.arrivedAt?.toDate) return item.arrivedAt.toDate().getTime();
          if (item.arrivedAt) return new Date(item.arrivedAt).getTime();
          return 0;
        };
        return getTime(b) - getTime(a);
      });
      
      const unclaimed = [];
      const claimed = [];
      
      parcels.forEach(parcel => {
        if (parcel.status === 'received' || parcel.claimed) {
          claimed.push(parcel);
        } else {
          unclaimed.push(parcel);
        }
      });
      
      // 渲染未領取列表
      if (unclaimed.length === 0) {
        const hint = pendingTotal > 0 ? '（社區有待領取，但未匹配到此帳號）' : '';
        unclaimedList.innerHTML = `<div class="status">目前沒有未領取的包裹${hint}</div>`;
      } else {
        unclaimedList.innerHTML = unclaimed.map(renderParcelItem).join('');
      }
      
      // 渲染已領取列表
      if (claimed.length === 0) {
        claimedList.innerHTML = '<div class="status">目前沒有已領取的包裹</div>';
      } else {
        claimedList.innerHTML = claimed.map(renderParcelItem).join('');
      }
      
    } catch (e) {
      console.error('Error loading parcels:', e);
      unclaimedList.innerHTML = '<div class="status error">載入包裹失敗，請稍後再試</div>';
      claimedList.innerHTML = '';
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
      console.log('Fetching user data for uid:', user.uid);
      const doc = await db.collection('users').doc(String(user.uid)).get();
      console.log('User doc exists:', doc.exists);
      if (doc.exists) {
        data = doc.data() || {};
        console.log('User data from uid:', data);
      }
      
      // 如果从 uid 没找到，尝试通过 email 查找
      if (!data || !Object.keys(data).length) {
        const email = String(user.email || '').trim();
        if (email) {
          console.log('Trying to fetch by email:', email);
          const snap = await db.collection('users').where('email', '==', email).limit(1).get();
          console.log('Email query result size:', snap.size);
          if (snap.size > 0) {
            data = snap.docs[0].data() || {};
            console.log('User data from email:', data);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching user data:', e);
      data = {};
    }

    console.log('Final user data:', data);

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
    
    console.log('Setting title - houseNo:', houseNo, 'subHouseNo:', subHouseNo, 'displayName:', displayName);
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

  function bindSignOut() {
    const btn = document.getElementById('btnSignOut');
    if (!btn || btn._boundSignOut) return;
    btn._boundSignOut = true;
    btn.addEventListener('click', async () => {
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
