(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  const auth = firebase.auth();

  const STORAGE_CONFIG = "csp_config_v1";
  const STORAGE_ACCOUNTS = "csp_accounts_v1";
  const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";

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

  function ensureConfigMigrated(communityId) {
    const key = configKey(communityId);
    if (localStorage.getItem(key)) return;
    const legacy = localStorage.getItem(STORAGE_CONFIG);
    if (legacy) localStorage.setItem(key, legacy);
  }

  function loadConfig(communityId) {
    try {
      ensureConfigMigrated(communityId);
      const raw = localStorage.getItem(configKey(communityId));
      if (!raw) return defaultConfig();
      const parsed = JSON.parse(raw);
      const d = defaultConfig();
      return {
        communityButtons: { ...d.communityButtons, ...(parsed.communityButtons || {}) },
        residentButtons: { ...d.residentButtons, ...(parsed.residentButtons || {}) },
      };
    } catch {
      return defaultConfig();
    }
  }

  function saveConfig(cfg, communityId) {
    localStorage.setItem(configKey(communityId), JSON.stringify(cfg));
  }

  function defaultAccounts() {
    return {
      communities: [
        { id: "c001", name: "紅樹林社區", enabled: true, username: "community_admin_01", level: "銅", image: "" },
        { id: "c002", name: "白石社區", enabled: true, username: "community_admin_02", level: "銅", image: "" },
      ],
      residents: [
        { id: "r001", communityId: "c001", unit: "A-1203", name: "林小姐", enabled: true, username: "A1203" },
        { id: "r002", communityId: "c001", unit: "B-0808", name: "陳先生", enabled: true, username: "B0808" },
        { id: "r003", communityId: "c002", unit: "C-0501", name: "張小姐", enabled: false, username: "C0501" },
      ],
    };
  }

  function loadAccounts() {
    try {
      const raw = localStorage.getItem(STORAGE_ACCOUNTS);
      if (!raw) return defaultAccounts();
      const parsed = JSON.parse(raw);
      const d = defaultAccounts();
      return {
        communities: Array.isArray(parsed.communities) ? parsed.communities : d.communities,
        residents: Array.isArray(parsed.residents) ? parsed.residents : d.residents,
      };
    } catch {
      return defaultAccounts();
    }
  }

  function saveAccounts(data) {
    localStorage.setItem(STORAGE_ACCOUNTS, JSON.stringify(data));
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

    document.getElementById("btnSaveLinks").addEventListener("click", () => {
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
      saveConfig(next, activeCommunityId);
      const s = document.getElementById("linksStatus");
      s.textContent = `已儲存設定（社區：${activeCommunityName}）。`;
      s.classList.remove("error");
    });
  }

  function renderAccounts() {
    const host = document.getElementById("content");
    host.innerHTML = "";
    const node = document.getElementById("tplAccounts").content.cloneNode(true);
    host.appendChild(node);

    const data = loadAccounts();
    const communitySelect = document.getElementById("r_community");
    communitySelect.innerHTML = data.communities.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    const initialCommunityId = loadActiveCommunityId(data);
    if (initialCommunityId) communitySelect.value = initialCommunityId;

    const renderResidentList = () => {
      const d = loadAccounts();
      const activeId = communitySelect.value || d.communities[0]?.id || "";
      const rList = document.getElementById("residentList");
      const residents = d.residents.filter((r) => r.communityId === activeId);
      rList.innerHTML = residents.map((r) => `
            <div class="item">
              <div>
                <div style="font-weight:900;">${r.unit}｜${r.name}</div>
                <div class="meta">
                  <span class="tag ${r.enabled ? "red" : ""}">${r.enabled ? "已開通" : "未開通"}</span>
                  <span class="tag">帳號：${r.username}</span>
                  <span class="tag">ID：${r.id}</span>
                </div>
              </div>
              <button class="btn" type="button" data-toggle-resident="${r.id}">${r.enabled ? "停用" : "啟用"}</button>
            </div>
          `).join("") || `
            <div class="item">
              <div>
                <div style="font-weight:900;">尚無住戶帳號</div>
                <div class="meta"><span class="tag">提示</span></div>
              </div>
              <span class="tag">—</span>
            </div>
          `;

      document.querySelectorAll("[data-toggle-resident]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-toggle-resident");
          const next = loadAccounts();
          next.residents = next.residents.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r);
          saveAccounts(next);
          renderResidentList();
        });
      });
    };

    communitySelect.addEventListener("change", () => {
      setActiveCommunityId(communitySelect.value);
      renderResidentList();
    });

    document.getElementById("formCreateResident").addEventListener("submit", (e) => {
      e.preventDefault();
      const communityId = communitySelect.value;
      const unit = normalizeText(document.getElementById("r_unit").value);
      const name = normalizeText(document.getElementById("r_name").value);
      const username = normalizeText(document.getElementById("r_user").value);
      const enabled = document.getElementById("r_enabled").value === "true";
      if (!communityId || !unit || !name || !username) {
        const s = document.getElementById("acctStatus");
        s.textContent = "請填寫所屬社區、戶號、姓名與登入帳號（示意）。";
        s.classList.add("error");
        return;
      }
      const next = loadAccounts();
      const id = `r${String(Date.now()).slice(-6)}`;
      next.residents = [{ id, communityId, unit, name, enabled, username }, ...next.residents];
      saveAccounts(next);
      document.getElementById("r_unit").value = "";
      document.getElementById("r_name").value = "";
      document.getElementById("r_user").value = "";
      const s = document.getElementById("acctStatus");
      s.textContent = "已建立住戶帳號（示意）。";
      s.classList.remove("error");
      renderResidentList();
    });

    renderResidentList();
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
    const imageInput = document.getElementById("communityImageInput");
    const imagePreview = document.getElementById("communityImagePreview");
    const imagePlaceholder = document.getElementById("communityImagePlaceholder");
    const imageUploader = document.getElementById("communityImageUploader");
    const submitBtn = document.getElementById("btnSubmitCommunityModal");
    const cancelBtn = document.getElementById("btnCancelCommunityModal");
    const closeBtn = document.getElementById("btnCloseCommunityModal");
    const backdrop = modal ? modal.querySelector("[data-modal-close]") : null;

    let editCommunityId = "";
    let modalImageData = "";
    let detachKeydown = () => {};

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
    };

    const closeModal = () => {
      if (!modal) return;
      modal.hidden = true;
      editCommunityId = "";
      setImagePreview("");
      clearModalStatus();
      if (form) form.reset();
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
      setImagePreview(mode === "edit" && community ? String(community.image || "") : "");
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
      cList.innerHTML = (d.communities || []).map((c) => `
            <div class="item community-item">
              <div class="community-thumb">
                ${c.image ? `<img src="${c.image}" alt="社區圖片">` : `<div class="fallback">2:1</div>`}
              </div>
              <div>
                <div style="font-weight:900;">${c.name}</div>
                <div class="meta">
                  ${levelBadgeHtml(c.level)}
                  <div class="switch-label">${c.enabled ? "啟用" : "停用"}</div>
                  <label class="switch">
                    <input type="checkbox" data-toggle-community="${c.id}" ${c.enabled ? "checked" : ""} />
                    <span class="slider"></span>
                  </label>
                  <div class="tag">代號：${c.username}</div>
                </div>
              </div>
              <div class="community-actions">
                <button class="btn" type="button" data-edit-community="${c.id}">編輯</button>
                <button class="btn" type="button" data-delete-community="${c.id}">刪除</button>
              </div>
            </div>
          `).join("") || `<div class="status">尚無社區資料。</div>`;

      cList.querySelectorAll("[data-toggle-community]").forEach((input) => {
        input.addEventListener("change", () => {
          const id = input.getAttribute("data-toggle-community");
          const next = loadAccounts();
          next.communities = (next.communities || []).map((c) => c.id === id ? { ...c, enabled: input.checked } : c);
          saveAccounts(next);
          refresh();
        });
      });

      cList.querySelectorAll("[data-edit-community]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-edit-community");
          const next = loadAccounts();
          const c = (next.communities || []).find((x) => x.id === id);
          if (!c) return;
          setActiveCommunityId(id);
          openModal("edit", c);
        });
      });

      cList.querySelectorAll("[data-delete-community]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-delete-community");
          const next = loadAccounts();
          next.communities = (next.communities || []).filter((c) => c.id !== id);
          saveAccounts(next);
          const activeId = loadActiveCommunityId(next);
          if (!next.communities.find((c) => c.id === activeId)) {
            setActiveCommunityId(next.communities[0]?.id || "default");
          }
          refresh();
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
        const reader = new FileReader();
        reader.onload = () => setImagePreview(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
    }

    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = normalizeText(inputName ? inputName.value : "");
        const code = normalizeText(inputCode ? inputCode.value : "");
        const level = normalizeText(inputLevel ? inputLevel.value : "銅") || "銅";
        if (!name || !code) {
          showModalError("請填寫社區名稱與社區代號。");
          return;
        }
        const next = loadAccounts();
        const list = next.communities || [];
        const duplicated = list.some((c) => String(c?.username || "") === code && String(c?.id || "") !== String(editCommunityId || ""));
        if (duplicated) {
          showModalError("社區代號已存在，請更換。");
          return;
        }

        if (editCommunityId) {
          const id = editCommunityId;
          next.communities = list.map((c) => c.id === id ? { ...c, name, username: code, level, image: modalImageData } : c);
          saveAccounts(next);
          setActiveCommunityId(id);
        } else {
          const id = `c${String(Date.now()).slice(-6)}`;
          next.communities = [{ id, name, enabled: true, username: code, level, image: modalImageData }, ...list];
          saveAccounts(next);
          saveConfig(defaultConfig(), id);
          setActiveCommunityId(id);
        }

        closeModal();
        refresh();
      });
    }

    refresh();
  }

  function openPage(page) {
    const titleEl = document.getElementById("pageTitle");
    const subEl = document.getElementById("pageSubtitle");
    setNavCurrent(page);

    if (page === "community") {
      titleEl.textContent = "社區列表";
      subEl.textContent = "";
      subEl.style.display = "none";
      renderCommunity();
      return;
    }
    if (page === "accounts") {
      titleEl.textContent = "帳號開通";
      subEl.textContent = "管理社區與住戶的登入帳號開通狀態（示意）";
      subEl.style.display = "";
      renderAccounts();
      return;
    }
    titleEl.textContent = "連結設定";
    const accounts = loadAccounts();
    const activeId = loadActiveCommunityId(accounts);
    const activeName = accounts.communities.find((c) => c.id === activeId)?.name || activeId;
    subEl.textContent = `設定「社區後台」與「住戶前台」按鈕功能與連結（社區：${activeName}）`;
    subEl.style.display = "";
    renderLinks();
  }

  document.getElementById("btnReset").addEventListener("click", () => {
    const accounts = defaultAccounts();
    saveAccounts(accounts);
    localStorage.removeItem(STORAGE_CONFIG);
    accounts.communities.forEach((c) => {
      localStorage.removeItem(configKey(c.id));
      saveConfig(defaultConfig(), c.id);
    });
    openPage("accounts");
  });

  document.getElementById("btnSignOut").addEventListener("click", async () => {
    setBusy(true);
    try {
      sessionStorage.removeItem("csp_role");
      await auth.signOut();
      location.href = "index.html";
    } catch {
      location.href = "index.html";
    }
  });

  document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => openPage(b.dataset.page)));

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
    document.getElementById("loginInfo").textContent = `已登入：${user.email || "（未知）"}`;
    const fallback = document.getElementById("userAvatarFallback");
    if (fallback) fallback.textContent = String(user.email || "U").trim().slice(0, 1).toUpperCase() || "U";
  });

  openPage("accounts");
})();
