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
  const bookList = document.getElementById('bookList');
  const myBookingsList = document.getElementById('myBookingsList');
  const communityFacilityTitle = document.getElementById('communityFacilityTitle');

  let currentFacility = null;
  let facilitiesData = {};
  let currentCommunityId = null;
  let currentCommunityName = "";
  let selectedDate = new Date();
  let currentUserData = null;
  let currentUserId = null;
  let currentUserName = "";
  let currentUserHouseNo = "";
  let pendingReservationsByFacility = {}; // 按设施统计待审核预约
  let totalPendingReservations = 0;

  function switchTab(tab) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    if (tab === 'book') {
      bookList.classList.remove('hidden');
      myBookingsList.classList.add('hidden');
    } else {
      bookList.classList.add('hidden');
      myBookingsList.classList.remove('hidden');
    }
  }

  function switchMyBookingsTab(subtab) {
    const myBookingsTabBtns = document.querySelectorAll('.my-bookings-tab-btn');
    myBookingsTabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === subtab);
    });

    const recentBookingsEl = document.getElementById('recentBookings');
    const historyBookingsEl = document.getElementById('historyBookings');
    
    if (recentBookingsEl && historyBookingsEl) {
      if (subtab === 'recent') {
        recentBookingsEl.classList.remove('hidden');
        historyBookingsEl.classList.add('hidden');
      } else {
        recentBookingsEl.classList.add('hidden');
        historyBookingsEl.classList.remove('hidden');
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
      if (out.includes(s)) return;
      out.push(s);
    };
    push(userData?.__communityId);
    push(userData?.community);
    try { push(new URLSearchParams(location.search).get('c')); } catch {}
    try { push(localStorage.getItem('csp_active_community_v1')); } catch {}
    return out.length ? out : ['default'];
  }

  function normalizeFacilityConfig(v, id) {
    const data = v && typeof v === "object" ? v : {};
    const name = String(data.name || id || "").trim() || "設施";
    const imageDataUrl = String(data.imageDataUrl || data.image || data.imageUrl || "").trim();
    const chargeMethod = String(data.chargeMethod || data.charge || data.pricing || "").trim();
    const orderRaw = Number(data.order);
    const order = Number.isFinite(orderRaw) ? orderRaw : null;
    const slotMinutes = Math.max(15, Math.min(240, Number(data.slotMinutes || data.slot || 60) || 60));
    const openTime = String(data.openTime || "09:00").trim() || "09:00";
    const closeTime = String(data.closeTime || "21:00").trim() || "21:00";
    const capacity = Math.max(1, Math.min(500, Number(data.capacity || data.quota || 1) || 1));
    const requireApproval = Boolean(data.requireApproval !== false);
    const enabled = Boolean(data.enabled !== false);
    const advanceBookingDays = Math.max(1, Math.min(365, Number(data.advanceBookingDays || 30) || 30));
    return { id: String(id || "").trim(), name, imageDataUrl, chargeMethod, order, slotMinutes, openTime, closeTime, capacity, requireApproval, enabled, advanceBookingDays };
  }

  async function loadFacilityConfigs(cid, filterEnabled = true) {
    const communityId = String(cid || "").trim() || "default";
    try {
      const snap = await db.collection("communities").doc(communityId).collection("facility_configs").get();
      let list = (snap && snap.docs ? snap.docs : []).map((d) => normalizeFacilityConfig(d.data() || {}, d.id));
      
      // 先过滤启用的设施
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

  function renderFacilityItem(facility) {
    const imageStyle = facility.imageDataUrl 
      ? `background-image: url('${facility.imageDataUrl}'); background-size: cover; background-position: center;`
      : '';
    
    const pendingCount = pendingReservationsByFacility[facility.id] || 0;
    
    return `
      <div class="parcel-item facility-item">
        <div class="facility-preview facility-preview-responsive" style="${imageStyle}">
          ${!facility.imageDataUrl ? `
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
          <div class="parcel-no" style="font-size: 18px; font-weight: 800;">${facility.name}</div>
          <div class="parcel-desc">開放時間：${facility.openTime} - ${facility.closeTime}</div>
          <div class="parcel-type">時段長度：${facility.slotMinutes} 分鐘</div>
          <div class="parcel-type">預約名額：${facility.capacity} 人</div>
          ${facility.chargeMethod ? `<div class="parcel-type">費用說明：${facility.chargeMethod}</div>` : ''}
          ${facility.requireApproval ? `<div class="parcel-date" style="color: #d32f2f;">需要審核</div>` : '<div class="parcel-date" style="color: #10b981;">免審核</div>'}
        </div>
        <button class="btn btn-primary facility-book-btn" onclick="window.bookFacility && window.bookFacility('${facility.id}', '${facility.name}')">
          ${pendingCount > 0 ? `<span class="badge-inline">${pendingCount}</span>` : ''}
          預約
        </button>
      </div>
    `;
}

function renderReservationItem(reservation) {
  const statusText = {
    'pending': '待審核',
    'approved': '已核准',
    'rejected': '已拒絕',
    'canceled': '已取消'
  }[String(reservation.status || 'pending')] || '待審核';
  
  const statusClass = {
    'pending': 'warning',
    'approved': 'success',
    'rejected': 'error',
    'canceled': 'secondary'
  }[String(reservation.status || 'pending')] || 'warning';

  // 确定预约状态样式
  const now = new Date();
  let itemClass = 'reservation-item';
  let canCancel = false;
  
  if (['pending', 'approved'].includes(String(reservation.status || ''))) {
    const endDateTime = makeDateTime80(reservation.dateKey, reservation.endTime);
    if (endDateTime && endDateTime < now) {
      // 已结束
      itemClass += ' self-used';
    } else if (String(reservation.status) === 'approved') {
      // 已预约且未结束，可取消
      itemClass += ' self-booked';
      canCancel = true;
    } else if (String(reservation.status) === 'pending') {
      // 待审核且未结束，可取消
      itemClass += ' self-pending';
      canCancel = true;
    }
  }

  const onclickAttr = canCancel 
    ? `onclick="openCancelReservationModal('${reservation.id}', '${escapeHtml(reservation.facilityName)}', '${reservation.dateKey}', '${reservation.startTime}', '${reservation.endTime}')"` 
    : '';

  return `
    <div class="parcel-item ${itemClass}" ${onclickAttr}>
      <div class="parcel-info">
        <div class="parcel-no" style="font-size: 18px; font-weight: 800;">${escapeHtml(reservation.facilityName || '設施')}</div>
        <div class="parcel-desc">日期：${escapeHtml(reservation.dateKey || '')}</div>
        <div class="parcel-type">時間：${escapeHtml(reservation.startTime || '')} - ${escapeHtml(reservation.endTime || '')}</div>
        <div class="parcel-date">狀態：<span class="tag ${statusClass}">${escapeHtml(statusText)}</span></div>
      </div>
    </div>
  `;
}

async function loadAndRenderMyReservations() {
  const recentBookingsEl = document.getElementById('recentBookings');
  const historyBookingsEl = document.getElementById('historyBookings');
  if (!recentBookingsEl || !historyBookingsEl) return;
  
  try {
    console.log('加载预约 - currentCommunityId:', currentCommunityId, 'currentUserId:', currentUserId);
    const reservations = await loadUserReservations(currentCommunityId, currentUserId);
    console.log('找到的预约数量:', reservations.length);
    console.log('预约数据:', reservations);
    
    const now = new Date();
    
    // 分离近期预约和历史预约
    const recentReservations = [];
    const historyReservations = [];
    
    reservations.forEach(reservation => {
      const endDateTime = makeDateTime80(reservation.dateKey, reservation.endTime);
      if (endDateTime && endDateTime >= now) {
        // 未结束的预约
        recentReservations.push(reservation);
      } else {
        // 已结束的预约
        historyReservations.push(reservation);
      }
    });
    
    // 渲染近期预约
    if (!recentReservations.length) {
      recentBookingsEl.innerHTML = '<div class="status">目前沒有近期預約</div>';
    } else {
      recentBookingsEl.innerHTML = recentReservations.map(renderReservationItem).join('');
    }
    
    // 渲染历史预约
    if (!historyReservations.length) {
      historyBookingsEl.innerHTML = '<div class="status">目前沒有歷史預約</div>';
    } else {
      historyBookingsEl.innerHTML = historyReservations.map(renderReservationItem).join('');
    }
    
  } catch (e) {
    console.error('Error loading reservations:', e);
    recentBookingsEl.innerHTML = '<div class="status error">載入預約失敗，請稍後再試</div>';
    historyBookingsEl.innerHTML = '<div class="status error">載入預約失敗，請稍後再試</div>';
  }
}

async function loadFacilities(userData) {
    const candidates = readCommunityCandidates(userData);
    
    console.log('Loading facilities candidates:', candidates);

    const tryLoadByCommunityId = async (communityId) => {
      // loadFacilityConfigs 已经处理过滤和排序
      const facilities = await loadFacilityConfigs(communityId, true);
      
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
      
      return { facilities, communityId, communityName };
    };
    
    try {
      let resolvedCommunityId = "";
      let resolvedCommunityName = "社區";
      let facilities = [];
      for (const key of candidates) {
        const cid = await resolveCommunityId(key);
        if (!cid) continue;
        const { facilities: list, communityId, communityName } = await tryLoadByCommunityId(cid);
        if (list && list.length) {
          facilities = list;
          resolvedCommunityId = communityId;
          resolvedCommunityName = communityName;
          break;
        }
        if (!resolvedCommunityId) {
          facilities = list;
          resolvedCommunityId = communityId;
          resolvedCommunityName = communityName;
        }
      }
      
      console.log('Total facilities found:', facilities.length);
      
      // 保存当前社区信息
      currentCommunityId = resolvedCommunityId;
      currentCommunityName = resolvedCommunityName;
      
      // 存储设施数据
      facilitiesData = {};
      facilities.forEach(f => {
        facilitiesData[f.id] = f;
      });
      
      // 加载预约统计
      if (currentCommunityId) {
        await loadReservationsByFacility(currentCommunityId);
      }
      
      // 渲染设施列表
      if (!bookList) return;
      if (!facilities.length) {
        bookList.innerHTML = '<div class="status">目前沒有開放預約的設施</div>';
      } else {
        bookList.innerHTML = facilities.map(renderFacilityItem).join('');
      }
      
      // 加载我的预约
      if (currentCommunityId && currentUserId) {
        loadAndRenderMyReservations();
      } else {
        myBookingsList.innerHTML = '<div class="status">載入預約中...</div>';
      }
      
    } catch (e) {
      console.error('Error loading facilities:', e);
      bookList.innerHTML = '<div class="status error">載入設施失敗，請稍後再試</div>';
      myBookingsList.innerHTML = '';
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

  function formatDateDisplay(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = getChineseWeekday(date.getDay());
    return `${year}年${month}月${day}日 ${weekday}`;
  }

  function getBookableDateRange(facility) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + (facility?.advanceBookingDays || 30) - 1);
    return {
      minDate: today,
      maxDate: maxDate
    };
  }

  function updateBookingDateDisplay() {
    const dateEl = document.getElementById('bookingCurrentDate');
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

  async function loadReservationsByFacilityDate(cid, facilityId, dateKey) {
    const communityId = String(cid || "").trim() || "default";
    const fid = String(facilityId || "").trim();
    const dk = String(dateKey || "").trim();
    if (!fid || !dk) return [];
    try {
      const snap = await db.collection("communities").doc(communityId).collection("reservations")
        .where("facilityId", "==", fid)
        .where("dateKey", "==", dk)
        .get();
      const list = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
      list.sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")) || String(a.unit || "").localeCompare(String(b.unit || "")));
      return list;
    } catch {
      return [];
    }
  }

  async function loadUserReservations(cid, userId) {
    const communityId = String(cid || "").trim() || "default";
    const uid = String(userId || "").trim();
    console.log('loadUserReservations - communityId:', communityId, 'userId:', uid);
    if (!uid) return [];
    try {
      // 先尝试获取该社区的所有预约，然后在本地过滤（避免索引问题）
      console.log('尝试获取社区所有预约...');
      let snap;
      try {
        snap = await db.collection("communities").doc(communityId).collection("reservations")
          .get();
      } catch (error) {
        console.log('查询失败，尝试其他方式');
        snap = { size: 0, docs: [] };
      }
      
      // 在本地过滤出该用户的预约
      const allReservations = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
      console.log('该社区的所有预约数量:', allReservations.length);
      console.log('所有预约数据:', allReservations);
      
      const userReservations = allReservations.filter(r => {
        // 尝试多种可能的用户ID字段
        const matchById = String(r.createdBy || r.uid || r.userId || r.userUid || '') === uid;
        const matchByName = String(r.createdByName || r.userName || r.name || '') === currentUserName;
        const matchByUnit = String(r.unit || '') === currentUserHouseNo;
        return matchById || matchByName || matchByUnit;
      });
      
      // 按创建时间排序（新的在前）
      userReservations.sort((a, b) => {
        const timeA = a.createdAt?.toDate?.() || new Date(a.createdAt || 0);
        const timeB = b.createdAt?.toDate?.() || new Date(b.createdAt || 0);
        return timeB - timeA;
      });
      
      console.log('本地过滤后的预约数量:', userReservations.length);
      console.log('本地过滤后的预约记录:', userReservations);
      return userReservations;
    } catch (e) {
      console.error('loadUserReservations error:', e);
      return [];
    }
  }

  async function loadReservationsByFacility(cid) {
    const communityId = String(cid || "").trim() || "default";
    try {
      const snap = await db.collection("communities").doc(communityId).collection("reservations")
        .where("status", "in", ["pending", "approved"])
        .get();
      const list = (snap && snap.docs ? snap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
      
      // 获取当前时间
      const now = new Date();
      
      // 统计每个设施的预约数量（包括待审核和免审核，但只统计未过期的预约
      const stats = {};
      let total = 0;
      list.forEach(r => {
        const fid = String(r.facilityId || "").trim();
        if (fid) {
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
            stats[fid] = (stats[fid] || 0);
            stats[fid]++;
            total++;
          }
        }
      });
      
      pendingReservationsByFacility = stats;
      totalPendingReservations = total;
    } catch {
      pendingReservationsByFacility = {};
      totalPendingReservations = 0;
    }
  }

  function generateTimeSlots(facility) {
    const slots = [];
    const open = parseTime(facility.openTime);
    const close = parseTime(facility.closeTime);
    
    const startDate = new Date();
    startDate.setHours(open.hour, open.minute, 0, 0);
    
    const endDate = new Date();
    endDate.setHours(close.hour, close.minute, 0, 0);
    
    let current = new Date(startDate);
    
    while (current < endDate) {
      const slotEnd = new Date(current);
      slotEnd.setMinutes(slotEnd.getMinutes() + facility.slotMinutes);
      
      if (slotEnd > endDate) break;
      
      slots.push({
        start: formatTime(current),
        end: formatTime(slotEnd)
      });
      
      current = slotEnd;
    }
    
    return slots;
  }

  async function openBookingModal(facilityId, facilityName) {
    const facility = facilitiesData[facilityId];
    if (!facility) return;
    
    currentFacility = facility;
    selectedDate = new Date(); // 重置为当天
    
    const modal = document.getElementById('bookingModal');
    const facilityNameEl = document.getElementById('bookingFacilityName');
    const communityNameEl = document.getElementById('bookingCommunityName');
    const timesContainer = document.getElementById('bookingTimesContainer');
    
    // 设置社区名称和设施名称
    if (communityNameEl) {
      communityNameEl.textContent = currentCommunityName || "社區";
    }
    facilityNameEl.textContent = facilityName;
    
    // 更新日期显示
    updateBookingDateDisplay();
    
    // 生成时间段
    await renderTimeSlots(facility);
    
    // 显示弹窗
    modal.hidden = false;
  }

  async function renderTimeSlots(facility) {
    const timesContainer = document.getElementById('bookingTimesContainer');
    if (!timesContainer) return;

    // 加载预约数据
    const dateKey = ymd80(selectedDate);
    const existingReservations = await loadReservationsByFacilityDate(
      currentCommunityId,
      facility.id,
      dateKey
    );

    // 生成时间段
    const slots = generateTimeSlots(facility);
    const now = new Date();
    const selectedDateStr = ymd80(selectedDate);
    const todayStr = ymd80(new Date());

    const timesHtml = `
      <div class="booking-times-grid">
        ${slots.map(slot => {
          let status = 'available';
          let reservationData = null;
          const slotDateTime = makeDateTime80(dateKey, slot.start);
          
          // 检查时间是否已过
          const isPast = selectedDateStr < todayStr || 
            (selectedDateStr === todayStr && slotDateTime < now);
          
          if (isPast) {
            status = 'past';
          } else {
            // 查找该时段的预约
            const reservation = existingReservations.find(r => 
              String(r.startTime) === slot.start && 
              ['pending', 'approved'].includes(String(r.status))
            );
            
            if (reservation) {
              reservationData = reservation;
              if (String(reservation.createdBy) === String(currentUserId)) {
                // 自己的预约
                // 这里简化处理，实际可以添加已使用/未使用的逻辑
                status = 'self-booked';
              } else {
                // 他人预约
                status = 'other-booked';
              }
            }
          }

          let className = 'booking-time-btn';
          if (status === 'past') className += ' past';
          else if (status === 'other-booked') className += ' other-booked';
          else if (status === 'self-booked') className += ' self-booked';
          else if (status === 'self-used') className += ' self-used';
          else if (status === 'self-unused') className += ' self-unused';

          return `
            <button class="${className}" data-start="${slot.start}" data-end="${slot.end}" data-status="${status}" data-reservation-id="${reservationData ? reservationData.id : ''}">
              ${slot.start} - ${slot.end}
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
        const reservationId = btn.dataset.reservationId;
        
        if (status === 'self-booked' && reservationId) {
          // 自己预约的，显示取消确认
          openCancelConfirmModal(facility, start, end, reservationId);
        } else if (status === 'available') {
          // 可用时段，显示预约确认
          handleTimeSlotSelect(facility, start, end);
        }
      });
    });
  }

  function openDatePicker() {
    if (!currentFacility) return;
    
    const { minDate, maxDate } = getBookableDateRange(currentFacility);
    
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
        updateBookingDateDisplay();
        if (currentFacility) {
          await renderTimeSlots(currentFacility);
        }
      }
      closeDatePicker();
    });
    
    // 显示日期选择器
    datePickerModal.hidden = false;
  }

  function closeBookingModal() {
    const modal = document.getElementById('bookingModal');
    modal.hidden = true;
    currentFacility = null;
  }

  function handleTimeSlotSelect(facility, start, end) {
    openBookingConfirmModal(facility, start, end);
  }

  function openBookingConfirmModal(facility, start, end) {
    const confirmHtml = `
      <div class="booking-confirm-modal" id="bookingConfirmModal">
        <div class="booking-confirm-backdrop" id="bookingConfirmBackdrop"></div>
        <div class="booking-confirm-dialog">
          <div class="booking-confirm-header">
            <h3>確認預約</h3>
            <button class="modal-close" type="button" id="btnCloseBookingConfirm" aria-label="關閉">×</button>
          </div>
          <div class="booking-confirm-body">
            <div class="booking-confirm-info">
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">設施名稱</span>
                <span class="booking-confirm-value">${escapeHtml(facility.name)}</span>
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
                <span class="booking-confirm-value">${escapeHtml(facility.chargeMethod || '免費')}</span>
              </div>
            </div>
          </div>
          <div class="booking-confirm-footer">
            <button class="btn" type="button" id="btnCancelBooking">取消</button>
            <button class="btn btn-primary" type="button" id="btnConfirmBooking">確認預約</button>
          </div>
        </div>
      </div>
    `;
    
    // 添加到 body
    const existing = document.getElementById('bookingConfirmModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', confirmHtml);
    
    const modal = document.getElementById('bookingConfirmModal');
    const closeBtn = document.getElementById('btnCloseBookingConfirm');
    const cancelBtn = document.getElementById('btnCancelBooking');
    const confirmBtn = document.getElementById('btnConfirmBooking');
    const backdrop = document.getElementById('bookingConfirmBackdrop');
    
    const closeModal = () => {
      const el = document.getElementById('bookingConfirmModal');
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
        const existingReservations = await loadReservationsByFacilityDate(
          currentCommunityId,
          facility.id,
          dateKey
        );
        
        const used = existingReservations.filter(r => 
          String(r.startTime || '') === start && 
          ['pending', 'approved'].includes(String(r.status || 'pending'))
        ).length;
        
        if (used >= Number(facility.capacity || 1)) {
          alert('該時段已滿，請選擇其他時段');
          return;
        }
        
        // 创建预约
        const startAt = makeDateTime80(dateKey, start);
        const endAt = makeDateTime80(dateKey, end);
        const status = facility.requireApproval ? 'pending' : 'approved';
        
        const payload = {
          facilityId: facility.id,
          facilityName: facility.name,
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
        
        await db.collection('communities').doc(currentCommunityId).collection('reservations').add(payload);
        
        alert(status === 'pending' ? '預約已送出，請等待審核' : '預約成功！');
        closeModal();
        closeBookingModal();
        
        // 重新加载预约列表
        if (currentCommunityId && currentUserId) {
          loadAndRenderMyReservations();
        }
        
      } catch (e) {
        console.error('Error booking:', e);
        alert('預約失敗，請稍後再試');
      }
    });
    
    // 显示弹窗
    modal.hidden = false;
  }

  function openCancelConfirmModal(facility, start, end, reservationId) {
    const confirmHtml = `
      <div class="booking-confirm-modal" id="cancelConfirmModal">
        <div class="booking-confirm-backdrop" id="cancelConfirmBackdrop"></div>
        <div class="booking-confirm-dialog">
          <div class="booking-confirm-header">
            <h3>確認取消預約</h3>
            <button class="modal-close" type="button" id="btnCloseCancelConfirm" aria-label="關閉">×</button>
          </div>
          <div class="booking-confirm-body">
            <div class="booking-confirm-info">
              <div class="booking-confirm-row">
                <span class="booking-confirm-label">設施名稱</span>
                <span class="booking-confirm-value">${escapeHtml(facility.name)}</span>
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
            <button class="btn" type="button" id="btnCancelCancel">返回</button>
            <button class="btn btn-primary" type="button" id="btnConfirmCancel" style="background: #ef4444;">確認取消</button>
          </div>
        </div>
      </div>
    `;
    
    // 添加到 body
    const existing = document.getElementById('cancelConfirmModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', confirmHtml);
    
    const modal = document.getElementById('cancelConfirmModal');
    const closeBtn = document.getElementById('btnCloseCancelConfirm');
    const cancelBtn = document.getElementById('btnCancelCancel');
    const confirmBtn = document.getElementById('btnConfirmCancel');
    const backdrop = document.getElementById('cancelConfirmBackdrop');
    
    const closeModal = () => {
      const el = document.getElementById('cancelConfirmModal');
      if (el) el.remove();
    };
    
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);
    
    confirmBtn.addEventListener('click', async () => {
      try {
        // 取消预约
        await db.collection('communities').doc(currentCommunityId).collection('reservations').doc(reservationId).update({
          status: 'canceled',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        alert('預約已取消');
        closeModal();
        
        // 重新渲染时间槽
        if (currentFacility) {
          renderTimeSlots(currentFacility);
        }
        
        // 重新加载预约列表
        if (currentCommunityId && currentUserId) {
          loadAndRenderMyReservations();
        }
        
        // 重新加载设施预约统计
        if (currentCommunityId) {
          loadReservationsByFacility(currentCommunityId);
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
    communityFacilityTitle.textContent = `戶號 ${basicName}`;

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
    communityFacilityTitle.textContent = `${fullHouseNo || '戶號'} ${displayName || '姓名'}`;

    if (houseNoTextEl) {
      houseNoTextEl.textContent = fullHouseNo || '—';
    }

    const avatarUrl = String(data.avatarDataUrl || data.photoDataUrl || data.photoURL || user.photoURL || '').trim();
    if (avatarUrl && profileAvatarImg) {
      profileAvatarImg.src = avatarUrl;
      profileAvatarImg.style.display = 'block';
      if (profileAvatar) profileAvatar.style.display = 'none';
    }
    
    // 載入設施資料
    await loadFacilities({ ...data, __displayName: displayName || '', __communityId: String(data.community || '').trim() });
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
    const closeBtn = document.getElementById('btnCloseBookingModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeBookingModal);
    }
    
    // 点击背景关闭
    const backdrop = document.querySelectorAll('[data-modal-close="1"]');
    backdrop.forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target === el) {
          closeBookingModal();
        }
      });
    });
    
    // 日期选择按钮
    const btnSelectDate = document.getElementById('btnSelectDate');
    if (btnSelectDate) {
      btnSelectDate.addEventListener('click', openDatePicker);
    }
  }

  // 全局预约函数
  window.bookFacility = function (facilityId, facilityName) {
    openBookingModal(facilityId, facilityName);
  };

  // 全局取消预约函数
  window.openCancelReservationModal = function (reservationId, facilityName, dateKey, startTime, endTime) {
    const facility = {
      id: '',
      name: facilityName
    };
    openCancelConfirmModal(facility, startTime, endTime, reservationId);
  };

  let authWaitTimer = null;

  function init() {
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    // 绑定我的预约的分页按钮
    const myBookingsTabBtns = document.querySelectorAll('.my-bookings-tab-btn');
    myBookingsTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchMyBookingsTab(btn.dataset.subtab);
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
        if (bookList) bookList.innerHTML = html;
        if (myBookingsList) myBookingsList.innerHTML = '';
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
