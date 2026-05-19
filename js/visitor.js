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
      setStatus("無法建立連線，請稍後再試。", true);
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
    const btnFooterPass = qs("#btnFooterPass");
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
        const v = String(u || "").trim();
        if (!v) return;
        const opt = document.createElement("option");
        opt.value = v;
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

    try {
      await ensureAnonAuth(auth);
    } catch {
      return;
    }

    const updatePurposeOther = () => {
      const v = String(purposeTypeEl ? purposeTypeEl.value : "").trim();
      show(purposeOtherField, v === "其他");
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
          if (resultMsg) {
            resultMsg.textContent = authorized ? "已授權，可查看訪客證。" : "已送出登記，等待授權。";
          }
        },
        () => {
          setPassReady(false);
        }
      );
    };

    setPassReady(false);
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
        current.vid = vid;
        current.passAuthorized = false;
        setPassReady(false);
        attachDoc(docRef);
        show(form, false);
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
