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
    communityAreaFilter: "全部",
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
    if (["全部", "台北", "新北", "桃園"].includes(savedArea)) state.communityAreaFilter = savedArea;
  } catch {}

  const catalogCommunityButtons = [
    { id: "parcel", name: "包裹郵件", defaultUrl: "#community/parcel" },
    { id: "visitor", name: "訪客登記", defaultUrl: "#community/visitor" },
    { id: "residents", name: "住戶造冊", defaultUrl: "#community/residents" },
    { id: "facility", name: "設施預約", defaultUrl: "#community/facility" },
    { id: "bulletin", name: "公告系統", defaultUrl: "#community/bulletin" },
    { id: "parking", name: "綠色停車", defaultUrl: "#community/parking" },
  ];

  const catalogResidentButtons = [
    { id: "resident-bulletin", name: "公告", defaultUrl: "#resident/resident-bulletin" },
    { id: "resident-parcel", name: "包裹通知", defaultUrl: "#resident/resident-parcel" },
    { id: "resident-facility", name: "設施預約", defaultUrl: "#resident/resident-facility" },
    { id: "resident-parking", name: "綠色停車", defaultUrl: "#resident/resident-parking" },
  ];

  function defaultConfig() {
    const toButton = (x) => ({ enabled: true, url: x.defaultUrl });
    return {
      communityButtons: Object.fromEntries(catalogCommunityButtons.map((x) => [x.id, toButton(x)])),
      residentButtons: Object.fromEntries(catalogResidentButtons.map((x) => [x.id, toButton(x)])),
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
      const area = String(state.communityAreaFilter || "全部");
      const list = state.communities || [];
      return list.filter((c) => area === "全部" ? true : String(c?.area || "") === area);
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
      const ok = Boolean(unit) && units.some((x) => String(x || "").trim() === unit);
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
      const html = list.map((c) => `<option value="${c.id}">${c.name || c.id}</option>`).join("");
      communitySelect.innerHTML = html;
      if (inputCommunity) {
        inputCommunity.innerHTML = html;
      }
      return list;
    };

    const optionList = setOptions();
    const pickedCommunityId = loadActiveCommunityId({ communities: optionList }) || "";
    if (pickedCommunityId && optionList.some((c) => String(c?.id || "") === String(pickedCommunityId))) {
      communitySelect.value = pickedCommunityId;
    } else if (optionList[0]) {
      communitySelect.value = String(optionList[0].id || "");
    }
    if (communitySelect.value) setActiveCommunityId(communitySelect.value);

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
      const list = view === "admin" ? (currentUsers || []) : (currentUsers || []).filter((r) => String(r.communityId || "") === String(activeId || ""));
      const title = view === "admin" ? "系統管理員" : view === "community" ? "社區" : "住戶";
      rList.innerHTML = list.map((r) => {
        const unitText = String(r.unit || "").trim();
        const sub = view === "resident" && unitText ? `<div class="account-sub">${unitText}</div>` : "";
        return `
            <div class="item account-item">
              <div class="account-left">
                <div class="avatar-sm">${avatarHtml(r)}</div>
                <div class="account-text">
                  <div class="account-name">${String(r.name || "—")}</div>
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
          setBusy(true);
          try {
            await db.collection("users").doc(String(id)).set(
              { enabled: Boolean(input.checked), updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          } catch {
          } finally {
            setBusy(false);
          }
        });
      });
    };

    const subscribeUsers = (communityId) => {
      if (state.unsubResidents) state.unsubResidents();
      currentUsers = [];
      const rList = document.getElementById("residentList");
      if (rList) rList.innerHTML = `<div class="status">讀取中...</div>`;
      const cid = String(communityId || "default");
      const view = String(state.accountsRoleView || "resident");
      const base = db.collection("users");
      const q =
        view === "admin"
          ? base.where("role", "in", ["系統管理員", "系統管理者", "系統", "admin"])
          : base.where("community", "==", cid);

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

      q.get().then((snap) => {
        if (didLoad) return;
        window.clearTimeout(t);
        applySnap(snap);
      }).catch((err) => {
        window.clearTimeout(t);
        onError(err);
      });

      state.unsubResidents = null;
    };

    communitySelect.addEventListener("change", () => {
      setActiveCommunityId(communitySelect.value);
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
    subscribeUsers(communitySelect.value || "default");

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
    const unitTextarea = document.getElementById("modal_units_text");
    const unitStatus = document.getElementById("unitModalStatus");
    const unitCloseBtn = document.getElementById("btnCloseUnitModal");
    const unitCancelBtn = document.getElementById("btnCancelUnitModal");
    const unitBackdrop = unitModal ? unitModal.querySelector("[data-modal-close]") : null;

    let editCommunityId = "";
    let modalImageData = "";
    let modalImageFile = null;
    let detachKeydown = () => {};
    let unitCommunityId = "";
    let detachUnitKeydown = () => {};

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
      const area = String(state.communityAreaFilter || "全部");
      const list = (d.communities || []).filter((c) => area === "全部" ? true : String(c?.area || "") === area);
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
                  <button class="icon-btn" type="button" data-units-community="${c.id}" aria-label="戶號" title="戶號">
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M7 7h10M7 12h10M7 17h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                      <path d="M5.2 5.2h13.6v13.6H5.2z" stroke="currentColor" stroke-width="1.7" opacity="0.65"/>
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

    const closeUnitModal = () => {
      if (!unitModal) return;
      unitModal.hidden = true;
      detachUnitKeydown();
      detachUnitKeydown = () => {};
      unitCommunityId = "";
      clearUnitStatus();
    };

    const openUnitModal = (community) => {
      if (!unitModal || !unitTextarea) return;
      unitCommunityId = String(community?.id || "");
      const list = Array.isArray(community?.units) ? community.units : [];
      unitTextarea.value = list.map((x) => String(x || "").trim()).filter(Boolean).join("\n");
      clearUnitStatus();
      unitModal.hidden = false;
      unitTextarea.focus();
      const onKeydown = (e) => {
        if (e.key === "Escape") closeUnitModal();
      };
      document.addEventListener("keydown", onKeydown);
      detachUnitKeydown = () => document.removeEventListener("keydown", onKeydown);
    };

    if (unitCancelBtn) unitCancelBtn.addEventListener("click", closeUnitModal);
    if (unitCloseBtn) unitCloseBtn.addEventListener("click", closeUnitModal);
    if (unitBackdrop) unitBackdrop.addEventListener("click", closeUnitModal);

    if (unitForm) {
      unitForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = String(unitCommunityId || "");
        if (!id) {
          closeUnitModal();
          return;
        }
        const raw = String(unitTextarea ? unitTextarea.value : "");
        const lines = raw.split(/\r?\n/).map((x) => String(x || "").trim()).filter(Boolean);
        const uniq = [];
        const seen = new Set();
        for (const x of lines) {
          const k = x;
          if (seen.has(k)) continue;
          seen.add(k);
          uniq.push(k);
        }
        if (uniq.length === 0) {
          showUnitError("請至少輸入 1 個戶號（每行一戶）。");
          return;
        }
        setBusy(true);
        try {
          await db.collection("communities").doc(id).set(
            { units: uniq, updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
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

    const options = ["全部", "台北", "新北", "桃園"];
    const current = String(state.communityAreaFilter || "全部");
    const titleArea = document.getElementById("communityAreaName");
    if (titleArea) {
      const rv = String(state.accountsRoleView || "resident");
      if (state.currentPage === "accounts" && rv === "community") titleArea.textContent = "社區";
      else if (state.currentPage === "accounts" && rv === "admin") titleArea.textContent = "系統管理員";
      else titleArea.textContent = current;
    }

    if (state.currentPage === "accounts") {
      const rv = String(state.accountsRoleView || "resident");
      bar.innerHTML = `
        <div class="filter-left">
          ${options.map((x) => `
              <button type="button" class="filter-btn ${rv === "resident" && x === current ? "active" : ""}" data-area="${x}" aria-pressed="${rv === "resident" && x === current ? "true" : "false"}">${x}</button>
            `).join("")}
        </div>
        <div class="filter-right">
          <button type="button" class="filter-btn ${rv === "community" ? "active" : ""}" data-accounts-role="community" aria-pressed="${rv === "community" ? "true" : "false"}">社區</button>
          <button type="button" class="filter-btn ${rv === "admin" ? "active" : ""}" data-accounts-role="admin" aria-pressed="${rv === "admin" ? "true" : "false"}">系統</button>
        </div>
      `.trim();
    } else {
      bar.innerHTML = options.map((x) => `
          <button type="button" class="filter-btn ${x === current ? "active" : ""}" data-area="${x}" aria-pressed="${x === current ? "true" : "false"}">${x}</button>
        `).join("");
    }

    if (bar._boundAreaFilter) return;
    bar._boundAreaFilter = true;
    bar.addEventListener("click", (e) => {
      const roleBtn = e.target && e.target.closest ? e.target.closest("[data-accounts-role]") : null;
      if (roleBtn && state.currentPage === "accounts") {
        const v = String(roleBtn.getAttribute("data-accounts-role") || "resident");
        if (v === state.accountsRoleView) return;
        state.accountsRoleView = v;
        openPage("accounts");
        return;
      }

      const t = e.target && e.target.closest ? e.target.closest("[data-area]") : null;
      if (!t) return;
      const v = String(t.getAttribute("data-area") || "全部");
      const cur = String(state.communityAreaFilter || "全部");
      const roleView = String(state.accountsRoleView || "resident");
      const shouldForceToResident = state.currentPage === "accounts" && roleView !== "resident";
      if (v === cur && !shouldForceToResident) return;
      state.communityAreaFilter = v;
      if (state.currentPage === "accounts") state.accountsRoleView = "resident";
      try {
        localStorage.setItem(STORAGE_AREA_FILTER, v);
      } catch {}
      openPage(state.currentPage);
    });
  }

  function ensureCommunitiesSubscription() {
    db.collection("communities").get().then((snap) => {
      const list = snap.docs.map((d) => {
        const v = d.data() || {};
        const units = Array.isArray(v.units) ? v.units.map((x) => String(x || "").trim()).filter(Boolean) : [];
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
