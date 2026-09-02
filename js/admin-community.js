  (function () {
    "use strict";
    function esc(v) {
      return String(v == null ? "" : v).replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
    }
    function pad2(n) { return String(n).padStart(2, "0"); }
    function toNum(v, fallback) {
      const n = Number(v);
      return Number.isFinite(n) ? n : (typeof fallback === "number" ? fallback : NaN);
    }
    function nowIso() {
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    }

    const COMMUNITY_STAFF_CATEGORIES = ["總幹事", "秘書", "保全"];
    const DEFAULT_SUITE_FORMULA = Object.freeze({
      electric: { enabled: true, name: "電費", formula: "usage * unitPrice", unitPrice: 5.5, baseFee: 0, remark: "usage=本期度數；unitPrice 可自訂單價；baseFee 為基本費" },
      water: { enabled: true, name: "水費", formula: "usage * unitPrice + baseFee", unitPrice: 12, baseFee: 50, remark: "usage=本期用水量；unitPrice 每度單價；baseFee 基本費" },
      maintain: { enabled: true, name: "維護費", formula: "baseFee + usage * unitPrice", unitPrice: 0, baseFee: 800, remark: "usage 可為戶數或坪數，預設 baseFee=800 固定費" },
      other: { enabled: false, name: "其他費用", formula: "baseFee", unitPrice: 0, baseFee: 0, remark: "自訂費用項目，可自由填寫 formula" }
    });

    function openSimpleModal({ title, bodyHtml, footerHtml, width }) {
      const backdrop = document.createElement("div");
      backdrop.className = "mr-modal-backdrop";
      backdrop.setAttribute("role", "presentation");
      backdrop.innerHTML = `
        <div class="mr-modal" role="dialog" aria-modal="true" aria-labelledby="acm_modal_title">
          <div class="mr-modal-hd">
            <div class="title" id="acm_modal_title">${esc(title || "")}</div>
            <button class="mr-modal-close" type="button" aria-label="關閉">×</button>
          </div>
          <div class="mr-modal-bd">${bodyHtml || ""}</div>
          <div class="mr-modal-ft">${footerHtml || ""}</div>
        </div>
      `;
      document.body.appendChild(backdrop);
      const modal = backdrop.querySelector(".mr-modal");
      if (width) modal.style.width = width;
      modal.style.maxHeight = "88vh";
      modal.style.display = "grid";
      modal.style.gridTemplateRows = "auto 1fr auto";
      const bd = modal.querySelector(".mr-modal-bd");
      if (bd) {
        bd.style.overflowY = "auto";
        bd.style.overflowX = "hidden";
      }
      const close = () => { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); };
      backdrop.querySelector(".mr-modal-close").onclick = close;
      backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
      const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
      document.addEventListener("keydown", onKey);
      return { el: backdrop, modal, close };
    }

    function toast(msg, isErr) {
      if (!msg) return;
      const tEl = document.getElementById("toast");
      if (!tEl) { alert(msg); return; }
      tEl.textContent = String(msg);
      tEl.classList.toggle("show", true);
      tEl.style.background = isErr ? "rgba(220,38,38,.95)" : "rgba(17,24,39,.92)";
      tEl.style.color = "#fff";
      tEl.style.zIndex = 999999;
      setTimeout(() => { tEl.classList.toggle("show", false); tEl.textContent = ""; }, 2200);
    }

    function sha256Hex(text) {
      const v = String(text || "");
      const cryptoObj = window.crypto && window.crypto.subtle ? window.crypto : null;
      if (!cryptoObj) return Promise.resolve("");
      const data = new TextEncoder().encode(v);
      return cryptoObj.subtle.digest("SHA-256", data).then((hashBuf) => {
        const bytes = Array.from(new Uint8Array(hashBuf));
        return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
      });
    }

    function getSecondaryAuth() {
      const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
      if (!fb || !fb.apps || !fb.auth) return null;
      try {
        const exist = fb.apps.find((a) => a && a.name === "nwapp-secondary");
        if (exist) return fb.auth(exist);
      } catch {}
      try {
        const cfg = window.FIREBASE_CONFIG || (fb.apps[0] && fb.apps[0].options) || null;
        if (!cfg) return null;
        return fb.initializeApp(cfg, "nwapp-secondary").auth();
      } catch {
        return null;
      }
    }

    function createAuthUser(email, password) {
      const a = getSecondaryAuth();
      if (!a) return Promise.reject(new Error("auth-not-ready"));
      return a.createUserWithEmailAndPassword(String(email || ""), String(password || "")).then((cred) => {
        const u = cred && cred.user ? cred.user : null;
        const uid = u && u.uid ? String(u.uid) : "";
        if (!uid) throw new Error("no-uid");
        return { uid, auth: a, user: u };
      });
    }

    function upsertUserLookup({ phoneNormalized, email, phone, uid, community, communityCode, role }) {
      const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
      const db = fb && fb.firestore ? fb.firestore() : null;
      const key = String(phoneNormalized || "").replace(/\D/g, "");
      if (!db || !key) return Promise.resolve();
      const payload = {
        uid: String(uid || ""),
        email: String(email || ""),
        phone: String(phone || ""),
        phoneNormalized: key,
        community: String(community || ""),
        communityCode: String(communityCode || ""),
        role: String(role || ""),
        updatedAt: (fb.firestore && fb.firestore.FieldValue && fb.firestore.FieldValue.serverTimestamp) ? fb.firestore.FieldValue.serverTimestamp() : Date.now()
      };
      return db.collection("user_lookup").doc(key).set(payload, { merge: true }).catch(() => {});
    }

    function matchesCommunityStaff(docRole, docCategory, communityId, docCommunityIds, docCommunityId) {
      const roleNorm = String(docRole || "").trim();
      if (roleNorm !== "社區") return false;
      const cat = String(docCategory || "").trim();
      if (!COMMUNITY_STAFF_CATEGORIES.includes(cat)) return false;
      const cid = String(communityId || "").trim();
      if (!cid) return false;
      const ids = Array.isArray(docCommunityIds) ? docCommunityIds : [];
      if (ids.map((x) => String(x || "").trim()).includes(cid)) return true;
      if (String(docCommunityId || "").trim() === cid) return true;
      return false;
    }

    async function saveCommunityStaffUser({ isEdit, userId, communityId, communityCode, communityName, category, name, loginAccount, email, phone, passwordPlain }) {
      const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
      const db = fb && fb.firestore ? fb.firestore() : null;
      if (!db) throw new Error("Firestore 尚未初始化");
      const cid = String(communityId || "").trim();
      if (!cid) throw new Error("缺少社區資訊");
      const cat = String(category || "").trim();
      if (!COMMUNITY_STAFF_CATEGORIES.includes(cat)) throw new Error("類別僅限總幹事、秘書、保全");
      if (!String(name || "").trim()) throw new Error("姓名為必填");
      if (!String(loginAccount || "").trim()) throw new Error("登入帳號為必填");
      if (!isEdit && !String(passwordPlain || "").trim()) throw new Error("密碼為必填");
      const emailVal = String(email || "").trim();
      if (!emailVal) throw new Error("Email 為必填（系統 Auth 使用）");
      let uid = isEdit ? String(userId || "").trim() : "";
      if (!isEdit) {
        const created = await createAuthUser(emailVal, passwordPlain);
        uid = created.uid;
      }
      if (!uid) throw new Error("無法取得使用者 ID");
      const passwordHash = (!isEdit || String(passwordPlain || "").trim()) ? (await sha256Hex(passwordPlain)) : "";
      const fbTs = (fb.firestore && fb.firestore.FieldValue && fb.firestore.FieldValue.serverTimestamp) ? fb.firestore.FieldValue.serverTimestamp() : Date.now();
      const payload = {
        role: "社區",
        category: cat,
        community: cid,
        communityIds: [cid],
        communityCodes: communityCode ? [String(communityCode).trim()] : [],
        communityNames: communityName ? [String(communityName).trim()] : [],
        houseNo: "",
        displayName: String(name || "").trim(),
        username: String(loginAccount || "").trim(),
        email: emailVal,
        phone: String(phone || "").trim(),
        updatedAt: fbTs
      };
      if (!isEdit) payload.createdAt = fbTs;
      if (passwordHash) {
        payload.passwordHash = passwordHash;
        payload.passwordPlain = String(passwordPlain || "");
        payload.passwordPlainUpdatedAt = fbTs;
      }
      await db.collection("users").doc(uid).set(payload, { merge: true });
      const phoneDigits = String(phone || "").replace(/\D/g, "");
      await upsertUserLookup({
        phoneNormalized: phoneDigits || emailVal,
        email: emailVal,
        phone: String(phone || ""),
        uid,
        community: cid,
        communityCode: String(communityCode || ""),
        role: "社區"
      });
      return { id: uid };
    }

    async function deleteCommunityStaffUser(userId) {
      const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
      const db = fb && fb.firestore ? fb.firestore() : null;
      if (!db) throw new Error("Firestore 尚未初始化");
      const uid = String(userId || "").trim();
      if (!uid) throw new Error("缺少使用者 ID");
      await db.collection("users").doc(uid).delete();
    }

    async function loadCommunitySuiteConfig(communityId) {
      const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
      const db = fb && fb.firestore ? fb.firestore() : null;
      const cid = String(communityId || "").trim();
      if (!db || !cid) return JSON.parse(JSON.stringify(DEFAULT_SUITE_FORMULA));
      try {
        const snap = await db.collection("communities").doc(cid).collection("settings").doc("suitePricing").get();
        if (snap && snap.exists) {
          const raw = snap.data() || {};
          const out = JSON.parse(JSON.stringify(DEFAULT_SUITE_FORMULA));
          Object.keys(out).forEach((k) => {
            if (raw[k] && typeof raw[k] === "object") {
              out[k] = Object.assign({}, out[k], raw[k]);
              if (typeof out[k].enabled !== "boolean") out[k].enabled = true;
            }
          });
          return out;
        }
      } catch (e) {
        console.warn("load suite config failed", e);
      }
      return JSON.parse(JSON.stringify(DEFAULT_SUITE_FORMULA));
    }

    async function saveCommunitySuiteConfig(communityId, cfg) {
      const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
      const db = fb && fb.firestore ? fb.firestore() : null;
      const cid = String(communityId || "").trim();
      if (!db || !cid) throw new Error("缺少 Firestore 或社區 ID");
      const fbTs = (fb.firestore && fb.firestore.FieldValue && fb.firestore.FieldValue.serverTimestamp) ? fb.firestore.FieldValue.serverTimestamp() : Date.now();
      const payload = Object.assign({}, cfg || {}, { updatedAt: fbTs });
      await db.collection("communities").doc(cid).collection("settings").doc("suitePricing").set(payload, { merge: false });
    }

    function safeEvalFormula(formula, vars, fallback) {
      try {
        const keys = Object.keys(vars || {});
        const vals = keys.map((k) => vars[k]);
        const src = `"use strict"; return (${formula});`;
        const fn = new Function(...keys, src);
        const result = fn(...vals);
        if (result == null || typeof result === "boolean" || Number.isNaN(Number(result))) return fallback;
        const n = Number(result);
        return Number.isFinite(n) ? n : fallback;
      } catch (e) {
        return fallback;
      }
    }

    function renderSuitePreview(cfg) {
      const rows = [];
      const sampleVars = { usage: 100, unitPrice: 1, baseFee: 0, days: 30, count: 1 };
      Object.keys(cfg || {}).forEach((k) => {
        const item = cfg[k] || {};
        if (!item || item.enabled === false) return;
        const vars = {
          usage: 100,
          unitPrice: toNum(item.unitPrice, 0),
          baseFee: toNum(item.baseFee, 0),
          days: 30,
          count: 1
        };
        const result = safeEvalFormula(item.formula || "0", vars, null);
        const varsStr = `usage=100, unitPrice=${vars.unitPrice}, baseFee=${vars.baseFee}`;
        rows.push(`
          <div style="padding:12px 14px; border-radius:14px; background:#fff; border:1px solid rgba(17,24,39,.08);">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
              <div style="font-weight:900;">${esc(item.name || k)}</div>
              <div style="font-family:'SF Mono',Consolas,monospace; font-weight:900; color:#9f1c1c;">${result == null ? "公式錯誤" : ("NT$ " + Number(result).toFixed(2))}</div>
            </div>
            <div style="margin-top:6px; font-size:12px; color:#374151; font-weight:700;">公式：<code style="background:#f3f4f6; padding:2px 6px; border-radius:6px;">${esc(item.formula || "")}</code></div>
            <div style="margin-top:4px; font-size:11px; color:#6b7280;">樣本(${varsStr})</div>
          </div>
        `);
      });
      return rows.length ? rows.join("") : `<div class="muted" style="padding:14px;text-align:center;">尚未啟用任何費用項目</div>`;
    }

    window.NwAdminCommunity = {
      UI: {
        renderCommunityStaffPage(container, ctx) {
          if (!container) return;
          const fb = typeof window.firebase !== "undefined" ? window.firebase : null;
          const db = fb && fb.firestore ? fb.firestore() : null;
          const cid = String((ctx && ctx.communityId) || "").trim();
          const cCode = String((ctx && ctx.communityCode) || "").trim();
          const cName = String((ctx && ctx.communityName) || "").trim();
          const myUid = fb && fb.auth && fb.auth().currentUser ? String(fb.auth().currentUser.uid || "") : "";
          if (!db) {
            container.innerHTML = `<section class="card"><div class="card-bd"><div class="tag red">Firestore 未初始化</div></div></section>`;
            return;
          }
          if (!cid) {
            container.innerHTML = `<section class="card"><div class="card-bd"><div class="tag yellow">請先選擇社區</div></div></section>`;
            return;
          }

          const state = { loading: true, users: [], unsub: null };
          const catChips = ["全部", ...COMMUNITY_STAFF_CATEGORIES];
          let currentCat = "全部";
          let searchKey = "";

          const renderLayout = () => {
            const filtered = (state.users || []).filter((u) => {
              if (currentCat !== "全部" && String(u.category || "").trim() !== currentCat) return false;
              if (searchKey) {
                const k = searchKey.toLowerCase();
                return (
                  String(u.name || "").toLowerCase().includes(k) ||
                  String(u.username || "").toLowerCase().includes(k) ||
                  String(u.email || "").toLowerCase().includes(k) ||
                  String(u.phone || "").toLowerCase().includes(k)
                );
              }
              return true;
            });
            container.innerHTML = `
              <section class="card meter-page">
                <div class="card-hd">
                  <div class="left">
                    <div class="chip" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(37,99,235,.12);color:#2563eb;font-weight:900;">👥</div>
                    <div style="min-width:0;">
                      <h2>管理帳號${cName ? `｜${esc(cName)}` : ""}</h2>
                      <p>管理社區後台登入帳號（總幹事／秘書／保全），不包含管理員類別。</p>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                    <div class="tag red">${filtered.length}</div>
                    <button class="btn btn-sm btn-ghost" type="button" id="acmRefreshBtn" title="重新整理">⟳</button>
                    <button class="btn btn-sm btn-primary" type="button" id="acmAddBtn">＋ 新增</button>
                  </div>
                </div>
                <div class="card-bd" style="display:grid; gap:12px;">
                  <div style="display:grid; gap:10px; grid-template-columns: 1fr auto;">
                    <div style="position:relative;">
                      <input type="search" id="acmSearch" placeholder="搜尋姓名 / 帳號 / Email / 手機" value="${esc(searchKey)}" style="width:100%;padding:10px 14px;border-radius:12px;border:1px solid rgba(17,24,39,.12);"/>
                      ${searchKey ? `<button class="btn btn-sm btn-ghost" type="button" id="acmSearchClear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);">✕</button>` : ""}
                    </div>
                  </div>
                  <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${catChips.map((c) => `
                      <button class="btn btn-sm ${c === currentCat ? "btn-primary" : "btn-ghost"}" type="button" data-acm-cat="${esc(c)}">${esc(c)}${c === "全部" ? ("(" + (state.users || []).length + ")") : ("(" + (state.users || []).filter((u) => String(u.category || "") === c).length + ")")}</button>
                    `).join("")}
                  </div>
                  ${state.loading ? `<div class="muted" style="padding:24px;text-align:center;">讀取中...</div>` :
                    filtered.length === 0 ? `<div class="muted" style="padding:24px;text-align:center;">尚無資料，可點擊右上角「＋ 新增」建立第一筆。</div>` :
                    `<div style="display:grid; gap:12px;">${filtered.map((u) => userCard(u)).join("")}</div>`
                  }
                </div>
              </section>
            `;
            bindEvents();
          };

          const userCard = (u) => {
            const isMe = myUid && String(u.id || "") === myUid;
            const catTagColor = u.category === "總幹事" ? "background:rgba(194,24,91,.10);color:#9f1c1c;border:1px solid rgba(194,24,91,.22);"
              : u.category === "秘書" ? "background:rgba(37,99,235,.10);color:#1d4ed8;border:1px solid rgba(37,99,235,.22);"
              : "background:rgba(5,150,105,.10);color:#047857;border:1px solid rgba(5,150,105,.22);";
            return `
              <div style="display:grid;gap:10px;padding:14px;border-radius:18px;background:#fff;border:1px solid rgba(17,24,39,.10);box-shadow:0 8px 22px rgba(17,24,39,.06);">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                  <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                    <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#eef2ff,#faf5ff);display:flex;align-items:center;justify-content:center;font-weight:900;color:#4338ca;">${esc(String(u.name || "U").trim().slice(0, 1).toUpperCase())}</div>
                    <div style="min-width:0;">
                      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <div style="font-weight:900; font-size:16px;">${esc(u.name || "—")}</div>
                        <span class="tag" style="${catTagColor} border-radius:999px; padding:0 10px; height:22px; font-size:12px; display:inline-flex; align-items:center;">${esc(u.category || "—")}</span>
                        ${u.enabled === false ? `<span class="tag" style="background:rgba(107,114,128,.12);color:#4b5563;border-radius:999px;padding:0 10px;height:22px;font-size:12px;">停用</span>` : ""}
                        ${isMe ? `<span class="tag" style="background:rgba(16,185,129,.12);color:#065f46;border-radius:999px;padding:0 10px;height:22px;font-size:12px;">本人</span>` : ""}
                      </div>
                      <div style="margin-top:4px;font-size:12px;color:#6b7280;">帳號：${esc(u.username || "—")} ｜ Email：${esc(u.email || "—")} ｜ 手機：${esc(u.phone || "—")}</div>
                      ${u.passwordPlain ? `<div style="margin-top:4px;font-size:11px;color:#6b7280;">密碼：<b style="color:#111827;">${esc(u.passwordPlain)}</b></div>` : ""}
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                    <button class="btn btn-sm" type="button" data-acm-edit="${esc(u.id)}">編輯</button>
                    ${!isMe ? `<button class="btn btn-sm btn-danger" type="button" data-acm-delete="${esc(u.id)}">刪除</button>` : `<span style="font-size:11px; color:#9ca3af; font-weight:800; align-self:center;">本帳號無法自刪</span>`}
                  </div>
                </div>
              </div>
            `;
          };

          const bindEvents = () => {
            const addBtn = container.querySelector("#acmAddBtn");
            if (addBtn) addBtn.onclick = () => openStaffModal(null);
            const refreshBtn = container.querySelector("#acmRefreshBtn");
            if (refreshBtn) refreshBtn.onclick = () => { subscribe(); toast("已重新整理"); };
            const searchInput = container.querySelector("#acmSearch");
            if (searchInput) {
              searchInput.addEventListener("input", (e) => {
                searchKey = String(e && e.target ? e.target.value : "").trim();
                renderLayout();
              });
            }
            const clearBtn = container.querySelector("#acmSearchClear");
            if (clearBtn) clearBtn.onclick = () => { searchKey = ""; renderLayout(); };
            container.querySelectorAll("[data-acm-cat]").forEach((b) => {
              b.onclick = () => { currentCat = String(b.getAttribute("data-acm-cat") || ""); renderLayout(); };
            });
            container.querySelectorAll("[data-acm-edit]").forEach((b) => {
              b.onclick = () => {
                const uid = String(b.getAttribute("data-acm-edit") || "");
                const u = (state.users || []).find((x) => String(x.id || "") === uid);
                if (u) openStaffModal(u);
              };
            });
            container.querySelectorAll("[data-acm-delete]").forEach((b) => {
              b.onclick = () => {
                const uid = String(b.getAttribute("data-acm-delete") || "");
                const u = (state.users || []).find((x) => String(x.id || "") === uid);
                if (u) confirmDelete(u);
              };
            });
          };

          const openStaffModal = (user) => {
            const isEdit = Boolean(user);
            const cat = isEdit && user.category && COMMUNITY_STAFF_CATEGORIES.includes(String(user.category)) ? String(user.category) : "總幹事";
            const m = openSimpleModal({
              title: (isEdit ? "編輯" : "新增") + "管理帳號",
              width: "min(80vw, 720px)",
              bodyHtml: `
                <div style="display:grid;gap:12px;">
                  <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">類別（僅限非管理員）</label>
                    <select id="acm_category" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;">
                      ${COMMUNITY_STAFF_CATEGORIES.map((c) => `<option value="${esc(c)}" ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}
                    </select>
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">姓名 *</label><input id="acm_name" type="text" value="${esc(isEdit ? (user.name || "") : "")}" placeholder="真實姓名" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/></div>
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">登入帳號 *</label><input id="acm_username" type="text" value="${esc(isEdit ? (user.username || "") : "")}" placeholder="例如：sec01" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/></div>
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">Email *（Auth 登入）</label><input id="acm_email" type="email" value="${esc(isEdit ? (user.email || "") : "")}" placeholder="name@example.com" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/></div>
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">手機</label><input id="acm_phone" type="tel" value="${esc(isEdit ? (user.phone || "") : "")}" placeholder="09xxxxxxxx" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/></div>
                  </div>
                  <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">密碼${isEdit ? "（留空則不修改）" : " *"}</label>
                    <input id="acm_password" type="text" value="" placeholder="${isEdit ? "留空=不修改" : "至少 6 碼"}" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/>
                  </div>
                  ${isEdit ? `
                    <div style="padding:12px 14px;border-radius:14px;background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.2);">
                      <div style="font-weight:900;font-size:13px;color:#1e3a8a;">帳號資訊</div>
                      <div style="margin-top:6px;font-size:12px;color:#374151;line-height:1.7;">使用者ID：<code style="background:#fff;padding:2px 6px;border-radius:6px;">${esc(user.id || "")}</code><br/>建立/更新時間：${esc(user._updatedAt || "—")}</div>
                    </div>` : ""}
                  <div id="acm_status" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;"></div>
                </div>
              `,
              footerHtml: `<button class="btn btn-ghost" type="button" id="acm_cancel">取消</button><button class="btn btn-primary" type="button" id="acm_save">${isEdit ? "儲存" : "建立"}</button>`
            });
            const statusEl = m.modal.querySelector("#acm_status");
            const showStatus = (msg, isErr) => {
              if (!statusEl) return;
              statusEl.style.display = String(msg || "").trim() ? "block" : "none";
              statusEl.textContent = String(msg || "");
              statusEl.style.color = isErr ? "#9f1c1c" : "#15803d";
              statusEl.style.background = isErr ? "rgba(211,47,47,0.08)" : "rgba(46,125,50,0.08)";
              statusEl.style.border = isErr ? "1px solid rgba(211,47,47,.22)" : "1px solid rgba(46,125,50,.22)";
            };
            m.modal.querySelector("#acm_cancel").onclick = () => m.close();
            const saveBtn = m.modal.querySelector("#acm_save");
            if (saveBtn) saveBtn.onclick = async () => {
              const payload = {
                category: String(m.modal.querySelector("#acm_category").value || "").trim(),
                name: String(m.modal.querySelector("#acm_name").value || "").trim(),
                loginAccount: String(m.modal.querySelector("#acm_username").value || "").trim(),
                email: String(m.modal.querySelector("#acm_email").value || "").trim(),
                phone: String(m.modal.querySelector("#acm_phone").value || "").trim(),
                passwordPlain: String(m.modal.querySelector("#acm_password").value || "").trim()
              };
              try {
                saveBtn.disabled = true;
                saveBtn.textContent = "處理中…";
                showStatus("儲存中...", false);
                const res = await saveCommunityStaffUser({
                  isEdit, userId: isEdit ? user.id : "",
                  communityId: cid, communityCode: cCode, communityName: cName,
                  ...payload
                });
                showStatus((isEdit ? "已更新" : "已建立") + "，畫面即將刷新", false);
                setTimeout(() => { m.close(); subscribe(); }, 500);
              } catch (e) {
                saveBtn.disabled = false;
                saveBtn.textContent = isEdit ? "儲存" : "建立";
                showStatus("操作失敗：" + (e && e.message ? e.message : "請再試一次"), true);
              }
            };
          };

          const confirmDelete = (u) => {
            const m = openSimpleModal({
              title: "確認刪除管理帳號",
              width: "min(80vw, 680px)",
              bodyHtml: `
                <div style="display:grid;gap:12px;">
                  <div style="padding:12px 14px;border-radius:14px;background:rgba(220,38,38,.08);border:1.5px solid rgba(220,38,38,.22);color:#991b1b;font-weight:900;font-size:13px;line-height:1.6;">
                    確認刪除後，<b>此帳號將永久從使用者清單移除（連同 Auth 紀錄）</b>，若該人員需回聘請重新建立。<br/>※ 僅刪除 Firestore 紀錄，若有系統後台 Auth 手動清理需求請洽系統管理員。
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">類別</label><div style="padding:10px 12px;border-radius:12px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);font-weight:800;">${esc(u.category || "—")}</div></div>
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">姓名</label><div style="padding:10px 12px;border-radius:12px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);font-weight:800;">${esc(u.name || "—")}</div></div>
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">登入帳號</label><div style="padding:10px 12px;border-radius:12px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);font-weight:800;">${esc(u.username || "—")}</div></div>
                    <div class="field" style="gap:2px;margin:0;"><label style="font-size:11px;">Email</label><div style="padding:10px 12px;border-radius:12px;background:#f9fafb;border:1px solid rgba(17,24,39,.08);font-weight:800;">${esc(u.email || "—")}</div></div>
                  </div>
                  <div id="acm_delStatus" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;"></div>
                </div>
              `,
              footerHtml: `<button class="btn btn-ghost" type="button" id="acm_delCancel">取消</button><button class="btn btn-danger" type="button" id="acm_delOk">確認刪除</button>`
            });
            const statusEl = m.modal.querySelector("#acm_delStatus");
            const showStatus = (msg, isErr) => {
              if (!statusEl) return;
              statusEl.style.display = String(msg || "").trim() ? "block" : "none";
              statusEl.textContent = String(msg || "");
              statusEl.style.color = isErr ? "#9f1c1c" : "#15803d";
              statusEl.style.background = isErr ? "rgba(211,47,47,0.08)" : "rgba(46,125,50,0.08)";
              statusEl.style.border = isErr ? "1px solid rgba(211,47,47,.22)" : "1px solid rgba(46,125,50,.22)";
            };
            m.modal.querySelector("#acm_delCancel").onclick = () => m.close();
            const okBtn = m.modal.querySelector("#acm_delOk");
            if (okBtn) okBtn.onclick = async () => {
              try {
                okBtn.disabled = true;
                okBtn.textContent = "處理中…";
                showStatus("刪除中...", false);
                await deleteCommunityStaffUser(u.id);
                showStatus("已刪除，畫面即將刷新", false);
                setTimeout(() => { m.close(); subscribe(); }, 500);
              } catch (e) {
                okBtn.disabled = false;
                okBtn.textContent = "確認刪除";
                showStatus("刪除失敗：" + (e && e.message ? e.message : "請再試一次"), true);
              }
            };
          };

          const subscribe = () => {
            if (state.unsub) { try { state.unsub(); } catch {}; state.unsub = null; }
            state.loading = true;
            renderLayout();
            try {
              const col = db.collection("users").where("role", "==", "社區").where("communityIds", "array-contains", cid);
              state.unsub = col.onSnapshot(
                (snap) => {
                  const list = [];
                  snap.forEach((d) => {
                    const v = d.data() || {};
                    if (!matchesCommunityStaff(v.role, v.category, cid, v.communityIds, v.community)) return;
                    const up = v.updatedAt;
                    list.push({
                      id: d.id,
                      category: String(v.category || ""),
                      name: String(v.displayName || v.name || ""),
                      username: String(v.username || v.email || v.phone || ""),
                      email: String(v.email || ""),
                      phone: String(v.phone || ""),
                      passwordPlain: String(v.passwordPlain || ""),
                      enabled: v.enabled !== false,
                      communityId: String(v.community || ""),
                      communityIds: Array.isArray(v.communityIds) ? v.communityIds : [],
                      _updatedAt: (up && up.toDate) ? up.toDate().toLocaleString("zh-TW") : (up ? new Date(Number(up) || Date.now()).toLocaleString("zh-TW") : nowIso())
                    });
                  });
                  state.users = list.sort((a, b) => (COMMUNITY_STAFF_CATEGORIES.indexOf(a.category) - COMMUNITY_STAFF_CATEGORIES.indexOf(b.category)) || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant-TW"));
                  state.loading = false;
                  renderLayout();
                },
                (e) => {
                  console.warn("community staff subscribe failed", e);
                  state.loading = false;
                  state.users = [];
                  renderLayout();
                  toast("讀取失敗：" + (e && e.message ? e.message : "請檢查權限"), true);
                }
              );
            } catch (e) {
              console.warn(e);
              state.loading = false;
              renderLayout();
            }
          };

          subscribe();
          if (typeof window !== "undefined") {
            window.__nwCommunityStaffCleanup = () => { try { if (state.unsub) state.unsub(); } catch {} };
          }
        },

        renderSuitePage(container, ctx) {
          if (!container) return;
          const cid = String((ctx && ctx.communityId) || "").trim();
          const cName = String((ctx && ctx.communityName) || "").trim();
          if (!cid) {
            container.innerHTML = `<section class="card"><div class="card-bd"><div class="tag yellow">請先選擇社區</div></div></section>`;
            return;
          }
          const state = { loading: true, cfg: JSON.parse(JSON.stringify(DEFAULT_SUITE_FORMULA)), dirty: false, preview: true };
          const items = [
            { key: "electric", defaultName: "電費" },
            { key: "water", defaultName: "水費" },
            { key: "maintain", defaultName: "維護費" },
            { key: "other", defaultName: "其他費用" }
          ];

          const renderLayout = () => {
            container.innerHTML = `
              <section class="card meter-page">
                <div class="card-hd">
                  <div class="left">
                    <div class="chip" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:12px;background:rgba(16,185,129,.12);color:#047857;font-weight:900;">🛖</div>
                    <div style="min-width:0;">
                      <h2>套房專區${cName ? `｜${esc(cName)}` : ""}</h2>
                      <p>客製化電費、水費、維護費、其他費用的計算公式；可使用 usage / unitPrice / baseFee / days / count 等變數。</p>
                    </div>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                    <button class="btn btn-sm ${state.preview ? "btn-primary" : "btn-ghost"}" type="button" id="suiteTogglePreview">預覽${state.preview ? "開" : "關"}</button>
                    <button class="btn btn-sm" type="button" id="suiteResetBtn">回復預設</button>
                    <button class="btn btn-sm btn-primary" type="button" id="suiteSaveBtn">儲存設定</button>
                  </div>
                </div>
                <div class="card-bd" style="display:grid; gap:14px;">
                  <div style="padding:12px 14px;border-radius:14px;background:rgba(37,99,235,.06);border:1px solid rgba(37,99,235,.15);font-size:12px;color:#1e3a8a;font-weight:700;line-height:1.7;">
                    變數說明：<code style="background:#fff;padding:2px 6px;border-radius:6px;">usage</code> 本期用量（度數／度數／坪數等）、
                    <code style="background:#fff;padding:2px 6px;border-radius:6px;">unitPrice</code> 項目單價、
                    <code style="background:#fff;padding:2px 6px;border-radius:6px;">baseFee</code> 基本費、
                    <code style="background:#fff;padding:2px 6px;border-radius:6px;">days</code> 天數（預設 30）、
                    <code style="background:#fff;padding:2px 6px;border-radius:6px;">count</code> 戶數（預設 1）。
                    範例：<code style="background:#fff;padding:2px 6px;border-radius:6px;">usage * unitPrice + baseFee</code> 或
                    <code style="background:#fff;padding:2px 6px;border-radius:6px;">baseFee * count</code>
                  </div>
                  <div style="display:grid; gap:12px;">
                    ${items.map((it, idx) => itemBlock(it, idx)).join("")}
                  </div>
                  ${state.preview ? `
                    <div style="padding:14px;border-radius:18px;background:linear-gradient(180deg,#f8fafc,#fff);border:1px solid rgba(17,24,39,.08);">
                      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
                        <div style="font-weight:900;">樣本試算（usage=100，其餘使用上方設定值）</div>
                        <div class="tag" title="試算總額" style="background:rgba(194,24,91,.10);color:#9f1c1c;border:1px solid rgba(194,24,91,.22);border-radius:999px;padding:0 12px;height:26px;display:inline-flex;align-items:center;font-weight:900;">NT$ ${calcTotalPreview()}</div>
                      </div>
                      ${renderSuitePreview(state.cfg)}
                    </div>
                  ` : ""}
                  <div id="suiteStatus" style="display:none;padding:10px 12px;border-radius:12px;font-size:12px;font-weight:800;"></div>
                </div>
              </section>
            `;
            bindEvents();
          };

          const itemBlock = (it, idx) => {
            const row = (state.cfg && state.cfg[it.key]) ? state.cfg[it.key] : {};
            const enabled = row.enabled !== false;
            const name = String(row.name || it.defaultName);
            const formula = String(row.formula || "0");
            const unitPrice = toNum(row.unitPrice, 0);
            const baseFee = toNum(row.baseFee, 0);
            const remark = String(row.remark || "");
            return `
              <div style="padding:14px;border-radius:18px;background:#fff;border:1px solid rgba(17,24,39,.08);box-shadow:0 8px 22px rgba(17,24,39,.04);display:grid;gap:12px;opacity:${enabled ? 1 : 0.55};">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <label class="check-inline" style="font-weight:900;">
                      <input type="checkbox" data-suite-enable="${esc(it.key)}" ${enabled ? "checked" : ""}/>
                      項目${idx + 1}. ${esc(it.defaultName)}
                    </label>
                  </div>
                  <div class="field" style="gap:2px;margin:0;min-width:200px;max-width:40%;">
                    <label style="font-size:11px;">顯示名稱</label>
                    <input type="text" data-suite-name="${esc(it.key)}" value="${esc(name)}" ${enabled ? "" : "disabled"} style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/>
                  </div>
                </div>
                <div class="field" style="gap:2px;margin:0;">
                  <label style="font-size:11px;">計算公式（JavaScript 運算式）</label>
                  <input type="text" data-suite-formula="${esc(it.key)}" value="${esc(formula)}" ${enabled ? "" : "disabled"} placeholder="例如：usage * unitPrice + baseFee" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);font-family:'SF Mono',Consolas,monospace;font-weight:800;"/>
                </div>
                <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
                  <div class="field" style="gap:2px;margin:0;">
                    <label style="font-size:11px;">unitPrice（單價）</label>
                    <input type="number" step="0.01" data-suite-unit="${esc(it.key)}" value="${Number(unitPrice).toFixed(2)}" ${enabled ? "" : "disabled"} style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/>
                  </div>
                  <div class="field" style="gap:2px;margin:0;">
                    <label style="font-size:11px;">baseFee（基本費）</label>
                    <input type="number" step="0.01" data-suite-base="${esc(it.key)}" value="${Number(baseFee).toFixed(2)}" ${enabled ? "" : "disabled"} style="padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);width:100%;font-weight:800;"/>
                  </div>
                </div>
                <div class="field" style="gap:2px;margin:0;">
                  <label style="font-size:11px;">備註（內部說明）</label>
                  <input type="text" data-suite-remark="${esc(it.key)}" value="${esc(remark)}" ${enabled ? "" : "disabled"} placeholder="例如：夏季單價另計，請洽總幹事" style="width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(17,24,39,.12);"/>
                </div>
              </div>
            `;
          };

          const calcTotalPreview = () => {
            let sum = 0;
            Object.keys(state.cfg || {}).forEach((k) => {
              const item = state.cfg[k] || {};
              if (!item || item.enabled === false) return;
              const vars = { usage: 100, unitPrice: toNum(item.unitPrice, 0), baseFee: toNum(item.baseFee, 0), days: 30, count: 1 };
              const v = safeEvalFormula(item.formula || "0", vars, null);
              if (Number.isFinite(v)) sum += Number(v);
            });
            return Number(sum).toFixed(2);
          };

          const bindEvents = () => {
            const readCfgFromDom = () => {
              items.forEach((it) => {
                const k = it.key;
                const en = container.querySelector(`[data-suite-enable="${k}"]`);
                const nm = container.querySelector(`[data-suite-name="${k}"]`);
                const fm = container.querySelector(`[data-suite-formula="${k}"]`);
                const up = container.querySelector(`[data-suite-unit="${k}"]`);
                const bf = container.querySelector(`[data-suite-base="${k}"]`);
                const rm = container.querySelector(`[data-suite-remark="${k}"]`);
                if (!state.cfg[k]) state.cfg[k] = Object.assign({}, DEFAULT_SUITE_FORMULA[k]);
                if (en) state.cfg[k].enabled = Boolean(en.checked);
                if (nm) state.cfg[k].name = String(nm.value || "");
                if (fm) state.cfg[k].formula = String(fm.value || "");
                if (up) state.cfg[k].unitPrice = toNum(up.value, 0);
                if (bf) state.cfg[k].baseFee = toNum(bf.value, 0);
                if (rm) state.cfg[k].remark = String(rm.value || "");
              });
              state.dirty = true;
            };
            container.querySelectorAll("input").forEach((inp) => {
              inp.addEventListener("input", () => { readCfgFromDom(); renderLayout(); });
              inp.addEventListener("change", () => { readCfgFromDom(); renderLayout(); });
            });
            const togglePrev = container.querySelector("#suiteTogglePreview");
            if (togglePrev) togglePrev.onclick = () => { state.preview = !state.preview; renderLayout(); };
            const resetBtn = container.querySelector("#suiteResetBtn");
            if (resetBtn) resetBtn.onclick = () => {
              if (!window.confirm("確認回復為系統預設公式（未儲存修改將遺失）？")) return;
              state.cfg = JSON.parse(JSON.stringify(DEFAULT_SUITE_FORMULA));
              state.dirty = true;
              renderLayout();
            };
            const saveBtn = container.querySelector("#suiteSaveBtn");
            const statusEl = container.querySelector("#suiteStatus");
            const showStatus = (msg, isErr) => {
              if (!statusEl) return;
              statusEl.style.display = String(msg || "").trim() ? "block" : "none";
              statusEl.textContent = String(msg || "");
              statusEl.style.color = isErr ? "#9f1c1c" : "#15803d";
              statusEl.style.background = isErr ? "rgba(211,47,47,0.08)" : "rgba(46,125,50,0.08)";
              statusEl.style.border = isErr ? "1px solid rgba(211,47,47,.22)" : "1px solid rgba(46,125,50,.22)";
            };
            if (saveBtn) saveBtn.onclick = async () => {
              readCfgFromDom();
              try {
                saveBtn.disabled = true;
                saveBtn.textContent = "儲存中…";
                showStatus("儲存中...", false);
                await saveCommunitySuiteConfig(cid, state.cfg);
                state.dirty = false;
                showStatus("已儲存套房專區公式設定", false);
                setTimeout(() => showStatus("", false), 1200);
                saveBtn.disabled = false;
                saveBtn.textContent = "儲存設定";
              } catch (e) {
                saveBtn.disabled = false;
                saveBtn.textContent = "儲存設定";
                showStatus("儲存失敗：" + (e && e.message ? e.message : "請再試一次"), true);
              }
            };
          };

          const init = async () => {
            state.loading = true;
            renderLayout();
            state.cfg = await loadCommunitySuiteConfig(cid);
            state.loading = false;
            renderLayout();
          };
          init();
        }
      }
    };
  })();
