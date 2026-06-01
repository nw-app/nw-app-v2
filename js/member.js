(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
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

  const STORAGE_CONFIG = "csp_config_v1";
  const STORAGE_ACCOUNTS = "csp_accounts_v1";
  const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";

  const defaultRowDButtons = [
    { name: "AI對話", icon: "photo/b01.png", url: "#" },
    { name: "郵件包裹", icon: "photo/b02.png", url: "#" },
    { name: "監視系統", icon: "photo/b03.png", url: "#" },
    { name: "財務報表", icon: "photo/b04.png", url: "#" },
    { name: "社區園地", icon: "photo/b05.png", url: "#" },
    { name: "區大直播", icon: "photo/b06.png", url: "#" },
    { name: "設施預約", icon: "photo/b07.png", url: "#" },
    { name: "會議記錄", icon: "photo/b08.png", url: "#" },
  ];

  const defaultRowFButtons = [
    { name: "福利通", icon: "photo/b09.png", url: "#" },
    { name: "銀髮族", icon: "photo/b10.png", url: "#" },
    { name: "美食街", icon: "photo/b11.png", url: "#" },
    { name: "購物樂", icon: "photo/b12.png", url: "#" },
    { name: "聽音樂", icon: "photo/b13.png", url: "#" },
    { name: "影視台", icon: "photo/b14.png", url: "#" },
    { name: "電子書", icon: "photo/b15.png", url: "#" },
    { name: "遊戲網", icon: "photo/b16.png", url: "#" },
  ];

  const state = {
    communities: [],
    config: null,
  };
  const catalogResidentButtons = [
    { id: "resident-service", name: "客服", defaultUrl: "#resident/resident-service", hint: "", icon: "headset" },
  ];

  const navEl = document.getElementById("nav");
  const contentEl = document.getElementById("content");
  const pageTitleEl = document.getElementById("pageTitle");
  const pageSubtitleEl = document.getElementById("pageSubtitle");

  function defaultConfig() {
    const toButton = (x) => ({ enabled: true, url: x.defaultUrl });
    return { 
      residentButtons: Object.fromEntries(catalogResidentButtons.map((x) => [x.id, toButton(x)])),
      rowAImages: [],
      rowAInterval: 5,
      rowDButtons: defaultRowDButtons.map(b => ({ ...b })),
      rowFButtons: defaultRowFButtons.map(b => ({ ...b })),
      serviceUrl: ""
    };
  }

  function loadAccounts() {
    return { communities: state.communities, residents: [] };
  }

  function readUrlCommunityKey() {
    try {
      const params = new URLSearchParams(location.search);
      return String(params.get("c") || "").trim();
    } catch {
      return "";
    }
  }

  function setHeaderCommunityText(text) {
    const subEl = document.getElementById("communityNameSub");
    if (!subEl) return;
    const t = String(text || "").trim();
    subEl.textContent = t && t !== "default" ? t : "";
  }

  async function ensureUrlCommunityKey(user) {
    const existing = readUrlCommunityKey();
    if (existing) return existing;

    try {
      const fromSession = String(sessionStorage.getItem("csp_last_cid") || "").trim();
      if (fromSession) {
        const u = new URL(location.href);
        u.searchParams.set("c", fromSession);
        history.replaceState(null, "", u.toString());
        return fromSession;
      }
    } catch {}

    if (!user) return "";
    try {
      const udoc = await db.collection("users").doc(String(user.uid)).get();
      const udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
      const cid = String(udata.community || "").trim();
      if (!cid || cid === "default") return "";
      const cdoc = await db.collection("communities").doc(cid).get();
      const cdata = cdoc && cdoc.exists ? (cdoc.data() || {}) : {};
      const code = String(cdata.username || "").trim();
      const key = code || cid;
      if (!key) return "";
      try { sessionStorage.setItem("csp_last_cid", key); } catch {}
      const u = new URL(location.href);
      u.searchParams.set("c", key);
      history.replaceState(null, "", u.toString());
      return key;
    } catch {
      return "";
    }
  }

  function resolveActiveCommunityId() {
    const accounts = loadAccounts();
    const list = accounts.communities || [];
    
    try {
      const urlCidRaw = readUrlCommunityKey();
      const urlCid = urlCidRaw.toLowerCase();
      if (urlCid) {
        const found = list.find((x) => x && (String(x.id || "").trim().toLowerCase() === urlCid || String(x.username || "").trim().toLowerCase() === urlCid));
        if (found && found.id) {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, found.id);
          return found.id;
        }
      }
    } catch {}

    const saved = localStorage.getItem(STORAGE_ACTIVE_COMMUNITY);
    const first = list.find((x) => x && x.enabled)?.id || list[0]?.id || "";
    if (saved && list.some((x) => x && x.id === saved)) return saved;
    if (first) {
      localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, first);
      return first;
    }
    return "default";
  }

  function configDocRef(communityId) {
    return db.collection("communities").doc(String(communityId || "default")).collection("settings").doc("app_config");
  }

  function loadConfig() {
    try {
      const parsed = state.config && typeof state.config === "object" ? state.config : {};
      const d = defaultConfig();
      
      const mergeButtons = (saved, defaults) => {
        const result = defaults.map(b => ({ ...b }));
        if (Array.isArray(saved)) {
          saved.forEach((b, i) => {
            if (i < result.length && b) {
              if (b.name) result[i].name = b.name;
              if (b.url) result[i].url = b.url;
              if (b.data) result[i].data = b.data;
              if (b.icon) result[i].icon = b.icon;
              result[i].openExternal = b.openExternal || false;
            }
          });
        }
        return result;
      };

      const rowAImages = (() => {
        const defaults = [
          { url: "photo/b01.png", data: "" },
          { url: "photo/b02.png", data: "" }
        ];
        if (!Array.isArray(parsed.rowAImages)) return defaults;
        const configured = parsed.rowAImages.filter(img => img && (img.url || img.data));
        return configured.length > 0 ? configured : defaults;
      })();

      return { 
        residentButtons: { ...d.residentButtons, ...(parsed.residentButtons || {}) },
        rowAImages: rowAImages,
        rowAInterval: parsed.rowAInterval || 5,
        rowDButtons: mergeButtons(parsed.rowDButtons, defaultRowDButtons),
        rowFButtons: mergeButtons(parsed.rowFButtons, defaultRowFButtons),
        serviceUrl: parsed.serviceUrl || ""
      };
    } catch {
      return defaultConfig();
    }
  }

  function refreshLoginInfo(user) {
    const accounts = loadAccounts();
    const cid = resolveActiveCommunityId();
    const c = accounts.communities.find((x) => x && x.id === cid) || null;
    const urlC = readUrlCommunityKey();
    const cname = c ? String(c.name || "").trim() : "";
    const el = document.getElementById("loginInfo");
    if (el) el.textContent = `已登入：${user.email || "（未知）"}｜${cname || urlC || cid}`;
    setHeaderCommunityText(cname);
  }

  function ensureConfigSubscription() {
    const cid = resolveActiveCommunityId();
    if (state._configUnsub) state._configUnsub();
    state._configUnsub = configDocRef(cid).onSnapshot((doc) => {
      state.config = doc && doc.exists ? (doc.data() || null) : null;
      render();
    }, () => {
      state.config = null;
      render();
    });
  }

  function ensureCommunitiesSubscription(user) {
    db.collection("communities").get().then((snap) => {
      state.communities = snap.docs.map((d) => {
        const v = d.data() || {};
        return { id: String(v.id || d.id), name: String(v.name || ""), username: String(v.username || ""), enabled: v.enabled !== false };
      });
      refreshLoginInfo(user);
      ensureConfigSubscription();
      render();
    }).catch(() => {
      state.communities = [];
      refreshLoginInfo(user);
      ensureConfigSubscription();
      render();
    });
  }

  function parseRoute() {
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    if (!raw) return { moduleId: "home" };
    const parts = raw.split("/");
    const role = parts[0] || "resident";
    if (role !== "resident") return { moduleId: "home" };
    return { moduleId: parts[1] || "home" };
  }

  function buildNav() {
    const cfg = loadConfig();
    const items = [{ id: "home", name: "首頁", hint: "Home", icon: "home", enabled: true, url: "#resident/home" }]
      .concat(catalogResidentButtons.map((x) => ({ ...x, ...cfg.residentButtons[x.id] })));
    navEl.innerHTML = items
      .filter((x) => x.enabled)
      .map((m) => `
            <a href="${m.url || "#resident/home"}" data-id="${m.id}" aria-current="false">
              <span aria-hidden="true">${icon(m.icon || "dot")}</span>
              <span class="label">${m.name}</span>
              <span class="hint">${m.hint || ""}</span>
            </a>
          `)
      .join("");
    navEl.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const moduleId = a.getAttribute("data-id");
        if (moduleId === "resident-service") {
          const cfg = loadConfig();
          openPageModal(cfg.serviceUrl || "", "客服中心");
          return;
        }
        location.hash = a.getAttribute("href");
      });
    });
  }

  function icon(kind) {
    if (kind === "home") {
      return `
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 10.5 12 4l8 6.5V20a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 20v-9.5Z" stroke="currentColor" stroke-width="1.7" />
              <path d="M9 21v-7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7" stroke="currentColor" stroke-width="1.7" />
            </svg>
          `;
    }
    if (kind === "bell") {
      return `
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            </svg>
          `;
    }
    if (kind === "headset") {
      return `
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 14V11a8 8 0 1 1 16 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M18 14h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M4 14h2a2 2 0 0 0 2 2v2a2 2 0 0 0-2 2H4a2 2 0 0 0-2-2v-2a2 2 0 0 0 2-2z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M20 18v2a2 2 0 0 1-2 2h-2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          `;
    }
    return `
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 21.5c5.247 0 9.5-4.253 9.5-9.5S17.247 2.5 12 2.5 2.5 6.753 2.5 12 6.753 21.5 12 21.5Z" stroke="currentColor" stroke-width="1.7" opacity="0.9"/>
            <path d="M12 8.2h.01" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
            <path d="M12 16v-5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        `;
  }

  function setActive(moduleId) {
    navEl.querySelectorAll("a").forEach((a) => a.setAttribute("aria-current", a.dataset.id === moduleId ? "page" : "false"));

    if (moduleId === "resident-service") {
      pageTitleEl.textContent = "客服中心";
      pageSubtitleEl.textContent = "聯繫社區管理處或系統客服（開發中）";
      contentEl.innerHTML = "";
      return;
    }
    pageTitleEl.textContent = "";
    pageSubtitleEl.textContent = "";
    contentEl.innerHTML = homeView();
    if (moduleId === "home") {
      renderRowACarousel();
      
      // 綁定九宮格按鈕點擊事件
      contentEl.querySelectorAll(".grid-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const url = btn.getAttribute("data-url");
          const name = btn.getAttribute("data-name");
          const isExternal = btn.getAttribute("data-external") === "1";
          
          if (url && url !== "#" && !url.startsWith("#")) {
            e.preventDefault();
            if (isExternal) {
              window.open(url, "_blank");
            } else {
              openPageModal(url, name);
            }
          }
        });
      });
    }
  }

  function openPageModal(url, name) {
    const modal = document.getElementById("externalPageModal");
    const iframe = document.getElementById("externalPageIframe");
    const title = document.getElementById("externalPageModalTitle");
    const openNewBtn = document.getElementById("btnExternalPageOpenNew");
    const errorContainer = document.getElementById("externalPageError");
    const errorOpenBtn = document.getElementById("btnExternalPageErrorOpen");
    const communityNameEl = document.getElementById("externalPageModalCommunityName");

    if (!modal || !iframe || !title) return;

    // 更新標題與按鈕網址
    title.textContent = name || "頁面";
    if (openNewBtn) openNewBtn.href = url;
    if (errorOpenBtn) errorOpenBtn.href = url;

    // 獲取並顯示社區名稱
    const accounts = loadAccounts();
    const cid = resolveActiveCommunityId();
    const c = accounts.communities.find((x) => x && x.id === cid) || null;
    const urlC = readUrlCommunityKey();
    const cname = c ? String(c.name || "").trim() : "";
    const displayCommunityName = cname || urlC || cid || "";
    if (communityNameEl) {
      communityNameEl.textContent = displayCommunityName;
    }

    // 先確保錯誤區塊被完全隱藏
    if (errorContainer) {
      errorContainer.hidden = true;
      errorContainer.style.display = "none";
    }

    // 檢查是否為本地頁面（.html 結尾或本地路徑）
    const isLocalPage = url.endsWith('.html') || !url.startsWith('http');
    
    // 檢查是否為已知無法嵌入的外部網站
    const blockedDomains = ["google.com", "gemini.google.com", "facebook.com", "youtube.com", "line.me"];
    const isBlocked = !isLocalPage && blockedDomains.some(domain => url.toLowerCase().includes(domain));

    if (isBlocked) {
      iframe.hidden = true;
      iframe.style.display = "none";
      iframe.src = "";
      if (errorContainer) {
        errorContainer.hidden = false;
        errorContainer.style.display = "block";
      }
    } else {
      iframe.hidden = false;
      iframe.style.display = "block";
      iframe.src = url;
    }

    modal.hidden = false;
  }

  function homeView() {
    const cfg = loadConfig();
    const renderButtonGrid = (buttons) => {
      if (!buttons || buttons.length === 0) return "";
      return `
        <div class="button-grid">
          ${buttons.map(b => {
            const isRemoteIcon = b.icon && (b.icon.startsWith("http") || b.icon.startsWith("//"));
            const imgSrc = isRemoteIcon ? b.icon : (b.data || b.icon || "photo/logo.png");
            const isExternal = b.openExternal ? "1" : "";
            return `
              <a href="${b.url || "#"}" class="grid-btn" data-url="${b.url || ""}" data-name="${b.name || ""}" data-external="${isExternal}">
                <div class="grid-btn-icon">
                  <img src="${imgSrc}" alt="${b.name}" />
                </div>
                <div class="grid-btn-label">${b.name}</div>
              </a>
            `;
          }).join("")}
        </div>
      `;
    };

    return `
      <div class="home-grid">
        <section class="row-a" id="rowACarousel">
          <div class="carousel-container">
            <div class="carousel-track" id="carouselTrack"></div>
            <div class="carousel-dots" id="carouselDots"></div>
          </div>
        </section>
        <section class="row-b">
          <button class="btn-sos" type="button" onclick="alert('SOS 呼叫已發出')">SOS</button>
        </section>
        <section class="row-c">社區服務</section>
        <section class="row-d">
          ${renderButtonGrid(cfg.rowDButtons)}
        </section>
        <section class="row-e">生活服務</section>
        <section class="row-f">
          ${renderButtonGrid(cfg.rowFButtons)}
        </section>
      </div>
    `;
  }

  function renderRowACarousel() {
    const cfg = loadConfig();
    const images = (cfg.rowAImages || []).filter(img => img.url || img.data);
    const track = document.getElementById("carouselTrack");
    const dotsContainer = document.getElementById("carouselDots");
    if (!track || images.length === 0) return;

    track.innerHTML = images.map(img => `
      <div class="carousel-slide">
        <img src="${img.url || img.data}" alt="" />
      </div>
    `).join("");

    dotsContainer.innerHTML = images.map((_, i) => `
      <div class="carousel-dot ${i === 0 ? "active" : ""}" data-index="${i}"></div>
    `).join("");

    let currentIndex = 0;
    const total = images.length;
    const intervalTime = (cfg.rowAInterval || 5) * 1000;
    let timer = null;

    const update = () => {
      track.style.transform = `translateX(-${currentIndex * 100}%)`;
      dotsContainer.querySelectorAll(".carousel-dot").forEach((dot, i) => {
        dot.classList.toggle("active", i === currentIndex);
      });
    };

    const next = () => {
      currentIndex = (currentIndex + 1) % total;
      update();
    };

    const startTimer = () => {
      if (timer) clearInterval(timer);
      if (total > 1) {
        timer = setInterval(next, intervalTime);
      }
    };

    // Touch support
    let startX = 0;
    let isDragging = false;
    const container = document.querySelector(".carousel-container");

    container.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
      isDragging = true;
      clearInterval(timer);
    });

    container.addEventListener("touchmove", (e) => {
      if (!isDragging) return;
      const x = e.touches[0].clientX;
      const diff = startX - x;
      if (Math.abs(diff) > 5) {
        e.preventDefault();
      }
    }, { passive: false });

    container.addEventListener("touchend", (e) => {
      if (!isDragging) return;
      const endX = e.changedTouches[0].clientX;
      const diff = startX - endX;
      if (diff > 50) {
        currentIndex = (currentIndex + 1) % total;
      } else if (diff < -50) {
        currentIndex = (currentIndex - 1 + total) % total;
      }
      update();
      isDragging = false;
      startTimer();
    });

    // Click dots
    dotsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("carousel-dot")) {
        currentIndex = parseInt(e.target.dataset.index);
        update();
        startTimer();
      }
    });

    startTimer();
  }

  function render() {
    const route = parseRoute();
    buildNav();
    setActive(route.moduleId);
  }

  const btnGoCommunity = document.getElementById("btnGoCommunity");
  if (btnGoCommunity) {
    btnGoCommunity.addEventListener("click", () => {
      location.href = "admin.html#community/community-dashboard";
    });
  }

  // Notification Modal Logic
  const btnNotification = document.getElementById("btnNotification");
  const notificationModal = document.getElementById("notificationModal");
  const btnCloseNotificationModal = document.getElementById("btnCloseNotificationModal");
  const btnNotificationModalBackdrop = document.getElementById("btnNotificationModalBackdrop");

  if (btnNotification && notificationModal) {
    btnNotification.addEventListener("click", () => {
      notificationModal.hidden = false;
    });
  }

  const closeNotificationModal = () => {
    if (notificationModal) notificationModal.hidden = true;
  };

  if (btnCloseNotificationModal) {
    btnCloseNotificationModal.addEventListener("click", closeNotificationModal);
  }
  if (btnNotificationModalBackdrop) {
    btnNotificationModalBackdrop.addEventListener("click", closeNotificationModal);
  }

  // External Page Modal Logic
  const externalPageModal = document.getElementById("externalPageModal");
  const btnCloseExternalPageModal = document.getElementById("btnCloseExternalPageModal");
  const btnExternalPageModalBackdrop = document.getElementById("btnExternalPageModalBackdrop");
  const externalPageIframe = document.getElementById("externalPageIframe");

  const closeExternalPageModal = () => {
    if (externalPageModal) externalPageModal.hidden = true;
    if (externalPageIframe) externalPageIframe.src = "";
  };

  if (btnCloseExternalPageModal) {
    btnCloseExternalPageModal.addEventListener("click", closeExternalPageModal);
  }
  if (btnExternalPageModalBackdrop) {
    btnExternalPageModalBackdrop.addEventListener("click", closeExternalPageModal);
  }

  const bindSignOut = () => {
    const btn = document.getElementById("btnSignOut");
    if (!btn || btn._boundSignOut) return;
    btn._boundSignOut = true;
    btn.addEventListener("click", async () => {
      try {
        sessionStorage.removeItem("csp_role");
        sessionStorage.removeItem("csp_sysadmin");
        await auth.signOut();
      } catch {}
      location.href = "index.html";
    });
  };
  bindSignOut();
  document.addEventListener("DOMContentLoaded", bindSignOut);

  auth.onAuthStateChanged(async (user) => {
    const redirectToIndex = () => {
      if (window.__nw_redirecting) return;
      window.__nw_redirecting = true;
      location.replace("index.html");
    };

    if (!user) {
      redirectToIndex();
      return;
    }

    let role = String(sessionStorage.getItem("csp_role") || "").trim().toLowerCase();
    if (!role) {
      try {
        const udoc = await db.collection("users").doc(String(user.uid)).get();
        const udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
        const r = String(udata.role || "").trim();
        if (r === "admin" || r === "系統管理員" || r === "系統管理者" || r === "系統") role = "admin";
        else if (r === "community" || r === "社區") role = "community";
        else if (r) role = "resident";
        if (role) sessionStorage.setItem("csp_role", role);
      } catch {}
    }

    if (role && role !== "resident" && role !== "admin") {
      if (role === "community") {
        const key = readUrlCommunityKey();
        const cPart = key ? `?c=${encodeURIComponent(key)}` : "";
        if (!window.__nw_redirecting) {
          window.__nw_redirecting = true;
          location.replace(`admin.html${cPart}#community/community-dashboard`);
        }
        return;
      }
      redirectToIndex();
      return;
    }

    refreshLoginInfo(user);
    ensureUrlCommunityKey(user).then(() => refreshLoginInfo(user)).catch(() => {});
    const fallback = document.getElementById("userAvatarFallback");
    if (fallback) fallback.textContent = String(user.email || "U").trim().slice(0, 1).toUpperCase() || "U";
    ensureCommunitiesSubscription(user);
    render();
  });

  window.addEventListener("hashchange", () => render());
})();
