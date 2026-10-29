(() => {
  const qs = (id) => document.getElementById(id);
  const getParam = (k) => {
    try { return new URL(location.href).searchParams.get(k) || ""; } catch { return ""; }
  };
  const pad2 = (n) => String(n).padStart(2, "0");

  const setStatus = (msg, isError) => {
    const el = qs("vfStatus");
    if (!el) return;
    const t = String(msg || "").trim();
    el.textContent = t;
    el.hidden = !t;
    el.classList.toggle("error", Boolean(isError));
  };

  /* Firestore Timestamp／數值 → 毫秒 */
  const toMs = (v) => {
    if (v == null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v.toMillis === "function") { try { return v.toMillis(); } catch {} }
    if (typeof v.toDate === "function") { try { return v.toDate().getTime(); } catch {} }
    if (v instanceof Date) return v.getTime();
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const formatDay = (ms) => {
    if (ms == null || !Number.isFinite(ms)) return "";
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const randomId = (len) => {
    let out = "";
    for (let i = 0; i < len; i += 1) out += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    return out;
  };

  /* 裝置識別：優先使用本機保存的隨機碼，可穩定代表「這台裝置（此瀏覽器）」 */
  const deviceId = (() => {
    const KEY = "nwapp_freq_device_id";
    try {
      let id = localStorage.getItem(KEY);
      if (!id || !/^[A-Za-z0-9]{8,32}$/.test(id)) {
        id = randomId(16);
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch {
      return randomId(16);
    }
  })();

  const metaRow = (k, v) => {
    const row = document.createElement("div");
    row.className = "vf-meta-row";
    const kk = document.createElement("span");
    kk.className = "vf-k";
    kk.textContent = k;
    const vv = document.createElement("span");
    vv.className = "vf-v";
    vv.textContent = String(v == null || v === "" ? "—" : v);
    row.appendChild(kk);
    row.appendChild(vv);
    return row;
  };

  /* 記錄使用裝置（僅新增，不覆寫；已記錄過或無權限則忽略） */
  const recordDevice = async (db, c, code) => {
    try {
      await db.collection("communities").doc(c).collection("frequent_devices")
        .doc(`${code}_${deviceId}`)
        .set({
          code: String(code),
          deviceId: String(deviceId),
          ua: String(navigator.userAgent || "").slice(0, 300),
          at: Date.now(),
        });
      return true;
    } catch {
      return false;
    }
  };

  const renderCard = (data, communityId, code) => {
    const card = qs("vfCard");
    const nameEl = qs("vfName");
    const badgeEl = qs("vfBadge");
    const metaEl = qs("vfMeta");
    const footEl = qs("vfFoot");
    const qrWrap = qs("vfQrWrap");
    const qrImg = qs("vfQr");
    if (!card) return;

    const inactive = data && data.active === false;
    const expMs = toMs(data && data.expiresAt);
    const expired = expMs != null && expMs < Date.now();
    const usable = !inactive && !expired;

    if (nameEl) nameEl.textContent = String((data && data.name) || "—");
    if (badgeEl) {
      const bad = !usable;
      badgeEl.classList.toggle("warning", bad);
      badgeEl.textContent = inactive ? "已停用" : (expired ? "已過期" : "有效");
    }

    if (metaEl) {
      metaEl.innerHTML = "";
      metaEl.appendChild(metaRow("拜訪戶號", String((data && data.unit) || "")));
      metaEl.appendChild(metaRow("手機", String((data && data.phone) || "")));
      metaEl.appendChild(metaRow("到訪事由", String((data && data.purpose) || "")));
      metaEl.appendChild(metaRow("拜訪人數", String(data && data.partySize != null ? Number(data.partySize) : 1)));
      metaEl.appendChild(metaRow("車牌", String((data && data.plate) || "")));
      metaEl.appendChild(metaRow("有效期限", expMs != null ? formatDay(expMs) : "永久有效"));
    }

    /* QR code：與訪客證同一組 code，供管理中心掃描登記進入／離開 */
    if (qrWrap && qrImg) {
      if (code && communityId) {
        const target = new URL("visitor-frequent.html", location.href);
        target.searchParams.set("c", String(communityId));
        target.searchParams.set("k", String(code));
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(target.toString())}`;
      }
      qrWrap.hidden = !usable || !code;
    }

    if (footEl) {
      footEl.textContent = inactive
        ? "此訪客證已停用，請洽社區管理人員。"
        : (expired ? "此訪客證已過期，請洽社區管理人員延長期限。" : "請於到訪時出示此頁面供社區人員確認。");
    }

    card.hidden = false;
  };

  const main = async () => {
    const c = String(getParam("c") || "").trim();
    const k = String(getParam("k") || "").trim();
    const sub = qs("vfSub");

    if (!c || !k) {
      setStatus("缺少訪客證代碼，請確認連結是否完整。", true);
      return;
    }
    if (!window.firebase || !firebase.apps) {
      setStatus("系統尚未就緒，請稍後再試。", true);
      return;
    }

    try {
      if (!firebase.apps.length) {
        if (!window.FIREBASE_CONFIG) {
          setStatus("缺少系統設定。", true);
          return;
        }
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      const db = firebase.firestore();
      setStatus("讀取中...", false);

      const doc = await db.collection("communities").doc(c).collection("visitor_frequent").doc(k).get();
      if (!doc || !doc.exists) {
        setStatus("查無此訪客證，請確認連結是否正確。", true);
        return;
      }

      const data = doc.data() || {};
      if (sub) {
        const cname = String(data.cname || "").trim();
        sub.textContent = cname ? `${cname}／常用訪客證` : `社區 ${c}／常用訪客證`;
      }

      setStatus("", false);
      renderCard(data, c, k);
      const firstTime = await recordDevice(db, c, k);
      const footEl = qs("vfFoot");
      if (footEl && firstTime) {
        const note = document.createElement("div");
        note.style.marginTop = "6px";
        note.textContent = "（已記錄本次使用裝置）";
        footEl.appendChild(note);
      }
    } catch (err) {
      const code = String(err && err.code ? err.code : "");
      setStatus(code.includes("permission-denied") ? "沒有權限讀取資料。" : "讀取失敗，請稍後再試。", true);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
  else main();
})();
