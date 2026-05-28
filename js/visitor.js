(() => {
  const qs = (s) => document.querySelector(s);
  const show = (el, on) => { if (el) el.hidden = !on; };
  const setStatus = (msg, isError) => {
    const el = qs("#statusBox");
    const t = String(msg || "").trim();
    if (!el) return;
    el.textContent = t;
    show(el, Boolean(t));
    el.classList.toggle("error", Boolean(isError));
  };

  const escapeText = (v) => String(v == null ? "" : v);
  const clampInt = (raw, min, max, fallback) => {
    const n = parseInt(String(raw || "").trim(), 10);
    if (!Number.isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  };

  const getParam = (k) => {
    try { return new URL(location.href).searchParams.get(k) || ""; } catch { return ""; }
  };

  const loadCommunityByKey = async (db, key) => {
    const k = String(key || "").trim();
    if (!k) return null;
    const byId = await db.collection("communities").doc(k).get();
    if (byId && byId.exists) return { id: byId.id, data: byId.data() || {} };
    const snap = await db.collection("communities").where("username", "==", k).limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, data: doc.data() || {} };
  };

  const ensureAnonAuth = async (auth) => {
    const pill = qs("#authPill");
    if (pill) { pill.textContent = "連線中…"; show(pill, true); }
    try {
      if (auth.currentUser) {
        if (pill) { pill.textContent = "已連線"; show(pill, false); }
        return auth.currentUser;
      }
      const res = await auth.signInAnonymously();
      if (pill) { pill.textContent = "已連線"; show(pill, false); }
      return res && res.user ? res.user : auth.currentUser;
    } catch (err) {
      if (pill) { pill.textContent = "無法連線"; show(pill, true); }
      const code = String(err && err.code ? err.code : "");
      if (code.includes("auth/unauthorized-domain") || code.includes("unauthorized-domain")) {
        setStatus("無法連線：網域未授權。請使用官方網址開啟。", true);
      } else {
        setStatus("無法建立連線，請稍後再試。", true);
      }
      throw err;
    }
  };

  const buildPassPayload = ({ cid, vid }) => {
    const deep = `nwapp://visitor-pass?cid=${encodeURIComponent(cid)}&vid=${encodeURIComponent(vid)}&t=${encodeURIComponent(vid)}`;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(deep)}`;
    return { deep, qr };
  };

  const main = async () => {
    const cKey = getParam("c");
    if (!cKey) {
      setStatus("缺少社區代碼。", true);
      return;
    }

    // 暫存 Key 定義
    const STORAGE_KEY_PREFIX = `nwapp_v2_visitor_${cKey}`;
    const FORM_CACHE_KEY = `${STORAGE_KEY_PREFIX}_form`;
    const PASS_CACHE_KEY = `${STORAGE_KEY_PREFIX}_pass`;

    const saveFormCache = () => {
      const formData = {
        name: qs("#v_name")?.value || "",
        party: qs("#v_party")?.value || "",
        unit: qs("#v_unit")?.value || "",
        phone: qs("#v_phone")?.value || "",
        plate: qs("#v_plate")?.value || "",
        email: qs("#v_email")?.value || "",
        purposeType: qs("#v_purposeType")?.value || "",
        purposeOther: qs("#v_purposeOther")?.value || "",
        note: qs("#v_note")?.value || "",
        timestamp: Date.now()
      };
      localStorage.setItem(FORM_CACHE_KEY, JSON.stringify(formData));
    };

    const loadFormCache = () => {
      try {
        const cached = localStorage.getItem(FORM_CACHE_KEY);
        if (cached) {
          const data = JSON.parse(cached);
          if (qs("#v_name")) qs("#v_name").value = data.name || "";
          if (qs("#v_party")) qs("#v_party").value = data.party || "1";
          if (qs("#v_unit")) qs("#v_unit").value = data.unit || "";
          if (qs("#v_phone")) qs("#v_phone").value = data.phone || "";
          if (qs("#v_plate")) qs("#v_plate").value = data.plate || "";
          if (qs("#v_email")) qs("#v_email").value = data.email || "";
          if (qs("#v_purposeType")) qs("#v_purposeType").value = data.purposeType || "親友拜訪";
          if (qs("#v_purposeOther")) qs("#v_purposeOther").value = data.purposeOther || "";
          if (qs("#v_note")) qs("#v_note").value = data.note || "";
        }
      } catch (e) { console.error("Load cache failed", e); }
    };

    if (!window.firebase || !firebase.apps) {
      setStatus("系統初始化失敗。", true);
      return;
    }
    try {
      if (!firebase.apps.length) {
        if (!window.FIREBASE_CONFIG) {
          setStatus("系統初始化失敗。", true);
          return;
        }
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
    } catch {
      setStatus("系統初始化失敗。", true);
      return;
    }
    const auth = firebase.auth();
    const db = firebase.firestore();

    const form = qs("#visitorForm");
    const resultBox = qs("#resultBox");
    const btnFooterSubmit = qs("#btnFooterSubmit");
    const btnFooterAuth = qs("#btnFooterAuth");
    const btnFooterPass = qs("#btnFooterPass");
    const btnSavePassImage = qs("#btnSavePassImage");
    const pageTitle = qs("#pageTitle");
    const resultMsg = qs("#resultMsg");
    const passBox = qs("#passBox");

    const purposeTypeEl = qs("#v_purposeType");
    const purposeOtherField = qs("#purposeOtherField");

    const unitList = qs("#unitList");
    const fillUnitList = (units) => {
      if (!unitList) return;
      unitList.innerHTML = "";
      (Array.isArray(units) ? units : []).forEach((u) => {
        const uid = (typeof u === "object" && u !== null) ? String(u.id || "").trim() : String(u || "").trim();
        const addr = (typeof u === "object" && u !== null && u.address) ? ` (${u.address})` : "";
        if (!uid) return;
        const opt = document.createElement("option");
        opt.value = uid;
        opt.label = addr;
        unitList.appendChild(opt);
      });
    };

    setStatus("", false);
    let community = null;
    try {
      community = await loadCommunityByKey(db, cKey);
    } catch {
      community = null;
    }
    if (!community) {
      setStatus("找不到社區。", true);
      return;
    }
    const cid = community.id;
    const cname = String((community.data && community.data.name) || "").trim() || "—";
    if (pageTitle) pageTitle.textContent = `訪客登記-${cname}`;
    fillUnitList(community.data && Array.isArray(community.data.units) ? community.data.units : []);

    // 載入表單暫存
    loadFormCache();

    // 監聽輸入以自動暫存
    form?.addEventListener("input", saveFormCache);

    try {
      await ensureAnonAuth(auth);
    } catch {
      return;
    }

    const updatePurposeOther = () => {
      const v = String(purposeTypeEl ? purposeTypeEl.value : "").trim();
      const isOther = v === "其他";
      if (purposeOtherField) {
        purposeOtherField.hidden = !isOther;
        purposeOtherField.style.display = isOther ? "" : "none";
      }
      if (!isOther) {
        const otherEl = qs("#v_purposeOther");
        if (otherEl) otherEl.value = "";
      }
    };
    if (purposeTypeEl) purposeTypeEl.addEventListener("change", updatePurposeOther);
    updatePurposeOther();

    const showPass = ({ deep, qr }) => {
      const img = qs("#passQrImg");
      const hint = qs("#passHint");
      const urlEl = qs("#passUrl");
      if (img) img.src = qr;
      if (hint) hint.textContent = "請出示此 QR code 作為訪客證。";
      if (urlEl) urlEl.textContent = deep;
      show(passBox, true);
      
      // 暫存訪客證資訊
      localStorage.setItem(PASS_CACHE_KEY, JSON.stringify({
        deep, qr, vid: current.vid, cid: current.cid, timestamp: Date.now()
      }));
    };

    const setPassReady = (ready) => {
      if (!btnFooterPass) return;
      btnFooterPass.disabled = !ready;
    };

    if (!form) return;
    let current = {
      cid,
      cname,
      vid: "",
      docRef: null,
      unsub: null,
      passAuthorized: false,
    };

    const detachDoc = () => {
      try { if (current.unsub) current.unsub(); } catch {}
      current.unsub = null;
    };

    const attachDoc = (docRef) => {
      detachDoc();
      current.docRef = docRef;
      current.unsub = docRef.onSnapshot(
        (snap) => {
          const data = snap && snap.exists ? (snap.data() || {}) : null;
          const authorized = Boolean(data && (data.passAuthorized === true || data.status === "approved"));
          current.passAuthorized = authorized;
          setPassReady(authorized);
          if (btnFooterAuth) show(btnFooterAuth, !authorized);
          if (resultMsg) {
            resultMsg.textContent = authorized ? "已授權，可查看訪客證。" : "已送出登記，等待授權。";
          }
          // 如果已授權，自動更新暫存
          if (authorized && current.vid) {
            const pass = buildPassPayload({ cid: current.cid, vid: current.vid });
            localStorage.setItem(PASS_CACHE_KEY, JSON.stringify({
              ...pass, vid: current.vid, cid: current.cid, timestamp: Date.now()
            }));
          }
        },
        () => {
          setPassReady(false);
          if (btnFooterAuth) show(btnFooterAuth, false);
        }
      );
    };

    // 嘗試恢復訪客證暫存
    const tryRestorePass = () => {
      try {
        const cached = localStorage.getItem(PASS_CACHE_KEY);
        if (cached) {
          const data = JSON.parse(cached);
          // 檢查是否為同一社區
          if (data.cid === cid) {
            current.vid = data.vid;
            current.passAuthorized = true;
            setPassReady(true);
            
            // 重新掛載監聽以確保狀態同步
            const docRef = db.collection("communities").doc(cid).collection("visitors").doc(data.vid);
            attachDoc(docRef);

            // 如果已經是在結果畫面，顯示訪客證
            if (resultBox && !resultBox.hidden) {
              showPass(data);
            }
          }
        }
      } catch (e) { console.error("Restore pass failed", e); }
    };

    tryRestorePass();

    setPassReady(false);
    if (btnFooterAuth) {
      btnFooterAuth.addEventListener("click", async () => {
        if (!current.docRef) {
          setStatus("請先送出登記。", true);
          return;
        }
        btnFooterAuth.disabled = true;
        setStatus("授權中...", false);
        try {
          await current.docRef.update({
            passAuthorized: true,
            status: "approved",
            authorizedAt: firebase.firestore.Timestamp.now()
          });
          setStatus("授權成功！", false);
        } catch (err) {
          console.error("Auth failed:", err);
          setStatus("授權失敗，請稍後再試。", true);
          btnFooterAuth.disabled = false;
        }
      });
    }

    if (btnFooterPass) {
      btnFooterPass.addEventListener("click", async () => {
        if (!current.docRef || !current.vid) {
          setStatus("請先送出登記。", true);
          return;
        }
        if (!current.passAuthorized) {
          setStatus("尚未授權，請稍後再試。", true);
          return;
        }
        setStatus("", false);
        const pass = buildPassPayload({ cid: current.cid, vid: current.vid });
        show(form, false);
        show(resultBox, true);
        showPass(pass);
      });
    }

    if (btnSavePassImage) {
      btnSavePassImage.addEventListener("click", async () => {
        const card = qs(".v-card");
        if (!card || !window.html2canvas) return;
        
        btnSavePassImage.disabled = true;
        const originalText = btnSavePassImage.textContent;
        btnSavePassImage.textContent = "處理中...";
        
        try {
          const canvas = await html2canvas(card, {
            useCORS: true,
            scale: 2, // 提高解析度
            backgroundColor: null,
            logging: false
          });
          
          const link = document.createElement("a");
          link.download = `訪客證_${current.cname || "社區"}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          setStatus("訪客證已儲存至您的裝置。", false);
        } catch (err) {
          console.error("Save image failed:", err);
          setStatus("儲存圖片失敗，請嘗試直接截圖。", true);
        } finally {
          btnSavePassImage.disabled = false;
          btnSavePassImage.textContent = originalText;
        }
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setStatus("", false);
      if (btnFooterSubmit) btnFooterSubmit.disabled = true;

      const name = String(qs("#v_name") ? qs("#v_name").value : "").trim();
      const unit = String(qs("#v_unit") ? qs("#v_unit").value : "").trim();
      const phone = String(qs("#v_phone") ? qs("#v_phone").value : "").trim();
      const plate = String(qs("#v_plate") ? qs("#v_plate").value : "").trim();
      const email = String(qs("#v_email") ? qs("#v_email").value : "").trim();
      const partySize = clampInt(qs("#v_party") ? qs("#v_party").value : "", 1, 20, 1);
      const purposeType = String(purposeTypeEl ? purposeTypeEl.value : "").trim() || "親友拜訪";
      const purposeOther = String(qs("#v_purposeOther") ? qs("#v_purposeOther").value : "").trim();
      const note = String(qs("#v_note") ? qs("#v_note").value : "").trim();
      const purpose = purposeType === "其他" ? (purposeOther || "其他") : purposeType;

      if (!name || !unit) {
        setStatus("請填寫訪客姓名與拜訪戶號。", true);
        if (btnSubmit) btnSubmit.disabled = false;
        return;
      }
      const user = auth.currentUser;
      if (!user) {
        setStatus("尚未連線，請稍後再試。", true);
        if (btnSubmit) btnSubmit.disabled = false;
        return;
      }

      const docRef = db.collection("communities").doc(cid).collection("visitors").doc();
      const vid = docRef.id;
      const nowTs = firebase.firestore.Timestamp.now();
      const payload = {
        qrToken: vid,
        name,
        email,
        phone,
        unit,
        partySize,
        plate,
        purpose,
        purposeType,
        purposeOther: purposeType === "其他" ? purposeOther : "",
        note,
        inAt: null,
        outAt: null,
        keep: null,
        source: "self",
        status: "pending",
        passAuthorized: false,
        passAuthorizedAt: null,
        createdAt: nowTs,
        updatedAt: nowTs,
        createdBy: user.uid,
        createdByName: "訪客自填",
      };

      try {
        await docRef.set(payload, { merge: true });
        
        // 送出後清除表單暫存，但保留訪客證暫存
        localStorage.removeItem(FORM_CACHE_KEY);
        
        current.vid = vid;
        current.passAuthorized = false;
        setPassReady(false);
        attachDoc(docRef);
        show(form, false);
        if (btnFooterSubmit) show(btnFooterSubmit, false);
        if (btnFooterAuth) show(btnFooterAuth, true);
        show(resultBox, true);
        show(passBox, false);
        if (resultMsg) resultMsg.textContent = "已送出登記，等待授權。";
        setStatus("", false);
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限送出，請聯繫管理員。": "送出失敗，請稍後再試。", true);
      } finally {
        if (btnFooterSubmit) btnFooterSubmit.disabled = false;
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
