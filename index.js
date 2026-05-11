(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  const auth = firebase.auth();

  const routes = Object.freeze({
    admin: "system.html",
    community: "admin.html#community/community-dashboard",
    resident: "member.html",
  });
  const ADMIN_EMAILS = new Set(["nwapp.eason@gmail.com"]);

  const statusEl = document.getElementById("status");
  const loginForm = document.getElementById("loginForm");
  const btnLogin = document.getElementById("btnLogin");
  const rememberEl = document.getElementById("rememberMe");
  const btnApply = document.getElementById("btnApply");
  const btnTogglePassword = document.getElementById("btnTogglePassword");

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", Boolean(isError));
  }

  function setBusy(isBusy) {
    btnLogin.disabled = Boolean(isBusy);
  }

  function goTo(url) {
    window.location.href = String(url || "index.html");
  }

  if (btnApply) {
    btnApply.addEventListener("click", () => {
      setStatus("請聯絡管理員申請帳號。", false);
    });
  }

  if (btnTogglePassword) {
    btnTogglePassword.addEventListener("click", () => {
      const input = document.getElementById("password");
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
    });
  }

  function normalizeRole(input) {
    const r = String(input || "").trim().toLowerCase();
    if (r === "admin" || r === "community" || r === "resident") return r;
    return "";
  }

  function inferRoleFromEmail(email) {
    const e = String(email || "").trim().toLowerCase();
    if (!e) return "";
    if (ADMIN_EMAILS.has(e)) return "admin";
    if (e.includes("admin") || e.includes("system") || e.includes("sys")) return "admin";
    if (e.includes("community") || e.includes("comm")) return "community";
    if (e.includes("resident") || e.includes("member")) return "resident";
    return "resident";
  }

  async function resolveRole(user, emailHint) {
    try {
      const token = await user.getIdTokenResult();
      const claimRole = normalizeRole(token && token.claims ? token.claims.role : "");
      if (claimRole) return claimRole;
      const claimRoles = token && token.claims ? token.claims.roles : null;
      if (Array.isArray(claimRoles)) {
        const found = claimRoles.map(normalizeRole).find(Boolean);
        if (found) return found;
      }
    } catch {}
    return inferRoleFromEmail(emailHint || (user ? user.email : ""));
  }

  function showAdminDestinationModal() {
    return new Promise((resolve) => {
      const backdrop = document.getElementById("adminModalBackdrop");
      if (!backdrop) {
        resolve({ role: "admin", url: routes.admin });
        return;
      }

      const buttons = Array.from(backdrop.querySelectorAll("[data-admin-go]"));
      const onPick = (key) => {
        cleanup();
        if (key === "admin") resolve({ role: "community", url: routes.community });
        else if (key === "member") resolve({ role: "resident", url: routes.resident });
        else resolve({ role: "admin", url: routes.admin });
      };

      const onClick = (e) => {
        const t = e.target && e.target.closest ? e.target.closest("[data-admin-go]") : null;
        if (!t) return;
        const key = t.getAttribute("data-admin-go");
        onPick(String(key || ""));
      };

      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
      };

      const cleanup = () => {
        backdrop.removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKeyDown, true);
        backdrop.hidden = true;
        document.body.style.overflow = "";
      };

      document.body.style.overflow = "hidden";
      backdrop.hidden = false;
      backdrop.addEventListener("click", onClick);
      document.addEventListener("keydown", onKeyDown, true);
      if (buttons[0]) buttons[0].focus();
    });
  }

  let didAutoRedirect = false;

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setBusy(true);
    setStatus("登入中...", false);

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      const remember = Boolean(rememberEl && rememberEl.checked);
      const persistence = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(persistence);
      const cred = await auth.signInWithEmailAndPassword(email, password);
      const user = cred && cred.user ? cred.user : auth.currentUser;
      const role = await resolveRole(user, email);

      if (role === "admin") {
        const picked = await showAdminDestinationModal();
        sessionStorage.setItem("csp_role", picked.role);
        setStatus("登入成功，導向中...", false);
        goTo(picked.url);
        return;
      }

      const url = routes[role] || routes.resident;
      sessionStorage.setItem("csp_role", role);
      setStatus("登入成功，導向中...", false);
      goTo(url);
    } catch (err) {
      const code = String(err && err.code ? err.code : "");
      const msg =
        code === "auth/invalid-credential" ? "帳號或密碼錯誤。" :
        code === "auth/user-not-found" ? "找不到此帳號。" :
        code === "auth/wrong-password" ? "密碼錯誤。" :
        code === "auth/too-many-requests" ? "嘗試次數過多，請稍後再試。" :
        "登入失敗，請確認帳號密碼。";
      setStatus(msg, true);
    } finally {
      setBusy(false);
    }
  });

  auth.onAuthStateChanged((user) => {
    if (!user || didAutoRedirect) return;
    didAutoRedirect = true;
    (async () => {
      const role = await resolveRole(user, user.email);
      if (role === "admin") {
        const picked = await showAdminDestinationModal();
        sessionStorage.setItem("csp_role", picked.role);
        goTo(picked.url);
        return;
      }
      const url = routes[role] || routes.resident;
      sessionStorage.setItem("csp_role", role);
      goTo(url);
    })();
  });
})();
