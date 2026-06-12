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
  let unsubscribeListener = null;
  let currentImages = [];

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

  function renderBulletinList(data) {
    console.log("[Bulletin] renderBulletinList called with data:", data);
    if (!bulletinList) return;
    
    if (!data || data.length === 0) {
      bulletinList.innerHTML = '<div class="status">目前沒有公告</div>';
      return;
    }
    
    bulletinList.innerHTML = data.map((item) => {
      const tagColor = item.isPinned ? 'red' : (item.isImportant ? 'yellow' : 'green');
      const tagText = item.isPinned ? '置頂' : (item.isImportant ? '重要' : '最新');
      const hasImages = item.images && item.images.length > 0;
      
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
        <div style="padding:16px; width:100%;">
          <div style="background:#fff; border-radius:12px; padding:16px; box-shadow:0 1px 3px rgba(0,0,0,0.1);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:12px;">
              <div style="flex:1; min-width:0;">
                <h3 style="font-size:16px; margin:0 0 4px 0; font-weight:600;">${escapeHtml(item.title || '')}</h3>
              </div>
              <span style="flex-shrink:0; display:inline-block; padding:4px 10px; border-radius:9999px; font-size:12px; font-weight:500; background:${tagBgColor}; color:${tagTextColor};">${tagText}</span>
            </div>
            <p style="font-size:14px; margin:0 0 12px 0; color:#333; line-height:1.5;">${escapeHtml(item.content || '')}</p>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size:12px; color:#888;">建立時間：${formatDate(item.createdAt)}</div>
              ${hasImages ? `
                <button type="button" style="width:40px; height:40px; border-radius:50%; background:#f3f4f6; border:none; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s;" data-images='${JSON.stringify(item.images).replace(/'/g, "&#039;")}' data-title="${escapeHtml(item.title || '圖片')}" aria-label="查看圖片" title="查看圖片">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:22px; height:22px; color:#4b5563;">
                    <path d="M4 4h16v16H4V4zm1 2v12h14V6H5zm2 2h10l-2 4-3-4-2 4-3-4z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // 绑定图片按钮点击事件
    const imageButtons = bulletinList.querySelectorAll('[data-images]');
    imageButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault();
        const images = JSON.parse(button.getAttribute('data-images') || '[]');
        const title = button.getAttribute('data-title') || '圖片';
        openImageModal(images, title);
      });
    });
  }

  function getActiveCommunityId() {
    const urlParams = new URLSearchParams(window.location.search);
    const cParam = urlParams.get('c');
    const stored = localStorage.getItem('csp_active_community_v1');
    return cParam || stored || '';
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
    
    // 绑定关闭图片弹窗按钮
    const closeImageModalBtn = document.getElementById('btnCloseImageModal');
    if (closeImageModalBtn) {
      closeImageModalBtn.addEventListener('click', closeImageModal);
    }
    
    const imageModalBackdrop = document.querySelector('#imageModal .modal-backdrop');
    if (imageModalBackdrop) {
      imageModalBackdrop.addEventListener('click', closeImageModal);
    }
    
    const communityId = getActiveCommunityId();
    console.log("[Bulletin] Community ID:", communityId);
    setupBulletinsListener(communityId, BULLETIN_TYPE);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
