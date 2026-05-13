(() => {
  const DISMISS_KEY = "nw_pwa_install_dismissed_v1";
  const DISMISS_DAYS = 30;

  function updateForcePortrait() {
    const hasTouch = typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) <= 900;
    const isMobileLike = hasTouch && smallScreen;
    const isLandscape = window.innerWidth > window.innerHeight;
    document.documentElement.classList.toggle("force-portrait", Boolean(isMobileLike && isLandscape));
  }

  function isStandalone() {
    return window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
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
        <div class="logo" aria-hidden="true"><img src="logo.svg" alt="" /></div>
        <div class="meta">
          <div class="title">安裝「西北守護星」</div>
          <div class="sub">加入主畫面後可像 App 一樣使用</div>
        </div>
      </div>
      <div class="row2">
        <button class="btn" type="button" data-action="later">稍後</button>
        <button class="btn btn-primary" type="button" data-action="install">安裝應用程式</button>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function initProfileModal() {
    const btn = document.getElementById("btnUserMenu");
    const modal = document.getElementById("profileModal");
    if (!btn || !modal) return;

    const backdrop = modal.querySelector("[data-modal-close]");
    const closeBtn = document.getElementById("btnCloseProfileModal");
    const closeBtnFt = document.getElementById("btnCloseProfileModalFt");
    const roleEl = document.getElementById("profileRole");
    const nameInput = document.getElementById("profileName");
    const statusEl = document.getElementById("profileStatus");
    const profileAvatar = document.getElementById("profileAvatarFallback");
    const headerAvatar = document.getElementById("userAvatarFallback");

    const getRoleText = () => {
      const r = String(sessionStorage.getItem("csp_role") || "").trim().toLowerCase();
      if (r === "admin") return "系統管理員";
      if (r === "community") return "社區";
      if (r === "resident") return "住戶";
      return "—";
    };

    const pickInitial = (displayName, email) => {
      const s = String(displayName || "").trim() || String(email || "").trim();
      return s ? s.slice(0, 1).toUpperCase() : "U";
    };

    const showStatus = (msg, isError) => {
      if (!statusEl) return;
      statusEl.textContent = String(msg || "");
      statusEl.hidden = !msg;
      statusEl.classList.toggle("error", Boolean(isError));
    };

    const ensureDb = () => {
      const fb = window.firebase;
      if (!fb || !fb.firestore) return null;
      const db = fb.firestore();
      try {
        db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
      } catch {}
      return db;
    };

    const loadProfile = async (user) => {
      if (!user) return;
      if (roleEl) roleEl.textContent = getRoleText();
      const initial = pickInitial(user.displayName, user.email);
      if (profileAvatar) profileAvatar.textContent = initial;
      if (headerAvatar) headerAvatar.textContent = initial;

      const db = ensureDb();
      if (!db) return;
      const doc = await db.collection("users").doc(String(user.uid)).get();
      const data = doc && doc.exists ? (doc.data() || {}) : {};
      const displayName = String(data.displayName || user.displayName || "").trim();
      if (nameInput) nameInput.value = displayName;
      const initial2 = pickInitial(displayName, user.email);
      if (profileAvatar) profileAvatar.textContent = initial2;
      if (headerAvatar) headerAvatar.textContent = initial2;
    };

    const saveName = async () => {
      const fb = window.firebase;
      const user = fb && fb.auth ? fb.auth().currentUser : null;
      if (!user || !nameInput) return;
      const name = String(nameInput.value || "").trim();
      const db = ensureDb();
      if (!db) return;
      showStatus("儲存中...", false);
      try {
        await db.collection("users").doc(String(user.uid)).set(
          { displayName: name, updatedAt: fb.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        showStatus("已儲存。", false);
        const initial = pickInitial(name, user.email);
        if (profileAvatar) profileAvatar.textContent = initial;
        if (headerAvatar) headerAvatar.textContent = initial;
      } catch {
        showStatus("儲存失敗。", true);
      }
    };

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
        if (nameInput) nameInput.focus();
      });
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });

    if (backdrop) backdrop.addEventListener("click", close);
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (closeBtnFt) closeBtnFt.addEventListener("click", close);
    if (nameInput) nameInput.addEventListener("blur", () => saveName());
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
    banner.hidden = false;

    const onClick = async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-action]") : null;
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "install") {
        await onInstall?.();
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
      banner.removeEventListener("click", onClick);
    };
    banner.addEventListener("click", onClick);
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      updateForcePortrait();
      initProfileModal();
      window.nwConfirm = confirmDialog;
      navigator.serviceWorker.register("./sw.js").then((reg) => {
        reg.update().catch(() => {});

        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      }).catch(() => {});
    });
  }

  window.addEventListener("resize", () => updateForcePortrait());
  window.addEventListener("orientationchange", () => updateForcePortrait());

  let didReloadForSw = false;
  navigator.serviceWorker?.addEventListener?.("controllerchange", () => {
    if (didReloadForSw) return;
    didReloadForSw = true;
    location.reload();
  });

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner(async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } catch {}
      deferredPrompt = null;
    });
  });

  window.addEventListener("appinstalled", () => {
    dismiss();
  });
})();
