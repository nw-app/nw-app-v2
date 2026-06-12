(() => {
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
  const STORAGE_LAST_PAGE = "csp_system_page_v1";
  const STORAGE_AREA_FILTER = "csp_community_area_filter_v1";
  const PAGES = ["accounts", "community", "links"];

  const state = {
      communities: [],
      configByCommunityId: new Map(),
      unsubCommunities: null,
      unsubConfig: null,
      unsubResidents: null,
      currentPage: "accounts",
      communityAreaFilter: "住戶",
      accountsRoleView: "resident",
    };

  try {
    const raw = String(location.hash || "").replace(/^#/, "");
    const seg = raw ? raw.split(/[/?]/)[0] : "";
    if (PAGES.includes(seg)) state.currentPage = seg;
  } catch {}
  try {
    if (!state.currentPage || state.currentPage === "accounts") {
      const savedPage = String(localStorage.getItem(STORAGE_LAST_PAGE) || "");
      if (PAGES.includes(savedPage)) state.currentPage = savedPage;
    }
  } catch {}
  try {
    const savedArea = String(localStorage.getItem(STORAGE_AREA_FILTER) || "");
    if (["住戶"].includes(savedArea)) {
      state.communityAreaFilter = savedArea;
    } else {
      // 如果没有保存过，默认使用住戶
      state.communityAreaFilter = "住戶";
    }
  } catch {
    state.communityAreaFilter = "住戶";
  }

  const catalogCommunityButtons = [
    { id: "parcel", name: "包裹郵件", defaultUrl: "#community/parcel" },
    { id: "visitor", name: "訪客登記", defaultUrl: "#community/visitor" },
    { id: "residents", name: "住戶造冊", defaultUrl: "#community/residents" },
    { id: "facility", name: "設施預約", defaultUrl: "#community/facility" },
    { id: "bulletin", name: "公告系統", defaultUrl: "#community/bulletin" },
    { id: "parking", name: "綠色停車", defaultUrl: "#community/parking" },
  ];

  const catalogResidentButtons = [
    { id: "resident-bulletin", name: "通知", defaultUrl: "#resident/resident-bulletin" },
  ];

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

  function defaultConfig() {
    const toButton = (x) => ({ enabled: true, url: x.defaultUrl });
    return {
      communityButtons: Object.fromEntries(catalogCommunityButtons.map((x) => [x.id, toButton(x)])),
      residentButtons: Object.fromEntries(catalogResidentButtons.map((x) => [x.id, toButton(x)])),
      rowDButtons: defaultRowDButtons.map(b => ({ ...b })),
      rowFButtons: defaultRowFButtons.map(b => ({ ...b })),
    };
  }

  function configKey(communityId) {
    return `${STORAGE_CONFIG}:${String(communityId || "default")}`;
  }

  function configDocRef(communityId) {
    return db.collection("communities").doc(String(communityId || "default")).collection("settings").doc("app_config");
  }

  function loadActiveCommunityId(accounts) {
    const saved = localStorage.getItem(STORAGE_ACTIVE_COMMUNITY);
    const list = accounts && Array.isArray(accounts.communities) ? accounts.communities : [];
    const first = list.find((x) => x && x.enabled)?.id || list[0]?.id || "";
    if (saved && list.some((x) => x && x.id === saved)) return saved;
    if (first) {
      localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, first);
      return first;
    }
    return "default";
  }

  function setActiveCommunityId(id) {
    const v = String(id || "").trim();
    if (!v) return;
    localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, v);
  }

  function loadConfig(communityId) {
    try {
      const raw = state.configByCommunityId.get(String(communityId || "default")) || null;
      const parsed = raw && typeof raw === "object" ? raw : {};
      const d = defaultConfig();
      return {
        communityButtons: { ...d.communityButtons, ...(parsed.communityButtons || {}) },
        residentButtons: { ...d.residentButtons, ...(parsed.residentButtons || {}) },
        rowDButtons: parsed.rowDButtons || d.rowDButtons,
        rowFButtons: parsed.rowFButtons || d.rowFButtons,
      };
    } catch {
      return defaultConfig();
    }
  }

  async function saveConfig(cfg, communityId) {
    const cid = String(communityId || "default");
    await configDocRef(cid).set(
      {
        communityButtons: cfg && cfg.communityButtons ? cfg.communityButtons : {},
        residentButtons: cfg && cfg.residentButtons ? cfg.residentButtons : {},
        rowDButtons: cfg && cfg.rowDButtons ? cfg.rowDButtons : [],
        rowFButtons: cfg && cfg.rowFButtons ? cfg.rowFButtons : [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  function loadAccounts() {
    return { communities: state.communities, residents: [] };
  }

  function normalizeText(v) {
    return String(v || "").trim();
  }

  function setBusy(isBusy) {
    document.querySelectorAll("button, input, select, textarea").forEach((el) => {
      if (el.id === "btnSignOut") return;
      el.disabled = Boolean(isBusy);
    });
  }

  function setNavCurrent(page) {
    document.querySelectorAll("#nav button").forEach((b) => b.setAttribute("aria-current", b.dataset.page === page ? "page" : "false"));
  }

  function renderLinks() {
    const host = document.getElementById("content");
    host.innerHTML = "";
    const node = document.getElementById("tplLinks").content.cloneNode(true);
    host.appendChild(node);

    const accounts = loadAccounts();
    const activeCommunityId = loadActiveCommunityId(accounts);
    const activeCommunityName = accounts.communities.find((c) => c.id === activeCommunityId)?.name || activeCommunityId;
    const cfg = loadConfig(activeCommunityId);
    const renderGroup = (containerId, items, storeKey) => {
      const container = document.getElementById(containerId);
      container.innerHTML = items.map((x) => {
        const v = cfg[storeKey]?.[x.id] || { enabled: true, url: x.defaultUrl };
        return `
              <div class="link-row">
                <div class="field">
                  <label>功能</label>
                  <input type="text" value="${x.name}" readonly />
                </div>
                <div class="field">
                  <label>狀態</label>
                  <select data-link-enabled="${storeKey}:${x.id}">
                    <option value="true" ${v.enabled ? "selected" : ""}>啟用</option>
                    <option value="false" ${!v.enabled ? "selected" : ""}>停用</option>
                  </select>
                </div>
                <div class="field">
                  <label>連結</label>
                  <input type="text" value="${v.url || ""}" placeholder="${x.defaultUrl}" data-link-url="${storeKey}:${x.id}" />
                </div>
              </div>
            `;
      }).join("");
    };

    renderGroup("communityLinks", catalogCommunityButtons, "communityButtons");
    renderGroup("residentLinks", catalogResidentButtons, "residentButtons");

    document.getElementById("btnSaveLinks").addEventListener("click", async () => {
      const next = loadConfig(activeCommunityId);
      document.querySelectorAll("[data-link-enabled]").forEach((el) => {
        const [storeKey, id] = el.getAttribute("data-link-enabled").split(":");
        next[storeKey][id] = next[storeKey][id] || {};
        next[storeKey][id].enabled = el.value === "true";
      });
      document.querySelectorAll("[data-link-url]").forEach((el) => {
        const [storeKey, id] = el.getAttribute("data-link-url").split(":");
        next[storeKey][id] = next[storeKey][id] || {};
        next[storeKey][id].url = normalizeText(el.value);
      });
      setBusy(true);
      const s = document.getElementById("linksStatus");
      try {
        await saveConfig(next, activeCommunityId);
        s.textContent = `已儲存設定（社區：${activeCommunityName}）。`;
        s.classList.remove("error");
      } catch {
        s.textContent = "儲存失敗，請稍後再試。";
        s.classList.add("error");
      } finally {
        setBusy(false);
      }
    });
  }

  function renderAccounts() {
    const host = document.getElementById("content");
    host.innerHTML = "";
    const node = document.getElementById("tplAccounts").content.cloneNode(true);
    host.appendChild(node);

    const communitySelect = document.getElementById("r_community");
    const accountsCommunityField = document.getElementById("field_accounts_community");
    const statusEl = document.getElementById("acctStatus");
    const addBtn = document.getElementById("btnAddResident");
    const modal = document.getElementById("residentModal");
    const modalTitleEl = document.getElementById("residentModalTitle");
    const modalRoleNameEl = document.getElementById("residentRoleName");
    const form = document.getElementById("residentModalForm");
    const submitBtn = document.getElementById("btnSubmitResidentModal");
    const modalStatus = document.getElementById("residentModalStatus");
    const inputCategory = document.getElementById("modal_r_category");
    const fieldCategory = document.getElementById("field_r_category");
    const inputCommunity = document.getElementById("modal_r_community");
    const inputUnit = document.getElementById("modal_r_unit");
    const inputName = document.getElementById("modal_r_name");
    const inputEmail = document.getElementById("modal_r_email");
    const inputPhone = document.getElementById("modal_r_phone");
    const inputPassword = document.getElementById("modal_r_password");
    const inputAddress = document.getElementById("modal_r_address");
    const inputEnabled = document.getElementById("modal_r_enabled");
    const unitMatchBadge = document.getElementById("unitMatchBadge");
    const avatarUploader = document.getElementById("residentAvatarUploader");
    const avatarInput = document.getElementById("residentAvatarInput");
    const avatarPreview = document.getElementById("residentAvatarPreview");
    const avatarPlaceholder = document.getElementById("residentAvatarPlaceholder");
    const rolesWrap = document.getElementById("modal_r_roles");
    const roleOtherChk = document.getElementById("modal_r_role_other_chk");
    const roleOtherText = document.getElementById("modal_r_role_other_text");
    const fieldCommunity = document.getElementById("field_r_community");
    const fieldUnit = document.getElementById("field_r_unit");
    const fieldRoles = document.getElementById("field_r_roles");
    const fieldAddress = document.getElementById("field_r_address");
    const cancelBtn = document.getElementById("btnCancelResidentModal");
    const closeBtn = document.getElementById("btnCloseResidentModal");
    const backdrop = modal ? modal.querySelector("[data-modal-close]") : null;
    let detachKeydown = () => {};
    let unitTouched = false;
    let avatarFile = null;
    let avatarPreviewData = "";
    let editUserId = "";
    let modalRoleView = "resident";
    let forceCreateUser = false;

    const getCommunityOptions = () => {
      const list = state.communities || [];
      return list;
    };

    const resolveUnits = () => {
      const cid = normalizeText(inputCommunity ? inputCommunity.value : "") || normalizeText(communitySelect.value || "");
      const c = (state.communities || []).find((x) => String(x?.id || "") === String(cid || ""));
      return c && Array.isArray(c.units) ? c.units : [];
    };

    const updateUnitMatch = () => {
      if (!unitMatchBadge || !inputUnit) return;
      if (!unitTouched) {
        unitMatchBadge.classList.remove("show");
        unitMatchBadge.hidden = true;
        unitMatchBadge.style.display = "none";
        return;
      }
      const unit = normalizeText(inputUnit.value);
      const units = resolveUnits();
      const ok = Boolean(unit) && units.some((x) => {
        const uid = (typeof x === "object" && x !== null) ? String(x.id || "") : String(x || "");
        return uid.trim().toLowerCase() === unit.toLowerCase();
      });
      unitMatchBadge.hidden = !ok;
      unitMatchBadge.classList.toggle("show", ok);
      unitMatchBadge.style.display = ok ? "inline-flex" : "none";
    };

    const readResidentRoles = () => {
      const picked = new Set();
      if (rolesWrap) {
        rolesWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => {
          if (el.checked) picked.add(String(el.value || ""));
        });
      }
      const otherEnabled = roleOtherChk && roleOtherChk.checked;
      const otherText = normalizeText(roleOtherText ? roleOtherText.value : "");
      const roles = Array.from(picked).filter(Boolean);
      const extra = otherEnabled ? otherText : "";
      return { roles, extra };
    };

    const syncOtherRoleInput = () => {
      if (!roleOtherText || !roleOtherChk) return;
      roleOtherText.hidden = !roleOtherChk.checked;
      if (!roleOtherChk.checked) roleOtherText.value = "";
    };

    const sha256Hex = async (text) => {
      const v = String(text || "");
      const cryptoObj = window.crypto && window.crypto.subtle ? window.crypto : null;
      if (!cryptoObj) return "";
      const data = new TextEncoder().encode(v);
      const hashBuf = await cryptoObj.subtle.digest("SHA-256", data);
      const bytes = Array.from(new Uint8Array(hashBuf));
      return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const normalizePhoneDigits = (input) => {
      const raw = String(input || "").trim();
      let digits = raw.replace(/\D/g, "");
      if (!digits) return "";
      if (digits.startsWith("886") && digits.length === 12) digits = `0${digits.slice(3)}`;
      return digits;
    };

    const getSecondaryAuth = () => {
      const fb = window.firebase;
      if (!fb || !firebaseConfig) return null;
      try {
        return fb.app("nwapp-secondary").auth();
      } catch {
        try {
          return fb.initializeApp(firebaseConfig, "nwapp-secondary").auth();
        } catch {
          return null;
        }
      }
    };

    const createAuthUser = async (email, password) => {
      const a = getSecondaryAuth();
      if (!a) throw new Error("no-secondary-auth");
      const cred = await a.createUserWithEmailAndPassword(String(email || ""), String(password || ""));
      const u = cred && cred.user ? cred.user : null;
      const uid = u && u.uid ? String(u.uid) : "";
      if (!uid) throw new Error("no-uid");
      return { uid, auth: a, user: u };
    };

    const upsertUserLookup = async ({ phoneNormalized, email, phone, uid, community, communityCode, role }) => {
      const key = normalizePhoneDigits(phoneNormalized);
      if (!key) return;
      await db.collection("user_lookup").doc(key).set(
        {
          uid: String(uid || ""),
          email: String(email || ""),
          phone: String(phone || ""),
          phoneNormalized: key,
          community: String(community || ""),
          communityCode: String(communityCode || ""),
          role: String(role || ""),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    };

    const setAvatarPreview = (dataUrl) => {
      avatarPreviewData = String(dataUrl || "");
      if (avatarPreview) {
        avatarPreview.src = avatarPreviewData || "";
        avatarPreview.style.display = avatarPreviewData ? "block" : "none";
      }
      if (avatarPlaceholder) avatarPlaceholder.style.display = avatarPreviewData ? "none" : "block";
    };

    const fileToAvatarDataUrl = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read-failed"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("image-decode-failed"));
        img.onload = () => {
          const target = 360;
          const srcW = img.naturalWidth || 0;
          const srcH = img.naturalHeight || 0;
          if (!srcW || !srcH) {
            reject(new Error("bad-image"));
            return;
          }
          const side = Math.min(srcW, srcH);
          const sx = Math.round((srcW - side) / 2);
          const sy = Math.round((srcH - side) / 2);
          const canvas = document.createElement("canvas");
          canvas.width = target;
          canvas.height = target;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("no-canvas"));
            return;
          }
          ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });

    const setOptions = () => {
      const list = getCommunityOptions();
      
      // For main community select (always show "全部" as default)
      const html = 
        `<option value="" selected>全部</option>` + 
        list.map((c) => `<option value="${c.id}">${c.name || c.id}</option>`).join("");
      communitySelect.innerHTML = html;
      
      // For modal community select (without default option)
      if (inputCommunity) {
        const modalHtml = list.map((c) => `<option value="${c.id}">${c.name || c.id}</option>`).join("");
        inputCommunity.innerHTML = modalHtml;
      }
      
      return list;
    };

    const optionList = setOptions();
    // Always default to "全部" (empty string)
    communitySelect.value = "";

    let currentUsers = [];

    const matchesRole = (docRole, view) => {
      const r = String(docRole || "");
      if (view === "admin") return r === "admin" || r === "系統管理員" || r === "系統";
      if (view === "community") return r === "community" || r === "社區";
      if (!r) return true;
      return r === "resident" || r === "住戶";
    };

    const viewToRoleValue = (view) => {
      if (view === "admin") return "系統管理員";
      if (view === "community") return "社區";
      return "住戶";
    };

    const roleValueToView = (role) => {
      const r = String(role || "");
      if (matchesRole(r, "admin")) return "admin";
      if (matchesRole(r, "community")) return "community";
      return "resident";
    };

    const applyModalMode = (view) => {
      modalRoleView = viewToRoleValue(view) === "住戶" ? "resident" : view;
      const isResident = modalRoleView === "resident";
      const isCommunity = modalRoleView === "community";
      const isAdmin = modalRoleView === "admin";
      const setFieldVisible = (el, visible) => {
        if (!el) return;
        el.hidden = !visible;
        el.style.display = visible ? "" : "none";
      };
      setFieldVisible(fieldCategory, !isAdmin);
      setFieldVisible(fieldCommunity, isResident || isCommunity);
      setFieldVisible(fieldUnit, isResident);
      setFieldVisible(fieldRoles, isResident);
      setFieldVisible(fieldAddress, isResident);

      if (inputCategory) inputCategory.required = !isAdmin;
      if (inputCommunity) inputCommunity.required = Boolean(isResident || isCommunity);
      if (inputUnit) inputUnit.required = Boolean(isResident);
      if (unitMatchBadge) {
        unitMatchBadge.hidden = true;
        unitMatchBadge.classList.remove("show");
        unitMatchBadge.style.display = "none";
      }
      if (inputCategory) {
        if (isCommunity) {
          inputCategory.innerHTML = `
            <option value="管理員" selected>管理員</option>
            <option value="總幹事">總幹事</option>
            <option value="秘書">秘書</option>
          `.trim();
        } else {
          inputCategory.innerHTML = `
            <option value="住戶" selected>住戶</option>
            <option value="委員">委員</option>
          `.trim();
        }
      }
      if (modalRoleNameEl) {
        const label = modalRoleView === "admin" ? "系統管理員" : modalRoleView === "community" ? "社區" : "住戶";
        modalRoleNameEl.textContent = label;
      }
    };

    const avatarHtml = (u) => {
      const dataUrl = u && u.avatarDataUrl ? String(u.avatarDataUrl || "") : "";
      const name = String(u && (u.username || u.name) ? (u.username || u.name) : "U");
      const initial = name.trim().slice(0, 1).toUpperCase() || "U";
      return dataUrl ? `<img src="${dataUrl}" alt="">` : `<div class="fallback">${initial}</div>`;
    };

    const renderUserList = () => {
      const view = String(state.accountsRoleView || "resident");
      const activeId = communitySelect.value || "";
      const rList = document.getElementById("residentList");

      let list = [];
      if (view === "admin") {
        list = currentUsers || [];
      } else if (activeId !== "") {
        // 如果選了特定社區，只顯示該社區
        list = (currentUsers || []).filter((r) => String(r.communityId || "") === String(activeId));
      } else {
        // 沒選特定社區，顯示所有帳號
        list = currentUsers || [];
      }

      const title = view === "admin" ? "系統管理員" : view === "community" ? "社區" : "住戶";
      
      // 建立社区ID到名称的映射
      const communityMap = new Map();
      (state.communities || []).forEach(c => {
        communityMap.set(String(c.id), String(c.name || c.id));
      });
      
      rList.innerHTML = list.map((r) => {
        const unitText = String(r.unit || "").trim();
        const sub = view === "resident" && unitText ? `<div class="account-sub">${unitText}</div>` : "";
        const communityName = communityMap.get(String(r.communityId || "")) || "";
        const communityDisplay = communityName ? `<span class="tag" style="margin-left:8px;">${communityName}</span>` : "";
        return `
            <div class="item account-item">
              <div class="account-left">
                <div class="avatar-sm">${avatarHtml(r)}</div>
                <div class="account-text">
                  <div style="display:flex;align-items:center;">
                    <div class="account-name">${String(r.name || "—")}</div>
                    ${communityDisplay}
                  </div>
                  ${sub}
                  <div class="account-meta">
                    <div class="switch-label">${r.enabled ? "啟用" : "停用"}</div>
                    <label class="switch">
                      <input type="checkbox" data-toggle-user="${r.id}" ${r.enabled ? "checked" : ""} ${r.readOnly ? "disabled" : ""} />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
              </div>
              <div class="account-actions">
                <button class="icon-btn" type="button" data-edit-user="${r.id}" aria-label="編輯" title="編輯">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-.2-.2a2 2 0 0 0-2.8 0L5 17v3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
                <button class="icon-btn danger" type="button" data-delete-user="${r.id}" aria-label="刪除" title="刪除">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9 4h6l1 2h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    <path d="M6 6h12l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                    <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          `.trim();
      }).join("") || `
            <div class="item">
              <div>
                <div style="font-weight:900;">尚無${title}帳號</div>
                <div class="meta"><span class="tag">提示</span></div>
              </div>
              <span class="tag">—</span>
            </div>
          `;

      rList.querySelectorAll("[data-toggle-user]").forEach((input) => {
        input.addEventListener("change", async () => {
          const id = input.getAttribute("data-toggle-user");
          const found = (currentUsers || []).find((x) => String(x.id || "") === String(id || ""));
          if (!id || !found || found.readOnly) return;
          const prev = Boolean(found.enabled);
          setBusy(true);
          try {
            await db.collection("users").doc(String(id)).set(
              { enabled: Boolean(input.checked), updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
            found.enabled = Boolean(input.checked);
            renderUserList();
          } catch {
            input.checked = prev;
          } finally {
            setBusy(false);
          }
        });
      });
    };

    const subscribeUsers = async (communityId) => {
      if (state.unsubResidents) state.unsubResidents();
      currentUsers = [];
      const rList = document.getElementById("residentList");
      if (rList) rList.innerHTML = `<div class="status">讀取中...</div>`;
      const cid = String(communityId || "");
      const view = String(state.accountsRoleView || "resident");
      const base = db.collection("users");
      
      console.log("subscribeUsers called with:", { communityId, cid, view });
      
      let didLoad = false;
      const renderError = (msg) => {
        if (!rList) return;
        rList.innerHTML = `<div class="status error">${String(msg || "讀取失敗。")}</div>`;
      };
      
      const applySnap = (snap) => {
        didLoad = true;
        currentUsers = snap.docs.map((d) => {
          const v = d.data() || {};
          const role = String(v.role || "");
          if (!matchesRole(role, view)) return null;
          return {
            id: d.id,
            communityId: String(v.community || cid),
            unit: String(v.houseNo || v.unit || ""),
            name: String(v.displayName || v.name || ""),
            username: String(v.username || v.email || v.phone || ""),
            role: String(v.role || ""),
            email: String(v.email || ""),
            phone: String(v.phone || ""),
            address: String(v.address || ""),
            residentRoles: Array.isArray(v.residentRoles) ? v.residentRoles : [],
            residentRoleOther: String(v.residentRoleOther || ""),
            avatarDataUrl: String(v.avatarDataUrl || ""),
            enabled: v.enabled !== false,
            category: String(v.category || v.residentCategory || ""),
          };
        }).filter(Boolean);
        
        if (view === "admin") {
          const me = auth && auth.currentUser ? auth.currentUser : null;
          const email = me && me.email ? String(me.email || "").trim() : "";
          if (email) {
            const exists = currentUsers.some((u) => String(u.username || "").toLowerCase() === email.toLowerCase());
            if (!exists) {
              currentUsers.unshift({
                id: "__auth_admin__",
                communityId: "",
                unit: "",
                name: email,
                username: email,
                role: "系統管理員",
                email,
                phone: "",
                address: "",
                residentRoles: [],
                residentRoleOther: "",
                avatarDataUrl: "",
                enabled: true,
                category: "",
                readOnly: true,
              });
            }
          }
        }
        renderUserList();
      };
      
      const onError = (err) => {
        const code = String(err && err.code ? err.code : "");
        const msg =
          code.includes("permission-denied") ? "讀取失敗：沒有權限（請用系統管理員帳號登入）。" :
          code.includes("unavailable") ? "讀取失敗：連線不穩定，請稍後再試。" :
          "讀取住戶資料失敗，請稍後再試。";
        if (!didLoad) renderError(msg);
        if (statusEl) {
          statusEl.textContent = msg;
          statusEl.classList.add("error");
        }
      };
      
      const t = window.setTimeout(() => {
        if (didLoad) return;
        renderError("讀取逾時，請確認網路或重新登入後再試。");
      }, 8000);
      
      try {
        if (view === "admin") {
          const q = base.where("role", "in", ["系統管理員", "系統管理者", "系統", "admin"]);
          const snap = await q.get();
          window.clearTimeout(t);
          applySnap(snap);
        } else if (cid === "") {
          // 没选特定社区，获取所有用户
          const snap = await base.get();
          window.clearTimeout(t);
          applySnap(snap);
        } else {
          const q = base.where("community", "==", cid);
          const snap = await q.get();
          window.clearTimeout(t);
          applySnap(snap);
        }
      } catch (err) {
        window.clearTimeout(t);
        onError(err);
      }
      
      state.unsubResidents = null;
    };

    communitySelect.addEventListener("change", () => {
      if (communitySelect.value) {
        setActiveCommunityId(communitySelect.value);
      }
      subscribeUsers(communitySelect.value);
    });

    const clearModalStatus = () => {
      if (!modalStatus) return;
      modalStatus.hidden = true;
      modalStatus.textContent = "";
      modalStatus.classList.remove("error");
    };

    const showModalError = (msg) => {
      if (!modalStatus) return;
      modalStatus.hidden = false;
      modalStatus.textContent = msg;
      modalStatus.classList.add("error");
    };

    const closeModal = () => {
      if (!modal) return;
      modal.hidden = true;
      detachKeydown();
      detachKeydown = () => {};
      clearModalStatus();
    };

    const openModal = () => {
      if (!modal) return;
      setOptions();
      const cid = String(communitySelect.value || "");
      if (inputCommunity && cid) inputCommunity.value = cid;
      editUserId = "";
      forceCreateUser = false;
      applyModalMode(String(state.accountsRoleView || "resident"));
      if (modalTitleEl) modalTitleEl.setAttribute("data-mode", "create");
      if (submitBtn) submitBtn.textContent = "建立";
      if (inputCategory) {
        if (modalRoleView === "community") inputCategory.value = "管理員";
        else if (modalRoleView === "admin") inputCategory.value = "";
        else inputCategory.value = "住戶";
      }
      avatarFile = null;
      setAvatarPreview("");
      if (inputUnit) inputUnit.value = "";
      if (inputName) inputName.value = "";
      if (inputEmail) inputEmail.value = "";
      if (inputPhone) inputPhone.value = "";
      if (inputPassword) inputPassword.value = "";
      if (inputAddress) inputAddress.value = "";
      if (rolesWrap) rolesWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => (el.checked = false));
      if (roleOtherText) roleOtherText.value = "";
      syncOtherRoleInput();
      if (inputEnabled) inputEnabled.value = "true";
      clearModalStatus();
      modal.hidden = false;
      if (modalRoleView === "resident") {
        if (inputUnit) inputUnit.focus();
      } else {
        if (inputName) inputName.focus();
      }
      unitTouched = false;
      if (unitMatchBadge) {
        unitMatchBadge.hidden = true;
        unitMatchBadge.classList.remove("show");
        unitMatchBadge.style.display = "none";
      }
      const onKeydown = (e) => {
        if (e.key === "Escape") closeModal();
      };
      document.addEventListener("keydown", onKeydown);
      detachKeydown = () => document.removeEventListener("keydown", onKeydown);
    };

    const openEditModal = (user) => {
      if (!modal || !user) return;
      forceCreateUser = Boolean(user.readOnly);
      editUserId = forceCreateUser ? "" : String(user.id || "");
      const view = roleValueToView(user.role);
      applyModalMode(view);
      if (modalTitleEl) modalTitleEl.setAttribute("data-mode", "edit");
      if (submitBtn) submitBtn.textContent = "儲存";
      setOptions();

      if (inputCategory) inputCategory.value = normalizeText(user.category || "住戶") || "住戶";
      if (inputCommunity && user.communityId) inputCommunity.value = String(user.communityId || "");
      if (inputUnit) inputUnit.value = normalizeText(user.unit || "");
      if (inputName) inputName.value = normalizeText(user.name || "");
      if (inputEmail) inputEmail.value = normalizeText(user.email || "");
      if (inputPhone) inputPhone.value = normalizeText(user.phone || "");
      if (inputPassword) inputPassword.value = "";
      if (inputAddress) inputAddress.value = normalizeText(user.address || "");
      if (inputEnabled) inputEnabled.value = user.enabled ? "true" : "false";
      if (rolesWrap) rolesWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => (el.checked = false));
      if (Array.isArray(user.residentRoles) && rolesWrap) {
        const set = new Set(user.residentRoles.map((x) => String(x || "")));
        rolesWrap.querySelectorAll("input[type=\"checkbox\"]").forEach((el) => {
          const v = String(el.value || "");
          if (set.has(v)) el.checked = true;
        });
      }
      if (roleOtherText) roleOtherText.value = normalizeText(user.residentRoleOther || "");
      if (roleOtherChk) roleOtherChk.checked = Boolean(roleOtherText && roleOtherText.value);
      syncOtherRoleInput();

      avatarFile = null;
      setAvatarPreview(String(user.avatarDataUrl || ""));

      clearModalStatus();
      modal.hidden = false;
      if (inputName) inputName.focus();
      unitTouched = false;
      if (unitMatchBadge) {
        unitMatchBadge.hidden = true;
        unitMatchBadge.classList.remove("show");
        unitMatchBadge.style.display = "none";
      }
      const onKeydown = (e) => {
        if (e.key === "Escape") closeModal();
      };
      document.addEventListener("keydown", onKeydown);
      detachKeydown = () => document.removeEventListener("keydown", onKeydown);
    };

    if (addBtn) addBtn.addEventListener("click", openModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);
    if (inputUnit) inputUnit.addEventListener("input", () => {
      unitTouched = true;
      updateUnitMatch();
    });
    if (inputCommunity) inputCommunity.addEventListener("change", () => {
      if (!unitTouched && unitMatchBadge) {
        unitMatchBadge.hidden = true;
        unitMatchBadge.classList.remove("show");
        unitMatchBadge.style.display = "none";
      }
      updateUnitMatch();
    });
    if (roleOtherChk) roleOtherChk.addEventListener("change", syncOtherRoleInput);
    if (avatarUploader && avatarInput) {
      const openPicker = () => avatarInput.click();
      avatarUploader.addEventListener("click", openPicker);
      avatarUploader.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      });
      avatarInput.addEventListener("change", () => {
        const file = avatarInput.files && avatarInput.files[0];
        if (!file) return;
        avatarFile = file;
        const reader = new FileReader();
        reader.onload = () => setAvatarPreview(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const category = normalizeText(inputCategory ? inputCategory.value : "住戶") || "住戶";
        const communityId = normalizeText(inputCommunity ? inputCommunity.value : "") || normalizeText(communitySelect.value || "");
        const unit = normalizeText(inputUnit ? inputUnit.value : "");
        const name = normalizeText(inputName ? inputName.value : "");
        const email = normalizeText(inputEmail ? inputEmail.value : "");
        const phone = normalizeText(inputPhone ? inputPhone.value : "");
        const passwordRaw = normalizeText(inputPassword ? inputPassword.value : "");
        const address = normalizeText(inputAddress ? inputAddress.value : "");
        const enabled = String(inputEnabled ? inputEnabled.value : "true") === "true";
        const isResident = modalRoleView === "resident";
        const isCommunity = modalRoleView === "community";
        const requiredCommunity = isResident || isCommunity;
        if (!name) {
          showModalError("請填寫姓名。");
          return;
        }
        if (requiredCommunity && !communityId) {
          showModalError("請選擇所屬社區。");
          return;
        }
        if (isResident && !unit) {
          showModalError("請填寫戶號。");
          return;
        }
        if (!email || !phone) {
          showModalError("電子郵件與手機號碼皆為必填。");
          return;
        }
        const phoneNormalized = normalizePhoneDigits(phone);
        if (!phoneNormalized) {
          showModalError("手機號碼格式不正確。");
          return;
        }
        const loginAccount = email;
        const password = editUserId ? passwordRaw : (passwordRaw || phone);
        if (!password && !editUserId) {
          showModalError("未設定預設密碼時，預設會使用手機號碼；請填寫手機號碼或預設密碼。");
          return;
        }
        const { roles, extra } = readResidentRoles();
        if (isResident) {
          if (roles.includes("其他") && !extra) {
            showModalError("已選擇「其他」，請輸入自定義角色。");
            return;
          }
        }

        setBusy(true);
        let createdAuth = null;
        try {
          const isEdit = Boolean(editUserId) && !forceCreateUser;
          let id = isEdit ? String(editUserId) : "";
          if (!isEdit) {
            const isCurrentAdmin = Boolean(forceCreateUser) && modalRoleView === "admin" && auth.currentUser && auth.currentUser.uid;
            if (isCurrentAdmin) {
              id = String(auth.currentUser.uid);
            } else {
              createdAuth = await createAuthUser(email, password);
              id = String(createdAuth.uid);
            }
          }
          if (!id) {
            showModalError("建立失敗，請稍後再試。");
            return;
          }
          const roleValue = viewToRoleValue(modalRoleView);
          const passwordHash = password ? await sha256Hex(password) : "";
          const avatarDataUrl = avatarFile ? await fileToAvatarDataUrl(avatarFile) : "";
          const payload = {
            role: roleValue,
            category,
            community: String((requiredCommunity ? communityId : "default") || "default"),
            houseNo: isResident ? unit : "",
            displayName: name,
            username: loginAccount,
            email,
            phone,
            phoneNormalized,
            address,
            enabled: Boolean(enabled),
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (isResident) {
            payload.residentRoles = roles;
            payload.residentRoleOther = extra;
          }
          if (avatarDataUrl) payload.avatarDataUrl = avatarDataUrl;
          if (passwordHash) {
            payload.passwordHash = passwordHash;
            payload.passwordHashAlg = "SHA-256";
            payload.passwordUpdatedAt = FieldValue.serverTimestamp();
          }
          if (!isEdit) payload.createdAt = FieldValue.serverTimestamp();
          await db.collection("users").doc(id).set(payload, { merge: true });
          const c = (state.communities || []).find((x) => String(x && x.id ? x.id : "") === String(payload.community || ""));
          const communityCode = c ? String(c.username || "") : "";
          await upsertUserLookup({ phoneNormalized, email, phone, uid: id, community: payload.community, communityCode, role: payload.role });

          const existingIdx = (currentUsers || []).findIndex((x) => String(x && x.id ? x.id : "") === String(id));
          const existing = existingIdx >= 0 ? (currentUsers[existingIdx] || null) : null;
          const resolvedAvatarDataUrl = avatarDataUrl ? avatarDataUrl : String(existing && existing.avatarDataUrl ? existing.avatarDataUrl : "");
          const nextItem = {
            id: String(id),
            communityId: String(payload.community || "default"),
            unit: String(payload.houseNo || ""),
            name: String(payload.displayName || ""),
            username: String(payload.username || payload.email || payload.phone || ""),
            role: String(payload.role || ""),
            email: String(payload.email || ""),
            phone: String(payload.phone || ""),
            address: String(payload.address || ""),
            residentRoles: Array.isArray(payload.residentRoles) ? payload.residentRoles : [],
            residentRoleOther: String(payload.residentRoleOther || ""),
            avatarDataUrl: resolvedAvatarDataUrl,
            enabled: payload.enabled !== false,
            category: String(payload.category || ""),
          };
          if (existingIdx >= 0) {
            currentUsers[existingIdx] = { ...(currentUsers[existingIdx] || {}), ...nextItem };
          } else {
            currentUsers.unshift(nextItem);
          }
          if (String(state.accountsRoleView || "resident") === "admin") {
            const me = auth && auth.currentUser ? auth.currentUser : null;
            const myEmail = me && me.email ? String(me.email || "").trim().toLowerCase() : "";
            if (myEmail) {
              const hasReal = currentUsers.some((u) => String(u && (u.username || u.email) ? (u.username || u.email) : "").trim().toLowerCase() === myEmail && String(u.id || "") !== "__auth_admin__");
              if (hasReal) currentUsers = currentUsers.filter((u) => String(u && u.id ? u.id : "") !== "__auth_admin__");
            }
          }
          renderUserList();

          if (communitySelect.value !== String(communityId || "")) {
            communitySelect.value = String(communityId || "");
            setActiveCommunityId(communitySelect.value);
            subscribeUsers(communitySelect.value);
          }
          if (statusEl) {
            statusEl.textContent = isEdit ? "已更新帳號。" : "已建立帳號。";
            statusEl.classList.remove("error");
          }
          closeModal();
        } catch {
          if (createdAuth && createdAuth.user && typeof createdAuth.user.delete === "function") {
            try {
              await createdAuth.user.delete();
            } catch {}
          }
          showModalError((Boolean(editUserId) && !forceCreateUser) ? "更新失敗，請稍後再試。" : "建立失敗，請稍後再試。");
        } finally {
          if (createdAuth && createdAuth.auth) {
            try {
              await createdAuth.auth.signOut();
            } catch {}
          }
          setBusy(false);
        }
      });
    }

    const isAdminView = state.accountsRoleView === "admin";
    if (accountsCommunityField) {
      if (isAdminView) accountsCommunityField.remove();
      else accountsCommunityField.hidden = false;
    }
    communitySelect.disabled = Boolean(isAdminView);
    if (inputCommunity) inputCommunity.disabled = Boolean(isAdminView);
    
    // Initial data load for accounts
    subscribeUsers(communitySelect.value || "");

    const rList = document.getElementById("residentList");
    if (rList) {
      rList.addEventListener("click", async (e) => {
        const editBtn = e.target && e.target.closest ? e.target.closest("[data-edit-user]") : null;
        if (editBtn) {
          const id = editBtn.getAttribute("data-edit-user");
          const found = (currentUsers || []).find((x) => String(x.id || "") === String(id || ""));
          if (!found) return;
          openEditModal(found);
          return;
        }
        const delBtn = e.target && e.target.closest ? e.target.closest("[data-delete-user]") : null;
        if (delBtn) {
          const id = delBtn.getAttribute("data-delete-user");
          const found = (currentUsers || []).find((x) => String(x.id || "") === String(id || ""));
          if (!id || !found) return;
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "確認刪除",
            message: `確定要刪除此帳號「${String(found.username || found.name || id)}」？此操作無法復原。`,
            okText: "刪除",
            cancelText: "取消",
            danger: true,
          }) : Promise.resolve(window.confirm("確定要刪除？此操作無法復原。")));
          if (!ok) return;
          if (found.readOnly) return;
          setBusy(true);
          try {
            await db.collection("users").doc(String(id)).delete();
            currentUsers = (currentUsers || []).filter((x) => String(x && x.id ? x.id : "") !== String(id));
            if (String(state.accountsRoleView || "resident") === "admin") {
              const me = auth && auth.currentUser ? auth.currentUser : null;
              const myEmail = me && me.email ? String(me.email || "").trim().toLowerCase() : "";
              const deletedEmail = String(found.username || found.email || "").trim().toLowerCase();
              if (myEmail && deletedEmail && myEmail === deletedEmail) {
                const exists = currentUsers.some((u) => String(u && (u.username || u.email) ? (u.username || u.email) : "").trim().toLowerCase() === myEmail);
                if (!exists) {
                  currentUsers.unshift({
                    id: "__auth_admin__",
                    communityId: "",
                    unit: "",
                    name: String(me.email || "—"),
                    username: String(me.email || ""),
                    role: "系統管理員",
                    email: String(me.email || ""),
                    phone: "",
                    address: "",
                    residentRoles: [],
                    residentRoleOther: "",
                    avatarDataUrl: "",
                    enabled: true,
                    category: "",
                    readOnly: true,
                  });
                }
              }
            }
            renderUserList();
          } catch {
          } finally {
            setBusy(false);
          }
        }
      });
    }
  }

  function renderCommunity() {
    const host = document.getElementById("content");
    host.innerHTML = "";
    const node = document.getElementById("tplCommunity").content.cloneNode(true);
    host.appendChild(node);

    const addBtn = document.getElementById("btnAddCommunity");
    const modal = document.getElementById("communityModal");
    const modalTitle = document.getElementById("communityModalTitle");
    const modalStatus = document.getElementById("communityModalStatus");
    const form = document.getElementById("communityModalForm");
    const inputName = document.getElementById("modal_c_name");
    const inputCode = document.getElementById("modal_c_code");
    const inputLevel = document.getElementById("modal_c_level");
    const inputArea = document.getElementById("modal_c_area");
    const imageInput = document.getElementById("communityImageInput");
    const imagePreview = document.getElementById("communityImagePreview");
    const imagePlaceholder = document.getElementById("communityImagePlaceholder");
    const imageUploader = document.getElementById("communityImageUploader");
    const submitBtn = document.getElementById("btnSubmitCommunityModal");
    const cancelBtn = document.getElementById("btnCancelCommunityModal");
    const closeBtn = document.getElementById("btnCloseCommunityModal");
    const backdrop = modal ? modal.querySelector("[data-modal-close]") : null;
    const unitModal = document.getElementById("unitModal");
    const unitForm = document.getElementById("unitModalForm");
    const tbody = document.getElementById("unitsTableBody");
    const unitStatus = document.getElementById("unitModalStatus");
    const unitTitleTextEl = document.getElementById("unitModalTitleText");
    const unitFeatureList = document.getElementById("unitFeatureList");
    const unitFeatureAll = document.getElementById("unitFeatureAll");
    const unitCloseBtn = document.getElementById("btnCloseUnitModal");
    const unitCancelBtn = document.getElementById("btnCancelUnitModal");
    const unitBackdrop = unitModal ? unitModal.querySelector("[data-modal-close]") : null;

    const btnExport = document.getElementById("btnExportUnits");
    const btnImport = document.getElementById("btnImportUnits");
    const inputImport = document.getElementById("inputImportUnits");
    const btnAddRow = document.getElementById("btnAddUnitRow");

    let editCommunityId = "";
    let modalImageData = "";
    let modalImageFile = null;
    let detachKeydown = () => {};
    let unitCommunityId = "";
    let detachUnitKeydown = () => {};
    let unitActiveTab = "units";
    let unitConfigCache = null;
    let unitDrag = null;

    const createUnitRow = (u = {}) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="text" class="u-id" value="${u.id || ""}" placeholder="戶號" /></td>
        <td><input type="text" class="u-address" value="${u.address || ""}" placeholder="地址" /></td>
        <td><input type="text" class="u-area" value="${u.area || ""}" placeholder="坪數" /></td>
        <td><input type="text" class="u-ownership" value="${u.ownership || ""}" placeholder="%" /></td>
        <td><div class="remove-row" title="刪除">&times;</div></td>
      `;
      tr.querySelector(".remove-row").onclick = () => {
        tr.remove();
        updateUnitHeaderCounts();
      };
      return tr;
    };

    const adminModules = [
      { id: "parcel", name: "包裹郵件" },
      { id: "visitor", name: "訪客登記" },
      { id: "residents", name: "住戶造冊" },
      { id: "facility", name: "設施預約" },
      { id: "bulletin", name: "公告系統" },
      { id: "parking", name: "綠色停車" },
      { id: "company-support", name: "公司支援" },
      { id: "meter-reading", name: "抄表紀錄" },
      { id: "finance", name: "收支報表" },
      { id: "checkin-vote", name: "報到投票" },
      { id: "assignments", name: "交辦事項" },
      { id: "duty", name: "勤務管理" },
      { id: "care", name: "關懷救護" },
      { id: "life", name: "生活服務" },
    ];

    const setImagePreview = (dataUrl) => {
      modalImageData = dataUrl || "";
      if (imagePreview) {
        imagePreview.src = modalImageData || "";
        imagePreview.style.display = modalImageData ? "block" : "none";
      }
      if (imagePlaceholder) imagePlaceholder.style.display = modalImageData ? "none" : "block";
    };

    const clearModalStatus = () => {
      if (!modalStatus) return;
      modalStatus.hidden = true;
      modalStatus.textContent = "";
      modalStatus.classList.remove("error");
    };

    const showModalError = (msg) => {
      if (!modalStatus) return;
      modalStatus.textContent = String(msg || "");
      modalStatus.hidden = false;
      modalStatus.classList.add("error");
      modalStatus.scrollIntoView({ block: "nearest" });
    };

    const showModalInfo = (msg) => {
      if (!modalStatus) return;
      modalStatus.textContent = String(msg || "");
      modalStatus.hidden = false;
      modalStatus.classList.remove("error");
      modalStatus.scrollIntoView({ block: "nearest" });
    };

    const fileToCompressedDataUrl = (file) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read-failed"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("image-decode-failed"));
        img.onload = () => {
          const targetW = 600;
          const targetH = 300;
          const ratio = targetW / targetH;
          const srcW = img.naturalWidth || 0;
          const srcH = img.naturalHeight || 0;
          if (!srcW || !srcH) {
            reject(new Error("bad-image"));
            return;
          }

          let cropW = srcW;
          let cropH = srcH;
          let sx = 0;
          let sy = 0;
          if (srcW / srcH > ratio) {
            cropW = Math.round(srcH * ratio);
            cropH = srcH;
            sx = Math.round((srcW - cropW) / 2);
          } else {
            cropW = srcW;
            cropH = Math.round(srcW / ratio);
            sy = Math.round((srcH - cropH) / 2);
          }

          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("no-canvas"));
            return;
          }
          ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, targetW, targetH);
          const out = canvas.toDataURL("image/jpeg", 0.78);
          resolve(out);
        };
        img.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });

    const closeModal = () => {
      if (!modal) return;
      modal.hidden = true;
      editCommunityId = "";
      modalImageFile = null;
      setImagePreview("");
      clearModalStatus();
      if (form) form.reset();
      if (imageInput) imageInput.value = "";
      detachKeydown();
      detachKeydown = () => {};
    };

    const openModal = (mode, community) => {
      if (!modal) return;
      editCommunityId = mode === "edit" && community ? String(community.id || "") : "";
      if (modalTitle) modalTitle.textContent = mode === "edit" ? "編輯社區" : "新增社區";
      if (submitBtn) submitBtn.textContent = mode === "edit" ? "儲存" : "建立";
      clearModalStatus();
      if (inputName) inputName.value = mode === "edit" && community ? String(community.name || "") : "";
      if (inputCode) inputCode.value = mode === "edit" && community ? String(community.username || "") : "";
      if (inputLevel) inputLevel.value = mode === "edit" && community ? String(community.level || "銅") : "銅";
      if (inputArea) inputArea.value = mode === "edit" && community ? String(community.area || "台北") : "台北";
      modalImageFile = null;
      if (imageInput) imageInput.value = "";
      setImagePreview(mode === "edit" && community ? String(community.imageDataUrl || "") : "");
      modal.hidden = false;

      const onKeyDown = (e) => {
        if (e.key === "Escape") closeModal();
      };
      document.addEventListener("keydown", onKeyDown);
      detachKeydown = () => document.removeEventListener("keydown", onKeyDown);

      requestAnimationFrame(() => {
        if (inputName) inputName.focus();
      });
    };

    const levelBadgeHtml = (level) => {
      const lv = String(level || "銅");
      const safe = lv === "金" || lv === "銀" || lv === "銅" ? lv : "銅";
      return `
        <div class="level-badge" data-level="${safe}" aria-label="社區級別：${safe}">
          <svg class="level-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2" opacity="0.9"></circle>
            <path d="M12 7.5l1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4L12 7.5z" fill="currentColor" opacity="0.85"></path>
          </svg>
          <span>${safe}</span>
        </div>
      `.trim();
    };

    const renderCommunityList = () => {
      const d = loadAccounts();
      const cList = document.getElementById("communityList");
      const list = d.communities || []; // 显示所有社区，不再按区域筛选
      cList.innerHTML = list.map((c) => `
            <div class="item community-item">
              <div class="community-row1">
                <div class="community-row1-left">
                  <div class="community-thumb">
                    ${c.imageDataUrl ? `<img src="${c.imageDataUrl}" alt="社區圖片">` : `<div class="fallback">2:1</div>`}
                  </div>
                  <div class="community-area">${c.area || "台北"}</div>
                  <div class="community-code">${c.username}</div>
                  <div class="community-name">${c.name}</div>
                </div>
              </div>
              <div class="community-row2">
                <div class="community-meta meta">
                  ${levelBadgeHtml(c.level)}
                  <div class="switch-label">${c.enabled ? "啟用" : "停用"}</div>
                  <label class="switch">
                    <input type="checkbox" data-toggle-community="${c.id}" ${c.enabled ? "checked" : ""} />
                    <span class="slider"></span>
                  </label>
                </div>
                <div class="community-actions">
                  <button class="icon-btn" type="button" data-go-admin="${c.id}" aria-label="前往社區後台" title="前往社區後台">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4.5 10.3 12 5.7l7.5 4.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M6.2 10.3V19h11.6v-8.7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M9 19v-5.3h6V19" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </button>
                  <button class="icon-btn" type="button" data-go-member="${c.id}" aria-label="前往住戶前台" title="前往住戶前台">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" stroke="currentColor" stroke-width="1.7"/>
                      <path d="M4 20a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <button class="icon-btn" type="button" data-units-community="${c.id}" aria-label="設定" title="設定">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" stroke-width="1.7"/>
                      <path d="M19.2 12a7.2 7.2 0 0 0-.1-1.1l2-1.6-1.8-3.1-2.5 1a7.2 7.2 0 0 0-1.9-1.1l-.4-2.7H9.5l-.4 2.7a7.2 7.2 0 0 0-1.9 1.1l-2.5-1-1.8 3.1 2 1.6A7.2 7.2 0 0 0 4.8 12c0 .4 0 .7.1 1.1l-2 1.6 1.8 3.1 2.5-1a7.2 7.2 0 0 0 1.9 1.1l.4 2.7h5l.4-2.7a7.2 7.2 0 0 0 1.9-1.1l2.5 1 1.8-3.1-2-1.6c.1-.4.1-.7.1-1.1Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" opacity="0.8"/>
                    </svg>
                  </button>
                  <button class="icon-btn" type="button" data-edit-community="${c.id}" aria-label="編輯" title="編輯">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-.2-.2a2 2 0 0 0-2.8 0L5 17v3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                      <path d="M13.5 6.5 17.5 10.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    </svg>
                  </button>
                  <button class="icon-btn danger" type="button" data-delete-community="${c.id}" aria-label="刪除" title="刪除">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M9 4h6l1 2h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                      <path d="M6 6h12l-1 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 6Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                      <path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          `).join("") || `<div class="status">尚無社區資料。</div>`;

      cList.querySelectorAll("[data-toggle-community]").forEach((input) => {
        input.addEventListener("change", async () => {
          const id = input.getAttribute("data-toggle-community");
          if (!id) return;
          setBusy(true);
          try {
            await db.collection("communities").doc(String(id)).set(
              { enabled: Boolean(input.checked), updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          } catch {
          } finally {
            setBusy(false);
          }
        });
      });

      cList.querySelectorAll("[data-edit-community]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-edit-community");
          const c = (state.communities || []).find((x) => x && String(x.id || "") === String(id || ""));
          if (!c) return;
          setActiveCommunityId(id);
          openModal("edit", c);
        });
      });

      cList.querySelectorAll("[data-units-community]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-units-community");
          const c = (state.communities || []).find((x) => x && String(x.id || "") === String(id || ""));
          if (!id || !c) return;
          setActiveCommunityId(id);
          openUnitModal(c);
        });
      });

      cList.querySelectorAll("[data-go-admin]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-go-admin");
          const c = (state.communities || []).find((x) => x && String(x.id || "") === String(id || ""));
          if (!id || !c) return;
          const key = String(c.username || c.id || "").trim();
          if (!key) return;
          try { sessionStorage.setItem("csp_last_cid", key); } catch {}
          try { sessionStorage.setItem("csp_role", "community"); } catch {}
          try { sessionStorage.setItem("csp_sysadmin", "1"); } catch {}
          location.href = `admin.html?c=${encodeURIComponent(key)}#community/community-dashboard`;
        });
      });

      cList.querySelectorAll("[data-go-member]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-go-member");
          const c = (state.communities || []).find((x) => x && String(x.id || "") === String(id || ""));
          if (!id || !c) return;
          const key = String(c.username || c.id || "").trim();
          if (!key) return;
          try { sessionStorage.setItem("csp_last_cid", key); } catch {}
          try { sessionStorage.setItem("csp_role", "resident"); } catch {}
          try { sessionStorage.setItem("csp_sysadmin", "1"); } catch {}
          location.href = `member.html?c=${encodeURIComponent(key)}`;
        });
      });

      cList.querySelectorAll("[data-delete-community]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-delete-community");
          if (!id) return;
          const target = (state.communities || []).find((c) => String(c?.id || "") === String(id)) || null;
          const ok = await (window.nwConfirm ? window.nwConfirm({
            title: "確認刪除",
            message: `確定要刪除「${target ? String(target.name || id) : id}」？此操作無法復原。`,
            okText: "刪除",
            cancelText: "取消",
            danger: true,
          }) : Promise.resolve(window.confirm("確定要刪除？此操作無法復原。")));
          if (!ok) return;
          setBusy(true);
          try {
            await db.collection("communities").doc(String(id)).delete();
            if (localStorage.getItem(STORAGE_ACTIVE_COMMUNITY) === String(id)) {
              localStorage.removeItem(STORAGE_ACTIVE_COMMUNITY);
            }
          } catch {
          } finally {
            setBusy(false);
          }
        });
      });
    };

    const refresh = () => {
      const d = loadAccounts();
      const currentId = loadActiveCommunityId(d);

      renderCommunityList();
      setActiveCommunityId(currentId);
    };

    if (addBtn) addBtn.addEventListener("click", () => openModal("create"));
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);

    const clearUnitStatus = () => {
      if (!unitStatus) return;
      unitStatus.hidden = true;
      unitStatus.textContent = "";
      unitStatus.classList.remove("error");
    };

    const showUnitError = (msg) => {
      if (!unitStatus) return;
      unitStatus.hidden = false;
      unitStatus.textContent = String(msg || "");
      unitStatus.classList.add("error");
      unitStatus.scrollIntoView({ block: "nearest" });
    };

    const setActiveUnitTab = (tabId) => {
      const validTabs = ["units", "features", "row-a", "row-b", "row-d", "row-f", "service"];
      const next = validTabs.includes(tabId) ? tabId : "units";
      unitActiveTab = next;
      if (!unitModal) return;
      const btns = unitModal.querySelectorAll("[data-unit-tab]");
      btns.forEach((b) => {
        const id = String(b.getAttribute("data-unit-tab") || "");
        b.setAttribute("aria-selected", id === next ? "true" : "false");
      });
      const panels = unitModal.querySelectorAll("[data-unit-panel]");
      panels.forEach((p) => {
        const id = String(p.getAttribute("data-unit-panel") || "");
        p.hidden = id !== next;
      });
      if (next === "features") {
        if (unitTitleTextEl) unitTitleTextEl.textContent = "功能列表";
      } else if (next === "row-a") {
        if (unitTitleTextEl) unitTitleTextEl.textContent = "圖覽設定";
      } else if (next === "row-b") {
        if (unitTitleTextEl) unitTitleTextEl.textContent = "呼叫設定";
      } else if (next === "row-d") {
        if (unitTitleTextEl) unitTitleTextEl.textContent = "社紐設定";
      } else if (next === "row-f") {
        if (unitTitleTextEl) unitTitleTextEl.textContent = "生紐設定";
      } else if (next === "service") {
        if (unitTitleTextEl) unitTitleTextEl.textContent = "客服設定";
      } else {
        if (unitTitleTextEl) unitTitleTextEl.textContent = "戶號列表";
      }
      updateUnitHeaderCounts();
    };

    const updateUnitHeaderCounts = () => {
      const summary = document.getElementById("unitTotalsSummary");
      if (unitActiveTab === "features") {
        if (summary) summary.hidden = true;
        return;
      }
      if (summary) summary.hidden = false;
      if (!tbody) return;

      const rows = Array.from(tbody.querySelectorAll("tr"));
      let totalUnits = 0;
      let totalArea = 0;
      let totalOwnership = 0;

      rows.forEach(tr => {
        const id = tr.querySelector(".u-id").value.trim();
        if (!id) return;
        totalUnits++;
        
        const area = parseFloat(tr.querySelector(".u-area").value) || 0;
        const ownership = parseFloat(tr.querySelector(".u-ownership").value) || 0;
        
        totalArea += area;
        totalOwnership += ownership;
      });

      const elUnits = document.getElementById("totalUnitsCount");
      const elArea = document.getElementById("totalAreaSum");
      const elOwnership = document.getElementById("totalOwnershipSum");

      if (elUnits) elUnits.textContent = `總戶數：${totalUnits}`;
      if (elArea) elArea.textContent = `總坪數：${totalArea.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
      if (elOwnership) elOwnership.textContent = `總比例：${totalOwnership.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}%`;
    };

    const getFeatureOrderFromDom = () => {
      if (!unitFeatureList) return adminModules.map((m) => m.id);
      const ids = Array.from(unitFeatureList.querySelectorAll("label.check[data-feature-row] input[data-feature-id]"))
        .map((el) => String(el.getAttribute("data-feature-id") || "").trim())
        .filter(Boolean);
      const used = new Set();
      const out = [];
      ids.forEach((id) => {
        if (used.has(id)) return;
        used.add(id);
        out.push(id);
      });
      adminModules.forEach((m) => {
        if (used.has(m.id)) return;
        used.add(m.id);
        out.push(m.id);
      });
      return out;
    };

    const updateUnitSelectAllState = () => {
      if (!unitFeatureAll || !unitFeatureList) return;
      const boxes = Array.from(unitFeatureList.querySelectorAll("input[data-feature-id]"));
      const total = boxes.length;
      const checked = boxes.filter((x) => x && x.checked).length;
      if (!total) return;
      unitFeatureAll.indeterminate = checked > 0 && checked < total;
      unitFeatureAll.checked = checked === total;
    };

    const loadUnitConfig = async (communityId) => {
      try {
        const doc = await configDocRef(communityId).get();
        return doc && doc.exists ? (doc.data() || {}) : {};
      } catch {
        return {};
      }
    };

    const renderUnitFeatureList = (cfg) => {
      if (!unitFeatureList) return;
      const cbtn = cfg && cfg.communityButtons ? cfg.communityButtons : {};
      const savedOrder = Array.isArray(cfg && cfg.communityButtonsOrder) ? cfg.communityButtonsOrder : [];
      const map = new Map(adminModules.map((m) => [String(m.id), m]));
      const used = new Set();
      const ordered = [];
      savedOrder.forEach((id) => {
        const key = String(id || "").trim();
        if (!key || used.has(key)) return;
        const m = map.get(key);
        if (!m) return;
        used.add(key);
        ordered.push(m);
      });
      adminModules.forEach((m) => {
        if (used.has(m.id)) return;
        used.add(m.id);
        ordered.push(m);
      });
      unitFeatureList.innerHTML = ordered.map((m) => {
        const v = cbtn && cbtn[m.id] ? cbtn[m.id] : null;
        const checked = !v || v.enabled !== false;
        return `<label class="check" data-feature-row="1"><input type="checkbox" data-feature-id="${m.id}" ${checked ? "checked" : ""} />${m.name}</label>`;
      }).join("");
      updateUnitHeaderCounts();
      updateUnitSelectAllState();
    };

    const renderRowAImageSettings = (cfg) => {
      const container = document.getElementById("rowAImageList");
      if (!container) return;
      const images = Array.isArray(cfg && cfg.rowAImages) ? cfg.rowAImages : [];
      const intervalInput = document.getElementById("modal_rowa_interval");
      if (intervalInput) intervalInput.value = cfg && cfg.rowAInterval ? cfg.rowAInterval : 5;

      let html = "";
      for (let i = 0; i < 8; i++) {
        const v = images[i] || { url: "", data: "" };
        html += `
          <div class="image-slot" data-slot-index="${i}">
            <div class="slot-preview" id="slot_preview_${i}" ${v.data ? `data-slot-data="${v.data}"` : ""}>
              ${v.data || v.url ? `<img src="${v.data || v.url}" />` : "<span>8:3</span>"}
            </div>
            <div class="slot-inputs">
              <div class="slot-actions">
                <input type="text" placeholder="輸入圖片網址" value="${v.url || ""}" data-slot-url="${i}" />
                <button class="btn btn-sm" type="button" data-slot-upload="${i}">上傳</button>
                <input type="file" accept="image/*" hidden data-slot-file="${i}" />
                <button class="btn btn-sm danger" type="button" data-slot-clear="${i}">清除</button>
              </div>
            </div>
          </div>
        `;
      }
      container.innerHTML = html;

      // Bind events
      container.querySelectorAll("[data-slot-upload]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = btn.getAttribute("data-slot-upload");
          container.querySelector(`[data-slot-file="${idx}"]`).click();
        });
      });

      container.querySelectorAll("[data-slot-file]").forEach(input => {
        input.addEventListener("change", async () => {
          const idx = input.getAttribute("data-slot-file");
          const file = input.files[0];
          if (!file) return;
          try {
            const dataUrl = await fileToCompressedDataUrl(file);
            const preview = document.getElementById(`slot_preview_${idx}`);
            preview.innerHTML = `<img src="${dataUrl}" />`;
            preview.setAttribute("data-slot-data", dataUrl);
          } catch (err) {
            console.error(err);
          }
        });
      });

      container.querySelectorAll("[data-slot-clear]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = btn.getAttribute("data-slot-clear");
          const preview = document.getElementById(`slot_preview_${idx}`);
          preview.innerHTML = "<span>8:3</span>";
          preview.removeAttribute("data-slot-data");
          container.querySelector(`[data-slot-url="${idx}"]`).value = "";
        });
      });
      
      container.querySelectorAll("[data-slot-url]").forEach(input => {
        input.addEventListener("input", () => {
          const idx = input.getAttribute("data-slot-url");
          const url = input.value.trim();
          const preview = document.getElementById(`slot_preview_${idx}`);
          const slotData = preview.getAttribute("data-slot-data");
          if (url) {
            preview.innerHTML = `<img src="${url}" />`;
          } else if (slotData) {
            preview.innerHTML = `<img src="${slotData}" />`;
          } else {
            preview.innerHTML = "<span>8:3</span>";
          }
        });
      });
    };

    const renderRowButtonSettings = (containerId, storeKey, defaultButtons) => {
      const container = document.getElementById(containerId);
      if (!container) return;
      const cfg = unitConfigCache || {};
      const savedButtons = Array.isArray(cfg[storeKey]) ? cfg[storeKey] : [];

      // 內部連結選項
      const internalLinks = [
        { value: "parcel.html", label: "包裹郵件" },
        { value: "facility.html", label: "設施預約" },
        { value: "bulletin-community.html", label: "社區園地" },
        { value: "bulletin-finance.html", label: "財務報表" },
        { value: "bulletin-meeting.html", label: "會議紀錄" },
        { value: "bulletin-repair.html", label: "修繕報告" }
      ];

      let html = "";
      for (let i = 0; i < 8; i++) {
        const saved = savedButtons[i];
        const def = defaultButtons[i] || { name: "", icon: "", url: "#", openExternal: false };
        
        // 如果保存的是舊的預設值（url 是 #），則使用新的預設值
        const useDefault = !saved || (saved.url === "#" && def.url !== "#");
        const b = useDefault ? { ...def } : { ...saved };
        
        const displayName = b.name || def.name || "";
        
        // 檢查是否為內部連結
        const isInternalLink = internalLinks.some(link => link.value === b.url);
        const selectedInternalValue = isInternalLink ? b.url : "";
        
        html += `
          <div class="button-slot" data-slot-index="${i}">
            <div class="btn-slot-preview" id="${containerId}_preview_${i}" ${b.data ? `data-slot-data="${b.data}"` : ""}>
              ${b.data || b.icon ? `<img src="${b.data || b.icon}" />` : "<span>圖</span>"}
            </div>
            <div class="btn-slot-inputs">
              <div class="btn-slot-row">
                <label>按鈕名稱</label>
                <input type="text" value="${displayName}" data-btn-name="${i}" placeholder="${def.name || ""}" />
              </div>
              <div class="btn-slot-row">
                <label>連結網址</label>
                <div class="url-with-check">
                  <select data-btn-internal="${i}">
                    <option value="">自訂連結</option>
                    ${internalLinks.map(link => `<option value="${link.value}" ${selectedInternalValue === link.value ? "selected" : ""}>${link.label}</option>`).join("")}
                  </select>
                  <input type="text" value="${isInternalLink ? "" : (b.url || "")}" placeholder="#" data-btn-url="${i}" ${isInternalLink ? "disabled" : ""} />
                  <label class="check-inline">
                    <input type="checkbox" data-btn-external="${i}" ${b.openExternal ? "checked" : ""} />
                    <span>另開</span>
                  </label>
                </div>
              </div>
              <div class="btn-slot-actions">
                <input type="text" placeholder="圖片網址" value="${b.icon && !b.icon.startsWith('photo/') ? b.icon : ''}" data-btn-icon="${i}" />
                <button class="btn btn-sm" type="button" data-btn-upload="${i}">上傳</button>
                <input type="file" accept="image/*" hidden data-btn-file="${i}" />
                <button class="btn btn-sm danger" type="button" data-btn-clear="${i}">清除</button>
              </div>
            </div>
          </div>
        `;
      }
      container.innerHTML = html;

      // Bind events for internal link select
      container.querySelectorAll("[data-btn-internal]").forEach(select => {
        select.addEventListener("change", () => {
          const idx = select.getAttribute("data-btn-internal");
          const urlInput = container.querySelector(`[data-btn-url="${idx}"]`);
          const selectedValue = select.value;
          
          if (selectedValue) {
            urlInput.value = selectedValue;
            urlInput.disabled = true;
          } else {
            urlInput.value = "";
            urlInput.disabled = false;
          }
        });
      });

      // Bind events
      container.querySelectorAll("[data-btn-upload]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = btn.getAttribute("data-btn-upload");
          container.querySelector(`[data-btn-file="${idx}"]`).click();
        });
      });

      container.querySelectorAll("[data-btn-file]").forEach(input => {
        input.addEventListener("change", async () => {
          const idx = input.getAttribute("data-btn-file");
          const file = input.files[0];
          if (!file) return;
          try {
            const dataUrl = await fileToCompressedDataUrl(file);
            const preview = document.getElementById(`${containerId}_preview_${idx}`);
            preview.innerHTML = `<img src="${dataUrl}" />`;
            preview.setAttribute("data-slot-data", dataUrl);
          } catch (err) {
            console.error(err);
          }
        });
      });

      container.querySelectorAll("[data-btn-clear]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = btn.getAttribute("data-btn-clear");
          const preview = document.getElementById(`${containerId}_preview_${idx}`);
          const def = defaultButtons[idx] || { icon: "" };
          preview.innerHTML = def.icon ? `<img src="${def.icon}" />` : "<span>圖</span>";
          preview.removeAttribute("data-slot-data");
          container.querySelector(`[data-btn-icon="${idx}"]`).value = "";
          container.querySelector(`[data-btn-name="${idx}"]`).value = def.name || "";
          container.querySelector(`[data-btn-url="${idx}"]`).value = "#";
          container.querySelector(`[data-btn-internal="${idx}"]`).value = "";
          container.querySelector(`[data-btn-url="${idx}"]`).disabled = false;
          const externalCheck = container.querySelector(`[data-btn-external="${idx}"]`);
          if (externalCheck) externalCheck.checked = false;
        });
      });

      container.querySelectorAll("[data-btn-icon]").forEach(input => {
        input.addEventListener("input", () => {
          const idx = input.getAttribute("data-btn-icon");
          const url = input.value.trim();
          const preview = document.getElementById(`${containerId}_preview_${idx}`);
          const slotData = preview.getAttribute("data-slot-data");
          if (url) {
            preview.innerHTML = `<img src="${url}" />`;
          } else if (slotData) {
            preview.innerHTML = `<img src="${slotData}" />`;
          } else {
            const def = defaultButtons[idx] || { icon: "" };
            preview.innerHTML = def.icon ? `<img src="${def.icon}" />` : "<span>圖</span>";
          }
        });
      });
    };

    const renderServiceSettings = (cfg) => {
      const input = document.getElementById("modal_service_url");
      if (input) {
        input.value = cfg && cfg.serviceUrl ? cfg.serviceUrl : "";
      }
    };

    const closeUnitModal = () => {
      if (!unitModal) return;
      unitModal.hidden = true;
      detachUnitKeydown();
      detachUnitKeydown = () => {};
      unitCommunityId = "";
      unitConfigCache = null;
      setActiveUnitTab("units");
      clearUnitStatus();
      if (unitCountEl) unitCountEl.textContent = "總戶數：—";
    };

    const openUnitModal = (community) => {
      if (!unitModal || !tbody) return;
      unitCommunityId = String(community?.id || "");
      const list = Array.isArray(community?.units) ? community.units : [];
      
      if (tbody) {
        tbody.innerHTML = "";
        list.forEach(u => {
          const rowData = typeof u === "object" && u !== null ? u : { id: String(u) };
          tbody.appendChild(createUnitRow(rowData));
        });
        if (list.length === 0) tbody.appendChild(createUnitRow());
      }

      clearUnitStatus();
      unitModal.hidden = false;
      setActiveUnitTab("units");
      updateUnitHeaderCounts();
      const cid = String(unitCommunityId || "");
      if (cid) {
        loadUnitConfig(cid).then((cfg) => {
          unitConfigCache = cfg || {};
          renderUnitFeatureList(unitConfigCache);
          renderRowAImageSettings(unitConfigCache);
          renderRowButtonSettings("rowDButtonList", "rowDButtons", defaultRowDButtons);
          renderRowButtonSettings("rowFButtonList", "rowFButtons", defaultRowFButtons);
          renderServiceSettings(unitConfigCache);
        }).catch(() => {
          unitConfigCache = {};
          renderUnitFeatureList(unitConfigCache);
          renderRowAImageSettings(unitConfigCache);
          renderRowButtonSettings("rowDButtonList", "rowDButtons", defaultRowDButtons);
          renderRowButtonSettings("rowFButtonList", "rowFButtons", defaultRowFButtons);
          renderServiceSettings(unitConfigCache);
        });
      }
      const onKeydown = (e) => {
        if (e.key === "Escape") closeUnitModal();
      };
      document.addEventListener("keydown", onKeydown);
      detachUnitKeydown = () => document.removeEventListener("keydown", onKeydown);
    };

    if (btnAddRow) btnAddRow.addEventListener("click", () => {
      if (tbody) {
        const row = createUnitRow();
        tbody.appendChild(row);
        updateUnitHeaderCounts();
        row.querySelector("input").focus();
      }
    });

    if (btnExport) btnExport.addEventListener("click", () => {
      if (!window.XLSX) {
        alert("Excel 函式庫尚未載入，請稍後再試。");
        return;
      }
      const rows = Array.from(tbody.querySelectorAll("tr"));
      const data = rows.map(tr => ({
        "戶號": tr.querySelector(".u-id").value.trim(),
        "地址": tr.querySelector(".u-address").value.trim(),
        "坪數": tr.querySelector(".u-area").value.trim(),
        "區分所有權人%": tr.querySelector(".u-ownership").value.trim()
      })).filter(x => x["戶號"]);

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "戶號列表");
      XLSX.writeFile(wb, `戶號列表_${unitCommunityId}.xlsx`);
    });

    if (btnImport) btnImport.addEventListener("click", () => inputImport.click());
    if (inputImport) inputImport.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!window.XLSX) {
        alert("Excel 函式庫尚未載入，請稍後再試。");
        return;
      }
      const reader = new FileReader();
      reader.onload = (re) => {
        try {
          const data = new Uint8Array(re.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(firstSheet);
          
          if (json.length === 0) {
            showUnitError("檔案中沒有資料。");
            return;
          }

          if (tbody) {
            tbody.innerHTML = "";
            json.forEach(row => {
              const id = String(row["戶號"] || row["id"] || row["戶"] || Object.values(row)[0] || "").trim();
              const addr = String(row["地址"] || row["address"] || Object.values(row)[1] || "").trim();
              const area = String(row["坪數"] || row["area"] || Object.values(row)[2] || "").trim();
              const own = String(row["區分所有權人%"] || row["ownership"] || Object.values(row)[3] || "").trim();
              if (id) tbody.appendChild(createUnitRow({ id, address: addr, area, ownership: own }));
            });
            updateUnitHeaderCounts();
          }
          showUnitError("匯入成功，請確認後點擊儲存。");
          unitStatus.classList.remove("error");
        } catch (err) {
          console.error("Import failed:", err);
          showUnitError("匯入失敗，請檢查檔案格式。");
        } finally {
          inputImport.value = "";
        }
      };
      reader.readAsArrayBuffer(file);
    });

    if (unitCancelBtn) unitCancelBtn.addEventListener("click", closeUnitModal);
    if (unitCloseBtn) unitCloseBtn.addEventListener("click", closeUnitModal);
    if (unitBackdrop) unitBackdrop.addEventListener("click", closeUnitModal);

    if (tbody && !tbody._boundInput) {
      tbody._boundInput = true;
      tbody.addEventListener("input", (e) => {
        if (e.target && (e.target.classList.contains("u-area") || e.target.classList.contains("u-ownership") || e.target.classList.contains("u-id"))) {
          updateUnitHeaderCounts();
        }
      });
    }

    if (unitModal && !unitModal._boundTabs) {
      unitModal._boundTabs = true;
      unitModal.addEventListener("click", (e) => {
        const t = e.target && e.target.closest ? e.target.closest("[data-unit-tab]") : null;
        if (!t) return;
        e.preventDefault();
        setActiveUnitTab(String(t.getAttribute("data-unit-tab") || "units"));
      });
    }
    if (unitFeatureList && !unitFeatureList._boundChange) {
      unitFeatureList._boundChange = true;
      unitFeatureList.addEventListener("change", () => updateUnitHeaderCounts());
    }
    if (unitFeatureList && !unitFeatureList._boundReorder) {
      unitFeatureList._boundReorder = true;
      unitDrag = {
        active: false,
        timer: null,
        pointerId: null,
        dragEl: null,
      };

      const clearTimer = () => {
        if (!unitDrag || !unitDrag.timer) return;
        clearTimeout(unitDrag.timer);
        unitDrag.timer = null;
      };

      const stopDrag = () => {
        if (!unitDrag || !unitDrag.active) return;
        unitDrag.active = false;
        if (unitDrag.dragEl) unitDrag.dragEl.classList.remove("dragging");
        unitFeatureList.classList.remove("reordering");
        unitDrag.dragEl = null;
        unitDrag.pointerId = null;
        if (unitConfigCache && typeof unitConfigCache === "object") {
          unitConfigCache.communityButtonsOrder = getFeatureOrderFromDom();
        }
      };

      unitFeatureList.addEventListener("pointerdown", (e) => {
        const row = e.target && e.target.closest ? e.target.closest('label.check[data-feature-row]') : null;
        if (!row) return;
        if (unitDrag.active) return;
        clearTimer();
        unitDrag.pointerId = e.pointerId;
        unitDrag.timer = setTimeout(() => {
          unitDrag.active = true;
          unitDrag.dragEl = row;
          unitFeatureList.classList.add("reordering");
          row.classList.add("dragging");
          try { row.setPointerCapture(e.pointerId); } catch {}
        }, 350);
      });

      unitFeatureList.addEventListener("pointermove", (e) => {
        if (!unitDrag || !unitDrag.active) return;
        e.preventDefault();
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const over = el && el.closest ? el.closest('label.check[data-feature-row]') : null;
        if (!over || over === unitDrag.dragEl) return;
        if (!unitFeatureList.contains(over)) return;
        const rect = over.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        if (before) {
          unitFeatureList.insertBefore(unitDrag.dragEl, over);
        } else {
          unitFeatureList.insertBefore(unitDrag.dragEl, over.nextSibling);
        }
      }, { passive: false });

      unitFeatureList.addEventListener("pointerup", () => {
        clearTimer();
        stopDrag();
      });
      unitFeatureList.addEventListener("pointercancel", () => {
        clearTimer();
        stopDrag();
      });
      unitFeatureList.addEventListener("click", () => {
        clearTimer();
      }, true);
    }
    if (unitFeatureAll && !unitFeatureAll._boundAll) {
      unitFeatureAll._boundAll = true;
      unitFeatureAll.addEventListener("change", () => {
        if (!unitFeatureList) return;
        const next = Boolean(unitFeatureAll.checked);
        unitFeatureList.querySelectorAll("input[data-feature-id]").forEach((x) => {
          x.checked = next;
        });
        updateUnitHeaderCounts();
        updateUnitSelectAllState();
      });
    }
    if (unitFeatureList && !unitFeatureList._boundSelectAllSync) {
      unitFeatureList._boundSelectAllSync = true;
      unitFeatureList.addEventListener("change", () => updateUnitSelectAllState());
    }

    if (unitForm) {
      unitForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = String(unitCommunityId || "");
        if (!id) {
          closeUnitModal();
          return;
        }

        const uniq = [];
        const seen = new Set();
        const rows = Array.from(tbody.querySelectorAll("tr"));
        
        for (const tr of rows) {
          const uId = tr.querySelector(".u-id").value.trim();
          const address = tr.querySelector(".u-address").value.trim();
          const area = tr.querySelector(".u-area").value.trim();
          const ownership = tr.querySelector(".u-ownership").value.trim();
          
          if (!uId) continue;
          if (seen.has(uId)) continue;
          seen.add(uId);

          uniq.push({ id: uId, address, area, ownership });
        }

        if (uniq.length === 0) {
          showUnitError("請至少輸入 1 個戶號。");
          return;
        }
        setBusy(true);
        try {
          const featureButtons = (() => {
            const base = unitConfigCache && unitConfigCache.communityButtons ? unitConfigCache.communityButtons : {};
            const next = { ...base };
            if (!unitFeatureList) return next;
            const selected = new Set(
              Array.from(unitFeatureList.querySelectorAll("[data-feature-id]"))
                .filter((x) => x && x.checked)
                .map((x) => String(x.getAttribute("data-feature-id") || "").trim())
                .filter(Boolean)
            );
            adminModules.forEach((m) => {
              const prev = next[m.id] && typeof next[m.id] === "object" ? next[m.id] : {};
              next[m.id] = { ...prev, enabled: selected.has(m.id) };
            });
            return next;
          })();
          const featureOrder = getFeatureOrderFromDom();

          const rowAImages = [];
          for (let i = 0; i < 8; i++) {
            const url = document.querySelector(`[data-slot-url="${i}"]`)?.value || "";
            const data = document.getElementById(`slot_preview_${i}`)?.getAttribute("data-slot-data") || "";
            if (url || data) {
              rowAImages.push({ url, data });
            } else {
              rowAImages.push({ url: "", data: "" });
            }
          }
          const rowAInterval = parseInt(document.getElementById("modal_rowa_interval")?.value) || 5;

          const getButtonsFromDom = (containerId, defaultButtons) => {
            const container = document.getElementById(containerId);
            if (!container) return null;
            const buttons = [];
            for (let i = 0; i < 8; i++) {
              const name = container.querySelector(`[data-btn-name="${i}"]`)?.value || "";
              // 優先從內部連結選擇框獲取，如果沒有再從 URL 輸入框獲取
              const internalSelect = container.querySelector(`[data-btn-internal="${i}"]`);
              const urlInput = container.querySelector(`[data-btn-url="${i}"]`);
              let url = "";
              if (internalSelect && internalSelect.value) {
                url = internalSelect.value;
              } else if (urlInput) {
                url = urlInput.value || "";
              }
              const openExternal = container.querySelector(`[data-btn-external="${i}"]`)?.checked || false;
              const iconUrl = container.querySelector(`[data-btn-icon="${i}"]`)?.value || "";
              const data = document.getElementById(`${containerId}_preview_${i}`)?.getAttribute("data-slot-data") || "";
              const def = defaultButtons[i] || { icon: "" };
              buttons.push({
                name,
                url,
                openExternal,
                icon: iconUrl || (data ? "" : def.icon),
                data: data
              });
            }
            return buttons;
          };

          const rowDButtons = getButtonsFromDom("rowDButtonList", defaultRowDButtons) || (unitConfigCache.rowDButtons || defaultRowDButtons.map(b => ({ ...b })));
          const rowFButtons = getButtonsFromDom("rowFButtonList", defaultRowFButtons) || (unitConfigCache.rowFButtons || defaultRowFButtons.map(b => ({ ...b })));
          const serviceUrl = document.getElementById("modal_service_url")?.value || "";

          await Promise.all([
            db.collection("communities").doc(id).set(
              { units: uniq, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            ),
            configDocRef(id).set(
              { 
                communityButtons: featureButtons, 
                communityButtonsOrder: featureOrder, 
                rowAImages,
                rowAInterval,
                rowDButtons,
                rowFButtons,
                serviceUrl,
                updatedAt: FieldValue.serverTimestamp() 
              },
              { merge: true }
            ),
          ]);
          closeUnitModal();
        } catch {
          showUnitError("儲存失敗，請稍後再試。");
        } finally {
          setBusy(false);
        }
      });
    }
    if (imageUploader && imageInput) {
      const openPicker = () => imageInput.click();
      imageUploader.addEventListener("click", openPicker);
      imageUploader.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      });
      imageInput.addEventListener("change", () => {
        const file = imageInput.files && imageInput.files[0];
        if (!file) return;
        modalImageFile = file;
        const reader = new FileReader();
        reader.onload = () => setImagePreview(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
    }

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = normalizeText(inputName ? inputName.value : "");
        const code = normalizeText(inputCode ? inputCode.value : "");
        const level = normalizeText(inputLevel ? inputLevel.value : "銅") || "銅";
        const area = normalizeText(inputArea ? inputArea.value : "台北") || "台北";
        if (!name || !code) {
          showModalError("請填寫社區名稱與社區代號。");
          return;
        }
        const list = state.communities || [];
        const duplicated = list.some((c) => String(c?.username || "") === code && String(c?.id || "") !== String(editCommunityId || ""));
        if (duplicated) {
          showModalError("社區代號已存在，請更換。");
          return;
        }
        showModalInfo("儲存中...");
        setBusy(true);
        try {
          const isEdit = Boolean(editCommunityId);
          const id = isEdit ? String(editCommunityId) : db.collection("communities").doc().id;
          const existing = isEdit ? (state.communities || []).find((c) => String(c?.id || "") === id) : null;
          let imageDataUrl = existing ? String(existing.imageDataUrl || "") : "";
          if (modalImageFile) imageDataUrl = await fileToCompressedDataUrl(modalImageFile);

          const payload = {
            id,
            name,
            username: code,
            level,
            area,
            imageDataUrl,
            updatedAt: FieldValue.serverTimestamp(),
          };
          if (!isEdit) payload.createdAt = FieldValue.serverTimestamp();
          if (!isEdit) payload.enabled = true;

          await db.collection("communities").doc(id).set(payload, { merge: true });
          if (!isEdit) await saveConfig(defaultConfig(), id);
          setActiveCommunityId(id);
          closeModal();
        } catch (err) {
          const code = String(err && err.code ? err.code : "");
          if (code.includes("permission-denied")) {
            showModalError("沒有權限執行此操作。");
          } else if (code.includes("resource-exhausted")) {
            showModalError("圖片過大，請換小一點的圖片再試。");
          } else {
            showModalError("儲存失敗，請稍後再試。");
          }
        } finally {
          setBusy(false);
        }
      });
    }

    refresh();
  }

  function renderAreaFilterBar() {
    const bar = document.getElementById("areaFilter");
    if (!bar) return;
    const shouldShow = state.currentPage === "community" || state.currentPage === "accounts";
    bar.hidden = !shouldShow;
    if (!shouldShow) return;

    const titleArea = document.getElementById("communityAreaName");
    if (titleArea) {
      const rv = String(state.accountsRoleView || "resident");
      if (state.currentPage === "accounts" && rv === "community") titleArea.textContent = "社區";
      else if (state.currentPage === "accounts" && rv === "admin") titleArea.textContent = "系統管理員";
      else if (state.currentPage === "accounts") titleArea.textContent = "住戶";
      else if (state.currentPage === "community") titleArea.textContent = "社區後台";
    }

    if (state.currentPage === "accounts") {
      const rv = String(state.accountsRoleView || "resident");
      bar.innerHTML = `
        <div class="filter-left">
          <button type="button" class="filter-btn ${rv === "resident" ? "active" : ""}" data-accounts-role="resident" aria-pressed="${rv === "resident" ? "true" : "false"}">住戶</button>
        </div>
        <div class="filter-right">
          <button type="button" class="filter-btn ${rv === "community" ? "active" : ""}" data-accounts-role="community" aria-pressed="${rv === "community" ? "true" : "false"}">社區</button>
          <button type="button" class="filter-btn ${rv === "admin" ? "active" : ""}" data-accounts-role="admin" aria-pressed="${rv === "admin" ? "true" : "false"}">系統</button>
        </div>
      `.trim();
    } else if (state.currentPage === "community") {
      bar.innerHTML = `<button type="button" class="filter-btn active" data-area="社區後台" aria-pressed="true">社區後台</button>`;
    }

    // 移除旧的事件绑定，重新绑定
    const oldBar = bar.cloneNode(true);
    bar.parentNode.replaceChild(oldBar, bar);
    
    oldBar.addEventListener("click", (e) => {
      const roleBtn = e.target && e.target.closest ? e.target.closest("[data-accounts-role]") : null;
      if (roleBtn && state.currentPage === "accounts") {
        const v = String(roleBtn.getAttribute("data-accounts-role") || "resident");
        if (v === state.accountsRoleView) return;
        state.accountsRoleView = v;
        openPage("accounts");
      }
    });
  }

  function ensureCommunitiesSubscription() {
    db.collection("communities").get().then((snap) => {
      const list = snap.docs.map((d) => {
        const v = d.data() || {};
        const units = Array.isArray(v.units) ? v.units : [];
        return {
          id: String(v.id || d.id),
          name: String(v.name || ""),
          username: String(v.username || ""),
          enabled: v.enabled !== false,
          level: String(v.level || "銅"),
          area: String(v.area || "台北"),
          imageDataUrl: String(v.imageDataUrl || ""),
          units,
        };
      });

      const areaOrder = { "台北": 1, "新北": 2, "桃園": 3 };
      state.communities = list.sort((a, b) => {
        const oA = areaOrder[a.area] || 99;
        const oB = areaOrder[b.area] || 99;
        if (oA !== oB) return oA - oB;
        const cA = String(a.username || "");
        const cB = String(b.username || "");
        return cA.localeCompare(cB, "zh-TW", { numeric: true });
      });
      console.log("[Debug] state.communities loaded:", state.communities.length);
      state.communities.forEach(c => console.log(`[Debug] Community: ${c.name}, Area: ${c.area}, ID: ${c.id}`));
      openPage(state.currentPage);
    }).catch(() => {
      state.communities = [];
      openPage(state.currentPage);
    });
  }

  function ensureConfigSubscription(communityId) {
    const cid = String(communityId || "default");
    state.unsubConfig = null;
    configDocRef(cid).get().then((doc) => {
      state.configByCommunityId.set(cid, doc && doc.exists ? (doc.data() || {}) : {});
      if (state.currentPage === "links") {
        const subEl = document.getElementById("pageSubtitle");
        const accounts = loadAccounts();
        const activeId = loadActiveCommunityId(accounts);
        const activeName = accounts.communities.find((c) => c.id === activeId)?.name || activeId;
        if (subEl) subEl.textContent = `設定「社區後台」與「住戶前台」按鈕功能與連結（社區：${activeName}）`;
        renderLinks();
      }
    }).catch(() => {
      state.configByCommunityId.set(cid, {});
      if (state.currentPage === "links") {
        renderLinks();
      }
    });
  }

  function openPage(page) {
    const nextPage = PAGES.includes(String(page || "")) ? String(page || "") : "accounts";
    state.currentPage = nextPage;
    try {
      localStorage.setItem(STORAGE_LAST_PAGE, nextPage);
    } catch {}
    try {
      const nextHash = `#${nextPage}`;
      if (location.hash !== nextHash) history.replaceState(null, "", nextHash);
    } catch {}
    const titleEl = document.getElementById("pageTitle");
    const subEl = document.getElementById("pageSubtitle");
    setNavCurrent(nextPage);
    if (subEl) {
      subEl.hidden = true;
      subEl.style.display = "none";
    }

    if (nextPage === "community") {
      titleEl.textContent = "社區列表";
      subEl.textContent = "";
      renderCommunity();
      renderAreaFilterBar();
      return;
    }
    if (nextPage === "accounts") {
      titleEl.textContent = "帳號開通";
      subEl.textContent = "管理社區與住戶的登入帳號開通狀態（示意）";
      renderAccounts();
      renderAreaFilterBar();
      return;
    }
    titleEl.textContent = "連結設定";
    const accounts = loadAccounts();
    const activeId = loadActiveCommunityId(accounts);
    const activeName = accounts.communities.find((c) => c.id === activeId)?.name || activeId;
    subEl.textContent = `設定「社區後台」與「住戶前台」按鈕功能與連結（社區：${activeName}）`;
    ensureConfigSubscription(activeId);
    renderLinks();
    renderAreaFilterBar();
  }

  const btnReset = document.getElementById("btnReset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_ACTIVE_COMMUNITY);
      localStorage.removeItem(STORAGE_ACCOUNTS);
      localStorage.removeItem(STORAGE_CONFIG);
      location.reload();
    });
  }

  const bindSignOut = () => {
    const btn = document.getElementById("btnSignOut");
    if (!btn || btn._boundSignOut) return;
    btn._boundSignOut = true;
    btn.addEventListener("click", async () => {
      setBusy(true);
      try {
        sessionStorage.removeItem("csp_role");
        sessionStorage.removeItem("csp_sysadmin");
        await auth.signOut();
        location.href = "index.html";
      } catch {
        location.href = "index.html";
      }
    });
  };
  bindSignOut();
  document.addEventListener("DOMContentLoaded", bindSignOut);

  document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => openPage(b.dataset.page)));
  window.addEventListener("hashchange", () => {
    const raw = String(location.hash || "").replace(/^#/, "");
    const seg = raw ? raw.split(/[/?]/)[0] : "";
    if (!PAGES.includes(seg)) return;
    if (seg === state.currentPage) return;
    openPage(seg);
  });

  auth.onAuthStateChanged((user) => {
    const role = sessionStorage.getItem("csp_role");
    if (!user) {
      location.href = "index.html";
      return;
    }
    if (role !== "admin") {
      location.href = "index.html";
      return;
    }
    const loginInfo = document.getElementById("loginInfo");
    if (loginInfo) loginInfo.textContent = `已登入：${user.email || "（未知）"}`;
    const fallback = document.getElementById("userAvatarFallback");
    if (fallback) fallback.textContent = String(user.email || "U").trim().slice(0, 1).toUpperCase() || "U";

    ensureCommunitiesSubscription();
    openPage(state.currentPage);
  });

})();
