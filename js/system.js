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
        { id: "c001", name: "紅樹林社區", enabled: true, username: "community_admin_01" },
        { id: "c002", name: "白石社區", enabled: true, username: "community_admin_02" },
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
              <div style="display:grid; grid-template-columns: 1.05fr 0.7fr 1.25fr; gap:12px;">
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
    const formCreateCommunity = document.getElementById("formCreateCommunity");
    const cNameEl = document.getElementById("c_name");
    const cUserEl = document.getElementById("c_user");
    const submitBtn = formCreateCommunity ? formCreateCommunity.querySelector('button[type="submit"]') : null;
    let editCommunityId = "";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = "取消";
    cancelBtn.hidden = true;
    cancelBtn.addEventListener("click", () => {
      editCommunityId = "";
      if (submitBtn) submitBtn.textContent = "建立";
      cancelBtn.hidden = true;
      if (cNameEl) cNameEl.value = "";
      if (cUserEl) cUserEl.value = "";
      const s = document.getElementById("acctStatus");
      if (s) s.classList.remove("error");
    });
    if (submitBtn && submitBtn.parentElement && !submitBtn.parentElement.querySelector("[data-cancel-edit]")) {
      cancelBtn.setAttribute("data-cancel-edit", "1");
      submitBtn.parentElement.insertBefore(cancelBtn, submitBtn);
    }

    const renderLists = () => {
      const d = loadAccounts();
      const cList = document.getElementById("communityList");
      cList.innerHTML = d.communities.map((c) => `
            <div class="item">
              <div>
                <div style="font-weight:900;">${c.name}</div>
                <div class="meta">
                  <span class="tag ${c.enabled ? "red" : ""}">${c.enabled ? "啟用" : "停用"}</span>
                  <span class="tag">帳號：${c.username}</span>
                  <span class="tag">ID：${c.id}</span>
                </div>
              </div>
              <div style="display:flex; gap:10px; align-items:center;">
                <button class="btn" type="button" data-edit-community="${c.id}">編輯</button>
                <button class="btn" type="button" data-toggle-community="${c.id}">${c.enabled ? "停用" : "啟用"}</button>
              </div>
            </div>
          `).join("");

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

      document.querySelectorAll("[data-toggle-community]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-toggle-community");
          const next = loadAccounts();
          next.communities = next.communities.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c);
          saveAccounts(next);
          renderLists();
        });
      });

      document.querySelectorAll("[data-edit-community]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-edit-community");
          const next = loadAccounts();
          const c = next.communities.find((x) => x.id === id);
          if (!c) return;
          editCommunityId = id;
          if (cNameEl) cNameEl.value = c.name || "";
          if (cUserEl) cUserEl.value = c.username || "";
          if (submitBtn) submitBtn.textContent = "儲存";
          cancelBtn.hidden = false;
          communitySelect.value = id;
          setActiveCommunityId(id);
          renderLists();
        });
      });

      document.querySelectorAll("[data-toggle-resident]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-toggle-resident");
          const next = loadAccounts();
          next.residents = next.residents.map((r) => r.id === id ? { ...r, enabled: !r.enabled } : r);
          saveAccounts(next);
          renderLists();
        });
      });
    };

    communitySelect.addEventListener("change", () => {
      setActiveCommunityId(communitySelect.value);
      renderLists();
    });

    document.getElementById("formCreateCommunity").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = normalizeText(document.getElementById("c_name").value);
      const username = normalizeText(document.getElementById("c_user").value);
      if (!name || !username) {
        const s = document.getElementById("acctStatus");
        s.textContent = "請填寫社區名稱與登入帳號。";
        s.classList.add("error");
        return;
      }
      const next = loadAccounts();
      if (editCommunityId) {
        const id = editCommunityId;
        next.communities = next.communities.map((c) => c.id === id ? { ...c, name, username } : c);
        saveAccounts(next);
        setActiveCommunityId(id);
        editCommunityId = "";
        if (submitBtn) submitBtn.textContent = "建立";
        cancelBtn.hidden = true;
      } else {
        const id = `c${String(Date.now()).slice(-6)}`;
        next.communities = [{ id, name, enabled: true, username }, ...next.communities];
        saveAccounts(next);
        saveConfig(defaultConfig(), id);
        setActiveCommunityId(id);
        communitySelect.value = id;
      }
      document.getElementById("c_name").value = "";
      document.getElementById("c_user").value = "";
      communitySelect.innerHTML = next.communities.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      const s = document.getElementById("acctStatus");
      s.textContent = "已儲存社區資料。";
      s.classList.remove("error");
      renderLists();
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
      renderLists();
    });

    renderLists();
  }

  function renderCommunity() {
    const host = document.getElementById("content");
    host.innerHTML = "";
    const node = document.getElementById("tplCommunity").content.cloneNode(true);
    host.appendChild(node);

    const data = loadAccounts();
    const communities = Array.isArray(data.communities) ? data.communities : [];
    const currentId = loadActiveCommunityId(data);

    const select = document.getElementById("activeCommunitySelect");
    const label = document.getElementById("activeCommunityLabel");
    const list = document.getElementById("communityPickList");

    const setActive = (id) => {
      setActiveCommunityId(id);
      const fresh = loadAccounts();
      const active = (fresh.communities || []).find((c) => c && c.id === id);
      if (label) label.textContent = active ? `目前社區：${active.name}（${active.id}）` : `目前社區：${id}`;
      if (select) select.value = id;
      if (list) {
        list.querySelectorAll("[data-community-pick]").forEach((btn) => {
          const isActive = btn.getAttribute("data-community-pick") === id;
          btn.setAttribute("aria-current", isActive ? "page" : "false");
        });
      }
    };

    if (select) {
      select.innerHTML = communities.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
      select.value = currentId;
      select.addEventListener("change", () => setActive(select.value));
    }

    if (list) {
      list.innerHTML = communities.map((c) => `
        <button class="btn" type="button" data-community-pick="${c.id}" aria-current="${c.id === currentId ? "page" : "false"}">
          ${c.name}
        </button>
      `).join("") || `
        <div class="status">尚無社區資料。</div>
      `;
      list.querySelectorAll("[data-community-pick]").forEach((btn) => {
        btn.addEventListener("click", () => setActive(btn.getAttribute("data-community-pick")));
      });
    }

    setActive(currentId);
  }

  function openPage(page) {
    const titleEl = document.getElementById("pageTitle");
    const subEl = document.getElementById("pageSubtitle");
    setNavCurrent(page);

    if (page === "community") {
      titleEl.textContent = "社區";
      subEl.textContent = "選擇目前操作的社區（連結設定/帳號資料以此社區為準）";
      renderCommunity();
      return;
    }
    if (page === "accounts") {
      titleEl.textContent = "帳號開通";
      subEl.textContent = "管理社區與住戶的登入帳號開通狀態（示意）";
      renderAccounts();
      return;
    }
    titleEl.textContent = "連結設定";
    const accounts = loadAccounts();
    const activeId = loadActiveCommunityId(accounts);
    const activeName = accounts.communities.find((c) => c.id === activeId)?.name || activeId;
    subEl.textContent = `設定「社區後台」與「住戶前台」按鈕功能與連結（社區：${activeName}）`;
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
