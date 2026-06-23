(() => {
  // 日期和時間更新功能
  function updateDateTime() {
    const now = new Date();
    
    // 更新時間
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeDisplay = document.getElementById('timeDisplay');
    if (timeDisplay) {
      timeDisplay.textContent = `${hours}:${minutes}:${seconds}`;
    }
    
    // 更新日期
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdays[now.getDay()];
    const dateDisplay = document.getElementById('dateDisplay');
    if (dateDisplay) {
      dateDisplay.textContent = `${year}年${month}月${day}日 星期${weekday}`;
    }
  }
  
  // 天氣圖標映射
  function getWeatherIcon(condition) {
    const iconMap = {
      '晴': '☀️',
      '多雲': '⛅',
      '陰': '☁️',
      '雨': '🌧️',
      '雷陣雨': '⛈️',
      '雪': '❄️',
      '霧': '🌫️'
    };
    for (let key in iconMap) {
      if (condition && condition.includes(key)) {
        return iconMap[key];
      }
    }
    return '🌤️';
  }
  
  // 獲取地理位置
  function getLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          fetchWeather(lat, lon);
          reverseGeocode(lat, lon);
        },
        (error) => {
          console.log('定位失敗，使用預設位置');
          // 使用台北作為預設位置
          fetchWeather(25.0330, 121.5654);
          const locationDisplay = document.getElementById('locationDisplay');
          if (locationDisplay) {
            locationDisplay.textContent = '台北市';
          }
        }
      );
    } else {
      console.log('瀏覽器不支持地理定位');
      fetchWeather(25.0330, 121.5654);
      const locationDisplay = document.getElementById('locationDisplay');
      if (locationDisplay) {
        locationDisplay.textContent = '台北市';
      }
    }
  }
  
  // 反向地理編碼（將座標轉換為地址）
  async function reverseGeocode(lat, lon) {
    try {
      // 使用 OpenStreetMap 的 Nominatim API
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&accept-language=zh-TW`
      );
      const data = await response.json();
      const locationDisplay = document.getElementById('locationDisplay');
      if (locationDisplay && data.address) {
        const city = data.address.city || data.address.town || data.address.county || '';
        const district = data.address.district || '';
        locationDisplay.textContent = city + (district ? ' ' + district : '');
      }
    } catch (error) {
      console.log('反向地理編碼失敗');
    }
  }
  
  // 獲取天氣資訊（使用 Open-Meteo 免費天氣 API）
  async function fetchWeather(lat, lon) {
    try {
      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto&forecast_days=1`
      );
      const data = await response.json();
      
      if (data.current) {
        const temperature = Math.round(data.current.temperature_2m);
        const weatherCode = data.current.weather_code;
        
        // 天氣代碼解釋
        const weatherDesc = interpretWeatherCode(weatherCode);
        const weatherIcon = getWeatherIcon(weatherDesc);
        
        // 更新天氣顯示
        const temperatureEl = document.getElementById('temperature');
        const weatherIconEl = document.getElementById('weatherIcon');
        const weatherDescEl = document.getElementById('weatherDesc');
        
        if (temperatureEl) {
          temperatureEl.textContent = `${temperature}°C`;
        }
        if (weatherIconEl) {
          weatherIconEl.textContent = weatherIcon;
        }
        if (weatherDescEl) {
          weatherDescEl.textContent = weatherDesc;
        }
      }
    } catch (error) {
      console.log('獲取天氣失敗:', error);
      const weatherDescEl = document.getElementById('weatherDesc');
      if (weatherDescEl) {
        weatherDescEl.textContent = '天氣資訊暫時無法取得';
      }
    }
  }
  
  // 解釋天氣代碼（來自 Open-Meteo）
  function interpretWeatherCode(code) {
    const codeMap = {
      0: '晴',
      1: '晴時多雲',
      2: '多雲',
      3: '陰',
      45: '霧',
      48: '霧',
      51: '小雨',
      53: '雨',
      55: '大雨',
      56: '凍雨',
      57: '凍雨',
      61: '小雨',
      63: '雨',
      65: '大雨',
      66: '凍雨',
      67: '凍雨',
      71: '小雪',
      73: '雪',
      75: '大雪',
      77: '雪粒',
      80: '陣雨',
      81: '陣雨',
      82: '暴雨',
      85: '陣雪',
      86: '陣雪',
      95: '雷陣雨',
      96: '雷陣雨伴冰雹',
      99: '雷陣雨伴冰雹'
    };
    return codeMap[code] || '多雲';
  }
  
  // 初始化日期時間和天氣
  function initDateTimeWeather() {
    updateDateTime();
    setInterval(updateDateTime, 1000); // 每秒更新時間
    getLocation();
    // 每30分鐘更新一次天氣
    setInterval(getLocation, 30 * 60 * 1000);
  }

  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  const auth = firebase.auth();
  const db = firebase.firestore();
  const FieldValue = firebase.firestore.FieldValue;
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
    { name: "福利通", icon: "photo/b09.png", url: "https://info.talk.tw/", openExternal: true },
    { name: "銀髮族", icon: "photo/b10.png", url: "https://www.hpa.gov.tw/Pages/List.aspx?nodeid=39", openExternal: true },
    { name: "美食街", icon: "photo/b11.png", url: "https://www.dachu.co/node/dishes", openExternal: false },
    { name: "購物樂", icon: "photo/b12.png", url: "https://www.gomaji.com/?city=1", openExternal: true },
    { name: "聽音樂", icon: "photo/b13.png", url: "https://tradio.gov.taipei/", openExternal: true },
    { name: "影視台", icon: "photo/b14.png", url: "https://m.4gtv.tv/", openExternal: false },
    { name: "電子書", icon: "photo/b15.png", url: "https://www.pubu.com.tw/", openExternal: true },
    { name: "遊戲網", icon: "photo/b16.png", url: "https://www.pubu.com.tw/", openExternal: false },
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
      serviceUrl: "",
      sosActionMode: "backend",
      sosPhoneNumber: ""
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
        try { localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, fromSession); } catch {}
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
      try { localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid); } catch {}
      try { sessionStorage.setItem("csp_last_cid", cid); } catch {}
      const u = new URL(location.href);
      u.searchParams.set("c", cid);
      history.replaceState(null, "", u.toString());
      return cid;
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
    if (saved && (!list.length || list.some((x) => x && x.id === saved))) return saved;
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
        serviceUrl: parsed.serviceUrl || "",
        sosActionMode: String(parsed.sosActionMode || d.sosActionMode || "backend").trim() || "backend",
        sosPhoneNumber: String(parsed.sosPhoneNumber || d.sosPhoneNumber || "").trim()
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
    }
  }

  // 使用事件委托处理按钮点击
  // 在 document 级别监听，确保所有按钮都能被处理
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("a.grid-btn");
    if (!btn) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const url = btn.getAttribute("data-url") || btn.getAttribute("href");
    const name = btn.getAttribute("data-name");
    const isExternal = btn.getAttribute("data-external") === "1";
    
    if (!url || url === "#") return;
    
    // 处理外部链接
    if (isExternal) {
      window.open(url, "_blank");
    } 
    // 处理本地 html 文件
    else if (url && url !== "#" && !url.startsWith("#")) {
      openPageModal(url, name);
    }
  });

  // SOS 按钮事件委托
  document.addEventListener("click", (e) => {
    const sosBtn = e.target.closest(".btn-sos");
    if (!sosBtn) return;
    
    e.preventDefault();
    e.stopPropagation();
    sendSOS();
  });

  function openPageModal(url, name) {
    const modal = document.getElementById("externalPageModal");
    const iframe = document.getElementById("externalPageIframe");
    const title = document.getElementById("externalPageModalTitle");
    const errorContainer = document.getElementById("externalPageError");
    const errorOpenBtn = document.getElementById("btnExternalPageErrorOpen");
    const communityNameEl = document.getElementById("externalPageModalCommunityName");

    if (!modal || !iframe || !title) return;

    const normalizeModalUrl = (raw) => {
      const input = String(raw || "").trim();
      if (!input) return { url: "", parsed: null };
      try {
        const parsed = new URL(input, location.href);
        const host = String(parsed.hostname || "").toLowerCase();
        const isLocalDevHost = host === "localhost" || host === "127.0.0.1";
        if (isLocalDevHost) {
          const cur = new URL(location.href);
          parsed.protocol = cur.protocol;
          parsed.host = cur.host;
          const baseDir = String(cur.pathname || "/").replace(/\/[^\/]*$/, "/");
          const p = String(parsed.pathname || "/");
          if (baseDir && baseDir !== "/" && p.startsWith("/") && !p.startsWith(baseDir)) {
            parsed.pathname = `${baseDir}${p.replace(/^\//, "")}`;
          }
        }
        return { url: parsed.toString(), parsed };
      } catch {
        return { url: input, parsed: null };
      }
    };

    const resolved = normalizeModalUrl(url);
    let resolvedUrl = resolved.url;
    if (resolved.parsed) {
      const sameOrigin = String(resolved.parsed.origin || "") === String(location.origin || "");
      const pathname = String(resolved.parsed.pathname || "");
      const isLocalHtml = sameOrigin && pathname.toLowerCase().endsWith(".html");
      if (isLocalHtml) {
        const activeCid = String(localStorage.getItem("csp_active_community_v1") || "").trim();
        const cKey = String(activeCid || readUrlCommunityKey() || "").trim();
        if (cKey && cKey !== "default") resolved.parsed.searchParams.set("c", cKey);
        resolved.parsed.searchParams.set("embed", "1");
        resolved.parsed.searchParams.set("v", "16");
        resolvedUrl = resolved.parsed.toString();
      }
    }

    // 更新標題與按鈕網址
    title.textContent = name || "頁面";
    if (errorOpenBtn) errorOpenBtn.href = resolvedUrl || url;

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
    const sameOrigin = Boolean(resolved.parsed && resolved.parsed.origin === location.origin);
    const pathname = resolved.parsed ? String(resolved.parsed.pathname || "") : "";
    const isLocalPage = sameOrigin && pathname.toLowerCase().endsWith(".html");
    
    // 檢查是否為已知無法嵌入的外部網站
    const blockedDomains = ["google.com", "gemini.google.com", "facebook.com", "youtube.com", "line.me"];
    const host = resolved.parsed ? String(resolved.parsed.hostname || "").toLowerCase() : "";
    const isBlocked = !isLocalPage && blockedDomains.some(domain => host === domain || host.endsWith(`.${domain}`));

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
      iframe.src = resolvedUrl || url;
    }

    modal.hidden = false;
  }

  async function sendSOS() {
    const user = auth.currentUser;
    if (!user) {
      alert("請先登入再送出 SOS");
      return;
    }

    const cfg = loadConfig();
    const sosActionMode = String(cfg.sosActionMode || "backend").trim();
    const sosPhoneNumber = String(cfg.sosPhoneNumber || "").trim();
    if (sosActionMode === "phone" && !sosPhoneNumber) {
      alert("尚未設定撥打電話號碼");
      return;
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const datetimeText = `${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}`;
    const createdAtMs = Date.now();

    let udata = {};
    try {
      const udoc = await db.collection("users").doc(String(user.uid)).get();
      udata = udoc && udoc.exists ? (udoc.data() || {}) : {};
    } catch {}

    const community = String(udata.community || resolveActiveCommunityId() || "").trim() || "default";
    const houseNo = String(udata.houseNo || udata.unit || "").trim() || "—";
    const subHouseNo = String(udata.subHouseNo || udata.subUnit || "").trim();
    const displayName = String(udata.displayName || udata.name || "").trim();
    const fallbackName = String(user.email || "").split("@")[0] || "住戶";
    const name = displayName || fallbackName;

    const payload = {
      community,
      houseNo,
      subHouseNo,
      name,
      status: "待處理",
      record: "",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs,
      createdBy: String(user.uid),
      createdByEmail: String(user.email || ""),
      datetimeText,
      actionMode: sosActionMode,
      phoneNumber: sosPhoneNumber,
    };

    try {
      await db.collection("sos_alerts").add(payload);
      alert(sosActionMode === "phone" ? "SOS 已送出，後台將直接撥號" : "SOS 通報已送出");
    } catch (e) {
      alert("SOS 通報送出失敗，請稍後再試");
    }
  }
  
  function homeView() {
    const cfg = loadConfig();
    const renderButtonGrid = (buttons) => {
      if (!buttons || buttons.length === 0) return "";
      return `
        <div class="button-grid">
          ${buttons.map(b => {
            const isRemoteIcon = b.icon && (b.icon.startsWith("http") || b.icon.startsWith("//"));
            const imgSrc = isRemoteIcon ? b.icon : (b.data || b.icon || "photo/logo.png?v=2");
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
          <button class="btn-sos" type="button" id="btnSOS">SOS</button>
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

  // 頁面載入時初始化日期時間和天氣
  document.addEventListener('DOMContentLoaded', initDateTimeWeather);
  
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
  
  // 暴露 SOS 功能到全局
  window.sendSOS = sendSOS;
})();
