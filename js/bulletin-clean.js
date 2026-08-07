(function () {
  'use strict';

  const BULLETIN_TYPE = 'clean';
  const MAX_IMAGES = 5;

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
  let currentUserData = null;
  let currentUserId = null;
  let currentUserName = "";
  let currentUserHouseNo = "";
  let currentCleanImages = [];
  const state = {
    embed: false,
    hideTabs: false,
    currentCommunityId: "",
    currentCommunityName: "",
    currentTab: "submit"
  };

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
    const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${da} ${h}:${mi}`;
  }

  const CATEGORY_LABEL = {
    trash: "垃圾未清",
    mess: "環境髒亂",
    disinfect: "消毒需求",
    other: "其他"
  };
  const STATUS_LABEL = {
    pending: "待處理",
    processing: "處理中",
    done: "已完成"
  };
  const STATUS_BADGE = {
    pending: { bg: "#fef2f2", text: "#b91c1c" },
    processing: { bg: "#fef3c7", text: "#b45309" },
    done: { bg: "#dcfce7", text: "#15803d" }
  };

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
    if (imageModal) imageModal.setAttribute('hidden', '');
  }

  function switchTab(tabId) {
    const tab = String(tabId || "submit").trim() || "submit";
    state.currentTab = tab;
    const tabs = document.querySelectorAll('#cleanTabs [data-clean-tab]');
    const submitSection = document.getElementById('cleanSubmitSection');
    const listSection = document.getElementById('cleanListSection');
    tabs.forEach((b) => b.classList.toggle('active', String(b.getAttribute('data-clean-tab') || "") === tab));
    if (submitSection) submitSection.style.display = tab === 'submit' ? '' : 'none';
    if (listSection) listSection.style.display = tab === 'list' ? '' : 'none';
  }

  function setupTabs() {
    const tabs = document.querySelectorAll('#cleanTabs [data-clean-tab]');
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-clean-tab') || 'submit';
        switchTab(tab);
      });
    });
  }

  function ensureEmbedLayout() {
    const params = new URLSearchParams(location.search || "");
    state.embed = String(params.get("embed") || "").trim() === "1";
    state.hideTabs = state.embed && String(params.get("nav") || "").trim() === "0";
    const tabsEl = document.getElementById('cleanTabs');
    if (state.hideTabs && tabsEl) tabsEl.style.display = "none";
    if (!state.embed) return;

    const layoutEl = document.querySelector(".parcel-layout");
    const midtopEl = document.querySelector(".parcel-midtop");

    if (state.hideTabs && midtopEl) midtopEl.style.display = "none";
    if (layoutEl) {
      if (state.hideTabs) {
        layoutEl.style.gridTemplateRows = "minmax(56px, 8vh) minmax(0, 68vh) minmax(56px, 16vh)";
      } else {
        layoutEl.style.gridTemplateRows = "minmax(56px, 8vh) minmax(56px, 8vh) minmax(0, 60vh) minmax(56px, 16vh)";
      }
    }
  }

  function bindHostMessaging() {
    window.addEventListener("message", (ev) => {
      const data = ev && ev.data ? ev.data : null;
      if (!data || typeof data !== "object") return;
      const origin = String(ev.origin || "").trim();
      if (origin && origin !== String(location.origin || "")) return;
      if (data.type === "CLEAN_NAV") {
        const tab = String(data.tab || "").trim();
        if (!tab) return;
        switchTab(tab);
      }
    });
  }

  function renderCleanImagesPreview() {
    const wrap = document.getElementById('cleanImagesPreview');
    if (!wrap) return;
    if (!currentCleanImages || !currentCleanImages.length) {
      wrap.innerHTML = '<div class="muted" style="font-size:12px;">尚未選擇相片</div>';
      return;
    }
    wrap.innerHTML = currentCleanImages.map((src, idx) => `
      <div style="position:relative;">
        <img src="${escapeHtml(src)}" alt="相片${idx + 1}" style="width:96px; height:96px; object-fit:cover; border-radius:10px; display:block;" />
        <button type="button" data-clean-remove-image="${idx}" aria-label="移除" style="position:absolute; top:-6px; right:-6px; width:26px; height:26px; border:none; border-radius:9999px; background:#111827; color:#fff; font-weight:700; cursor:pointer; font-size:14px;">×</button>
      </div>
    `).join('');
    wrap.querySelectorAll('[data-clean-remove-image]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-clean-remove-image'));
        if (!isNaN(idx) && currentCleanImages[idx] != null) {
          currentCleanImages.splice(idx, 1);
          renderCleanImagesPreview();
        }
      });
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  async function handleCleanImageFiles(fileList) {
    if (!fileList || !fileList.length) return;
    const files = Array.from(fileList).slice(0, Math.max(0, MAX_IMAGES - currentCleanImages.length));
    for (const f of files) {
      try {
        const src = await readFileAsDataUrl(f);
        if (src) currentCleanImages.push(src);
      } catch (e) { console.error(e); }
    }
    renderCleanImagesPreview();
  }

  function getActiveCommunityId() {
    const urlParams = new URLSearchParams(window.location.search);
    const cParam = urlParams.get('c');
    const stored = localStorage.getItem('csp_active_community_v1');
    return cParam || stored || '';
  }

  async function loadProfile(user) {
    if (!user) return;
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
    if (subHouseNo) fullHouseNo = `${houseNo}-${subHouseNo}`;
    currentUserHouseNo = fullHouseNo;

    const communityId = getActiveCommunityId();
    state.currentCommunityId = communityId || "";
    let communityName = "";
    if (communityId) {
      try {
        const cDoc = await db.collection('communities').doc(String(communityId)).get();
        if (cDoc.exists) {
          const cData = cDoc.data() || {};
          communityName = String(cData.name || cData.communityName || '').trim();
        }
      } catch {}
    }
    state.currentCommunityName = communityName;

    const titleParts = [];
    if (fullHouseNo) titleParts.push(fullHouseNo);
    if (displayName) titleParts.push(displayName);
    const prefix = titleParts.length ? titleParts.join(" ") : "清潔通報";
    const suffix = state.embed ? "" : (communityName ? `｜${communityName}` : "");
    if (communityBulletinTitle) communityBulletinTitle.textContent = `${prefix}${suffix}`;

    const locationEl = document.getElementById('cleanLocation');
    if (locationEl && !locationEl.value) {
      locationEl.value = fullHouseNo || '';
    }
  }

  function setupSubmitForm() {
    const form = document.getElementById('cleanSubmitForm');
    const statusEl = document.getElementById('cleanSubmitStatus');
    const fileEl = document.getElementById('cleanImagesFile');
    if (fileEl) {
      fileEl.addEventListener('change', (e) => {
        handleCleanImageFiles(e.target.files);
        try { fileEl.value = ''; } catch {}
      });
    }
    renderCleanImagesPreview();
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const communityId = getActiveCommunityId();
        if (!communityId) { setSubmitStatus("尚未選擇社區", true); return; }
        if (!currentUserId) { setSubmitStatus("尚未登入", true); return; }
        const category = String(document.getElementById('cleanCategory')?.value || '').trim() || 'other';
        const location = String(document.getElementById('cleanLocation')?.value || '').trim();
        const description = String(document.getElementById('cleanDescription')?.value || '').trim();
        if (!location || !description) { setSubmitStatus("請填寫位置與說明", true); return; }
        const categoryLabel = CATEGORY_LABEL[category] || category;
        setSubmitStatus("送出中...", false);
        const payload = {
          type: BULLETIN_TYPE,
          status: "pending",
          category,
          title: `${categoryLabel}｜${location}`,
          description,
          location,
          images: currentCleanImages.slice(),
          houseNo: currentUserHouseNo,
          applicantName: currentUserName,
          applicantUid: currentUserId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection('communities').doc(communityId).collection('bulletins').add(payload);
        toastClean("已送出，社區後台將立即派員處理");
        form.reset();
        currentCleanImages = [];
        renderCleanImagesPreview();
        const locationEl = document.getElementById('cleanLocation');
        if (locationEl) locationEl.value = currentUserHouseNo || '';
        setSubmitStatus("", false);
      } catch (err) {
        console.error(err);
        setSubmitStatus(`送出失敗：${err.message}`, true);
      }
    });
  }

  function setSubmitStatus(msg, isError) {
    const statusEl = document.getElementById('cleanSubmitStatus');
    if (!statusEl) return;
    const text = String(msg || '').trim();
    statusEl.textContent = text;
    statusEl.hidden = !text;
    statusEl.style.color = isError ? "#b91c1c" : "#15803d";
  }

  function toastClean(msg) {
    const s = String(msg || "").trim();
    if (!s) return;
    try {
      if (typeof window.nwToast === "function") { window.nwToast(s); return; }
    } catch {}
    let t = document.getElementById("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.style.cssText = "position:fixed; left:50%; bottom:32px; transform:translateX(-50%); background:rgba(17,24,39,0.92); color:#fff; padding:10px 18px; border-radius:12px; font-size:14px; z-index:9999; max-width:88vw;";
      document.body.appendChild(t);
    }
    t.textContent = s;
    t.style.opacity = "1";
    window.clearTimeout(toastClean._t);
    toastClean._t = window.setTimeout(() => { try { t.style.opacity = "0"; t.style.transition = "opacity 300ms"; } catch {} }, 2200);
  }

  function renderCleanList(data) {
    if (!bulletinList) return;
    allBulletinsData = data || [];
    const mine = allBulletinsData.filter((x) => String(x.applicantUid || "") === String(currentUserId || ""));
    if (!mine.length) {
      bulletinList.innerHTML = '<div class="status">尚無通報紀錄，切換至「提出通報」送出第一筆</div>';
      return;
    }
    mine.sort((a, b) => {
      const tA = (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Number(a.createdAt) || 0);
      const tB = (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Number(b.createdAt) || 0);
      return tB - tA;
    });
    bulletinList.innerHTML = mine.map((x) => {
      const st = String(x.status || "pending");
      const badge = STATUS_BADGE[st] || STATUS_BADGE.pending;
      const hasDoneImages = Array.isArray(x.doneImages) && x.doneImages.length > 0;
      const hasSubmitImages = Array.isArray(x.images) && x.images.length > 0;
      return `
        <div class="parcel-item" data-bulletin-id="${escapeHtml(String(x.id || ""))}" style="cursor:default;">
          <div style="display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:6px;">
                <span style="display:inline-block; padding:3px 10px; border-radius:9999px; font-size:12px; font-weight:600; background:${badge.bg}; color:${badge.text};">${STATUS_LABEL[st] || st}</span>
                <span class="tag ${st === "done" ? "green" : (st === "processing" ? "yellow" : "red")}">${CATEGORY_LABEL[x.category] || x.category || "其他"}</span>
                <h3 style="font-size:15px; margin:0; font-weight:600; min-width:0; flex:1; min-width:0;">${escapeHtml(String(x.title || ""))}</h3>
              </div>
              <div class="muted" style="font-size:13px;">位置：${escapeHtml(String(x.location || "—"))}｜申請人：${escapeHtml(String(x.applicantName || x.houseNo || "—"))}</div>
              <div class="muted" style="font-size:13px; margin-top:4px;">申請時間：${formatDate(x.createdAt) || "—"}</div>
              <div style="margin-top:8px; font-size:14px; line-height:1.5; color:#374151; white-space:pre-wrap;">${escapeHtml(String(x.description || ""))}</div>

              ${hasSubmitImages ? `
                <div style="margin-top:10px;">
                  <div class="muted" style="font-size:12px; margin-bottom:6px;">申請附圖</div>
                  <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    ${x.images.slice(0, 6).map((img) => `
                      <img src="${escapeHtml(img)}" alt="申請圖" data-clean-open-images='${JSON.stringify(x.images).replace(/'/g, "&#039;")}' data-clean-title="申請附圖" style="width:84px; height:84px; object-fit:cover; border-radius:10px; cursor:pointer;">
                    `).join("")}
                  </div>
                </div>
              ` : ""}

              ${st === "processing" ? `
                <div style="margin-top:12px; padding:10px 12px; background:#fefce8; border-radius:10px; font-size:13px;">
                  <div style="font-weight:600; margin-bottom:4px;">處理中${x.handlerName ? `｜派員：${escapeHtml(String(x.handlerName))}` : ""}</div>
                  <div class="muted">接單時間：${formatDate(x.acceptedAt) || "—"}${x.processNote ? `｜${escapeHtml(String(x.processNote))}` : ""}</div>
                </div>
              ` : ""}

              ${st === "done" ? `
                <div style="margin-top:12px; padding:10px 12px; background:#f0fdf4; border-radius:10px; font-size:13px;">
                  <div style="font-weight:600; margin-bottom:4px;">處理完成${x.doneBy ? `｜人員：${escapeHtml(String(x.doneBy))}` : ""}</div>
                  <div class="muted" style="margin-bottom:6px;">完成時間：${formatDate(x.doneAt) || "—"}</div>
                  ${x.doneRemark ? `<div style="white-space:pre-wrap; line-height:1.5; color:#1f2937;">${escapeHtml(String(x.doneRemark))}</div>` : ""}
                  ${hasDoneImages ? `
                    <div style="margin-top:8px;">
                      <div class="muted" style="font-size:12px; margin-bottom:6px;">完成相片</div>
                      <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        ${x.doneImages.slice(0, 6).map((img) => `
                          <img src="${escapeHtml(img)}" alt="完成圖" data-clean-open-images='${JSON.stringify(x.doneImages).replace(/'/g, "&#039;")}' data-clean-title="完成相片" style="width:84px; height:84px; object-fit:cover; border-radius:10px; cursor:pointer;">
                        `).join("")}
                      </div>
                    </div>
                  ` : ""}
                </div>
              ` : ""}
            </div>
          </div>
        </div>
      `;
    }).join("");

    bulletinList.querySelectorAll('[data-clean-open-images]').forEach((img) => {
      img.addEventListener('click', () => {
        try {
          const arr = JSON.parse(img.getAttribute('data-clean-open-images') || '[]');
          const title = img.getAttribute('data-clean-title') || '圖片';
          openImageModal(arr, title);
        } catch {}
      });
    });
  }

  function setupCleanListener(communityId) {
    if (unsubscribeListener) {
      try { unsubscribeListener(); } catch {}
    }
    if (!communityId) {
      if (bulletinList) bulletinList.innerHTML = '<div class="status">尚未選擇社區</div>';
      return;
    }
    unsubscribeListener = db
      .collection('communities')
      .doc(communityId)
      .collection('bulletins')
      .where('type', '==', BULLETIN_TYPE)
      .onSnapshot(
        (snap) => {
          const data = [];
          snap.forEach((doc) => data.push({ id: doc.id, ...doc.data() }));
          renderCleanList(data);
        },
        (err) => {
          console.error("[Clean] Snapshot error:", err);
          if (bulletinList) bulletinList.innerHTML = `<div class="status">讀取失敗：${err.message}</div>`;
        }
      );
  }

  function setupModalBasics() {
    const closeImageModalBtn = document.getElementById('btnCloseImageModal');
    if (closeImageModalBtn) closeImageModalBtn.addEventListener('click', closeImageModal);
    const imageModalBackdrop = document.querySelector('#imageModal .modal-backdrop');
    if (imageModalBackdrop) imageModalBackdrop.addEventListener('click', closeImageModal);
  }

  function init() {
    ensureEmbedLayout();
    bindHostMessaging();
    setupTabs();
    setupModalBasics();
    setupSubmitForm();
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        await loadProfile(user);
        const communityId = getActiveCommunityId();
        setupCleanListener(communityId);
      } else {
        if (bulletinList) bulletinList.innerHTML = '<div class="status">未登入</div>';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
