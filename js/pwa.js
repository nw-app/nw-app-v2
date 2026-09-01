(() => {
  const DISMISS_KEY = "nw_pwa_install_dismissed_v1";
  const DISMISS_DAYS = 30;
  const shouldSuppressFirestoreAbort = (err) => {
    const msg = String((err && (err.message || err.reason?.message)) || err || "");
    if (!(msg.includes("net::ERR_ABORTED") || msg.includes("net::ERR_CONNECTION_RESET"))) return false;
    return (
      msg.includes("google.firestore.v1.Firestore/Listen/channel") ||
      msg.includes("firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel")
    );
  };

  window.addEventListener("unhandledrejection", (e) => {
    if (shouldSuppressFirestoreAbort(e && e.reason)) e.preventDefault();
  });

  window.addEventListener("error", (e) => {
    const msg = String((e && (e.error || e.message)) || "");
    if (shouldSuppressFirestoreAbort(msg)) e.preventDefault();
  });

  function isPhoneLike() {
    const hasTouch = typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0;
    if (!hasTouch) return false;
    
    const ua = typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "";
    
    // 檢查是否為平板：iPad 或 Android 平板
    const isTablet = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua);
    if (isTablet) return false;
    
    // 檢查是否為手機
    const isMobileUa = /\bMobi\b|iPhone|iPod|Android.*Mobile/i.test(ua);
    if (!isMobileUa) return false;
    
    // 進一步根據螢幕尺寸判斷
    const shortest = Math.min(Number(window.innerWidth || 0), Number(window.innerHeight || 0));
    const longest = Math.max(Number(window.innerWidth || 0), Number(window.innerHeight || 0));
    
    // 如果短邊超過 900px 或長寬比接近 1:1（接近正方形），可能是平板
    if (shortest > 900) return false;
    if (shortest > 0 && longest / shortest < 1.2) return false;
    
    return true;
}

  function updateForcePortrait() {
    const isLandscape = window.innerWidth > window.innerHeight;
    const shouldForcePortrait = Boolean(isPhoneLike() && isLandscape);
    
    document.documentElement.classList.toggle("force-portrait", shouldForcePortrait);
  }

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch {}
    try {
      return Boolean(window.navigator && window.navigator.standalone);
    } catch {
      return false;
    }
  }

  async function updateOrientationLock() {
    if (!isStandalone()) return;
    
    const o = window.screen && window.screen.orientation;
    if (!o || typeof o.lock !== "function") return;

    if (isPhoneLike()) {
      // 在手機上，嘗試鎖定直屏
      try {
        // 先解鎖以確保狀態正確
        if (typeof o.unlock === "function") {
          try { o.unlock(); } catch {}
        }
        // 嘗試鎖定 portrait-primary（豎屏，主方向）
        await o.lock("portrait-primary");
      } catch (e1) {
        // 如果失敗，嘗試鎖定任意 portrait 方向
        try {
          await o.lock("portrait");
        } catch (e2) {
          // 如果還是失敗，至少不報錯
        }
      }
      return;
    }

    // 在平板上，解鎖以允許自由旋轉
    if (typeof o.unlock === "function") {
      try {
        o.unlock();
      } catch {}
    }
  }

  function shouldShow() {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return true;
      const ts = Number(raw);
      if (!Number.isFinite(ts)) return true;
      return Date.now() - ts > DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch {
      return true;
    }
  }

  function shouldInterceptInstallPrompt() {
    if (isStandalone()) return false;
    if (isIOSSafari()) return false;
    if (!isPhoneLike()) return false;
    return shouldShow();
  }

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
  }

  function ensureBanner() {
    let el = document.getElementById("pwaInstallBanner");
    if (el) return el;

    el = document.createElement("div");
    el.id = "pwaInstallBanner";
    el.className = "pwa-install";
    el.hidden = true;
    el.innerHTML = `
      <div class="row1">
        <div class="logo" aria-hidden="true"><img src="logo.svg?v=4" alt="" /></div>
        <div class="meta">
          <div class="title">安裝「生活網」</div>
          <div class="sub">加入主畫面後可像 App 一樣使用</div>
        </div>
      </div>
      <!-- Android/Chrome 安装按钮 -->
      <div class="row2 android-install" id="androidInstallButtons">
        <button class="btn" type="button" data-action="later">稍後</button>
        <button class="btn btn-primary" type="button" data-action="install">安裝應用程式</button>
      </div>
      <!-- iOS 安装指引 -->
      <div class="ios-install-guide" id="iosInstallGuide" style="display: none;">
        <div class="ios-install-step">
          <div class="ios-step-number">1</div>
          <div class="ios-step-content">點擊瀏覽器底部的分享按鈕</div>
        </div>
        <div class="ios-install-step">
          <div class="ios-step-number">2</div>
          <div class="ios-step-content">向下滑動並點擊「加入主畫面」</div>
        </div>
        <div class="ios-install-step">
          <div class="ios-step-number">3</div>
          <div class="ios-step-content">點擊「加入」即可完成安裝</div>
        </div>
        <div class="row2">
          <button class="btn" type="button" data-action="later">關閉</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function initProfileModal() {
    const btn = document.getElementById("btnUserMenu");
    const modal = document.getElementById("profileModal");
    if (!btn || !modal) return;

    const communityNameSub = document.getElementById("communityNameSub");
    const backdrop = modal.querySelector("[data-modal-close]");
    const closeBtn = document.getElementById("btnCloseProfileModal");
    const closeBtnFt = document.getElementById("btnCloseProfileModalFt");
    const roleEl = document.getElementById("profileRole");
    const statusEl = document.getElementById("profileStatus");
    const nameTextEl = document.getElementById("profileNameText");
    const profileAvatarImg = document.getElementById("profileAvatarImg");
    const profileAvatar = document.getElementById("profileAvatarFallback");
    const headerAvatar = document.getElementById("userAvatarFallback");
    const headerAvatarImg = document.getElementById("userAvatarImg");
    const greetingEl = document.getElementById("userGreeting");
    const switchEl = document.getElementById("profileSwitch");
    const btnEditAvatar = document.getElementById("btnEditAvatar");
    const avatarFileInput = document.getElementById("profileAvatarFile");
    const houseNoText = document.getElementById("profileHouseNoText");
    const houseNoItem = document.getElementById("profileHouseNoItem");
    const defaultProfileQrToken = "A000ADDT";

    const ensureProfileAvatarCrown = () => {
      const container = (profileAvatarImg && profileAvatarImg.closest) ? profileAvatarImg.closest(".profile-avatar") : document.querySelector("#profileModal .profile-avatar");
      if (!container) return null;
      let el = container.querySelector(".profile-avatar-crown");
      if (el) return el;
      el = document.createElement("span");
      el.className = "profile-avatar-crown";
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4.25 9.25 8.5 13.5 12 8.75 15.5 13.5 19.75 9.25 18 18H6l-1.75-8.75Z" fill="currentColor"/>
          <path d="M6 18h12l-.6 3H6.6L6 18Z" fill="currentColor"/>
        </svg>
      `.trim();
      container.appendChild(el);
      return el;
    };

    const setProfileAvatarCrownVisible = (visible) => {
      const container = (profileAvatarImg && profileAvatarImg.closest) ? profileAvatarImg.closest(".profile-avatar") : document.querySelector("#profileModal .profile-avatar");
      if (!container) return;
      const existing = container.querySelector(".profile-avatar-crown");
      if (!visible) {
        if (existing) {
          try { container.removeChild(existing); } catch {}
        }
        return;
      }
      ensureProfileAvatarCrown();
    };

    const ensureProfileHouseNoQr = () => {
      const roleRaw = String(sessionStorage.getItem("csp_role") || "").trim().toLowerCase();
      const isResidentRole = roleRaw === "resident" || roleRaw === "住戶";
      if (!isResidentRole) {
        const existing = document.getElementById("profileHouseNoQrWrap");
        if (existing && existing.parentElement) existing.parentElement.removeChild(existing);
        return null;
      }
      if (!houseNoText || !houseNoItem) return null;
      let wrap = document.getElementById("profileHouseNoQrWrap");
      if (wrap && houseNoItem.contains(wrap)) return wrap;
      wrap = document.createElement("div");
      wrap.id = "profileHouseNoQrWrap";
      wrap.className = "profile-qr-wrap";
      wrap.hidden = true;
      wrap.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center;">
          <img id="profileHouseNoQrImg" alt="QR Code" />
          <div id="profilePointsWrap" class="profile-points-wrap" style="margin-top: 12px; text-align: center;">
            <div class="profile-points-label" style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">目前點數</div>
            <div id="profilePointsValue" class="profile-points-value" style="font-size: 36px; font-weight: 900; color: #1f2937;">—</div>
          </div>
        </div>
      `;
      houseNoText.insertAdjacentElement("afterend", wrap);
      return wrap;
    };

    const renderProfileHouseNoQr = async (token, userData) => {
      const wrap = ensureProfileHouseNoQr();
      if (!wrap) return;
      const img = wrap.querySelector("#profileHouseNoQrImg");
      const t = String(token || "").trim() || defaultProfileQrToken;
      if (!t) {
        wrap.hidden = true;
        wrap.style.display = "none";
        return;
      }
      wrap.hidden = false;
      wrap.style.display = "";
      if (!img) {
        wrap.innerHTML = `<div class="status error">QR code 顯示失敗</div>`;
        return;
      }
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(t)}`;
      img.decoding = "async";
      img.loading = "eager";
      if (!img._boundProfileQrError) {
        img._boundProfileQrError = true;
        img.addEventListener("error", () => {
          try { wrap.innerHTML = `<div class="status error">QR code 產生失敗</div>`; } catch {}
        });
      }
      // 顯示點數
      const pointsEl = wrap.querySelector("#profilePointsValue");
      if (pointsEl && userData) {
        let points = Number(userData.points || userData.point || userData.credit || userData.score || userData.balance || 0);
        console.log("renderProfileHouseNoQr - 初始點數:", points);
        console.log("renderProfileHouseNoQr - userData 完整對象:", userData);
        
        // 檢查是否需要使用共用點數
        try {
          const db = ensureDb();
          console.log("renderProfileHouseNoQr - db 是否存在:", !!db);
          
          let cid = String(userData.community || "").trim();
          if (!cid) {
            cid = String(localStorage.getItem("csp_active_community_v1") || "").trim();
          }
          const houseNo = String(userData.houseNo || userData.unit || "").trim();
          console.log("renderProfileHouseNoQr - cid:", cid, "houseNo:", houseNo);
          
          if (db && cid && houseNo) {
            // 讀取社區點數設定和 housePoints
            let sharePoints = true; // 預設為共用
            let housePoints = null;
            
            try {
              const doc = await db.collection("communities").doc(cid).get();
              console.log("renderProfileHouseNoQr - 社區文件 doc.exists:", doc.exists);
              if (doc.exists) {
                const cData = doc.data() || {};
                console.log("renderProfileHouseNoQr - 社區設定:", cData);
                
                // 讀取點數共用設定
                if (cData.pointsSettings && cData.pointsSettings.sharePoints === false) {
                  sharePoints = false;
                }
                
                // 讀取 housePoints
                housePoints = cData.housePoints || {};
                console.log("renderProfileHouseNoQr - housePoints:", housePoints);
              }
            } catch (e) {
              console.error("renderProfileHouseNoQr - 讀取社區設定失敗:", e);
            }
            console.log("renderProfileHouseNoQr - 共用點數模式:", sharePoints);
            
            // 如果是共用點數，從 housePoints 中讀取
            if (sharePoints && housePoints && housePoints[houseNo] !== undefined) {
              points = Number(housePoints[houseNo]) || 0;
              console.log("renderProfileHouseNoQr - 從 housePoints 讀取到的點數:", points);
            }
          } else {
            console.log("renderProfileHouseNoQr - 缺少必要信息，跳過共用計算");
            console.log("renderProfileHouseNoQr - db:", !!db, "cid:", cid, "houseNo:", houseNo);
          }
        } catch (e) {
          console.error("renderProfileHouseNoQr - 共用點數計算失敗:", e);
        }
        
        console.log("renderProfileHouseNoQr - 最終顯示的點數:", points);
        pointsEl.textContent = String(points);
      } else if (pointsEl) {
        pointsEl.textContent = "—";
      }
    };

    const getRoleText = () => {
      const r = String(sessionStorage.getItem("csp_role") || "").trim().toLowerCase();
      if (r === "admin") return "系統管理員";
      if (r === "community") return "社區";
      if (r === "resident") return "住戶";
      if (r === "board") return "看板";
      if (r === "table") return "桌板";
      if (r === "shop") return "商店";
      return "—";
    };

    const pickInitial = (displayName, email) => {
      const s = String(displayName || "").trim() || String(email || "").trim();
      return s ? s.slice(0, 1).toUpperCase() : "U";
    };

    const nameFromEmail = (email) => {
      const e = String(email || "").trim();
      if (!e) return "";
      const part = e.split("@")[0] || "";
      return String(part || "").trim();
    };

    const isSystemAdminAccount = (user, data) => {
      const role = String(data && data.role ? data.role : "").trim();
      if (role === "admin" || role === "系統管理員" || role === "系統管理者" || role === "系統") return true;
      const email = String((data && (data.email || data.username)) || (user && user.email) || "").trim().toLowerCase();
      return email === "nwapp.eason@gmail.com";
    };
    const isSystemAdminFlag = () => {
      try {
        return String(sessionStorage.getItem("csp_sysadmin") || "") === "1";
      } catch {
        return false;
      }
    };
    const getSessionRole = () => {
      try {
        const r = String(sessionStorage.getItem("csp_role") || "").trim().toLowerCase();
        if (r === "admin" || r === "community" || r === "resident" || r === "board" || r === "table" || r === "shop") return r;
        if (r === "系統管理員" || r === "系統管理者" || r === "系統") return "admin";
        if (r === "社區") return "community";
        if (r === "住戶") return "resident";
        if (r === "看板") return "board";
        if (r === "桌板") return "table";
        if (r === "商店") return "shop";
        return "";
      } catch {
        return "";
      }
    };
    const markSystemAdminSession = (user, isAdmin) => {
      try {
        if (isAdmin && user && user.uid) sessionStorage.setItem("csp_system_admin_uid", String(user.uid));
        else sessionStorage.removeItem("csp_system_admin_uid");
      } catch {}
    };
    const isSystemAdminSession = (user) => {
      try {
        if (!user || !user.uid) return false;
        return String(sessionStorage.getItem("csp_system_admin_uid") || "") === String(user.uid);
      } catch {
        return false;
      }
    };

    const isCommunityPickerSupportedPage = () => {
      const page = String(location.pathname || "").split("/").pop().toLowerCase();
      return page === "admin.html" || page === "member.html" || page === "system.html" || page === "ead.html" || page === "tad.html" || page === "shop.html";
    };

    const readAllowedCommunityKeys = () => {
      try {
        const raw = String(sessionStorage.getItem("csp_allowed_community_keys") || "").trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((x) => String(x || "").trim()).filter(Boolean);
      } catch {
        return [];
      }
    };

    const writeAllowedCommunityKeys = (keys) => {
      try {
        const list = Array.isArray(keys) ? keys.map((x) => String(x || "").trim()).filter(Boolean) : [];
        sessionStorage.setItem("csp_allowed_community_keys", JSON.stringify(list));
      } catch {}
    };

    const ensureUrlCommunityKeyFromAllowed = (allowedKeys) => {
      const keys = Array.isArray(allowedKeys) ? allowedKeys.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!keys.length) return;
      try {
        const u = new URL(location.href);
        const current = String(u.searchParams.get("c") || "").trim();
        const ok = current && keys.some((k) => k.toLowerCase() === current.toLowerCase());
        if (!ok) {
          u.searchParams.set("c", keys[0]);
          history.replaceState(null, "", u.toString());
        }
        try { sessionStorage.setItem("csp_last_cid", String(u.searchParams.get("c") || keys[0])); } catch {}
      } catch {}
    };

    const ensureCommunityPickerModal = () => {
      let el = document.getElementById("communityPickerModal");
      if (el) return el;
      el = document.createElement("div");
      el.id = "communityPickerModal";
      el.className = "modal modal-community-picker";
      el.hidden = true;
      el.innerHTML = `
        <div class="modal-backdrop" data-modal-close="1"></div>
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="communityPickerTitle">
          <div class="modal-hd">
            <h3 class="modal-title" id="communityPickerTitle">切換社區</h3>
            <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
          </div>
          <div class="modal-body">
            <div class="community-picker-list" id="communityPickerList">
              <div class="status">讀取中...</div>
            </div>
          </div>
          <div class="modal-ft">
            <button class="intercom-btn ghost community-picker-close" type="button" data-modal-close="1">關閉</button>
          </div>
        </div>
      `;
      document.body.appendChild(el);
      return el;
    };

    const openCommunityPicker = async (db, targetPage, activeCodeOrId, allowedKeys) => {
      const modal = ensureCommunityPickerModal();
      const listEl = document.getElementById("communityPickerList");
      modal.hidden = false;
      document.body.style.overflow = "hidden";
      if (listEl) listEl.innerHTML = `<div class="status">讀取中...</div>`;

      const close = () => {
        modal.hidden = true;
        document.body.style.overflow = "";
      };

      const closerEls = modal.querySelectorAll("[data-modal-close]");
      closerEls.forEach((x) => x.addEventListener("click", close, { once: true }));
      const onKeyDown = (e) => {
        if (e.key === "Escape") close();
      };
      document.addEventListener("keydown", onKeyDown, { once: true });

      if (!db) {
        if (listEl) listEl.innerHTML = `<div class="status error">Firestore 尚未初始化</div>`;
        return;
      }

      try {
        const snap = await db.collection("communities").get();
        let list = snap.docs.map((d) => {
          const v = d.data() || {};
          return {
            id: String(v.id || d.id),
            name: String(v.name || ""),
            username: String(v.username || ""),
            area: String(v.area || ""),
            enabled: v.enabled !== false,
          };
        }).filter((x) => x && x.name);

        const allowed = Array.isArray(allowedKeys) ? allowedKeys.map((x) => String(x || "").trim()).filter(Boolean) : [];
        if (allowed.length) {
          const set = new Set(allowed.map((x) => x.toLowerCase()));
          list = list.filter((c) => {
            const id = String(c.id || "").trim().toLowerCase();
            const user = String(c.username || "").trim().toLowerCase();
            return set.has(id) || set.has(user);
          });
        }

        list.sort((a, b) => {
          const ka = String(a.username || a.id || "").trim();
          const kb = String(b.username || b.id || "").trim();
          const ca = ka.toLowerCase();
          const cb = kb.toLowerCase();
          const byKey = ca.localeCompare(cb, "en", { numeric: true, sensitivity: "base" });
          if (byKey !== 0) return byKey;
          return String(a.name || "").localeCompare(String(b.name || ""), "zh-TW", { numeric: true, sensitivity: "base" });
        });

        if (!listEl) return;
        if (!list.length) {
          listEl.innerHTML = `<div class="status">尚無社區資料</div>`;
          return;
        }

        const activeKey = String(activeCodeOrId || "").trim().toLowerCase();
        listEl.innerHTML = list.map((c) => {
          const key = String(c.username || c.id || "").trim();
          const isActive = activeKey && (key.toLowerCase() === activeKey || String(c.id || "").toLowerCase() === activeKey);
          const cls = isActive ? "community-picker-btn active" : "community-picker-btn";
          return `
            <div class="community-picker-item">
              <button type="button" class="${cls}" data-community-key="${encodeURIComponent(key)}">
                <span class="community-picker-name">${c.name}</span>
                <span class="community-picker-code">${key}</span>
              </button>
            </div>
          `.trim();
        }).join("");

        listEl.querySelectorAll("[data-community-key]").forEach((b) => {
          b.addEventListener("click", () => {
            const key = decodeURIComponent(String(b.getAttribute("data-community-key") || "").trim());
            if (!key) return;
            try { sessionStorage.setItem("csp_last_cid", key); } catch {}
            const target = String(targetPage || "").trim().toLowerCase();
            const cPart = `?c=${encodeURIComponent(key)}`;
            if (target === "admin") {
              try { sessionStorage.setItem("csp_role", "community"); } catch {}
              location.href = `admin.html${cPart}#community/community-dashboard`;
              return;
            }
            if (target === "member") {
              try { sessionStorage.setItem("csp_role", "resident"); } catch {}
              location.href = `member.html${cPart}`;
              return;
            }
            if (target === "board") {
              try { sessionStorage.setItem("csp_role", "board"); } catch {}
              location.href = `ead.html${cPart}`;
              return;
            }
            if (target === "table") {
              try { sessionStorage.setItem("csp_role", "table"); } catch {}
              location.href = `tad.html${cPart}`;
              return;
            }
            if (target === "shop") {
              try { sessionStorage.setItem("csp_role", "shop"); } catch {}
              location.href = `shop.html${cPart}`;
              return;
            }
            try { sessionStorage.setItem("csp_role", "community"); } catch {}
            location.href = `admin.html${cPart}#community/community-dashboard`;
          });
        });
      } catch (e) {
        if (listEl) listEl.innerHTML = `<div class="status error">讀取社區清單失敗</div>`;
      }
    };

    const showStatus = (msg, isError) => {
      if (!statusEl) return;
      statusEl.textContent = String(msg || "");
      statusEl.hidden = !msg;
      statusEl.classList.toggle("error", Boolean(isError));
    };
    const notify = (msg, isError) => {
      try {
        if (typeof window.toast === "function") {
          window.toast(String(msg || "").trim(), isError ? "error" : "success");
          return;
        }
      } catch {}
      showStatus(String(msg || "").trim(), Boolean(isError));
    };

    const ensureDb = () => {
      const fb = window.firebase;
      if (!fb || !fb.firestore) return null;
      const db = fb.firestore();
      try {
        db.settings({
          experimentalAutoDetectLongPolling: true,
          experimentalForceLongPolling: true,
          useFetchStreams: false,
          ignoreUndefinedProperties: true,
        });
      } catch {}
      return db;
    };

    const getCommunityKeyForNav = () => {
      try {
        const fromUrl = new URLSearchParams(location.search).get("c");
        if (fromUrl) return String(fromUrl || "").trim();
      } catch {}
      try {
        const fromSession = String(sessionStorage.getItem("csp_last_cid") || "").trim();
        if (fromSession) return fromSession;
      } catch {}
      try {
        const fromLocal = String(localStorage.getItem("csp_active_community_v1") || "").trim();
        if (fromLocal) return fromLocal;
      } catch {}
      return "";
    };

    const resolveSwitchTargets = () => {
      const page = String(location.pathname || "").split("/").pop().toLowerCase();
      if (page === "system.html") return ["admin", "member", "board", "table", "shop"];
      if (page === "admin.html") return ["system", "member", "board", "table", "shop"];
      if (page === "member.html") return ["system", "admin", "board", "table", "shop"];
      if (page === "ead.html") return ["system", "admin", "member", "table", "shop"];
      if (page === "tad.html") return ["system", "admin", "member", "board", "shop"];
      if (page === "shop.html") return ["system", "admin", "member", "board", "table"];
      return [];
    };

    const urlForTarget = (target) => {
      const c = getCommunityKeyForNav();
      const cPart = c && c !== "default" ? `?c=${encodeURIComponent(c)}` : "";
      if (target === "system") return "system.html";
      if (target === "admin") return `admin.html${cPart}#community/community-dashboard`;
      if (target === "member") return `member.html${cPart}`;
      if (target === "board") return `ead.html${cPart}`;
      if (target === "table") return `tad.html${cPart}`;
      if (target === "shop") return `shop.html${cPart}`;
      return "";
    };

    const roleForTarget = (target) => {
      if (target === "system") return "admin";
      if (target === "admin") return "community";
      if (target === "member") return "resident";
      if (target === "board") return "board";
      if (target === "table") return "table";
      if (target === "shop") return "shop";
      return "";
    };

    const labelForTarget = (target) => {
      if (target === "system") return "系統";
      if (target === "admin") return "社區";
      if (target === "member") return "住戶";
      if (target === "board") return "看板";
      if (target === "table") return "桌板";
      if (target === "shop") return "商店";
      return "";
    };

    const iconForTarget = (target) => {
      if (target === "system") {
        return `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="1.7"></path>
            <path d="M19.2 12a7.2 7.2 0 0 0-.1-1.1l2-1.6-1.8-3.1-2.5 1a7.2 7.2 0 0 0-1.9-1.1l-.4-2.7H9.5l-.4 2.7a7.2 7.2 0 0 0-1.9 1.1l-2.5-1-1.8 3.1 2 1.6A7.2 7.2 0 0 0 4.8 12c0 .4 0 .7.1 1.1l-2 1.6 1.8 3.1 2.5-1a7.2 7.2 0 0 0 1.9 1.1l.4 2.7h5l.4-2.7a7.2 7.2 0 0 0 1.9-1.1l2.5 1 1.8-3.1-2-1.6c.1-.4.1-.7.1-1.1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" opacity="0.8"></path>
          </svg>
        `.trim();
      }
      if (target === "admin") {
        return `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4.5 10.3 12 5.7l7.5 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M6.2 10.3V19h11.6v-8.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M9 19v-5.3h6V19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        `.trim();
      }
      if (target === "member") {
        return `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" stroke-width="1.7"></path>
            <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
          </svg>
        `.trim();
      }
      if (target === "board") {
        return `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" stroke-width="1.7"></rect>
            <path d="M9 19h6M12 16v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
          </svg>
        `.trim();
      }
      if (target === "table") {
        return `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="5" y="4.5" width="14" height="15" rx="2" stroke="currentColor" stroke-width="1.7"></rect>
            <path d="M9 9h6M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
          </svg>
        `.trim();
      }
      if (target === "shop") {
        return `
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 9h14l-1 10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 9Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>
            <path d="M9 9V7a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
          </svg>
        `.trim();
      }
      return "";
    };

    const isCommunityAccount = (user, data) => {
      const role = String(data && data.role ? data.role : "").trim();
      if (role === "community" || role === "社區") return true;
      return false;
    };

    const updateSwitchButtons = () => {
      if (!switchEl) return;
      const fb = window.firebase;
      const user = fb && fb.auth ? fb.auth().currentUser : null;
      const sessionRole = getSessionRole();
      const page = String(location.pathname || "").split("/").pop().toLowerCase();
      const isSystemPage = page === "system.html";
      if (sessionRole === "admin") markSystemAdminSession(user, true);
      const profileData = switchEl._profileData || {};
      const isSysAdmin = Boolean(
        isSystemAdminAccount(user, profileData) ||
        switchEl._isSystemAdmin ||
        isSystemAdminSession(user) ||
        isSystemAdminFlag() ||
        sessionRole === "admin" ||
        isSystemPage
      );
      const isCommunity = Boolean(
        isCommunityAccount(user, profileData) ||
        sessionRole === "community"
      );
      const canSwitch = isSysAdmin || isCommunity;
      if (!canSwitch) {
        switchEl.hidden = true;
        switchEl.innerHTML = "";
        return;
      }
      let targets = resolveSwitchTargets();
      if (!isSysAdmin) {
        targets = targets.filter((t) => t !== "system");
      }
      if (isCommunity && Array.isArray(profileData.accessiblePages)) {
        const targetToPage = {
          member: "resident",
          board: "board",
          table: "table",
          shop: "shop",
        };
        const allowed = new Set(profileData.accessiblePages.map((x) => String(x || "").trim()));
        targets = targets.filter((t) => {
          const p = targetToPage[t];
          if (!p) return false;
          return allowed.has(p);
        });
      }
      if (!targets.length) {
        switchEl.hidden = true;
        switchEl.innerHTML = "";
        return;
      }
      switchEl.hidden = false;
      switchEl.innerHTML = targets.map((t) => `
        <button class="icon-btn" type="button" data-profile-switch="${t}" aria-label="${labelForTarget(t)}" title="${labelForTarget(t)}">
          ${iconForTarget(t)}
        </button>
      `).join("");
    };
    const bindCommunityNameSubPicker = () => {
      if (!communityNameSub) return;
      const page = String(location.pathname || "").split("/").pop().toLowerCase();
      const isSystemPage = page === "system.html";
      const sessionRole = getSessionRole();
      const fb = window.firebase;
      const user = fb && fb.auth ? fb.auth().currentUser : null;
      const allowedKeys = readAllowedCommunityKeys();
      const multiRole = sessionRole === "community" || sessionRole === "board" || sessionRole === "table" || sessionRole === "shop";
      const multiEnabled = Boolean(multiRole && allowedKeys.length > 1);
      const hintClickable = Boolean(isSystemPage || sessionRole === "admin" || isSystemAdminFlag() || isSystemAdminSession(user) || multiEnabled);
      communityNameSub.classList.toggle("clickable", hintClickable);
      if (communityNameSub._pickerHandler) return;
      communityNameSub._pickerHandler = async (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch {}
        const fb2 = window.firebase;
        const u = fb2 && fb2.auth ? fb2.auth().currentUser : null;
        const allowedKeys2 = readAllowedCommunityKeys();
        const role2 = getSessionRole();
        const multiRole2 = role2 === "community" || role2 === "board" || role2 === "table" || role2 === "shop";
        let ok = Boolean(isSystemAdminFlag() || isSystemAdminSession(u) || (multiRole2 && allowedKeys2.length > 1));
        if (!ok) {
          const p = String(location.pathname || "").split("/").pop().toLowerCase();
          if (p === "system.html") ok = true;
        }
        if (!ok) {
          const r = getSessionRole();
          if (r === "admin") ok = true;
        }
        if (!ok && u) {
          try {
            const token = await u.getIdTokenResult();
            const claimRole = String(token && token.claims ? token.claims.role || "" : "").trim();
            const claimRoles = token && token.claims ? token.claims.roles : null;
            const normalized = String(claimRole || "").trim().toLowerCase();
            if (normalized === "admin" || claimRole === "系統管理員" || claimRole === "系統管理者" || claimRole === "系統") ok = true;
            else if (Array.isArray(claimRoles)) {
              ok = claimRoles.map((x) => String(x || "").trim().toLowerCase()).some((x) => x === "admin" || x === "系統管理員" || x === "系統管理者" || x === "系統");
            }
          } catch {}
        }
        if (!ok && u) {
          const email = String(u.email || "").trim().toLowerCase();
          if (email === "nwapp.eason@gmail.com") ok = true;
        }
        if (!ok) return;
        const p = String(location.pathname || "").split("/").pop().toLowerCase();
        const target =
          p === "member.html" ? "member" :
          p === "ead.html" ? "board" :
          p === "tad.html" ? "table" :
          p === "shop.html" ? "shop" :
          "admin";
        openCommunityPicker(
          ensureDb(),
          target,
          new URLSearchParams(location.search).get("c") || sessionStorage.getItem("csp_last_cid") || localStorage.getItem("csp_active_community_v1") || "",
          allowedKeys2
        );
      };
      communityNameSub.addEventListener("click", communityNameSub._pickerHandler, true);
      communityNameSub._pickerKeyHandler = (e) => {
        if (!e) return;
        const k = String(e.key || "");
        if (k !== "Enter" && k !== " ") return;
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch {}
        communityNameSub._pickerHandler(e);
      };
      communityNameSub.addEventListener("keydown", communityNameSub._pickerKeyHandler, true);
      try {
        if (!communityNameSub.hasAttribute("tabindex")) communityNameSub.setAttribute("tabindex", "0");
        if (!communityNameSub.getAttribute("role")) communityNameSub.setAttribute("role", "button");
      } catch {}
    };

    const loadProfile = async (user) => {
      if (!user) return;
      if (roleEl) roleEl.textContent = getRoleText();
      const initial = pickInitial(user.displayName, user.email);
      if (profileAvatar) profileAvatar.textContent = initial;
      if (headerAvatar) headerAvatar.textContent = initial;
      if (headerAvatarImg) headerAvatarImg.style.display = "none";
      if (headerAvatar) headerAvatar.style.display = "";
      if (profileAvatarImg) profileAvatarImg.style.display = "none";
      if (profileAvatar) profileAvatar.style.display = "";
      setProfileAvatarCrownVisible(false);
      if (greetingEl) greetingEl.textContent = "Hi~";

      const db = ensureDb();
      let data = {};
      if (db) {
        try {
          const doc = await db.collection("users").doc(String(user.uid)).get();
          data = doc && doc.exists ? (doc.data() || {}) : {};
        } catch {
          data = {};
        }
        if (!data || !Object.keys(data).length) {
          const email = String(user.email || "").trim();
          if (email) {
            try {
              const snap = await db.collection("users").where("email", "==", email).limit(1).get();
              const alt = snap && snap.docs && snap.docs[0] ? snap.docs[0] : null;
              if (alt && alt.exists) data = alt.data() || {};
            } catch {}
            if (!data || !Object.keys(data).length) {
              try {
                const snap = await db.collection("users").where("username", "==", email).limit(1).get();
                const alt = snap && snap.docs && snap.docs[0] ? snap.docs[0] : null;
                if (alt && alt.exists) data = alt.data() || {};
              } catch {}
            }
          }
        }
      }
      let sysAdmin = isSystemAdminAccount(user, data || {});
      if (!sysAdmin && user && typeof user.getIdTokenResult === "function") {
        try {
          const token = await user.getIdTokenResult();
          const claimRole = String(token && token.claims ? token.claims.role || "" : "").trim().toLowerCase();
          const claimRoles = token && token.claims ? token.claims.roles : null;
          if (claimRole === "admin" || claimRole === "系統管理員" || claimRole === "系統管理者" || claimRole === "系統") {
            sysAdmin = true;
          } else if (Array.isArray(claimRoles)) {
            sysAdmin = claimRoles.map((x) => String(x || "").trim().toLowerCase()).some((x) => x === "admin" || x === "系統管理員" || x === "系統管理者" || x === "系統");
          }
        } catch {}
      }
      const sessionRole = getSessionRole();
      const page = String(location.pathname || "").split("/").pop().toLowerCase();
      if (sessionRole === "admin" || page === "system.html" || isSystemAdminSession(user) || isSystemAdminFlag()) sysAdmin = true;
      if (switchEl) {
        switchEl._profileData = data || {};
        switchEl._isSystemAdmin = sysAdmin;
      }
      markSystemAdminSession(user, sysAdmin);
      updateSwitchButtons();
      try {
        const role = getSessionRole();
        const supportsMulti = role === "community" || role === "board" || role === "table" || role === "shop";
        if (supportsMulti && db) {
          const idsRaw = Array.isArray(data && data.communityIds ? data.communityIds : null) ? data.communityIds : [];
          const ids = idsRaw.map((x) => String(x || "").trim()).filter(Boolean);
          const codesRaw = Array.isArray(data && data.communityCodes ? data.communityCodes : null) ? data.communityCodes : [];
          let keys = codesRaw.map((x) => String(x || "").trim()).filter(Boolean);
          if (!keys.length) {
            keys = [];
            for (const id of ids) {
              if (!id) continue;
              try {
                const cdoc = await db.collection("communities").doc(String(id)).get();
                if (cdoc && cdoc.exists) {
                  const cdata = cdoc.data() || {};
                  const code = String(cdata.username || cdata.id || id).trim();
                  if (code) keys.push(code);
                } else {
                  keys.push(id);
                }
              } catch {
                keys.push(id);
              }
            }
          }
          const uniq = [];
          const seen = new Set();
          keys.forEach((k) => {
            const key = String(k || "").trim();
            const low = key.toLowerCase();
            if (!key || seen.has(low)) return;
            seen.add(low);
            uniq.push(key);
          });
          writeAllowedCommunityKeys(uniq);
          ensureUrlCommunityKeyFromAllowed(uniq);
        } else {
          writeAllowedCommunityKeys([]);
        }
      } catch {
        writeAllowedCommunityKeys([]);
      }
      bindCommunityNameSubPicker();
      const displayName = String(
        data.displayName ||
        data.name ||
        data.fullName ||
        user.displayName ||
        nameFromEmail(user.email) ||
        ""
      ).trim();
      if (nameTextEl) nameTextEl.textContent = displayName || "—";
      if (greetingEl) greetingEl.textContent = `Hi~${displayName || "—"}`;
      const initial2 = pickInitial(displayName, user.email);
      if (profileAvatar) profileAvatar.textContent = initial2;
      if (headerAvatar) headerAvatar.textContent = initial2;

      const avatarUrl = String(data.avatarDataUrl || data.photoDataUrl || data.photoURL || user.photoURL || "").trim();
      if (avatarUrl && profileAvatarImg) {
        profileAvatarImg.src = avatarUrl;
        profileAvatarImg.style.display = "block";
        if (profileAvatar) profileAvatar.style.display = "none";
      }
      if (avatarUrl && headerAvatarImg) {
        headerAvatarImg.src = avatarUrl;
        headerAvatarImg.style.display = "block";
        if (headerAvatar) headerAvatar.style.display = "none";
      } else {
        if (headerAvatarImg) headerAvatarImg.style.display = "none";
        if (headerAvatar) headerAvatar.style.display = "";
      }

      const communityTextEl = document.getElementById("profileCommunityText");
      const communityItemEl = document.getElementById("profileCommunityItem");
      if (communityItemEl && communityTextEl) {
        let cname = "—";
        if (sysAdmin) {
          cname = "系統管理員";
          communityTextEl.textContent = cname;
          communityItemEl.hidden = false;
          communityItemEl.classList.add("single");
          if (houseNoItem) houseNoItem.hidden = true;
          const qrWrap = document.getElementById("profileHouseNoQrWrap");
          if (qrWrap) {
            try { qrWrap.parentElement && qrWrap.parentElement.removeChild(qrWrap); } catch {}
          }
          if (roleEl) {
            roleEl.textContent = "";
            roleEl.style.display = "none";
          }
        } else {
          communityItemEl.classList.remove("single");
          const staffRole = sessionRole === "community" || sessionRole === "board" || sessionRole === "table" || sessionRole === "shop";
          const qrWrap = document.getElementById("profileHouseNoQrWrap");
          const residentCategory = String((data && (data.category || data.residentCategory)) || "").trim();
          const isCommitteeResident = sessionRole === "resident" && (residentCategory === "委員" || residentCategory.includes("委員"));
          if (staffRole) {
            if (houseNoItem) houseNoItem.hidden = true;
            if (qrWrap) {
              try { qrWrap.parentElement && qrWrap.parentElement.removeChild(qrWrap); } catch {}
            }
            setProfileAvatarCrownVisible(false);
          } else if (houseNoItem) {
            houseNoItem.hidden = false;
            const base = String(data.houseNo || data.unit || "").trim();
            const sub = String(data.subHouseNo || data.subUnit || data.sub || "").trim();
            const full = base ? (sub ? `${base}-${sub}` : base) : "—";
            if (houseNoText) houseNoText.textContent = full;
            renderProfileHouseNoQr(String(data.qrToken || "").trim(), data).catch(() => {});
            setProfileAvatarCrownVisible(isCommitteeResident);
          }
          if (roleEl) {
            roleEl.style.display = "";
            roleEl.textContent = isCommitteeResident ? "委員" : getRoleText();
          }
          const cid = String(data.community || localStorage.getItem("csp_active_community_v1") || "").trim();
          if (cid && cid !== "default") {
            try {
              if (db) {
                const cdoc = await db.collection("communities").doc(cid).get();
                if (cdoc.exists) cname = cdoc.data().name || cid;
                else cname = cid;
              } else {
                cname = cid;
              }
            } catch { cname = cid; }
          } else {
            cname = "—";
          }
          communityTextEl.textContent = cname;
          communityItemEl.hidden = false;
        }
      }
    };
    const updateAvatarDataUrl = async (user, dataUrl) => {
      const db = ensureDb();
      if (!db || !user || !user.uid) throw new Error("Firestore 尚未初始化");
      await db.collection("users").doc(String(user.uid)).set({ avatarDataUrl: String(dataUrl || "") }, { merge: true });
    };

    if (btnEditAvatar && avatarFileInput && !btnEditAvatar._boundEditAvatar) {
      btnEditAvatar._boundEditAvatar = true;
      btnEditAvatar.addEventListener("click", () => {
        try { avatarFileInput.click(); } catch {}
      });
      avatarFileInput.addEventListener("change", async () => {
        const fb = window.firebase;
        const user = fb && fb.auth ? fb.auth().currentUser : null;
        const f = avatarFileInput.files && avatarFileInput.files[0] ? avatarFileInput.files[0] : null;
        if (!user || !f) return;
        if (!String(f.type || "").startsWith("image/")) {
          notify("請選擇圖片檔案", true);
          return;
        }
        try {
          btnEditAvatar.disabled = true;
          notify("上傳中...", false);
          const dataUrl = await new Promise((resolve, reject) => {
            try {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error("讀取失敗"));
              reader.onload = () => resolve(String(reader.result || ""));
              reader.readAsDataURL(f);
            } catch (e) {
              reject(e);
            }
          });
          await updateAvatarDataUrl(user, dataUrl);
          if (profileAvatarImg) {
            profileAvatarImg.src = dataUrl;
            profileAvatarImg.style.display = "block";
          }
          if (profileAvatar) profileAvatar.style.display = "none";
          if (headerAvatarImg) {
            headerAvatarImg.src = dataUrl;
            headerAvatarImg.style.display = "block";
          }
          if (headerAvatar) headerAvatar.style.display = "none";
          notify("大頭照已更新", false);
        } catch (e) {
          notify("更新失敗，請稍後再試。", true);
        } finally {
          try { avatarFileInput.value = ""; } catch {}
          btnEditAvatar.disabled = false;
        }
      });
    }

    let detachKeydown = () => {};

    const close = () => {
      modal.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
      showStatus("", false);
      detachKeydown();
      detachKeydown = () => {};
    };

    const open = async () => {
      modal.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      showStatus("", false);
      if (roleEl) roleEl.textContent = getRoleText();

      const fb = window.firebase;
      const user = fb && fb.auth ? fb.auth().currentUser : null;
      if (user) {
        try { await loadProfile(user); } catch {}
      }

      const onKeyDown = (e) => {
        if (e.key === "Escape") close();
      };
      document.addEventListener("keydown", onKeyDown);
      detachKeydown = () => document.removeEventListener("keydown", onKeyDown);

      requestAnimationFrame(() => {
        if (closeBtnFt) closeBtnFt.focus();
      });
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });

    bindCommunityNameSubPicker();

    if (switchEl && !switchEl._boundSwitch) {
      switchEl._boundSwitch = true;
      switchEl.addEventListener("click", (e) => {
        const t = e.target && e.target.closest ? e.target.closest("[data-profile-switch]") : null;
        if (!t) return;
        const target = String(t.getAttribute("data-profile-switch") || "").trim();
        const role = roleForTarget(target);
        const url = urlForTarget(target);
        if (!role || !url) return;
        try {
          sessionStorage.setItem("csp_role", role);
        } catch {}
        location.href = url;
      });
    }

    if (backdrop) backdrop.addEventListener("click", close);
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (closeBtnFt) closeBtnFt.addEventListener("click", close);

    const fb = window.firebase;
    const a = fb && fb.auth ? fb.auth() : null;
    if (a && typeof a.onAuthStateChanged === "function") {
      let didHydrate = false;
      try {
        const u = a.currentUser;
        if (u) {
          didHydrate = true;
          loadProfile(u).catch(() => {});
        }
      } catch {}
      a.onAuthStateChanged((u) => {
        if (!u) return;
        if (didHydrate) return;
        didHydrate = true;
        loadProfile(u).catch(() => {});
      });
    }
  }

  function ensureConfirmModal() {
    let el = document.getElementById("confirmModal");
    if (el) return el;

    el = document.createElement("div");
    el.id = "confirmModal";
    el.className = "modal";
    el.hidden = true;
    el.innerHTML = `
      <div class="modal-backdrop" data-modal-close="1"></div>
      <div class="modal-dialog modal-sm" role="dialog" aria-modal="true" aria-labelledby="confirmModalTitle">
        <div class="modal-hd">
          <h3 class="modal-title" id="confirmModalTitle">再次確認</h3>
          <button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>
        </div>
        <div class="modal-body">
          <div class="confirm-message" id="confirmModalMessage">確定要執行此操作？</div>
        </div>
        <div class="modal-ft">
          <button class="btn" type="button" data-confirm-action="cancel">取消</button>
          <button class="btn btn-danger" type="button" data-confirm-action="ok">刪除</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function confirmDialog(options) {
    const modal = ensureConfirmModal();
    const titleEl = document.getElementById("confirmModalTitle");
    const msgEl = document.getElementById("confirmModalMessage");
    const okBtn = modal.querySelector('[data-confirm-action="ok"]');
    const cancelBtn = modal.querySelector('[data-confirm-action="cancel"]');
    const closerEls = modal.querySelectorAll("[data-modal-close]");

    const title = options && options.title ? String(options.title) : "再次確認";
    const message = options && options.message ? String(options.message) : "確定要執行此操作？";
    const okText = options && options.okText ? String(options.okText) : "確定";
    const cancelText = options && options.cancelText ? String(options.cancelText) : "取消";
    const danger = options && options.danger !== false;

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (okBtn) okBtn.textContent = okText;
    if (cancelBtn) cancelBtn.textContent = cancelText;
    if (okBtn) okBtn.classList.toggle("btn-danger", Boolean(danger));

    return new Promise((resolve) => {
      let detachKeydown = () => {};

      const close = (result) => {
        modal.hidden = true;
        document.body.style.overflow = "";
        cleanup();
        resolve(Boolean(result));
      };

      const onKeyDown = (e) => {
        if (e.key === "Escape") close(false);
      };

      const onClick = (e) => {
        const t = e.target && e.target.closest ? e.target.closest("[data-confirm-action]") : null;
        if (!t) return;
        const action = t.getAttribute("data-confirm-action");
        if (action === "ok") close(true);
        else close(false);
      };

      const onCloseClick = () => close(false);

      const cleanup = () => {
        modal.removeEventListener("click", onClick);
        closerEls.forEach((x) => x.removeEventListener("click", onCloseClick));
        detachKeydown();
        detachKeydown = () => {};
      };

      document.body.style.overflow = "hidden";
      modal.hidden = false;
      modal.addEventListener("click", onClick);
      closerEls.forEach((x) => x.addEventListener("click", onCloseClick));
      document.addEventListener("keydown", onKeyDown);
      detachKeydown = () => document.removeEventListener("keydown", onKeyDown);
    });
  }

  function showBanner(onInstall) {
    if (isStandalone()) return;
    if (!shouldShow()) return;
    const banner = ensureBanner();
    
    // 根据设备显示不同的内容
    const androidButtons = banner.querySelector("#androidInstallButtons");
    const iosGuide = banner.querySelector("#iosInstallGuide");
    
    if (isIOSSafari()) {
      // iOS Safari - 显示安装指引
      if (androidButtons) androidButtons.style.display = "none";
      if (iosGuide) iosGuide.style.display = "flex";
    } else {
      // Android/其他 - 显示安装按钮
      if (androidButtons) androidButtons.style.display = "flex";
      if (iosGuide) iosGuide.style.display = "none";
    }
    
    banner.hidden = false;

    const onClick = async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "install") {
        if (typeof onInstall !== "function") {
          try {
            alert("請使用瀏覽器選單的「安裝應用程式」或「加入主畫面」來安裝。");
          } catch {}
          return;
        }
        const didPrompt = await onInstall();
        if (didPrompt === false) return;
        banner.hidden = true;
        dismiss();
        cleanup();
        return;
      }
      banner.hidden = true;
      dismiss();
      cleanup();
    };

    const cleanup = () => {
      if (banner._nwPwaInstallOnClick) banner.removeEventListener("click", banner._nwPwaInstallOnClick);
      banner._nwPwaInstallOnClick = null;
    };
    if (banner._nwPwaInstallOnClick) banner.removeEventListener("click", banner._nwPwaInstallOnClick);
    banner._nwPwaInstallOnClick = onClick;
    banner.addEventListener("click", onClick);
  }
  
  // 为 iOS 设备显示 PWA 安装提示（iOS 不支持 beforeinstallprompt 事件）
  function showIOSInstallPrompt() {
    if (!isIOSSafari()) return;
    if (isStandalone()) return;
    if (!shouldShow()) return;
    
    // 延迟一小段时间显示，让页面先加载完成
    setTimeout(() => {
      showBanner(null);
    }, 1500);
  }

  function isLocalhost() {
    try {
      const h = String(location.hostname || "").trim().toLowerCase();
      return h === "localhost" || h === "127.0.0.1";
    } catch {
      return false;
    }
  }
  
  function isIOS() {
    try {
      const ua = String(navigator.userAgent || "").toLowerCase();
      return /iphone|ipad|ipod/.test(ua);
    } catch {
      return false;
    }
  }
  
  function isIOSSafari() {
    try {
      const ua = String(navigator.userAgent || "").toLowerCase();
      return isIOS() && /safari/.test(ua) && !/crios|fxios|opios|edgios/.test(ua);
    } catch {
      return false;
    }
  }

  window.addEventListener("load", () => {
    updateForcePortrait();
    updateOrientationLock();
    initProfileModal();
    window.nwConfirm = confirmDialog;

    // 为 iOS 设备显示安装提示
    showIOSInstallPrompt();
    setTimeout(() => {
      if (isIOSSafari()) return;
      if (!isPhoneLike()) return;
      showBanner(async () => {
        if (!deferredPrompt) {
          try {
            alert("請使用瀏覽器選單的「安裝應用程式」或「加入主畫面」來安裝。");
          } catch {}
          return false;
        }
        deferredPrompt.prompt();
        try {
          await deferredPrompt.userChoice;
        } catch {}
        deferredPrompt = null;
        return true;
      });
    }, 1500);

    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js").then((reg) => {
        const isLocal = isLocalhost();
        if (!isLocal) reg.update().catch(() => {});

        if (!isLocal && reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              if (!isLocalhost() && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      }).catch(() => {});
  });

  // 多個事件監聽確保方向鎖定
  const orientationEvents = ["resize", "orientationchange", "fullscreenchange", "webkitfullscreenchange"];
  
  orientationEvents.forEach(eventName => {
    window.addEventListener(eventName, () => {
      updateForcePortrait();
      updateOrientationLock();
    });
  });
  
  // 定期嘗試重新鎖定方向（防止某些瀏覽器解鎖）
  if (isPhoneLike()) {
    setInterval(() => {
      if (isStandalone()) {
        updateOrientationLock();
      }
    }, 2000); // 每 2 秒檢查一次
  }

  let didReloadForSw = false;
  navigator.serviceWorker?.addEventListener?.("controllerchange", () => {
    if (isLocalhost()) return;
    if (didReloadForSw) return;
    didReloadForSw = true;
    location.reload();
  });

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    if (!shouldInterceptInstallPrompt()) return;
    e.preventDefault();
    deferredPrompt = e;
    showBanner(async () => {
      if (!deferredPrompt) return false;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch {}
      deferredPrompt = null;
      return true;
    });
  });

  window.addEventListener("appinstalled", () => {
    dismiss();
  });
})();
