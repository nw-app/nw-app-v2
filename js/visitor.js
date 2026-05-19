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
        if (pill) { pill.textContent = "已連線"; }
        return auth.currentUser;
      }
      const res = await auth.signInAnonymously();
      if (pill) { pill.textContent = "已連線"; }
      return res && res.user ? res.user : auth.currentUser;
    } catch (err) {
      if (pill) { pill.textContent = "無法連線"; }
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
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      setStatus("系統初始化失敗。", true);
      return;
    }
    const auth = firebase.auth();
    const db = firebase.firestore();

    const form = qs("#visitorForm");
    const resultBox = qs("#resultBox");
    const btnSubmit = qs("#btnSubmit");
    const btnNew = qs("#btnNew");
    const communityLine = qs("#communityLine");

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
    if (communityLine) communityLine.textContent = `社區：${cname}`;
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

    const showResult = ({ deep, qr }) => {
      const img = qs("#passQrImg");
      const hint = qs("#passHint");
      const urlEl = qs("#passUrl");
      if (img) img.src = qr;
      if (hint) hint.textContent = "請出示此 QR code 作為訪客證。";
      if (urlEl) urlEl.textContent = deep;
      show(form, false);
      show(resultBox, true);
    };

    if (btnNew) {
      btnNew.addEventListener("click", () => {
        show(resultBox, false);
        show(form, true);
        setStatus("", false);
        try { form && form.reset(); } catch {}
        updatePurposeOther();
        const party = qs("#v_party");
        if (party) party.value = "1";
      });
    }

    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      setStatus("", false);
      if (btnSubmit) btnSubmit.disabled = true;

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
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: user.uid,
        createdByName: "訪客自填",
      };

      try {
        await docRef.set(payload, { merge: true });
        const pass = buildPassPayload({ cid, vid });
        showResult(pass);
        setStatus("", false);
      } catch (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.includes("permission-denied") ? "沒有權限送出，請聯繫管理員。": "送出失敗，請稍後再試。", true);
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
