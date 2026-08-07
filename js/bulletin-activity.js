(function () {
  'use strict';

  const FIRESTORE_TYPE = 'activity';

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

  function formatDate(date) {
    if (!date) return "";
    let d;
    if (date instanceof Date) d = date;
    else if (date && typeof date.toDate === "function") { try { d = date.toDate(); } catch {} }
    if (!d) d = new Date(date);
    if (!d || isNaN(d.getTime())) return String(date || "");
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${da} ${h}:${mi}`;
  }

  function youtubeVideoId(url) {
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

  function youtubeEmbedUrl(url) {
    const id = youtubeVideoId(url);
    if (!id) return "";
    return `https://www.youtube.com/embed/${id}?rel=0`;
  }

  function googlePhotosAlbumId(url) {
    const u = String(url || "").trim();
    const m = u.match(/photos\.google\.com\/[^/]+\/[^/]+\/([A-Za-z0-9_-]{10,})/);
    if (m && m[1]) return m[1];
    const m2 = u.match(/\/([A-Za-z0-9_-]{20,})/);
    if (m2 && m2[1]) return m2[1];
    return "";
  }

  function normalizePhotoPreviewUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    if (/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)) return u;
    const id = googlePhotosAlbumId(u);
    if (id) return `https://lh3.googleusercontent.com/${encodeURIComponent(id)}=w1200`;
    return "";
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
      const time = formatDate(item.activityTime || item.createdAt);
      const previewUrl = isVideo ? youtubeEmbedUrl(url) : normalizePhotoPreviewUrl(url);
      return `
        <div class="parcel-item" style="padding:14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; cursor:pointer;" data-open-external="${escapeHtml(item.id)}">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
                <h3 style="font-size:16px; margin:0; font-weight:700;">${escapeHtml(String(item.title || ""))}</h3>
                <span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-size:12px; font-weight:700; background:${isVideo ? "#fef3c7" : "#dcfce7"}; color:${isVideo ? "#b45309" : "#166534"};">${isVideo ? "影片" : "相片"}</span>
              </div>
              <div style="font-size:13px; color:#6b7280; margin-bottom:10px;">時間：${escapeHtml(time || "—")}</div>
              ${previewUrl ? `
                <div style="display:flex; justify-content:center; margin:8px 0;">
                  ${isVideo
                    ? `<iframe src="${escapeHtml(previewUrl)}" title="${escapeHtml(String(item.title || "影片"))}" style="width:100%; max-width:720px; aspect-ratio:16/9; border:none; border-radius:12px;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe>`
                    : `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(String(item.title || "相片"))}" style="max-width:100%; max-height:380px; border-radius:12px; display:block;">`}
                </div>
              ` : ""}
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
            <button class="btn btn-sm" type="button" data-external-btn="${escapeHtml(item.id)}">另開視窗前往</button>
          </div>
        </div>
      `;
    }).join("");

    const openExternal = (id) => {
      const item = allData.find((x) => String(x.id || "") === String(id || ""));
      const u = String(item?.url || "").trim();
      if (!u) return;
      window.open(u, "_blank", "noopener,noreferrer");
    };

    bulletinList.querySelectorAll("[data-open-external]").forEach((el) => {
      el.addEventListener("click", () => openExternal(el.getAttribute("data-open-external")));
    });
    bulletinList.querySelectorAll("[data-external-btn]").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        openExternal(el.getAttribute("data-external-btn"));
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
          snap.forEach((doc) => { list.push({ id: doc.id, ...doc.data() }); });
          list.sort((a, b) => {
            const getT = (x) => {
              const t = x.activityTime || x.createdAt;
              if (!t) return 0;
              if (t && typeof t.toMillis === "function") return t.toMillis();
              if (t instanceof Date) return t.getTime();
              const d = new Date(t);
              return isNaN(d.getTime()) ? 0 : d.getTime();
            };
            return getT(b) - getT(a);
          });
          allData = list;
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
