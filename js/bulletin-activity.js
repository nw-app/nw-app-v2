(function () {
  'use strict';

  const FIRESTORE_TYPE = 'activity';
  const NA = window.NWActivity || {};

  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) console.error("Missing FIREBASE_CONFIG");

  try { firebase.initializeApp(firebaseConfig); } catch (e) { console.log("Firebase init error:", e); }

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
  const tabsEl = document.getElementById('activityTabs');
  let unsubscribeListener = null;
  let allData = [];
  let currentTab = 'video'; // 'video' | 'photo'
  let currentUserId = null;
  let currentUserName = "";
  let currentUserHouseNo = "";

  function nameFromEmail(email) {
    const e = String(email || '').trim();
    if (!e) return '';
    const part = e.split('@')[0] || '';
    return String(part || '').trim();
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

  function setupTabs() {
    if (!tabsEl) return;
    const buttons = tabsEl.querySelectorAll(".tab-btn");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        currentTab = btn.getAttribute("data-activity-tab") || "video";
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderList();
      });
    });
  }

  function renderList() {
    if (!bulletinList) return;
    const list = (allData || []).filter((x) => String(x.category || "") === String(currentTab || ""));
    if (!list.length) {
      bulletinList.innerHTML = `<div class="status">目前沒有${currentTab === "video" ? "活動影片" : "活動相片"}</div>`;
      return;
    }
    const isVideo = currentTab === "video";
    bulletinList.innerHTML = list.map((item) => {
      const url = String(item.url || "").trim();
      const time = NA.formatDateTime(item.activityTime || item.createdAt);
      const thumb = isVideo ? NA.youtubeThumbUrl(url) : NA.normalizePhotoPreviewUrl(url);
      const title = escapeHtml(String(item.title || ""));
      const alt = escapeHtml(String(item.title || (isVideo ? "活動影片" : "活動相片")));
      return `
        <div class="parcel-item" style="padding:14px;">
          <div style="display:flex; flex-direction:column; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <h3 style="font-size:16px; margin:0; font-weight:700;">${title}</h3>
              <span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-size:12px; font-weight:700; background:${isVideo ? "#fef3c7" : "#dcfce7"}; color:${isVideo ? "#b45309" : "#166534"};">${isVideo ? "影片" : "相片"}</span>
            </div>
            <div style="font-size:13px; color:#6b7280;">時間：${escapeHtml(time || "—")}</div>
            ${thumb ? `
              <button type="button" data-open-external="${escapeHtml(item.id)}" style="padding:0; border:none; background:none; cursor:pointer; display:flex; justify-content:center; margin:4px 0;">
                <span style="position:relative; display:block; width:100%; max-width:720px; border-radius:12px; overflow:hidden; background:#0b0b0b;">
                  <img src="${escapeHtml(thumb)}" alt="${alt}" style="width:100%; display:block; max-height:420px; object-fit:contain; background:#0b0b0b;" loading="lazy" />
                  ${isVideo ? `<span style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.28);"><span style="width:56px; height:56px; border-radius:9999px; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; color:#fff;"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true" style="width:26px; height:26px;"><path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l11.3-6.8a1 1 0 0 0 0-1.7l-11.3-6.8A1 1 0 0 0 8 5.2Z" fill="currentColor"/></svg></span></span>` : ""}
                </span>
              </button>
            ` : ""}
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
            <button class="btn btn-sm" type="button" data-external-btn="${escapeHtml(item.id)}">另開視窗前往</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // 事件委派只綁一次（清單容器是靜態元素，重繪不需要重新綁定）
  function bindListEvents() {
    if (!bulletinList || bulletinList._actDelegBound) return;
    bulletinList._actDelegBound = true;
    bulletinList.addEventListener("click", (e) => {
      const el = e.target.closest("[data-open-external], [data-external-btn]");
      if (!el) return;
      e.preventDefault();
      const id = el.getAttribute("data-open-external") || el.getAttribute("data-external-btn") || "";
      const item = (allData || []).find((x) => String(x.id || "") === String(id || ""));
      const u = String((item && item.url) || "").trim();
      if (!u) return;
      window.open(u, "_blank", "noopener,noreferrer");
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
    const basicName = String(user.displayName || nameFromEmail(user.email) || '姓名').trim();
    communityBulletinTitle.textContent = `戶號 ${basicName}`;
    let data = {};
    try {
      const doc = await db.collection('users').doc(String(user.uid)).get();
      if (doc.exists) data = doc.data() || {};
      if (!data || !Object.keys(data).length) {
        const email = String(user.email || '').trim();
        if (email) {
          const snap = await db.collection('users').where('email', '==', email).limit(1).get();
          if (snap.size > 0) data = snap.docs[0].data() || {};
        }
      }
    } catch (e) {
      console.error('Error fetching user data:', e);
      data = {};
    }
    currentUserId = String(user.uid || '').trim();
    const displayName = String(
      data.displayName || data.name || data.fullName || user.displayName || nameFromEmail(user.email) || ''
    ).trim();
    currentUserName = displayName;
    const houseNo = String(data.houseNo || data.unit || '').trim();
    const subHouseNo = String(data.subHouseNo || data.subUnit || data.sub || '').trim();
    let fullHouseNo = houseNo;
    if (subHouseNo) fullHouseNo = `${houseNo}-${subHouseNo}`;
    currentUserHouseNo = fullHouseNo;
    communityBulletinTitle.textContent = `${fullHouseNo || '戶號'} ${displayName || '姓名'}`;
  }

  function setupListener(communityId) {
    if (unsubscribeListener) { try { unsubscribeListener(); } catch {} }
    if (!communityId) {
      allData = [];
      renderList();
      return;
    }
    unsubscribeListener = db
      .collection('communities')
      .doc(communityId)
      .collection('bulletins')
      .where('type', '==', FIRESTORE_TYPE)
      .onSnapshot(
        (snap) => {
          const list = [];
          snap.forEach((doc) => { list.push(NA.normalizeItem(doc)); });
          allData = NA.sortByTimeDesc(list);
          renderList();
        },
        (err) => {
          console.error("[Activity] Snapshot error:", err);
          allData = [];
          renderList();
        }
      );
  }

  function init() {
    setupTabs();
    bindListEvents();
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        await loadProfile(user);
        const cid = getActiveCommunityId();
        setupListener(cid);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
