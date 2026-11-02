/*!
 * punch-flow.js
 * 共用打卡流程：定位 → 地圖（目前位置 + 社區打卡範圍）→ 範圍內才可打卡 → 自拍 → 完成
 * 使用方式：
 *   window.NwPunchFlow.open({
 *     db, communityId, title,
 *     onConfirm: (photoDataUrl, meta) => Promise,
 *   }).then((r) => { if (r && r.ok) ... })
 */
(function () {
  "use strict";
  if (window.NwPunchFlow) return;

  const STYLE_ID = "nwpFlowStyle";
  const MAX_SIDE = 480;
  const JPEG_Q = 0.62;

  let ctx = null;
  let overlay = null;
  let map = null;
  let stream = null;
  let capturedPhoto = "";

  /* ---------- utils ---------- */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* ---------- style ---------- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = `
.nwp-flow{position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;justify-content:center;background:rgba(17,24,39,.55);}
.nwp-card{width:100%;max-width:520px;max-height:94vh;display:flex;flex-direction:column;background:#fff;border-radius:18px 18px 0 0;box-shadow:0 -10px 34px rgba(0,0,0,.32);overflow:hidden;}
@media (min-width:560px){.nwp-flow{align-items:center;padding:20px;}.nwp-card{border-radius:18px;}}
.nwp-hd{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid #eef0f3;}
.nwp-hd-t{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:900;color:#111827;}
.nwp-hd-t::before{content:"";width:8px;height:20px;border-radius:4px;background:linear-gradient(180deg,#ef4444,#b91c1c);}
.nwp-x{border:0;background:#f3f4f6;color:#374151;width:34px;height:34px;border-radius:999px;font-size:20px;line-height:1;font-weight:900;cursor:pointer;}
.nwp-body{flex:1 1 auto;overflow:auto;padding:14px 16px calc(16px + env(safe-area-inset-bottom,0px));}
.nwp-loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:34px 0;}
.nwp-spin{width:38px;height:38px;border-radius:50%;border:4px solid #f3d3d3;border-top-color:#d32f2f;animation:nwpSpin .85s linear infinite;}
@keyframes nwpSpin{to{transform:rotate(360deg);}}
.nwp-loading-t{font-size:15px;font-weight:900;color:#111827;}
.nwp-loading-s{font-size:12px;font-weight:700;color:#6b7280;}
.nwp-map{position:relative;z-index:0;height:240px;border-radius:14px;overflow:hidden;background:#eef0f3;border:1px solid #e5e7eb;}
.nwp-nomap{height:100%;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:12px;font-weight:700;color:#6b7280;}
.nwp-note{margin-top:12px;border-radius:12px;padding:11px 13px;font-size:13px;line-height:1.5;font-weight:800;}
.nwp-note.ok{background:rgba(15,157,88,.10);color:#0b6b3d;border:1px solid rgba(15,157,88,.30);}
.nwp-note.bad{background:rgba(211,47,47,.09);color:#a01b1b;border:1px solid rgba(211,47,47,.28);}
.nwp-note.warn{background:rgba(245,158,11,.12);color:#92400e;border:1px solid rgba(245,158,11,.32);}
.nwp-note b{display:block;font-size:14px;margin-bottom:2px;}
.nwp-note div{font-weight:700;font-size:12px;}
.nwp-hint{margin-top:8px;font-size:11px;font-weight:700;color:#9ca3af;text-align:center;}
.nwp-actions{display:flex;gap:10px;margin-top:14px;}
.nwp-btn{flex:1 1 0;min-height:46px;border-radius:12px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-size:15px;font-weight:900;cursor:pointer;}
.nwp-btn.primary{border-color:#d32f2f;background:linear-gradient(180deg,#ef4444,#c62828);color:#fff;}
.nwp-btn.primary[disabled]{background:#e5e7eb;border-color:#e5e7eb;color:#9ca3af;cursor:not-allowed;}
.nwp-btn.ghost[disabled]{color:#c3c8cf;cursor:not-allowed;}
.nwp-err{margin-top:12px;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:800;background:rgba(211,47,47,.10);color:#a01b1b;display:none;}
.nwp-cam{position:relative;margin-top:4px;border-radius:14px;overflow:hidden;background:#000;aspect-ratio:3/4;max-height:52vh;display:flex;align-items:center;justify-content:center;}
.nwp-cam video,.nwp-cam img{width:100%;height:100%;object-fit:cover;display:block;background:#000;}
.nwp-cam-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;color:#e5e7eb;font-size:13px;font-weight:800;background:rgba(0,0,0,.45);}
.nwp-file{display:flex;align-items:center;justify-content:center;width:100%;height:100%;min-height:220px;color:#fff;font-size:14px;font-weight:900;cursor:pointer;text-decoration:underline;}
.nwp-mepin{width:20px;height:20px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-sizing:border-box;animation:nwpPulse 1.7s infinite;}
@keyframes nwpPulse{0%{box-shadow:0 0 0 0 rgba(37,99,235,.55);}70%{box-shadow:0 0 0 16px rgba(37,99,235,0);}100%{box-shadow:0 0 0 0 rgba(37,99,235,0);}}
`;
    document.head.appendChild(st);
  }

  /* ---------- overlay ---------- */
  function setBody(html) {
    if (!overlay) return;
    const b = overlay.querySelector("#nwpBody");
    if (b) b.innerHTML = html;
  }

  function buildOverlay(title) {
    const wrap = document.createElement("div");
    wrap.className = "nwp-flow";
    wrap.innerHTML = `
      <div class="nwp-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="nwp-hd">
          <div class="nwp-hd-t">${esc(title)}</div>
          <button type="button" class="nwp-x" id="nwpX" aria-label="關閉">×</button>
        </div>
        <div class="nwp-body" id="nwpBody"></div>
      </div>`;
    document.body.appendChild(wrap);
    overlay = wrap;
    const x = wrap.querySelector("#nwpX");
    if (x) x.onclick = () => finish({ ok: false });
  }

  function stopCamera() {
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      stream = null;
    }
  }

  function destroyMap() {
    if (map) { try { map.remove(); } catch {} map = null; }
  }

  function finish(result) {
    const c = ctx;
    ctx = null;
    stopCamera();
    destroyMap();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    capturedPhoto = "";
    if (!c || c.settled) return;
    c.settled = true;
    c.resolve(result || { ok: false });
  }

  /* ---------- data ---------- */
  function getPosition() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) { rej(new Error("此裝置不支援定位功能")); return; }
      navigator.geolocation.getCurrentPosition(res, (err) => {
        let m = "無法取得目前位置";
        if (err && err.code === 1) m = "定位權限被拒絕，請於瀏覽器設定中允許存取位置";
        else if (err && err.code === 2) m = "目前無法取得位置，請確認已開啟 GPS";
        else if (err && err.code === 3) m = "定位逾時，請移至空曠處後重試";
        rej(new Error(m));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  function parseCommunityDoc(v) {
    if (!v) return null;
    const rawLat = v.latitude != null ? v.latitude : v.lat;
    const rawLng = v.longitude != null ? v.longitude : v.lng;
    const rawRange = v.checkinRange != null ? v.checkinRange : v.range;
    const lat = rawLat != null ? Number(rawLat) : NaN;
    const lng = rawLng != null ? Number(rawLng) : NaN;
    const range = rawRange != null ? Number(rawRange) : 50;
    return {
      name: String(v.name || ""),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      range: Number.isFinite(range) && range > 0 ? range : 50,
    };
  }

  async function loadCommunity() {
    const o = ctx.opts || {};
    if (!o.db || !o.communityId) return null;
    const cid = String(o.communityId).trim();
    const col = o.db.collection("communities");
    // 1) 以文件 ID 查（新版以亂碼 ID 建檔）
    try {
      const snap = await col.doc(cid).get();
      if (snap && snap.exists) return parseCommunityDoc(snap.data());
    } catch (e) { console.warn("punch flow: load community by id failed", e); }
    // 2) 以社區代號(username) 或 id 欄位查（舊版以社區代號建檔）
    for (const field of ["username", "id"]) {
      try {
        const q = await col.where(field, "==", cid).limit(1).get();
        if (q && q.size) return parseCommunityDoc(q.docs[0].data());
      } catch (e) { console.warn(`punch flow: load community by ${field} failed`, e); }
    }
    return null;
  }

  /* ---------- steps ---------- */
  async function locate() {
    if (!ctx) return;
    setBody(`
      <div class="nwp-loading">
        <div class="nwp-spin"></div>
        <div class="nwp-loading-t">正在取得目前位置…</div>
        <div class="nwp-loading-s">請允許瀏覽器存取定位權限</div>
      </div>`);
    try {
      const pos = await getPosition();
      if (!ctx) return;
      const comm = await loadCommunity();
      if (!ctx) return;
      ctx.pos = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: Number(pos.coords.accuracy) || 0,
      };
      ctx.community = comm;
      renderMapStep();
    } catch (e) {
      if (!ctx) return;
      renderLocateError(e);
    }
  }

  function renderLocateError(e) {
    setBody(`
      <div class="nwp-note bad"><b>無法取得目前位置</b><div>${esc((e && e.message) || "請確認已開啟定位並允許權限")}</div></div>
      <div class="nwp-actions">
        <button type="button" class="nwp-btn ghost" id="nwpCancel">取消</button>
        <button type="button" class="nwp-btn primary" id="nwpRetry">重新定位</button>
      </div>`);
    const cx = overlay.querySelector("#nwpCancel");
    if (cx) cx.onclick = () => finish({ ok: false });
    const rt = overlay.querySelector("#nwpRetry");
    if (rt) rt.onclick = () => locate();
  }

  function renderMapStep() {
    if (!ctx) return;
    const p = ctx.pos;
    const c = ctx.community;
    const hasCenter = !!(c && c.lat != null && c.lng != null);
    let distance = null;
    let within = true;
    if (hasCenter) {
      distance = haversine(p.lat, p.lng, c.lat, c.lng);
      within = distance <= c.range;
    }
    ctx.distance = distance;
    ctx.within = within;

    const note = !c
      ? `<div class="nwp-note warn"><b>查無社區資料</b><div>找不到社區設定，暫不限制打卡範圍。</div></div>`
      : !hasCenter
        ? `<div class="nwp-note warn"><b>此社區尚未設定打卡範圍</b><div>可直接進行自拍打卡。</div></div>`
        : (within
          ? `<div class="nwp-note ok"><b>已進入打卡範圍</b><div>距離社區中心約 ${Math.round(distance)} 公尺（允許 ${c.range} 公尺）</div></div>`
          : `<div class="nwp-note bad"><b>不在打卡範圍內</b><div>距離社區中心約 ${Math.round(distance)} 公尺，需在 ${c.range} 公尺內才能打卡。</div></div>`);

    setBody(`
      <div class="nwp-map" id="nwpMap"></div>
      ${note}
      <div class="nwp-hint">定位精度約 ±${Math.round(p.acc)} 公尺</div>
      <div class="nwp-actions">
        <button type="button" class="nwp-btn ghost" id="nwpRelocate">重新定位</button>
        <button type="button" class="nwp-btn primary" id="nwpNext" ${within ? "" : "disabled"}>前往自拍</button>
      </div>`);

    buildMap();

    const rel = overlay.querySelector("#nwpRelocate");
    if (rel) rel.onclick = () => locate();
    const next = overlay.querySelector("#nwpNext");
    if (next) next.onclick = () => { if (ctx && ctx.within) renderSelfieStep(); };
  }

  function buildMap() {
    const host = overlay.querySelector("#nwpMap");
    if (!host) return;
    const p = ctx.pos;
    const c = ctx.community;
    destroyMap();
    if (typeof L === "undefined" || !L.map) {
      host.innerHTML = `<div class="nwp-nomap">地圖元件未載入，仍可依上方距離資訊判斷。</div>`;
      return;
    }
    const hasCenter = !!(c && c.lat != null && c.lng != null);
    map = L.map(host, { zoomControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

    const pts = [];
    if (hasCenter) {
      L.circle([c.lat, c.lng], {
        radius: c.range, color: "#d32f2f", weight: 2, fillColor: "#d32f2f", fillOpacity: 0.12,
      }).addTo(map);
      L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: "",
          html: '<div style="width:18px;height:18px;border-radius:50%;background:#0f9d58;border:3px solid #fff;box-sizing:border-box;box-shadow:0 1px 5px rgba(0,0,0,.4);"></div>',
          iconSize: [18, 18], iconAnchor: [9, 9],
        }),
      }).addTo(map);
      pts.push([c.lat, c.lng]);
    }
    L.circle([p.lat, p.lng], {
      radius: Math.max(p.acc || 0, 10), color: "#2563eb", weight: 1, fillColor: "#2563eb", fillOpacity: 0.10,
    }).addTo(map);
    L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: "", html: '<div class="nwp-mepin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
    }).addTo(map);
    pts.push([p.lat, p.lng]);

    try {
      if (pts.length > 1) map.fitBounds(pts, { padding: [32, 32], maxZoom: 17 });
      else map.setView(pts[0], 17);
    } catch { map.setView([p.lat, p.lng], 16); }
    setTimeout(() => { try { map.invalidateSize(); } catch {} }, 80);
  }

  /* ---------- selfie ---------- */
  function renderSelfieStep() {
    capturedPhoto = "";
    setBody(`
      <div class="nwp-cam">
        <video id="nwpVideo" playsinline autoplay muted></video>
        <img id="nwpShot" alt="" hidden />
        <div class="nwp-cam-msg" id="nwpCamMsg">正在開啟相機…</div>
      </div>
      <div class="nwp-err" id="nwpErr"></div>
      <div class="nwp-actions">
        <button type="button" class="nwp-btn ghost" id="nwpRetake" hidden>重拍</button>
        <button type="button" class="nwp-btn ghost" id="nwpShutter" disabled>拍照</button>
        <button type="button" class="nwp-btn primary" id="nwpConfirm" disabled>確認打卡</button>
      </div>`);

    const shutter = overlay.querySelector("#nwpShutter");
    if (shutter) shutter.onclick = () => capture();
    const retake = overlay.querySelector("#nwpRetake");
    if (retake) retake.onclick = () => retakePhoto();
    const confirm = overlay.querySelector("#nwpConfirm");
    if (confirm) confirm.onclick = () => confirmPunch(confirm);

    startCamera();
  }

  async function startCamera() {
    const video = overlay.querySelector("#nwpVideo");
    const msg = overlay.querySelector("#nwpCamMsg");
    const shutter = overlay.querySelector("#nwpShutter");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no-gum");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } },
        audio: false,
      });
      if (!overlay || !video) { stopCamera(); return; }
      video.srcObject = stream;
      try { await video.play(); } catch {}
      if (msg) msg.style.display = "none";
      if (shutter) shutter.disabled = false;
    } catch (e) {
      console.warn("punch flow: camera failed", e);
      useFileFallback();
    }
  }

  function useFileFallback() {
    if (!overlay) return;
    const cam = overlay.querySelector(".nwp-cam");
    const msg = overlay.querySelector("#nwpCamMsg");
    if (msg) msg.style.display = "none";
    if (cam) {
      cam.innerHTML = `<label class="nwp-file"><input type="file" accept="image/*" capture="user" id="nwpFile" hidden />點此開啟相機拍照</label>`;
      const input = cam.querySelector("#nwpFile");
      if (input) {
        input.onchange = () => {
          const f = input.files && input.files[0];
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => setShot(String(rd.result || ""));
          rd.readAsDataURL(f);
        };
      }
    }
    const shutter = overlay.querySelector("#nwpShutter");
    if (shutter) shutter.style.display = "none";
  }

  function capture() {
    const video = overlay.querySelector("#nwpVideo");
    if (!video || !video.videoWidth) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, MAX_SIDE / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    g.drawImage(video, 0, 0, w, h);
    let url = "";
    try { url = cv.toDataURL("image/jpeg", JPEG_Q); } catch { url = ""; }
    if (url) setShot(url);
  }

  function setShot(url) {
    if (!url || !overlay) return;
    capturedPhoto = String(url);
    stopCamera();
    const cam = overlay.querySelector(".nwp-cam");
    const video = overlay.querySelector("#nwpVideo");
    let shot = overlay.querySelector("#nwpShot");
    if (!shot && cam) {
      shot = document.createElement("img");
      shot.id = "nwpShot";
      shot.alt = "";
      cam.appendChild(shot);
    }
    if (video) video.style.display = "none";
    if (shot) { shot.src = capturedPhoto; shot.hidden = false; shot.style.display = "block"; }
    const msg = overlay.querySelector("#nwpCamMsg");
    if (msg) msg.style.display = "none";
    const shutter = overlay.querySelector("#nwpShutter");
    if (shutter) { shutter.hidden = true; shutter.style.display = "none"; }
    const retake = overlay.querySelector("#nwpRetake");
    if (retake) { retake.hidden = false; retake.style.display = ""; }
    const confirm = overlay.querySelector("#nwpConfirm");
    if (confirm) confirm.disabled = false;
  }

  function retakePhoto() {
    capturedPhoto = "";
    if (!overlay) return;
    renderSelfieStep();
  }

  function showErr(msg) {
    if (!overlay) return;
    const err = overlay.querySelector("#nwpErr");
    if (!err) return;
    err.textContent = String(msg || "");
    err.style.display = "block";
  }

  async function confirmPunch(btn) {
    if (!ctx || !capturedPhoto) return;
    const p = ctx.pos || {};
    const meta = {
      latitude: p.lat,
      longitude: p.lng,
      accuracy: Math.round(p.acc || 0),
      distance: ctx.distance != null ? Math.round(ctx.distance) : null,
      withinRange: ctx.within !== false,
      range: ctx.community ? ctx.community.range : null,
      at: new Date(),
    };
    const done = ctx;
    if (btn) { btn.disabled = true; btn.textContent = "打卡中…"; }
    try {
      await done.opts.onConfirm(capturedPhoto, meta);
      finish({ ok: true });
    } catch (e) {
      console.error("punch flow: confirm failed", e);
      if (!ctx) return;
      if (btn) { btn.disabled = false; btn.textContent = "確認打卡"; }
      showErr("打卡失敗：" + ((e && e.message) || "請稍後再試"));
    }
  }

  /* ---------- api ---------- */
  function open(opts) {
    return new Promise((resolve, reject) => {
      if (ctx) { finish({ ok: false }); }
      ctx = { opts: opts || {}, resolve, reject, settled: false, pos: null, community: null, distance: null, within: true };
      injectStyle();
      buildOverlay((opts && opts.title) || "打卡");
      locate();
    });
  }

  window.NwPunchFlow = { open };
})();
