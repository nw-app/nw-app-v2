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
    db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
  } catch {}

  const STORAGE_CONFIG = "csp_config_v1";
  const STORAGE_ACCOUNTS = "csp_accounts_v1";
  const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";

  const state = {
    communities: [],
    configByCommunityId: new Map(),
    unsubCommunities: null,
    unsubConfig: null,
    unsubResidents: null,
    currentPage: "accounts",
  };

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
    const statusEl = document.getElementById("acctStatus");

    const setOptions = () => {
      const list = state.communities || [];
      communitySelect.innerHTML = list.map((c) => `<option value="${c.id}">${c.name || c.id}</option>`).join("");
    };

    setOptions();
    const initialCommunityId = loadActiveCommunityId({ communities: state.communities });
    if (initialCommunityId) communitySelect.value = initialCommunityId;

    let currentResidents = [];

    const renderResidentList = () => {
      const activeId = communitySelect.value || "";
      const rList = document.getElementById("residentList");
      const residents = (currentResidents || []).filter((r) => String(r.communityId || "") === String(activeId || ""));
      rList.innerHTML = residents.map((r) => `
            <div class="item">
              <div>
                <div style="font-weight:900;">${r.unit}｜${r.name}</div>
                <div class="meta">
                  <span class="tag ${r.enabled ? "red" : ""}">${r.enabled ? "已開通" : "未開通"}</span>
                  <span class="tag">帳號：${r.username}</span>
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

      rList.querySelectorAll("[data-toggle-resident]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-toggle-resident");
          const found = (currentResidents || []).find((x) => String(x.id || "") === String(id || ""));
          if (!id || !found) return;
          setBusy(true);
          try {
            await db.collection("users").doc(String(id)).set(
              { enabled: !found.enabled, updatedAt: FieldValue.serverTimestamp() },
              { merge: true }
            );
          } catch {
            if (statusEl) {
              statusEl.textContent = "更新失敗，請稍後再試。";
              statusEl.classList.add("error");
            }
          } finally {
            setBusy(false);
          }
        });
      });
    };

    const subscribeResidents = (communityId) => {
      if (state.unsubResidents) state.unsubResidents();
      currentResidents = [];
      const rList = document.getElementById("residentList");
      if (rList) rList.innerHTML = `<div class="status">讀取中...</div>`;
      const cid = String(communityId || "default");
      state.unsubResidents = db.collection("users").where("community", "==", cid).onSnapshot(
        (snap) => {
          currentResidents = snap.docs.map((d) => {
            const v = d.data() || {};
            const role = String(v.role || "");
            if (role && role !== "住戶") return null;
            return {
              id: d.id,
              communityId: String(v.community || cid),
              unit: String(v.houseNo || v.unit || ""),
              name: String(v.displayName || v.name || ""),
              username: String(v.username || ""),
              enabled: v.enabled !== false,
            };
          }).filter(Boolean);
          renderResidentList();
        },
        () => {
          if (statusEl) {
            statusEl.textContent = "讀取住戶資料失敗。";
            statusEl.classList.add("error");
          }
        }
      );
    };

    communitySelect.addEventListener("change", () => {
      setActiveCommunityId(communitySelect.value);
      subscribeResidents(communitySelect.value);
    });

    document.getElementById("formCreateResident").addEventListener("submit", async (e) => {
      e.preventDefault();
      const communityId = communitySelect.value;
      const unit = normalizeText(document.getElementById("r_unit").value);
      const name = normalizeText(document.getElementById("r_name").value);
      const username = normalizeText(document.getElementById("r_user").value);
      const enabled = document.getElementById("r_enabled").value === "true";
      if (!communityId || !unit || !name || !username) {
        if (statusEl) {
          statusEl.textContent = "請填寫所屬社區、戶號、姓名與登入帳號（示意）。";
          statusEl.classList.add("error");
        }
        return;
      }

      setBusy(true);
      try {
        const id = db.collection("users").doc().id;
        await db.collection("users").doc(id).set(
          {
            role: "住戶",
            community: String(communityId || "default"),
            houseNo: unit,
            displayName: name,
            username,
            enabled: Boolean(enabled),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        document.getElementById("r_unit").value = "";
        document.getElementById("r_name").value = "";
        document.getElementById("r_user").value = "";
        if (statusEl) {
          statusEl.textContent = "已建立住戶帳號（示意）。";
          statusEl.classList.remove("error");
        }
      } catch {
        if (statusEl) {
          statusEl.textContent = "建立失敗，請稍後再試。";
          statusEl.classList.add("error");
        }
      } finally {
        setBusy(false);
      }
    });

    subscribeResidents(initialCommunityId || communitySelect.value || "default");
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
    let modalImageFile = null;
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
      cList.innerHTML = (d.communities || []).map((c) => `
            <div class="item community-item">
              <div class="community-row1">
                <div class="community-row1-left">
                  <div class="community-thumb">
                    ${c.imageDataUrl ? `<img src="${c.imageDataUrl}" alt="社區圖片">` : `<div class="fallback">2:1</div>`}
                  </div>
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

  function ensureCommunitiesSubscription() {
    if (state.unsubCommunities) return;
    state.unsubCommunities = db.collection("communities").onSnapshot(
      (snap) => {
        state.communities = snap.docs.map((d) => {
          const v = d.data() || {};
          return {
            id: String(v.id || d.id),
            name: String(v.name || ""),
            username: String(v.username || ""),
            enabled: v.enabled !== false,
            level: String(v.level || "銅"),
            imageDataUrl: String(v.imageDataUrl || ""),
          };
        });
        openPage(state.currentPage);
      },
      () => {
        state.communities = [];
        openPage(state.currentPage);
      }
    );
  }

  function ensureConfigSubscription(communityId) {
    const cid = String(communityId || "default");
    if (state.unsubConfig) state.unsubConfig();
    state.unsubConfig = configDocRef(cid).onSnapshot(
      (doc) => {
        state.configByCommunityId.set(cid, doc && doc.exists ? (doc.data() || {}) : {});
        if (state.currentPage === "links") {
          const subEl = document.getElementById("pageSubtitle");
          const accounts = loadAccounts();
          const activeId = loadActiveCommunityId(accounts);
          const activeName = accounts.communities.find((c) => c.id === activeId)?.name || activeId;
          if (subEl) subEl.textContent = `設定「社區後台」與「住戶前台」按鈕功能與連結（社區：${activeName}）`;
          renderLinks();
        }
      },
      () => {
        state.configByCommunityId.set(cid, {});
        if (state.currentPage === "links") {
          renderLinks();
        }
      }
    );
  }

  function openPage(page) {
    state.currentPage = page;
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
    ensureConfigSubscription(activeId);
    renderLinks();
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
