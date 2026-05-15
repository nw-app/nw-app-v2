(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  const auth = firebase.auth();
  const db = typeof firebase.firestore === "function" ? firebase.firestore() : null;
  if (db) {
    try {
      db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
    } catch {}
  }

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
    if (r === "系統管理員" || r === "系統管理者" || r === "系統") return "admin";
    if (r === "社區") return "community";
    if (r === "住戶") return "resident";
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

  function isAdminRole(role) {
    return String(role || "").trim().toLowerCase() === "admin";
  }

  async function resolveCommunityEnabled(communityIdOrCode) {
    const raw = String(communityIdOrCode || "").trim();
    if (!db || !raw || raw === "default") return true;
    try {
      const doc = await db.collection("communities").doc(raw).get();
      if (doc && doc.exists) {
        const data = doc.data() || {};
        return data.enabled !== false;
      }
    } catch {}
    try {
      const snap = await db.collection("communities").where("username", "==", raw).limit(1).get();
      const doc = snap && snap.docs && snap.docs[0] ? snap.docs[0] : null;
      if (doc && doc.exists) {
        const data = doc.data() || {};
        return data.enabled !== false;
      }
    } catch {}
    return true;
  }

  async function enforceLoginEnabled(user, role, lookupCommunityIdOrCode) {
    if (!user || !db) return { ok: true };
    let data = null;
    try {
      const doc = await db.collection("users").doc(String(user.uid)).get();
      data = doc && doc.exists ? (doc.data() || {}) : null;
    } catch {}

    if (data && data.enabled === false) {
      try { await auth.signOut(); } catch {}
      try { sessionStorage.removeItem("csp_role"); } catch {}
      return { ok: false, message: "目前您的帳號已停用" };
    }

    if (isAdminRole(role)) return { ok: true };

    const communityKey = String((data && data.community ? data.community : "") || lookupCommunityIdOrCode || "").trim();
    if (!communityKey || communityKey === "default") return { ok: true };
    const enabled = await resolveCommunityEnabled(communityKey);
    if (!enabled) {
      try { await auth.signOut(); } catch {}
      try { sessionStorage.removeItem("csp_role"); } catch {}
      return { ok: false, message: "目前您的社區APP服務已停用" };
    }
    return { ok: true };
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

    if (user && db) {
      try {
        const doc = await db.collection("users").doc(String(user.uid)).get();
        const data = doc && doc.exists ? (doc.data() || {}) : {};
        const fromDoc = normalizeRole(data.role);
        if (fromDoc) return fromDoc;
      } catch {}
      try {
        const snap = await db.collection("user_lookup").where("uid", "==", String(user.uid)).limit(1).get();
        const data = snap && snap.docs && snap.docs[0] ? (snap.docs[0].data() || {}) : {};
        const fromLookup = normalizeRole(data.role);
        if (fromLookup) return fromLookup;
      } catch {}
    }

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

  async function resolveLookupForLogin(loginId) {
    const raw = String(loginId || "").trim();
    if (!raw) return { email: "", community: "", communityCode: "", phoneNormalized: "" };
    if (raw.includes("@")) return { email: raw, community: "", communityCode: "", phoneNormalized: "" };
    if (!db) return { email: "", community: "", communityCode: "", phoneNormalized: "" };

    let normalized = raw.replace(/\D/g, "");
    if (normalized.startsWith("886") && normalized.length === 12) normalized = `0${normalized.slice(3)}`;
    if (!normalized) return { email: "", community: "", communityCode: "", phoneNormalized: "" };
    try {
      const doc = await db.collection("user_lookup").doc(normalized).get();
      const data = doc && doc.exists ? (doc.data() || {}) : {};
      const email = String(data.email || "").trim();
      const community = String(data.community || "").trim();
      const communityCode = String(data.communityCode || "").trim();
      if (email) return { email, community, communityCode, phoneNormalized: normalized };
    } catch {}
    return { email: "", community: "", communityCode: "", phoneNormalized: normalized };
  }

  async function resolveCommunityKey(communityIdOrCode) {
    const raw = String(communityIdOrCode || "").trim();
    if (!raw || raw === "default") return "";
    if (!db) return raw;
    try {
      const byId = await db.collection("communities").doc(raw).get();
      if (byId && byId.exists) {
        const data = byId.data() || {};
        const code = String(data.username || "").trim();
        return code || raw;
      }
    } catch {}
    try {
      const snap = await db.collection("communities").where("username", "==", raw).limit(1).get();
      const doc = snap && snap.docs && snap.docs[0] ? snap.docs[0] : null;
      if (doc && doc.exists) {
        const data = doc.data() || {};
        const code = String(data.username || "").trim();
        return code || raw;
      }
    } catch {}
    return raw;
  }

  async function resolveCommunityAndUrl(user, role, defaultUrl) {
    if (!user || !db || role === "admin") return defaultUrl;
    try {
      const doc = await db.collection("users").doc(user.uid).get();
      if (doc && doc.exists) {
        const data = doc.data() || {};
        const cidRaw = String(data.community || "").trim();
        const cKey = await resolveCommunityKey(cidRaw);
        if (cKey) {
          if (role === "community") return `admin.html?c=${cKey}#community/community-dashboard`;
          return `member.html?c=${cKey}`;
        }
      }
    } catch {}
    try {
      const snap = await db.collection("user_lookup").where("uid", "==", String(user.uid)).limit(1).get();
      const d = snap && snap.docs && snap.docs[0] ? snap.docs[0].data() || {} : {};
      const cKey = String(d.communityCode || "").trim() || String(d.community || "").trim();
      if (cKey && cKey !== "default") {
        if (role === "community") return `admin.html?c=${cKey}#community/community-dashboard`;
        return `member.html?c=${cKey}`;
      }
    } catch {}
    return defaultUrl;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setBusy(true);
    setStatus("登入中...", false);

    const loginId = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      const remember = Boolean(rememberEl && rememberEl.checked);
      const persistence = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
      await auth.setPersistence(persistence);
      const lookup = await resolveLookupForLogin(loginId);
      const email = String(lookup && lookup.email ? lookup.email : "").trim();
      const lookupCommunity = String(lookup && lookup.community ? lookup.community : "").trim();
      const lookupCommunityCode = String(lookup && lookup.communityCode ? lookup.communityCode : "").trim();
      if (!email) {
        setStatus(db ? "找不到此手機號碼或電子郵件對應的帳號。" : "目前版本不支援手機號碼登入，請改用電子郵件登入或重新整理更新。", true);
        return;
      }
      const cred = await auth.signInWithEmailAndPassword(email, password);
      const user = cred && cred.user ? cred.user : auth.currentUser;
      const role = await resolveRole(user, email);
      const gate = await enforceLoginEnabled(user, role, lookupCommunityCode || lookupCommunity);
      if (!gate.ok) {
        setStatus(gate.message, true);
        return;
      }

      if (role === "admin") {
        const picked = await showAdminDestinationModal();
        sessionStorage.setItem("csp_role", picked.role);
        setStatus("登入成功，導向中...", false);
        goTo(picked.url);
        return;
      }

      let url = routes[role] || routes.resident;
      const cKey = lookupCommunityCode || (lookupCommunity ? await resolveCommunityKey(lookupCommunity) : "");
      if (cKey) {
        try {
          sessionStorage.setItem("csp_last_cid", cKey);
        } catch {}
        if (role === "community") url = `admin.html?c=${cKey}#community/community-dashboard`;
        else if (role === "resident") url = `member.html?c=${cKey}`;
      } else {
        url = await resolveCommunityAndUrl(user, role, url);
      }
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
      const gate = await enforceLoginEnabled(user, role, "");
      if (!gate.ok) {
        setStatus(gate.message, true);
        didAutoRedirect = false;
        return;
      }
      if (role === "admin") {
        const picked = await showAdminDestinationModal();
        sessionStorage.setItem("csp_role", picked.role);
        goTo(picked.url);
        return;
      }
      let url = routes[role] || routes.resident;
      try {
        const lastCid = String(sessionStorage.getItem("csp_last_cid") || "").trim();
        if (lastCid && lastCid !== "default") {
          if (role === "community") url = `admin.html?c=${lastCid}#community/community-dashboard`;
          else if (role === "resident") url = `member.html?c=${lastCid}`;
        } else {
          url = await resolveCommunityAndUrl(user, role, url);
        }
      } catch {
        url = await resolveCommunityAndUrl(user, role, url);
      }
      sessionStorage.setItem("csp_role", role);
      goTo(url);
    })();
  });
})();
