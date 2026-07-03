(function () {
  'use strict';

  const BULLETIN_TYPE = 'repair';

  // 初始化 Firebase
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) {
    console.error("Missing FIREBASE_CONFIG");
  }

  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
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

  const bulletinList = document.getElementById('bulletinList');
  const communityBulletinTitle = document.getElementById('communityBulletinTitle');
  let unsubscribeListener = null;
  let currentImages = [];
  let allBulletinsData = [];
  let currentFilter = 'all';
  let currentUserData = null;
  let currentUserId = null;
  let currentUserName = "";
  let currentUserHouseNo = "";
  let bulletinPdfMap = new Map();

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

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(date) {
    if (!date) return "";
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${da} ${h}:${mi}`;
  }

  function openImageModal(images, title) {
    currentImages = images || [];
    const imageModal = document.getElementById('imageModal');
    const imageModalTitle = document.getElementById('imageModalTitle');
    const imageModalContent = document.getElementById('imageModalContent');
    
    if (!imageModal || !imageModalContent) return;
    
    imageModalTitle.textContent = title || '圖片';
    
    if (currentImages.length === 0) {
      imageModalContent.innerHTML = '<div style="padding:40px; text-align:center; color:#888;">沒有圖片</div>';
    } else {
      imageModalContent.innerHTML = currentImages.map((img, index) => `
        <div style="margin-bottom:16px; display:flex; justify-content:center; align-items:center;">
          <img src="${escapeHtml(img)}" style="max-width:100%; max-height:70vh; height:auto; width:auto; display:block; border-radius:8px;" alt="圖片 ${index + 1}">
        </div>
      `).join('');
    }
    
    imageModal.removeAttribute('hidden');
  }

  function closeImageModal() {
    const imageModal = document.getElementById('imageModal');
    if (imageModal) {
      imageModal.setAttribute('hidden', '');
    }
  }

  function applyFilter(data) {
    if (!data) return [];
    
    if (currentFilter === 'all') {
      return data;
    }
    
    return data.filter(item => {
      const readKey = `bulletin_read_${BULLETIN_TYPE}_${item.id}`;
      const isRead = localStorage.getItem(readKey) === 'true';
      
      if (currentFilter === 'unread') {
        return !isRead;
      } else if (currentFilter === 'read') {
        return isRead;
      }
      return true;
    });
  }

  function setupFilterButtons() {
    const filterButtons = document.querySelectorAll('.tab-btn');
    
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        // 更新當前篩選
        currentFilter = btn.getAttribute('data-filter');
        
        // 更新按鈕樣式
        filterButtons.forEach(b => {
          b.classList.remove('active');
        });
        btn.classList.add('active');
        
        // 重新渲染列表
        renderBulletinList(allBulletinsData);
      });
    });
  }

  function renderBulletinList(data) {
    console.log("[Bulletin] renderBulletinList called with data:", data);
    if (!bulletinList) return;
    
    // 保存原始數據
    allBulletinsData = data || [];
    
    // 根據篩選條件過濾數據
    const filteredData = applyFilter(allBulletinsData);
    
    if (!filteredData || filteredData.length === 0) {
      bulletinList.innerHTML = '<div class="status">目前沒有公告</div>';
      return;
    }
    
    const pdfMap = new Map();
    bulletinList.innerHTML = filteredData.map((item) => {
      const tagColor = item.isPinned ? 'red' : (item.isImportant ? 'yellow' : 'green');
      const tagText = item.isPinned ? '置頂' : (item.isImportant ? '重要' : '最新');
      const hasImages = item.images && item.images.length > 0;
      const attachment = item.attachment && typeof item.attachment === 'object' ? item.attachment : null;
      const hasPdf = !!(attachment && attachment.dataUrl);
      if (hasPdf) {
        try { pdfMap.set(String(item.id || ''), String(attachment.dataUrl || '')); } catch {}
      }
      const readKey = `bulletin_read_${BULLETIN_TYPE}_${item.id}`;
      const isRead = localStorage.getItem(readKey) === 'true';
      
      // 有底色的标签样式
      let tagBgColor, tagTextColor;
      if (tagColor === 'red') {
        tagBgColor = '#fee2e2';
        tagTextColor = '#dc2626';
      } else if (tagColor === 'yellow') {
        tagBgColor = '#fef3c7';
        tagTextColor = '#d97706';
      } else {
        tagBgColor = '#dcfce7';
        tagTextColor = '#16a34a';
      }
      
      return `
        <div class="parcel-item" data-bulletin-id="${item.id}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; cursor:pointer;" class="bulletin-header">
                <h3 style="font-size:16px; margin:0; font-weight:600; ${isRead ? 'opacity:0.6;' : ''}">${escapeHtml(item.title || '')}</h3>
                ${!isRead ? '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:600; background:#dc2626; color:#fff;">未讀</span>' : '<span style="display:inline-block; padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:600; background:#6b7280; color:#fff;">已讀</span>'}
              </div>
              <div class="bulletin-content" style="display:none;">
                <p style="font-size:14px; margin:8px 0 12px 0; color:#333; line-height:1.5;">${escapeHtml(item.content || '')}</p>
                <div style="font-size:12px; color:#888;">建立時間：${formatDate(item.createdAt)}</div>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:12px;">
              <div style="display:flex; align-items:flex-start; gap:12px; cursor:pointer;" class="bulletin-header">
                <span style="display:inline-block; padding:4px 10px; border-radius:9999px; font-size:12px; font-weight:500; background:${tagBgColor}; color:${tagTextColor};">${tagText}</span>
                <button type="button" class="toggle-btn" style="width:40px; height:40px; border-radius:50%; background:#f3f4f6; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:transform 0.2s;">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:22px; height:22px; color:#4b5563;">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              </div>
              <div class="bulletin-content" style="display:none;">
                ${hasImages ? `
                  <button type="button" style="width:40px; height:40px; border-radius:50%; background:#f3f4f6; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s; flex-shrink:0;" data-images='${JSON.stringify(item.images).replace(/'/g, "&#039;")}' data-title="${escapeHtml(item.title || '圖片')}" aria-label="查看圖片" title="查看圖片">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:22px; height:22px; color:#4b5563;">
                      <path d="M4 4h16v16H4V4zm1 2v12h14V6H5zm2 2h10l-2 4-3-4-2 4-3-4z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                ` : ''}
                ${hasPdf ? `
                  <a href="#" rel="noopener noreferrer" data-open-pdf="1" data-pdf-id="${escapeHtml(String(item.id || ''))}" data-pdf-name="${escapeHtml(String(attachment.name || '附件.pdf'))}" style="width:40px; height:40px; border-radius:50%; background:#fef2f2; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s; flex-shrink:0; color:#b91c1c; text-decoration:none;" aria-label="開啟 PDF" title="${escapeHtml(String(attachment.name || '附件.pdf'))}">
                    <span style="font-size:11px; font-weight:800;">PDF</span>
                  </a>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // 绑定图片按钮点击事件
    const imageButtons = bulletinList.querySelectorAll('[data-images]');
    imageButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const images = JSON.parse(button.getAttribute('data-images') || '[]');
        const title = button.getAttribute('data-title') || '圖片';
        openImageModal(images, title);
      });
    });

    const pdfLinks = bulletinList.querySelectorAll('[data-open-pdf]');
    pdfLinks.forEach((a) => {
      const id = String(a.getAttribute('data-pdf-id') || '').trim();
      if (id && pdfMap.has(id)) a._pdfDataUrl = pdfMap.get(id);
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (typeof window.openPdfViewer === 'function') {
          window.openPdfViewer(a._pdfDataUrl || a.getAttribute('data-pdf-url') || a.getAttribute('href'), a.getAttribute('data-pdf-name'));
        } else {
          window.alert('PDF 檢視器尚未載入，請重新整理後再試。');
        }
      });
    });
    bulletinPdfMap = pdfMap;

    // 绑定折叠/展开事件
    const toggleButtons = bulletinList.querySelectorAll('.toggle-btn');
    const bulletinHeaders = bulletinList.querySelectorAll('.bulletin-header');
    
    function toggleBulletin(bulletinItem) {
      const contents = bulletinItem.querySelectorAll('.bulletin-content');
      const toggleBtn = bulletinItem.querySelector('.toggle-btn');
      const isExpanded = contents[0]?.style.display === 'block';
      
      contents.forEach(content => {
        content.style.display = isExpanded ? 'none' : 'block';
      });
      
      toggleBtn.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
    }
    
    function markAsRead(bulletinItem) {
      const bulletinId = bulletinItem.getAttribute('data-bulletin-id');
      const readKey = `bulletin_read_${BULLETIN_TYPE}_${bulletinId}`;
      localStorage.setItem(readKey, 'true');
      
      // 更新UI
      const titleEl = bulletinItem.querySelector('h3');
      const readTag = bulletinItem.querySelector('h3 + span');
      
      if (titleEl) {
        titleEl.style.opacity = '0.6';
      }
      if (readTag) {
        readTag.textContent = '已讀';
        readTag.style.background = '#6b7280';
      }
    }
    
    toggleButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const bulletinItem = btn.closest('.parcel-item');
        if (bulletinItem) {
          markAsRead(bulletinItem);
          toggleBulletin(bulletinItem);
        }
      });
    });
    
    bulletinHeaders.forEach(header => {
      header.addEventListener('click', (e) => {
        const bulletinItem = header.closest('.parcel-item');
        if (bulletinItem) {
          markAsRead(bulletinItem);
          toggleBulletin(bulletinItem);
        }
      });
    });
  }

  function getActiveCommunityId() {
    const urlParams = new URLSearchParams(window.location.search);
    const cParam = urlParams.get('c');
    const stored = localStorage.getItem('csp_active_community_v1');
    return cParam || stored || '';
  }

  async function loadProfile(user) {
    if (!user) return;

    // 先用基本信息更新标题
    const basicName = String(user.displayName || nameFromEmail(user.email) || '姓名').trim();
    communityBulletinTitle.textContent = `戶號 ${basicName}`;

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
    
    const houseNo = String(data.houseNo || data.unit || '').trim();
    const subHouseNo = String(data.subHouseNo || data.subUnit || data.sub || '').trim();
    let fullHouseNo = houseNo;
    if (subHouseNo) {
      fullHouseNo = `${houseNo}-${subHouseNo}`;
    }
    
    currentUserHouseNo = fullHouseNo;
    
    console.log('Setting title - houseNo:', houseNo, 'subHouseNo:', subHouseNo, 'displayName:', displayName);
    communityBulletinTitle.textContent = `${fullHouseNo || '戶號'} ${displayName || '姓名'}`;
  }

  function setupBulletinsListener(communityId, type) {
    console.log("[Bulletin] setupBulletinsListener called with cid:", communityId, "type:", type);
    if (unsubscribeListener) {
      try { unsubscribeListener(); } catch {}
    }

    if (!communityId) {
      console.warn("[Bulletin] No community ID available");
      renderBulletinList([]);
      return;
    }

    unsubscribeListener = db
      .collection('communities')
      .doc(communityId)
      .collection('bulletins')
      .where('type', '==', type)
      .onSnapshot(
        (snap) => {
          console.log("[Bulletin] Received snapshot with size:", snap.size);
          const data = [];
          snap.forEach((doc) => {
            data.push({ id: doc.id, ...doc.data() });
          });
          
          // Sort by createdAt descending
          data.sort((a, b) => {
            const tA = a.createdAt ? (a.createdAt.toMillis ? a.createdAt.toMillis() : a.createdAt) : 0;
            const tB = b.createdAt ? (b.createdAt.toMillis ? b.createdAt.toMillis() : b.createdAt) : 0;
            return tB - tA;
          });
          
          renderBulletinList(data);
        },
        (err) => {
          console.error("[Bulletin] Snapshot error:", err);
          renderBulletinList([]);
        }
      );
  }

  function init() {
    console.log("[Bulletin] Initializing bulletin page");
    
    // 设置篩選按鈕
    setupFilterButtons();
    
    // 绑定关闭图片弹窗按钮
    const closeImageModalBtn = document.getElementById('btnCloseImageModal');
    if (closeImageModalBtn) {
      closeImageModalBtn.addEventListener('click', closeImageModal);
    }
    
    const imageModalBackdrop = document.querySelector('#imageModal .modal-backdrop');
    if (imageModalBackdrop) {
      imageModalBackdrop.addEventListener('click', closeImageModal);
    }
    
    // 監聽認證狀態
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        await loadProfile(user);
        const communityId = getActiveCommunityId();
        console.log("[Bulletin] Community ID:", communityId);
        setupBulletinsListener(communityId, BULLETIN_TYPE);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
