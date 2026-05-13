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

  function initUserMenu() {
    const btn = document.getElementById("btnUserMenu");
    const menu = document.getElementById("userMenu");
    if (!btn || !menu) return;

    const close = () => {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    };

    const open = () => {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    };

    const toggle = () => {
      if (menu.hidden) open();
      else close();
    };

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });

    document.addEventListener("click", (e) => {
      if (menu.hidden) return;
      if (btn.contains(e.target) || menu.contains(e.target)) return;
      close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
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
      initUserMenu();
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
