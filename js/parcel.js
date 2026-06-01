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

  function getActiveCommunityId() {
    try {
      const urlParams = new URLSearchParams(location.search);
      const urlC = urlParams.get('c');
      if (urlC) return urlC;
      
      const saved = localStorage.getItem('csp_active_community_v1');
      if (saved) return saved;
    } catch {}
    return 'default';
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
    
    return `
      <div class="parcel-item">
        <div class="parcel-info">
          <div class="parcel-no">物流單號：${trackingNo}</div>
          <div class="parcel-desc">物流公司：${logisticsCompany}</div>
          <div class="parcel-type">類型：${type}</div>
          <div class="parcel-date">建立日期時間：${dateTimeStr}</div>
        </div>
        <div class="parcel-status ${(parcel.status === 'received' || parcel.claimed) ? 'claimed' : 'unclaimed'}">
          ${(parcel.status === 'received' || parcel.claimed) ? '已領取' : '未領取'}
        </div>
      </div>
    `;
  }

  async function loadParcels(userData) {
    const communityId = getActiveCommunityId();
    const houseNo = String(userData?.houseNo || '').trim();
    
    console.log('Loading parcels for community:', communityId, 'houseNo:', houseNo);
    
    if (!communityId || !houseNo) {
      unclaimedList.innerHTML = '<div class="status">請先設定戶號</div>';
      claimedList.innerHTML = '';
      return;
    }

    try {
      const parcelsRef = db.collection('communities').doc(communityId).collection('parcels');
      
      let parcels = [];
      
      // 先簡單嘗試獲取該集合的所有文檔（先不篩選）
      // 這樣可以幫助我們調試，確定問題所在
      try {
        console.log('Fetching all parcels for debugging...');
        const allSnapshot = await parcelsRef.limit(20).get();
        console.log('Total parcels in collection:', allSnapshot.size);
        
        allSnapshot.forEach(doc => {
          const data = doc.data();
          const parcelHouseNo = data.unit || data.houseNo || '';
          console.log('Parcel doc:', doc.id, 'data:', data, 'houseNo/unit:', parcelHouseNo, 'status:', data.status);
          
          // 檢查是否屬於當前用戶
          if (parcelHouseNo === houseNo) {
            parcels.push({ id: doc.id, ...data });
          }
        });
      } catch (err) {
        console.log('Error fetching all parcels:', err);
      }
      
      // 如果上面的方式沒有找到，嘗試用 where 查詢
      if (parcels.length === 0) {
        console.log('No parcels found in all docs, trying where query...');
        
        // 先嘗試用 unit
        try {
          console.log('Trying query with unit field...');
          const snapshot = await parcelsRef.where('unit', '==', houseNo).get();
          console.log('Found with unit:', snapshot.size);
          snapshot.forEach(doc => parcels.push({ id: doc.id, ...doc.data() }));
        } catch (err) {
          console.log('Unit query failed:', err);
        }
        
        // 如果 unit 也失敗，嘗試 houseNo
        if (parcels.length === 0) {
          try {
            console.log('Trying query with houseNo field...');
            const snapshot = await parcelsRef.where('houseNo', '==', houseNo).get();
            console.log('Found with houseNo:', snapshot.size);
            snapshot.forEach(doc => parcels.push({ id: doc.id, ...doc.data() }));
          } catch (err) {
            console.log('HouseNo query failed:', err);
          }
        }
      }
      
      console.log('Total matching parcels found:', parcels.length);
      
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
        unclaimedList.innerHTML = '<div class="status">目前沒有未領取的包裹</div>';
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
    await loadParcels(data);
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
