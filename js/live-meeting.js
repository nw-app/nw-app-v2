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
  const liveList = document.getElementById('liveList');
  const myRecordList = document.getElementById('myRecordList');
  const communityLiveTitle = document.getElementById('communityLiveTitle');

  let currentRoom = null;
  let roomsData = {};
  let currentCommunityId = null;
  let currentCommunityName = "";
  let selectedDate = new Date();
  let currentUserData = null;
  let currentUserId = null;
  let currentUserName = "";
  let currentUserHouseNo = "";
  let pendingBookingsByRoom = {}; // 按直播室统计待审核预约
  let totalPendingBookings = 0;
  let liveMeetingYoutubeUrl = "";
  let __unsubLiveConfig = null;

  function switchTab(tab) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const residentWrap = document.getElementById('residentLiveStreamWrap');
    if (tab === 'live') {
      if (residentWrap) residentWrap.classList.remove('hidden');
      liveList.classList.remove('hidden');
      myRecordList.classList.add('hidden');
    } else {
      if (residentWrap) residentWrap.classList.add('hidden');
      liveList.classList.add('hidden');
      myRecordList.classList.remove('hidden');
    }
  }

  function switchMyRecordsTab(subtab) {
    const myRecordsTabBtns = document.querySelectorAll('.my-record-tab-btn');
    myRecordsTabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === subtab);
    });

    const recentRecordsEl = document.getElementById('recentRecord');
    const historyRecordsEl = document.getElementById('historyRecord');
    
    if (recentRecordsEl && historyRecordsEl) {
      if (subtab === 'recent') {
        recentRecordsEl.classList.remove('hidden');
        historyRecordsEl.classList.add('hidden');
      } else {
        recentRecordsEl.classList.add('hidden');
        historyRecordsEl.classList.remove('hidden');
      }
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
      if (s === 'default') return; // 永遠不要把 default 放進優先清單，避免鎖死在預設社區
      if (out.includes(s)) return;
      out.push(s);
    };
    try { push(new URLSearchParams(location.search).get('c')); } catch {} // URL ?c= 優先級最高
    try { push(localStorage.getItem('csp_active_community_v1')); } catch {}
    push(userData?.__communityId);
    push(userData?.community);
    // 最後才放 default (永遠保持在最後一項)
    if (!out.length) return ['default'];
    if (!out.includes('default')) out.push('default'); // fallback
    return out;
  }

  function normalizeRoomConfig(v, id) {
    const data = v && typeof v === "object" ? v : {};
    const name = String(data.name || id || "").trim() || "直播室";
    const imageDataUrl = String(data.imageDataUrl || data.image || data.imageUrl || "").trim();
    const chargeMethod = String(data.chargeMethod || data.charge || data.pricing || "").trim();
    const chargeAmount = Number(data.chargeAmount || 0) || 0;
    const orderRaw = Number(data.order);
    const order = Number.isFinite(orderRaw) ? orderRaw : null;
    const slotMinutes = Math.max(15, Math.min(240, Number(data.slotMinutes || data.slot || 60) || 60));
    const openTime = String(data.openTime || "09:00").trim() || "09:00";
    const closeTime = String(data.closeTime || "21:00").trim() || "21:00";
    const capacity = Math.max(1, Math.min(500, Number(data.capacity || data.quota || 1) || 1));
    const requireApproval = Boolean(data.requireApproval !== false);
    const enabled = Boolean(data.enabled !== false);
    const advanceBookingDays = Math.max(1, Math.min(365, Number(data.advanceBookingDays || 30) || 30));
    return { id: String(id || "").trim(), name, imageDataUrl, chargeMethod, chargeAmount, order, slotMinutes, openTime, closeTime, capacity, requireApproval, enabled, advanceBookingDays };
  }

  async function loadRoomConfigs(cid, filterEnabled = true) {
    const communityId = String(cid || "").trim() || "default";
    try {
      const snap = await db.collection("communities").doc(communityId).collection("live_room_configs").get();
      let list = (snap && snap.docs ? snap.docs : []).map((d) => normalizeRoomConfig(d.data() || {}, d.id));
      
      // 先过滤启用的直播室
      if (filterEnabled) {
        list = list.filter(f => f.enabled);
      }
      
      // 然后排序，和管理后台保持一致
      list.sort((a, b) => {
        const ao = Number.isFinite(Number(a.order)) ? Number(a.order) : 1e9;
        const bo = Number.isFinite(Number(b.order)) ? Number(b.order) : 1e9;
        return ao - bo || String(a.name || "").localeCompare(String(b.name || "")) || String(a.id || "").localeCompare(String(b.id || ""));
      });
      return list;
    } catch {
      return [];
    }
  }

  function renderRoomItem(room) {
    const imageStyle = room.imageDataUrl 
      ? `background-image: url('${room.imageDataUrl}'); background-size: cover; background-position: center;`
      : '';
    
    const pendingCount = pendingBookingsByRoom[room.id] || 0;
    
    return `
      <div class="parcel-item facility-item">
        <div class="facility-preview facility-preview-responsive" style="${imageStyle}">
          ${!room.imageDataUrl ? `
            <div class="facility-icon">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width: 48px; height: 48px; opacity: 0.6;">
                <path d="M7 4v2M17 4v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M5 7.5h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M6 6.5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M9 11.2h.01M12 11.2h.01M15 11.2h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
              </svg>
            </div>
          ` : ''}
        </div>
        <div class="parcel-info facility-info">
          <div class="parcel-no" style="font-size: 18px; font-weight: 800;">${room.name}</div>
          <div class="parcel-desc">開放時間：${room.openTime} - ${room.closeTime}</div>
          <div class="parcel-type">時段長度：${room.slotMinutes} 分鐘</div>
          <div class="parcel-type">預約名額：${room.capacity} 人</div>
          ${room.chargeMethod ? `<div class="parcel-type">費用說明：${room.chargeMethod}${room.chargeAmount > 0 ? ` ${room.chargeAmount}` : ''}</div>` : ''}
          ${room.requireApproval ? `<div class="parcel-date" style="color: #d32f2f;">需要審核</div>` : `<div class="parcel-date" style="color: #10b981;">免審核</div>`}
        </div>
        <button class="btn btn-primary facility-book-btn" onclick="window.bookRoom && window.bookRoom('${room.id}', '${room.name}')">
          ${pendingCount > 0 ? `<span class="badge-inline">${pendingCount}</span>` : ''}
          預約
        </button>
      </div>
    `;
  }

  function renderRecordItem(record) {
    const statusText = {
      'pending': '待審核',
      'approved': '已核准',
      'rejected': '已拒絕',
      'canceled': '已取消'
    }[String(record.status || 'pending')] || '待審核';
    
    const statusClass = {
      'pending': 'warning',
      'approved': 'success',
      'rejected': 'error',
      'canceled': 'secondary'
    }[String(record.status || 'pending')] || 'warning';

    // 确定预约状态样式
    const now = new Date();
    let itemClass = 'reservation-item';
    let canCancel = false;
    
    if (['pending', 'approved'].includes(String(record.status || ''))) {
      const endDateTime = makeDateTime80(record.dateKey, record.endTime);
      if (endDateTime && endDateTime < now) {
        // 已结束
        itemClass += ' self-used';
      } else if (String(record.status) === 'approved') {
        // 已预约且未结束，可取消
        itemClass += ' self-booked';
        canCancel = true;
      } else if (String(record.status) === 'pending') {
        // 待审核且未结束，可取消
        itemClass += ' self-pending';
        canCancel = true;
      }
    }

    const onclickAttr = canCancel 
      ? `onclick="openCancelRecordModal('${record.id}', '${escapeHtml(record.roomName)}', '${record.dateKey}', '${record.startTime}', '${record.endTime}')"` 
      : '';

    return `
      <div class="parcel-item ${itemClass}" ${onclickAttr}>
        <div class="parcel-info">
          <div class="parcel-no" style="font-size: 18px; font-weight: 800;">${escapeHtml(record.roomName || '直播室')}</div>
          <div class="parcel-desc">日期：${escapeHtml(record.dateKey || '')}</div>
          <div class="parcel-type">時間：${escapeHtml(record.startTime || '')} - ${escapeHtml(record.endTime || '')}</div>
          <div class="parcel-date">狀態：<span class="tag ${statusClass}">${escapeHtml(statusText)}</span></div>
        </div>
      </div>
    `;
  }

  async function loadAndRenderMyRecords() {
    const recentRecordsEl = document.getElementById('recentRecord');
    const historyRecordsEl = document.getElementById('historyRecord');
    if (!recentRecordsEl || !historyRecordsEl) return;
    
    try {
      console.log('加载预约 - currentCommunityId:', currentCommunityId, 'currentUserId:', currentUserId);
      const records = await loadUserRecords(currentCommunityId, currentUserId);
      console.log('找到的预约数量:', records.length);
      console.log('预约数据:', records);
      
      const now = new Date();
      
      // 分离近期预约和历史预约
      const recentRecords = [];
      const historyRecords = [];
      
      records.forEach(record => {
        const endDateTime = makeDateTime80(record.dateKey, record.endTime);
        if (endDateTime && endDateTime >= now) {
          // 未结束的预约
          recentRecords.push(record);
        } else {
          // 已结束的预约
          historyRecords.push(record);
        }
      });
      
      // 渲染近期预约
      if (!recentRecords.length) {
        recentRecordsEl.innerHTML = '<div class="status">目前沒有近期預約</div>';
      } else {
        recentRecordsEl.innerHTML = recentRecords.map(renderRecordItem).join('');
      }
      
      // 渲染历史预约
      if (!historyRecords.length) {
        historyRecordsEl.innerHTML = '<div class="status">目前沒有歷史預約</div>';
      } else {
        historyRecordsEl.innerHTML = historyRecords.map(renderRecordItem).join('');
      }
      
    } catch (e) {
      console.error('Error loading records:', e);
      recentRecordsEl.innerHTML = '<div class="status error">載入預約失敗，請稍後再試</div>';
      historyRecordsEl.innerHTML = '<div class="status error">載入預約失敗，請稍後再試</div>';
    }
  }

  async function loadRooms(userData) {
    const candidates = readCommunityCandidates(userData);
    
    console.log('Loading rooms candidates:', candidates);

    const tryLoadByCommunityId = async (communityId) => {
      // loadRoomConfigs 已经处理过滤和排序
      const rooms = await loadRoomConfigs(communityId, true);
      
      // 获取社区名称
      let communityName = "社區";
      try {
        const communityDoc = await db.collection('communities').doc(communityId).get();
        if (communityDoc.exists) {
          const communityData = communityDoc.data();
          communityName = String(communityData?.name || communityData?.displayName || communityId).trim();
        }
      } catch {
        // 如果获取失败，使用默认值
      }
      
      return { rooms, communityId, communityName };
    };
    
    try {
      let resolvedCommunityId = "";
      let resolvedCommunityName = "社區";
      let rooms = [];
      for (let idx = 0; idx < candidates.length; idx++) {
        const key = candidates[idx];
        const isLastCandidate = idx === candidates.length - 1;
        const cid = await resolveCommunityId(key);
        if (!cid) continue;
        const { rooms: list, communityId, communityName } = await tryLoadByCommunityId(cid);

        const hasRooms = Boolean(list && list.length);
        const isDefaultCid = String(cid || '').trim() === 'default';
        const shouldAdopt = hasRooms || (!resolvedCommunityId && (isLastCandidate || !isDefaultCid));
        if (shouldAdopt) {
          rooms = list || [];
          resolvedCommunityId = communityId;
          resolvedCommunityName = communityName;
          if (hasRooms) break;
        }
      }
      
      console.log('Total rooms found:', rooms.length);
      
      // 保存当前社区信息
      currentCommunityId = resolvedCommunityId;
      currentCommunityName = resolvedCommunityName;

      try {
        ensureLiveConfigSubscription(resolvedCommunityId);
      } catch (e) {
        console.warn("[LiveMeeting] 註冊設定監聽失敗", e);
        (async () => {
          try {
            const v = await loadAppLiveUrl(resolvedCommunityId);
            if (v && v !== liveMeetingYoutubeUrl) {
              liveMeetingYoutubeUrl = v;
              renderLiveStreamCard();
            }
          } catch {}
        })();
      }
      
      // 存储直播室数据
      roomsData = {};
      rooms.forEach(f => {
        roomsData[f.id] = f;
      });
      
      // 加载预约统计
      if (currentCommunityId) {
        await loadBookingsByRoom(currentCommunityId);
      }
      
      // 渲染直播室列表
      if (!liveList) return;
      renderLiveStreamCard();
      if (rooms.length) {
        const roomsHtml = rooms.map(renderRoomItem).join('');
        liveList.insertAdjacentHTML('beforeend', roomsHtml);
      }
      
      // 加载我的预约
      if (currentCommunityId && currentUserId) {
        loadAndRenderMyRecords();
      } else {
        myRecordList.innerHTML = '<div class="status">載入預約中...</div>';
      }
      
    } catch (e) {
      console.error('Error loading rooms:', e);
      if (liveList) {
        liveList.innerHTML = '<div class="status error">載入直播室失敗，請稍後再試</div>';
      }
      try { renderLiveStreamCard(); } catch {}
      if (myRecordList) myRecordList.innerHTML = '';
    }
  }

  function getChineseWeekday(day) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return weekdays[day];
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function youtubeVideoId98(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    const patterns = [
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/))([A-Za-z0-9_-]{6,})/,
    ];
    for (const re of patterns) {
      const m = u.match(re);
      if (m && m[1]) return m[1];
    }
    try {
      const uo = new URL(u);
      if (uo.hostname.includes("youtube.com") || uo.hostname.includes("youtu.be")) {
        const v = uo.searchParams.get("v");
        if (v) return v;
      }
    } catch {}
    return "";
  }

  async function loadAppLiveUrl(cid) {
    const communityId = String(cid || "").trim() || "default";
    try {
      const doc = await db.collection("communities").doc(communityId).collection("settings").doc("app_config").get();
      if (doc && doc.exists) {
        const data = doc.data() || {};
        return String(data.liveMeetingYoutubeUrl || "").trim();
      }
    } catch (e) {
      console.warn("[LiveMeeting] 讀取 app_config.liveMeetingYoutubeUrl 失敗 (直接 get)", e);
    }
    return "";
  }

  function ensureLiveConfigSubscription(cid) {
    const communityId = String(cid || "").trim() || "default";
    try {
      if (__unsubLiveConfig) {
        try { __unsubLiveConfig(); } catch {}
        __unsubLiveConfig = null;
      }
      __unsubLiveConfig = db.collection("communities").doc(communityId).collection("settings").doc("app_config")
        .onSnapshot(
          (doc) => {
            try {
              const data = doc && doc.exists ? (doc.data() || {}) : {};
              const next = String(data.liveMeetingYoutubeUrl || "").trim();
              if (next !== liveMeetingYoutubeUrl) {
                liveMeetingYoutubeUrl = next;
                renderLiveStreamCard();
              }
            } catch (e) {
              console.warn("[LiveMeeting] onSnapshot 解析失敗", e);
            }
          },
          (err) => {
            console.warn("[LiveMeeting] onSnapshot 權限/連線錯誤，嘗試一次性讀取", err);
            loadAppLiveUrl(communityId).then((v) => {
              if (v && v !== liveMeetingYoutubeUrl) {
                liveMeetingYoutubeUrl = v;
                renderLiveStreamCard();
              }
            }).catch(() => {});
          }
        );
    } catch (e) {
      console.warn("[LiveMeeting] 註冊 onSnapshot 失敗", e);
      loadAppLiveUrl(communityId).then((v) => {
        if (v && v !== liveMeetingYoutubeUrl) {
          liveMeetingYoutubeUrl = v;
          renderLiveStreamCard();
        }
      }).catch(() => {});
    }
  }

  let __residentLiveBound = false;

  function renderLiveStreamCard() {
    try {
      const url = String(liveMeetingYoutubeUrl || "").trim();
      const videoId = youtubeVideoId98(url);
      const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

      const wrapper = document.getElementById('residentLiveStreamWrap');
      if (!wrapper) {
        console.warn('[LiveMeeting] #residentLiveStreamWrap DOM 不存在');
        return;
      }
      wrapper.classList.remove('hidden');
      wrapper.style.display = 'block !important';
      wrapper.style.setProperty('display', 'block', 'important');

      const cardEl = wrapper.querySelector('[data-resident-live-card="1"]');
      const coverEl = wrapper.querySelector('[data-resident-cover]');

      if (!cardEl || !coverEl) {
        console.warn('[LiveMeeting] 直播卡片靜態 DOM 節點缺失', { cardEl: !!cardEl, coverEl: !!coverEl });
        return;
      }

      if (url && thumbnailUrl) {
        cardEl.setAttribute('data-live-card', '1');
        cardEl.style.cursor = 'pointer';
        coverEl.setAttribute('data-resident-cover', 'loaded');
        coverEl.style.cssText = `position:relative;aspect-ratio:16/9;background:#000;background-image:url('${thumbnailUrl}');background-size:cover;background-position:center;display:block;overflow:hidden;`;
        coverEl.innerHTML = `
          <div style="position:absolute;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:68px;height:68px;color:#fff;filter:drop-shadow(0 4px 16px rgba(0,0,0,0.35));">
              <path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l11.3-6.8a1 1 0 0 0 0-1.7l-11.3-6.8A1 1 0 0 0 8 5.2Z" fill="currentColor"/>
            </svg>
          </div>
          <div style="position:absolute;top:12px;left:12px;display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(220,38,38,0.95);color:#fff;font-size:12px;font-weight:800;">
            <span style="width:8px;height:8px;border-radius:50%;background:#fff;animation:sosCardPulse 1.5s ease-in-out infinite;"></span>
            LIVE
          </div>
          <div style="position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:999px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;font-size:12px;font-weight:800;box-shadow:0 6px 18px rgba(239,68,68,0.35);">
            ↗ 另開
          </div>
        `;
      } else {
        cardEl.setAttribute('data-live-card', '0');
        cardEl.style.cursor = 'default';
        coverEl.setAttribute('data-resident-cover', 'empty');
        coverEl.style.cssText = 'aspect-ratio:16/9;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);display:flex;align-items:center;justify-content:center;color:#6b7280;';
        coverEl.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:56px;height:56px;">
            <path d="M22 8.5v7a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="m10 9 5 3-5 3V9Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
        `;
      }

      if (!__residentLiveBound) {
        __residentLiveBound = true;
        cardEl.style.transition = 'transform .18s ease, box-shadow .18s ease';
        cardEl.addEventListener('mouseenter', () => {
          if (!String(cardEl.getAttribute('data-live-card') || '').trim()) return;
          cardEl.style.transform = 'translateY(-2px)';
          cardEl.style.boxShadow = '0 16px 36px rgba(17,24,39,0.12)';
        });
        cardEl.addEventListener('mouseleave', () => {
          cardEl.style.transform = '';
          cardEl.style.boxShadow = '';
        });
        cardEl.addEventListener('click', (e) => {
          if (!String(cardEl.getAttribute('data-live-card') || '').trim()) return;
          if (e.target.closest('button, a')) return;
          window.open(String(liveMeetingYoutubeUrl || url || '').trim(), '_blank', 'noopener,noreferrer');
        });
      }
    } catch (e) {
      console.error('[LiveMeeting] renderLiveStreamCard 失敗', e);
    }
  }

  function formatDateDisplay(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = getChineseWeekday(date.getDay());
    return `${year}年${month}月${day}日 ${weekday}`;
  }

  function getBookableDateRange(room) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + (room?.advanceBookingDays || 30) - 1);
    return {
      minDate: today,
      maxDate: maxDate
    };
  }

  function updateLiveDateDisplay() {
    const dateEl = document.getElementById('liveCurrentDate');
    if (dateEl) {
      dateEl.textContent = formatDateDisplay(selectedDate);
    }
  }

  function parseTime(timeStr) {
    const parts = timeStr.split(':');
    return { hour: parseInt(parts[0]), minute: parseInt(parts[1]) };
  }

  function formatTime(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function pad2(num) {
    return String(num).padStart(2, '0');
  }

  function ymd80(date) {
    const d = date || new Date();
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function makeDateTime80(dateKey, timeStr) {
    if (!dateKey || !timeStr) return null;
    const d = new Date(dateKey + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    d.setHours(h, m, 0, 0);
    return d;
  }

  async function loadBookingsByRoomDate(cid, roomId, dateKey) {
    const communityId = String(cid || "").trim() || "default";
    const rid = String(roomId || "").trim();
    const dk = String(dateKey || "").trim();
    if (!rid || !dk) return [];
    try {
      const snap = await db.collection("communities").doc(communityId).collection("live_bookings")
        .where("roomId", "==", rid)
        .where("dateKey", "==", dk)
        .get();
      const list = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
      list.sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")) || String(a.unit || "").localeCompare(String(b.unit || "")));
      return list;
    } catch {
      return [];
    }
  }

  async function loadUserRecords(cid, userId) {
    const communityId = String(cid || "").trim() || "default";
    const uid = String(userId || "").trim();
    console.log('loadUserRecords - communityId:', communityId, 'userId:', uid);
    if (!uid) return [];
    try {
      // 先尝试获取该社区的所有预约，然后在本地过滤（避免索引问题）
      console.log('尝试获取社区所有预约...');
      let snap;
      try {
        snap = await db.collection("communities").doc(communityId).collection("live_bookings").get();
      } catch (error) {
        console.log('查询失败，尝试其他方式');
        snap = { size: 0, docs: [] };
      }
      
      // 在本地过滤出该用户的预约
      const allRecords = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
      console.log('该社区的所有预约数量:', allRecords.length);
      console.log('所有预约数据:', allRecords);
      
      const userRecords = allRecords.filter(r => {
        // 尝试多种可能的用户ID字段
        const matchById = String(r.createdBy || r.uid || r.userId || r.userUid || '') === uid;
        const matchByName = String(r.createdByName || r.userName || r.name || '') === currentUserName;
        const matchByUnit = String(r.unit || '') === currentUserHouseNo;
        return matchById || matchByName || matchByUnit;
      });
      
      // 按创建时间排序（新的在前）
      userRecords.sort((a, b) => {
        const timeA = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const timeB = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        return timeB - timeA;
      });
      
      console.log('本地过滤后的预约数量:', userRecords.length);
      console.log('本地过滤后的预约记录:', userRecords);
      return userRecords;
    } catch (e) {
      console.error('loadUserRecords error:', e);
      return [];
    }
  }

  async function loadBookingsByRoom(cid) {
    const communityId = String(cid || "").trim() || "default";
    try {
      const snap = await db.collection("communities").doc(communityId).collection("live_bookings")
        .where("status", "in", ["pending", "approved"])
        .get();
      const list = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
      
      // 获取当前时间
      const now = new Date();
      
      // 统计每个直播室的当前用户预约数量（只统计当前用户、未过期的预约）
      const stats = {};
      let total = 0;
      list.forEach(r => {
        const rid = String(r.roomId || "").trim();
        const bookingUserId = String(r.createdBy || "").trim();
        
        // 只统计当前用户的预约
        if (rid && bookingUserId === currentUserId) {
          // 检查预约时间是否已过
          let isExpired = false;
          
          if (r.endAt) {
            const endDate = r.endAt.toDate ? r.endAt.toDate() : new Date(r.endAt);
            if (endDate < now) {
              isExpired = true;
            }
          } else if (r.dateKey && r.endTime) {
            // 如果没有 endAt，尝试用 dateKey 和 endTime 构建时间
            const endDateTime = makeDateTime80(r.dateKey, r.endTime);
            if (endDateTime && endDateTime < now) {
              isExpired = true;
            }
          }
          
          if (!isExpired) {
            stats[rid] = (stats[rid] || 0);
            stats[rid]++;
            total++;
          }
        }
      });
      
      pendingBookingsByRoom = stats;
      totalPendingBookings = total;
    } catch {
      pendingBookingsByRoom = {};
      totalPendingBookings = 0;
    }
  }

  function generateTimeSlots(room) {
    const slots = [];
    const open = parseTime(room.openTime);
    const close = parseTime(room.closeTime);
    
    const startDate = new Date();
    startDate.setHours(open.hour, open.minute, 0, 0);
    
    const endDate = new Date();
    endDate.setHours(close.hour, close.minute, 0, 0);
    
    let current = new Date(startDate);
    
    while (current < endDate) {
      const slotEnd = new Date(current);
      slotEnd.setMinutes(slotEnd.getMinutes() + room.slotMinutes);
      
      if (slotEnd > endDate) break;
      
      slots.push({
        start: formatTime(current),
        end: formatTime(slotEnd)
      });
      
      current = slotEnd;
    }
    
    return slots;
  }

  async function openLiveModal(roomId, roomName) {
    const room = roomsData[roomId];
    if (!room) return;
    
    currentRoom = room;
    selectedDate = new Date(); // 重置为当天
    
    const modal = document.getElementById('liveModal');
    const roomNameEl = document.getElementById('liveRoomName');
    const communityNameEl = document.getElementById('liveCommunityName');
    const timesContainer = document.getElementById('liveTimesContainer');
    
    // 设置社区名称和直播室名称
    if (communityNameEl) {
      communityNameEl.textContent = currentCommunityName || "社區";
    }
    roomNameEl.textContent = roomName;
    
    // 更新日期显示
    updateLiveDateDisplay();
    
    // 生成时间段
    await renderLiveTimeSlots(room);
    
    // 显示弹窗
    modal.hidden = false;
  }

  async function renderLiveTimeSlots(room) {
    const timesContainer = document.getElementById('liveTimesContainer');
    if (!timesContainer) return;

    // 加载预约数据
    const dateKey = ymd80(selectedDate);
    const existingBookings = await loadBookingsByRoomDate(
      currentCommunityId,
      room.id,
      dateKey
    );

    // 生成时间段
    const slots = generateTimeSlots(room);
    const now = new Date();
    const selectedDateStr = ymd80(selectedDate);
    const todayStr = ymd80(new Date());

    const timesHtml = `
      <div class="booking-times-grid">
        ${slots.map(slot => {
          let status = 'available';
          let bookingData = null;
          const slotStartDateTime = makeDateTime80(dateKey, slot.start);
          const slotEndDateTime = makeDateTime80(dateKey, slot.end);
          
          // 检查时间是否已过
          const isPast = selectedDateStr < todayStr || 
            (selectedDateStr === todayStr && slotEndDateTime < now);
          
          // 检查是否在预约时间内
          const isInProgress = selectedDateStr === todayStr && 
            slotStartDateTime <= now && now <= slotEndDateTime;
          
          // 查找该时段的预约（无论时间是否已过）
          const booking = existingBookings.find(r => 
            String(r.startTime) === slot.start && 
            ['pending', 'approved'].includes(String(r.status))
          );
          
          if (booking) {
            bookingData = booking;
            if (String(booking.createdBy) === String(currentUserId)) {
              // 自己的预约
              status = 'self-booked';
            } else {
              // 他人预约
              status = 'other-booked';
            }
          }
          
          if (isPast) {
            // 时间已过，添加 past 类（灰色背景）
            // 但保留原来的预约状态，这样还能显示预约信息
          }

          let className = 'booking-time-btn';
          if (isPast) {
            className += ' past';
          } else if (isInProgress) {
            className += ' in-progress';
          } else if (status === 'other-booked') {
            className += ' other-booked';
          } else if (status === 'self-booked') {
            className += ' self-booked';
          } else if (status === 'self-used') {
            className += ' self-used';
          } else if (status === 'self-unused') {
            className += ' self-unused';
          }

          let statusText = '';
          let approvalText = '';
          let checkinText = '';
          if (status === 'self-booked') {
            if (isPast) {
              statusText = '<span class="booking-status-text">已預約</span>';
            } else {
              statusText = '<span class="booking-status-text">已預約</span>';
            }
            if (bookingData && String(bookingData.status) === 'approved') {
              approvalText = '<span class="booking-approval-text">(已核准)</span>';
            } else if (bookingData && String(bookingData.status) === 'pending') {
              approvalText = '<span class="booking-approval-text">(審查中)</span>';
            }
            // 显示报到状态
            if (bookingData && Boolean(bookingData.checkedIn)) {
              checkinText = '<span class="booking-checkin-text checked-in">已報到</span>';
            } else if (bookingData && String(bookingData.status) === 'approved') {
              checkinText = '<span class="booking-checkin-text not-checked-in">未報到</span>';
            }
          } else if (status === 'other-booked') {
            if (isPast) {
              statusText = '<span class="booking-status-text">已預約</span>';
            } else {
              statusText = '<span class="booking-status-text">目前已有預約</span>';
            }
            if (bookingData && String(bookingData.status) === 'approved') {
              approvalText = '<span class="booking-approval-text">(已核准)</span>';
            } else if (bookingData && String(bookingData.status) === 'pending') {
              approvalText = '<span class="booking-approval-text">(審查中)</span>';
            }
            // 显示报到状态
            if (bookingData && Boolean(bookingData.checkedIn)) {
              checkinText = '<span class="booking-checkin-text checked-in">已報到</span>';
            } else if (bookingData && String(bookingData.status) === 'approved') {
              checkinText = '<span class="booking-checkin-text not-checked-in">未報到</span>';
            }
          }

          return `
            <button class="${className}" data-start="${slot.start}" data-end="${slot.end}" data-status="${status}" data-booking-id="${bookingData ? bookingData.id : ''}">
              <span class="booking-time-text">${slot.start} - ${slot.end}</span>
              <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap; justify-content:flex-end;">
                ${statusText}
                ${approvalText}
                ${checkinText}
              </div>
            </button>
          `;
        }).join('')}
      </div>
    `;
    timesContainer.innerHTML = timesHtml;
    
    // 绑定时间按钮点击事件
    const timeBtns = timesContainer.querySelectorAll('.booking-time-btn');
    timeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        const start = btn.dataset.start;
        const end = btn.dataset.end;
        const bookingId = btn.dataset.bookingId;
        
        if (status === 'self-booked' && bookingId) {
          // 自己预约的，显示取消确认
          openCancelLiveConfirmModal(room, start, end, bookingId);
        } else if (status === 'available') {
          // 可用时段，显示预约确认
          handleLiveTimeSlotSelect(room, start, end);
        }
      });
    });
  }

  function openLiveDatePicker() {
    if (!currentRoom) return;
    
    const { minDate, maxDate } = getBookableDateRange(currentRoom);
    
    // 创建日期选择器 HTML
    const datePickerHtml = `
      <div class="date-picker-modal" id="datePickerModal">
        <div class="date-picker-backdrop" id="datePickerBackdrop"></div>
        <div class="date-picker-dialog">
          <div class="date-picker-header">
            <h3>選擇預約日期</h3>
            <button class="modal-close" type="button" id="btnCloseDatePicker" aria-label="關閉">×</button>
          </div>
          <div class="date-picker-body">
            <div class="date-picker-info">
              <p>可預約範圍：</p>
              <p>${formatDateDisplay(minDate)} 至 ${formatDateDisplay(maxDate)}</p>
            </div>
            <div class="date-picker-input-group">
              <input type="date" id="datePickerInput" class="date-picker-input" />
            </div>
          </div>
          <div class="date-picker-footer">
            <button class="btn" type="button" id="btnCancelDatePicker">取消</button>
            <button class="btn btn-primary" type="button" id="btnConfirmDatePicker">確認</button>
          </div>
        </div>
      </div>
    `;
    
    // 添加到 body
    const existingPicker = document.getElementById('datePickerModal');
    if (existingPicker) existingPicker.remove();
    
    document.body.insertAdjacentHTML('beforeend', datePickerHtml);
    
    const datePickerModal = document.getElementById('datePickerModal');
    const datePickerInput = document.getElementById('datePickerInput');
    
    // 设置日期选择器的范围
    const formatForInput = (d) => {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    
    datePickerInput.min = formatForInput(minDate);
    datePickerInput.max = formatForInput(maxDate);
    datePickerInput.value = formatForInput(selectedDate);
    
    // 绑定关闭事件
    const closeDatePicker = () => {
      const picker = document.getElementById('datePickerModal');
      if (picker) picker.remove();
    };
    
    document.getElementById('datePickerBackdrop').addEventListener('click', closeDatePicker);
    document.getElementById('btnCloseDatePicker').addEventListener('click', closeDatePicker);
    document.getElementById('btnCancelDatePicker').addEventListener('click', closeDatePicker);
    
    document.getElementById('btnConfirmDatePicker').addEventListener('click', async () => {
      const selectedValue = datePickerInput.value;
      if (selectedValue) {
        const [year, month, day] = selectedValue.split('-').map(Number);
        selectedDate = new Date(year, month - 1, day);
        updateLiveDateDisplay();
        if (currentRoom) {
          await renderLiveTimeSlots(currentRoom);
        }
      }
      closeDatePicker();
    });
    
    // 显示日期选择器
    datePickerModal.hidden = false;
  }

  function closeLiveModal() {
    const modal = document.getElementById('liveModal');
    modal.hidden = true;
    currentRoom = null;
  }

  function handleLiveTimeSlotSelect(room, start, end) {
    openLiveConfirmModal(room, start, end);
  }

  function openLiveConfirmModal(room, start, end) {
    const confirmHtml = `
      <div class="booking-confirm-modal" id="liveConfirmModal">
        <div class="booking-confirm-backdrop" id="liveConfirmBackdrop"></div>
        <div class="booking-confirm-dialog">
          <div class="booking-confirm-header">
            <h3>確認預約</h3>
            <button class="modal-close" type="button" id="btnCloseLiveConfirm" aria-label="關閉">×</button>
          </div>
          <div class="booking-confirm-body">
            <div class="booking-confirm-info">
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">直播室名稱</span>
                <span class="booking-confirm-value">${escapeHtml(room.name)}</span>
              </div>
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">預約日期</span>
                <span class="booking-confirm-value">${formatDateDisplay(selectedDate)}</span>
              </div>
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">預約時段</span>
                <span class="booking-confirm-value">${start} - ${end}</span>
              </div>
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">消費方式</span>
                <span class="booking-confirm-value">${escapeHtml(room.chargeMethod || '免費')}</span>
              </div>
            </div>
          </div>
          <div class="booking-confirm-footer">
            <button class="btn" type="button" id="btnCancelLive">取消</button>
            <button class="btn btn-primary" type="button" id="btnConfirmLive">確認預約</button>
          </div>
        </div>
      </div>
    `;
    
    // 添加到 body
    const existing = document.getElementById('liveConfirmModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', confirmHtml);
    
    const modal = document.getElementById('liveConfirmModal');
    const closeBtn = document.getElementById('btnCloseLiveConfirm');
    const cancelBtn = document.getElementById('btnCancelLive');
    const confirmBtn = document.getElementById('btnConfirmLive');
    const backdrop = document.getElementById('liveConfirmBackdrop');
    
    const closeModal = () => {
      const el = document.getElementById('liveConfirmModal');
      if (el) el.remove();
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    
    confirmBtn.addEventListener('click', async () => {
      try {
        // 检查用户信息
        if (!currentUserId || !currentUserHouseNo || !currentUserName) {
          alert('請先完成個人資料設置');
          return;
        }
        
        // 获取日期key
        const dateKey = ymd80(selectedDate);
        
        // 检查该时段是否已满
        const existingBookings = await loadBookingsByRoomDate(
          currentCommunityId,
          room.id,
          dateKey
        );
        
        const used = existingBookings.filter(r => 
          String(r.startTime || '') === start && 
          ['pending', 'approved'].includes(String(r.status || 'pending'))
        ).length;
        
        if (used >= Number(room.capacity || 1)) {
          alert('該時段已滿，請選擇其他時段');
          return;
        }
        
        // 创建预约
        const startAt = makeDateTime80(dateKey, start);
        const endAt = makeDateTime80(dateKey, end);
        const status = room.requireApproval ? 'pending' : 'approved';
        
        const payload = {
          roomId: room.id,
          roomName: room.name,
          dateKey,
          startTime: start,
          endTime: end,
          startAt: firebase.firestore.Timestamp.fromDate(startAt),
          endAt: firebase.firestore.Timestamp.fromDate(endAt),
          unit: currentUserHouseNo,
          name: currentUserName,
          note: '',
          status,
          createdBy: currentUserId,
          createdByName: currentUserName,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        if (status === 'approved') {
          payload.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
          payload.approvedBy = currentUserId;
          payload.approvedByName = currentUserName;
        }
        
        await db.collection('communities').doc(currentCommunityId).collection('live_bookings').add(payload);
        
        alert(status === 'pending' ? '預約已送出，請等待審核' : '預約成功！');
        closeModal();
        closeLiveModal();
        
        // 重新加载预约列表
        if (currentCommunityId && currentUserId) {
          loadAndRenderMyRecords();
        }
        
      } catch (e) {
        console.error('Error booking:', e);
        alert('預約失敗，請稍後再試');
      }
    });
    
    // 显示弹窗
    modal.hidden = false;
  }

  function openCancelLiveConfirmModal(room, start, end, bookingId) {
    const confirmHtml = `
      <div class="booking-confirm-modal" id="cancelLiveConfirmModal">
        <div class="booking-confirm-backdrop" id="cancelLiveConfirmBackdrop"></div>
        <div class="booking-confirm-dialog">
          <div class="booking-confirm-header">
            <h3>確認取消預約</h3>
            <button class="modal-close" type="button" id="btnCloseCancelLiveConfirm" aria-label="關閉">×</button>
          </div>
          <div class="booking-confirm-body">
            <div class="booking-confirm-info">
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">直播室名稱</span>
                <span class="booking-confirm-value">${escapeHtml(room.name)}</span>
              </div>
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">預約日期</span>
                <span class="booking-confirm-value">${formatDateDisplay(selectedDate)}</span>
              </div>
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">預約時段</span>
                <span class="booking-confirm-value">${start} - ${end}</span>
              </div>
            </div>
          </div>
          <div class="booking-confirm-footer">
            <button class="btn" type="button" id="btnCancelCancelLive">返回</button>
            <button class="btn btn-primary" type="button" id="btnConfirmCancelLive" style="background: #ef4444;">確認取消</button>
          </div>
        </div>
      </div>
    `;
    
    // 添加到 body
    const existing = document.getElementById('cancelLiveConfirmModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', confirmHtml);
    
    const modal = document.getElementById('cancelLiveConfirmModal');
    const closeBtn = document.getElementById('btnCloseCancelLiveConfirm');
    const cancelBtn = document.getElementById('btnCancelCancelLive');
    const confirmBtn = document.getElementById('btnConfirmCancelLive');
    const backdrop = document.getElementById('cancelLiveConfirmBackdrop');
    
    const closeModal = () => {
      const el = document.getElementById('cancelLiveConfirmModal');
      if (el) el.remove();
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    
    confirmBtn.addEventListener('click', async () => {
      try {
        // 取消预约
        await db.collection('communities').doc(currentCommunityId).collection('live_bookings').doc(bookingId).update({
          status: 'canceled',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        alert('預約已取消');
        closeModal();
        
        // 重新渲染时间槽
        if (currentRoom) {
          renderLiveTimeSlots(currentRoom);
        }
        
        // 重新加载预约列表
        if (currentCommunityId && currentUserId) {
          loadAndRenderMyRecords();
        }
        
        // 重新加载直播室预约统计
        if (currentCommunityId) {
          loadBookingsByRoom(currentCommunityId);
        }
        
      } catch (e) {
        console.error('Error canceling booking:', e);
        alert('取消預約失敗，請稍後再試');
      }
    });
    
    // 显示弹窗
    modal.hidden = false;
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
    communityLiveTitle.textContent = `棟別 ${basicName}`;

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

    // 保存用户数据
    currentUserData = data;
    currentUserId = String(user.uid || '').trim();
    
    const displayName = String(
      data.displayName ||
      data.name ||
      data.fullName ||
      user.displayName ||
      nameFromEmail(user.email) ||
      ''
    ).trim();
    
    currentUserName = displayName;
    
    if (nameTextEl) nameTextEl.textContent = displayName || '—';
    const initial2 = pickInitial(displayName, user.email);
    if (profileAvatar) profileAvatar.textContent = initial2;
    
    const houseNo = String(data.houseNo || data.unit || '').trim();
    const subHouseNo = String(data.subHouseNo || data.subUnit || data.sub || '').trim();
    let fullHouseNo = houseNo;
    if (subHouseNo) {
      fullHouseNo = `${houseNo}-${subHouseNo}`;
    }
    
    currentUserHouseNo = fullHouseNo;
    
    console.log('Setting title - houseNo:', houseNo, 'subHouseNo:', subHouseNo, 'displayName:', displayName);
    const buildingText = String(data.building || data.block || '').trim();
    communityLiveTitle.textContent = `${buildingText || '棟別'} ${displayName || '姓名'}`;

    if (houseNoTextEl) {
      houseNoTextEl.textContent = fullHouseNo || '—';
    }

    const avatarUrl = String(data.avatarDataUrl || data.photoDataUrl || data.photoURL || user.photoURL || '').trim();
    if (avatarUrl && profileAvatarImg) {
      profileAvatarImg.src = avatarUrl;
      profileAvatarImg.style.display = 'block';
      if (profileAvatar) profileAvatar.style.display = 'none';
    }
    
    // 載入直播室資料
    await loadRooms({ ...data, __displayName: displayName || '', __communityId: String(data.community || '').trim() });
  }

  function showToast(message, isError) {
    const statusEl = document.getElementById('profileStatus');
    if (!statusEl) return;
    statusEl.textContent = String(message || '');
    statusEl.hidden = !message;
    statusEl.classList.toggle('error', Boolean(isError));
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

  function bindModalEvents() {
    // 关闭按钮
    const closeBtn = document.getElementById('btnCloseLiveModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeLiveModal);
    }
    
    // 点击背景关闭
    const backdrop = document.querySelectorAll('[data-modal-close="1"]');
    backdrop.forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          closeLiveModal();
        }
      });
    });
    
    // 日期选择按钮
    const btnSelectDate = document.getElementById('btnSelectDate');
    if (btnSelectDate) {
      btnSelectDate.addEventListener('click', openLiveDatePicker);
    }
  }

  // 全局预约函数
  window.bookRoom = function (roomId, roomName) {
    openLiveModal(roomId, roomName);
  };

  // 全局取消预约函数
  window.openCancelRecordModal = function (recordId, roomName, dateKey, startTime, endTime) {
    const room = {
      id: '',
      name: roomName
    };
    openCancelLiveConfirmModal(room, startTime, endTime, recordId);
  };

  let authWaitTimer = null;

  function init() {
    try { renderLiveStreamCard(); } catch (e) { console.warn('[LiveMeeting] 首次 render 失敗', e); }
    setTimeout(() => { try { renderLiveStreamCard(); } catch {} }, 0);
    setTimeout(() => { try { renderLiveStreamCard(); } catch {} }, 200);
    setTimeout(() => { try { renderLiveStreamCard(); } catch {} }, 800);
    setTimeout(() => { try { renderLiveStreamCard(); } catch {} }, 2000);

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // 绑定我的预约的分页按钮
    const myRecordsTabBtns = document.querySelectorAll('.my-record-tab-btn');
    myRecordsTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchMyRecordsTab(btn.dataset.subtab);
      });
    });

    bindSignOut();
    bindModalEvents();

    // 检查登入状态
    auth.onAuthStateChanged(async (user) => {
      const isEmbedded = (() => {
        try {
          const urlParams = new URLSearchParams(location.search);
          if (String(urlParams.get('embed') || '') === '1') return true;
        } catch {}
        try { return window.self !== window.top; } catch { return true; }
      })();

      const showNeedLogin = () => {
        const html = `<div class="status error">請先在主頁登入後再開啟此頁面</div>`;
        if (liveList) liveList.innerHTML = html;
        if (myRecordList) myRecordList.innerHTML = '';
        setTimeout(() => { try { renderLiveStreamCard(); } catch {} }, 0);
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
