(() => {
  const statusEl = document.getElementById("status");
  const setStatus = (text, isError) => {
    if (!statusEl) return;
    statusEl.textContent = String(text || "");
    statusEl.classList.toggle("error", Boolean(isError));
  };

  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) {
    setStatus("系統初始化失敗：缺少 FIREBASE_CONFIG。", true);
    return;
  }
  if (typeof firebase === "undefined") {
    setStatus("系統初始化失敗：無法載入 Firebase。請確認網路或關閉擋廣告/防火牆設定後重整。", true);
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  let auth = null;
  let db = null;
  try {
    auth = firebase.auth();
    db = typeof firebase.firestore === "function" ? firebase.firestore() : null;
  } catch {
    setStatus("系統初始化失敗：Firebase Auth/Firestore 無法啟動。", true);
    return;
  }
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

  const loginForm = document.getElementById("loginForm");
  const btnLogin = document.getElementById("btnLogin");
  const rememberEl = document.getElementById("rememberMe");
  const btnApply = document.getElementById("btnApply");
  const btnTogglePassword = document.getElementById("btnTogglePassword");

  function setBusy(isBusy) {
    btnLogin.disabled = Boolean(isBusy);
  }

  async function ensureAnonAuth() {
    try {
      if (auth.currentUser) return auth.currentUser;
      const res = await auth.signInAnonymously();
      return res && res.user ? res.user : auth.currentUser;
    } catch (err) {
      console.error("Anonymous auth failed:", err);
      throw err;
    }
  }

  function goTo(url) {
    const raw = String(url || "").trim();
    const cleaned = raw ? raw.replace(/\/+$/, "") : "";
    const lower = cleaned.toLowerCase();
    const target =
      !cleaned ? "index.html" :
      cleaned.startsWith("http://") || cleaned.startsWith("https://") ? cleaned :
      lower === "/" || lower === "/index" || lower === "index" ? "index.html" :
      lower === "system" || lower === "/system" || lower === "system.html" || lower === "/system.html" ? routes.admin :
      lower === "community" || lower === "/community" || lower === "admin" || lower === "/admin" ? routes.community :
      lower === "member" || lower === "/member" || lower === "resident" || lower === "/resident" ? routes.resident :
      cleaned.startsWith("/") ? cleaned.slice(1) :
      cleaned;
    if (window.__nw_redirecting) return;
    window.__nw_redirecting = target;
    window.location.replace(target);
  }

  if (btnApply) {
    btnApply.addEventListener("click", () => {
      openApplyResidentModal();
    });
  }

  function openApplyResidentModal() {
    let modal = document.getElementById("applyResidentModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "modal";
      modal.id = "applyResidentModal";
      modal.hidden = true;
      modal.innerHTML = `
        <div class="modal-backdrop" data-modal-close="1"></div>
        <div class="modal-container">
          <div class="modal-dialog large">
            <div class="modal-hd">
              <h3 class="modal-title">住戶帳號申請</h3>
              <button class="modal-close" type="button" data-modal-close="1">×</button>
            </div>
            <div class="modal-body">
              <div id="applyStep1" class="apply-step">
                <div class="step-info">第一步：輸入社區代號</div>
                <div class="field">
                  <label for="applyCommunityCode">社區代號</label>
                  <div class="input-with-suffix">
                    <input id="applyCommunityCode" type="text" placeholder="例如: TM101" autocomplete="off" />
                    <span id="applyCommunityName" class="input-suffix-name"></span>
                  </div>
                </div>
              </div>
              <div id="applyStep2" class="apply-step" hidden>
              <div class="step-info">第二步：輸入戶號</div>
              <div class="field">
                <label for="applyHouseNo">戶號</label>
                <div class="input-with-suffix">
                  <input id="applyHouseNo" type="text" placeholder="例如: A1-10F" autocomplete="off" list="applyHouseNoList" />
                  <datalist id="applyHouseNoList"></datalist>
                  <span id="applyHouseStatus" class="input-suffix-name"></span>
                </div>
              </div>
            </div>
              <div id="applyStep3" class="apply-step" hidden>
              <div class="step-info">第三步：大頭照 (上傳或選擇內建)</div>
              <div class="field">
                <div class="image-uploader" id="applyAvatarUploader">
                  <div class="image-preview" id="applyAvatarPreview">
                    <span class="placeholder">點擊上傳照片</span>
                  </div>
                  <input type="file" id="applyAvatarInput" accept="image/*" hidden />
                </div>
              </div>
              <div class="built-in-avatars">
                <div class="built-in-title">或選擇系統內建：</div>
                <div class="avatar-grid">
                  <div class="avatar-option" data-url="photo/h01.png">
                    <img src="photo/h01.png" alt="h01" />
                  </div>
                  <div class="avatar-option" data-url="photo/h02.png">
                    <img src="photo/h02.png" alt="h02" />
                  </div>
                  <div class="avatar-option" data-url="photo/h03.png">
                    <img src="photo/h03.png" alt="h03" />
                  </div>
                  <div class="avatar-option" data-url="photo/h04.png">
                    <img src="photo/h04.png" alt="h04" />
                  </div>
                </div>
              </div>
            </div>
              <div id="applyStep4" class="apply-step" hidden>
                <div class="step-info">第四步：輸入基本資料</div>
                <div class="field">
                  <label for="applyName">姓名</label>
                  <input id="applyName" type="text" placeholder="請輸入姓名" autocomplete="off" />
                </div>
                <div class="field">
                  <label for="applyEmail">電子郵件</label>
                  <input id="applyEmail" type="email" placeholder="請輸入 Email" autocomplete="off" />
                </div>
                <div class="field">
                <label for="applyPhone">手機號碼</label>
                <input id="applyPhone" type="tel" placeholder="請輸入手機號碼" autocomplete="off" />
              </div>
              <div class="field">
                <label for="applyPassword">密碼 (選填)</label>
                <input id="applyPassword" type="password" placeholder="預設為手機號碼" autocomplete="off" />
              </div>
            </div>
              <div id="applyStep5" class="apply-step" hidden>
                <div class="apply-complete-msg">
                  <div class="icon-success">✓</div>
                  <p>已完成申請，等待管理員開通帳號，謝謝！</p>
                </div>
              </div>
              <div class="status" id="applyStatus" hidden></div>
            </div>
            <div class="modal-ft" id="applyModalFt">
              <button class="btn" type="button" id="btnApplyPrev" hidden>上一步</button>
              <button class="btn btn-primary" type="button" id="btnApplyNext">下一步</button>
            </div>
          </div>
        </div>
      `.trim();
      document.body.appendChild(modal);
    }

    const steps = [1, 2, 3, 4, 5];
    let currentStep = 1;
    const data = {
      communityCode: "",
      houseNo: "",
      avatarDataUrl: "",
      name: "",
      email: "",
      phone: ""
    };

    const statusEl = modal.querySelector("#applyStatus");
    const setModalStatus = (msg, isError) => {
      statusEl.textContent = msg || "";
      statusEl.hidden = !msg;
      statusEl.classList.toggle("error", !!isError);
    };

    const updateStepUI = () => {
      steps.forEach(s => {
        const el = modal.querySelector(`#applyStep${s}`);
        if (el) el.hidden = (s !== currentStep);
      });
      
      const btnPrev = modal.querySelector("#btnApplyPrev");
      const btnNext = modal.querySelector("#btnApplyNext");
      
      // 第一步至第四步均不顯示「上一步」按鈕
      btnPrev.hidden = true; 
      // 顯示下一步按鈕 (直到完成申請為止)
      btnNext.hidden = (currentStep >= 5);
      
      if (currentStep === 5) {
        modal.querySelector("#applyModalFt").innerHTML = `<button class="btn btn-primary" type="button" data-modal-close="1">關閉</button>`;
      }
      setModalStatus("");
    };

    const avatarUploader = modal.querySelector("#applyAvatarUploader");
    const avatarInput = modal.querySelector("#applyAvatarInput");
    const avatarPreview = modal.querySelector("#applyAvatarPreview");

    const applyCommunityCodeEl = modal.querySelector("#applyCommunityCode");
    const applyCommunityNameEl = modal.querySelector("#applyCommunityName");
    const applyHouseNoEl = modal.querySelector("#applyHouseNo");
    const applyHouseStatusEl = modal.querySelector("#applyHouseStatus");
    const applyHouseNoListEl = modal.querySelector("#applyHouseNoList");

    const updateHouseNoDatalist = (units) => {
      if (!applyHouseNoListEl) return;
      const list = Array.isArray(units) ? units : [];
      let html = `<option value="訪客"></option>`;
      html += list.map(u => {
        const uid = (typeof u === "object" && u !== null) ? String(u.id || "") : String(u || "");
        return `<option value="${escapeHtml(uid.trim())}"></option>`;
      }).join("");
      applyHouseNoListEl.innerHTML = html;
    };

    function escapeHtml(str) {
      return String(str || "").replace(/[&<>"']/g, m => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[m]);
    }

    if (applyCommunityCodeEl) {
      applyCommunityCodeEl.oninput = async () => {
        const code = applyCommunityCodeEl.value.trim();
        if (!code) {
          applyCommunityNameEl.textContent = "";
          data.communityUnits = [];
          updateHouseNoDatalist([]);
          return;
        }
        try {
          const snap = await db.collection("communities").where("username", "==", code).get();
          if (!snap.empty) {
            const cdata = snap.docs[0].data();
            applyCommunityNameEl.textContent = String(cdata.name || "");
            data.communityUnits = Array.isArray(cdata.units) ? cdata.units : [];
          } else {
            const doc = await db.collection("communities").doc(code).get();
            if (doc.exists) {
              const cdata = doc.data();
              applyCommunityNameEl.textContent = String(cdata.name || "");
              data.communityUnits = Array.isArray(cdata.units) ? cdata.units : [];
            } else {
              applyCommunityNameEl.textContent = "";
              data.communityUnits = [];
            }
          }
          updateHouseNoDatalist(data.communityUnits);
        } catch {
          applyCommunityNameEl.textContent = "";
          data.communityUnits = [];
          updateHouseNoDatalist([]);
        }
      };
    }

    if (applyHouseNoEl) {
      applyHouseNoEl.oninput = () => {
        const val = applyHouseNoEl.value.trim();
        if (!val) {
          applyHouseStatusEl.textContent = "";
          return;
        }
        if (val === "訪客") {
          applyHouseStatusEl.textContent = "訪客身分";
          applyHouseStatusEl.classList.add("success");
          return;
        }
        const units = Array.isArray(data.communityUnits) ? data.communityUnits : [];
        const exists = units.some(u => {
          const uid = (typeof u === "object" && u !== null) ? String(u.id || "") : String(u || "");
          return uid.trim().toLowerCase() === val.toLowerCase();
        });
        if (exists) {
          applyHouseStatusEl.textContent = "有此戶號";
          applyHouseStatusEl.classList.add("success");
        } else {
          applyHouseStatusEl.textContent = "無此戶號";
          applyHouseStatusEl.classList.remove("success");
        }
      };
    }

    if (avatarUploader) {
      avatarUploader.onclick = () => avatarInput.click();
      avatarInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (re) => {
          data.avatarDataUrl = re.target.result;
          avatarPreview.innerHTML = `<img src="${data.avatarDataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" />`;
          // 清除內建選取狀態
          modal.querySelectorAll(".avatar-option").forEach(opt => opt.classList.remove("active"));
        };
        reader.readAsDataURL(file);
      };
    }

    // 內建大頭照點擊邏輯
    const avatarOptions = modal.querySelectorAll(".avatar-option");
    avatarOptions.forEach(opt => {
      opt.onclick = () => {
        const url = opt.getAttribute("data-url");
        data.avatarDataUrl = url;
        avatarPreview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" />`;
        
        // 切換 active 狀態
        avatarOptions.forEach(o => o.classList.remove("active"));
        opt.classList.add("active");
        
        // 清除上傳的檔案
        avatarInput.value = "";
      };
    });

    const nextLogic = async (e) => {
      const btn = e ? e.target : null;
      if (btn) btn.disabled = true;
      
      try {
        if (currentStep === 1) {
          data.communityCode = modal.querySelector("#applyCommunityCode").value.trim();
          if (!data.communityCode) {
            setModalStatus("請輸入社區代號", true);
            return;
          }
          setModalStatus("驗證社區中...", false);
          const snap = await db.collection("communities").where("username", "==", data.communityCode).get();
          if (snap.empty) {
            const doc = await db.collection("communities").doc(data.communityCode).get();
            if (!doc.exists) {
              setModalStatus("找不到該社區，請確認代號是否正確。", true);
              return;
            }
            const cdata = doc.data();
            data.communityId = doc.id;
            data.communityUnits = Array.isArray(cdata.units) ? cdata.units : [];
          } else {
            const cdata = snap.docs[0].data();
            data.communityId = snap.docs[0].id;
            data.communityUnits = Array.isArray(cdata.units) ? cdata.units : [];
          }
        } else if (currentStep === 2) {
           data.houseNo = modal.querySelector("#applyHouseNo").value.trim();
           if (!data.houseNo) {
             setModalStatus("請輸入戶號", true);
             return;
           }
           // 驗證戶號是否存在於該社區，或為訪客
           if (data.houseNo === "訪客") {
             // 允許訪客身分進入下一步
           } else {
             const units = Array.isArray(data.communityUnits) ? data.communityUnits : [];
             const exists = units.some(u => {
               const uid = (typeof u === "object" && u !== null) ? String(u.id || "") : String(u || "");
               return uid.trim().toLowerCase() === data.houseNo.toLowerCase();
             });
             if (!exists) {
               setModalStatus("戶號不正確，請確認後再試。", true);
               return;
             }
           }
         } else if (currentStep === 3) {
          if (!data.avatarDataUrl) {
            setModalStatus("請上傳大頭照", true);
            return;
          }
        } else if (currentStep === 4) {
          await finishLogic();
          return;
        }
        
        currentStep++;
        updateStepUI();
      } catch (err) {
        setModalStatus("驗證失敗：" + err.message, true);
      } finally {
        btn.disabled = false;
      }
    };

    const prevLogic = () => {
      if (currentStep > 1) {
        currentStep--;
        updateStepUI();
      }
    };

    const finishLogic = async () => {
      data.name = modal.querySelector("#applyName").value.trim();
      data.email = modal.querySelector("#applyEmail").value.trim().toLowerCase();
      data.phone = modal.querySelector("#applyPhone").value.trim();
      const pwd = modal.querySelector("#applyPassword").value.trim();
      data.password = pwd || data.phone; // 若未填則預設為手機號碼
      
      if (!data.name || !data.email || !data.phone) {
        return setModalStatus("請填寫所有欄位", true);
      }
      
      setModalStatus("提交申請中...", false);
      try {
        // 防止重複申請機制：檢查該社區是否已有相同手機號碼的待審核申請
        const dupSnap = await db.collection("users")
          .where("community", "==", data.communityId)
          .where("phone", "==", data.phone)
          .where("role", "==", "resident")
          .where("status", "==", "pending")
          .get();
        
        if (!dupSnap.empty) {
          setModalStatus("已送審中", true);
          return;
        }

        // 直接寫入 Firestore
        await db.collection("users").add({
          community: data.communityId,
          houseNo: data.houseNo,
          displayName: data.name,
          email: data.email,
          phone: data.phone,
          password: data.password, // 儲存密碼
          avatarDataUrl: data.avatarDataUrl,
          role: "resident",
          enabled: false,
          status: "pending",
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        currentStep = 5;
        updateStepUI();
      } catch (err) {
        setModalStatus("提交失敗：" + err.message, true);
      }
    };

    modal.querySelector("#btnApplyNext").onclick = nextLogic;
    modal.querySelector("#btnApplyPrev").onclick = prevLogic;

    // 綁定關閉事件 (使用事件代理確保動態產生的按鈕也能運作)
    modal.onclick = (e) => {
      if (e.target.closest("[data-modal-close]")) {
        modal.hidden = true;
        // 重置
        currentStep = 1;
        modal.querySelector("#applyCommunityCode").value = "";
        modal.querySelector("#applyHouseNo").value = "";
        if (applyHouseNoListEl) applyHouseNoListEl.innerHTML = "";
        modal.querySelector("#applyName").value = "";
        modal.querySelector("#applyEmail").value = "";
        modal.querySelector("#applyPhone").value = "";
        avatarPreview.innerHTML = `<span class="placeholder">點擊上傳照片</span>`;
        data.avatarDataUrl = "";
        
        // 恢復原本的按鈕結構
        modal.querySelector("#applyModalFt").innerHTML = `
          <button class="btn" type="button" id="btnApplyPrev" hidden>上一步</button>
          <button class="btn btn-primary" type="button" id="btnApplyNext">下一步</button>
        `.trim();
        
        // 重新綁定新產生的按鈕事件
        modal.querySelector("#btnApplyNext").onclick = nextLogic;
        modal.querySelector("#btnApplyPrev").onclick = prevLogic;
        
        updateStepUI();
      }
    };

    modal.hidden = false;
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
        sessionStorage.setItem("csp_sysadmin", "1");
        setStatus("登入成功，導向中...", false);
        didAutoRedirect = true;
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
      try { sessionStorage.removeItem("csp_sysadmin"); } catch {}
      setStatus("登入成功，導向中...", false);
      didAutoRedirect = true;
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
        try { window.__nw_redirecting = ""; } catch {}
        return;
      }
      if (role === "admin") {
        const picked = await showAdminDestinationModal();
        sessionStorage.setItem("csp_role", picked.role);
        sessionStorage.setItem("csp_sysadmin", "1");
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
      try { sessionStorage.removeItem("csp_sysadmin"); } catch {}
      goTo(url);
    })();
  });
})();
