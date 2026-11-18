(() => {
  "use strict";

  if (!window.firebase || typeof firebase.auth !== "function") return;
  const auth = firebase.auth();
  const db = firebase.firestore();

  const MAX_ITEMS = 60;
  const MAX_READ_IDS = 300;

  const MODULE_META = {
    parcel: { label: "包裹郵件", url: "parcel.html", color: "#f59e0b" },
    visitor: { label: "訪客登記", url: "visitor-resident.html", color: "#3b82f6" },
    community: { label: "社區園地", url: "bulletin-community.html", color: "#d32f2f" },
    finance: { label: "財務報表", url: "bulletin-finance.html", color: "#10b981" },
    meeting: { label: "會議紀錄", url: "bulletin-meeting.html", color: "#8b5cf6" },
    repair: { label: "修繕報告", url: "bulletin-repair.html", color: "#ef4444" },
    clean: { label: "清潔通報", url: "bulletin-clean.html", color: "#06b6d4" },
    activity: { label: "社區活動", url: "bulletin-activity.html", color: "#ec4899" },
    facility: { label: "公設預約", url: "facility.html", color: "#6366f1" },
    cleanreport: { label: "清潔通報", url: "clean-report.html", color: "#06b6d4" },
    system: { label: "系統通知", url: "member.html", color: "#6b7280" },
  };

  const state = {
    uid: "",
    cid: "",
    started: false,
    all: [],
    mine: [],
    live: [],
    readIds: new Set(),
    unsubAll: null,
    unsubMine: null,
    unsubReads: null,
  };

  function el(id) {
    try { return document.getElementById(id); } catch { return null; }
  }

  function moduleMeta(type) {
    return MODULE_META[String(type || "").trim()] || MODULE_META.system;
  }

  function itemKey(item) {
    return `${item.type}|${item.refId}|${item.title}`;
  }

  function toMillis(v) {
    try {
      if (v && typeof v.toMillis === "function") return v.toMillis();
      if (v && typeof v.seconds === "number") return v.seconds * 1000;
    } catch {}
    return 0;
  }

  function normalizeDoc(doc) {
    const v = (doc && doc.data && doc.data()) || {};
    const type = String(v.type || "").trim();
    const meta = moduleMeta(type);
    const createdAtMs = Number(v.createdAtMs || 0) || toMillis(v.createdAt);
    return {
      id: String(doc.id || ""),
      type,
      module: String(v.module || meta.label).trim() || meta.label,
      title: String(v.title || meta.label).trim() || meta.label,
      body: String(v.body || "").trim(),
      url: String(v.url || meta.url).trim() || meta.url,
      refId: String(v.refId || "").trim(),
      createdAtMs,
      live: false,
    };
  }

  function normalizeRemote(data) {
    const d = data || {};
    const type = String(d.type || d.module || "").trim();
    const meta = moduleMeta(type);
    return {
      id: "",
      type,
      module: String(d.module || meta.label).trim() || meta.label,
      title: String(d.title || meta.label).trim() || meta.label,
      body: String(d.body || "").trim(),
      url: String(d.url || meta.url).trim() || meta.url,
      refId: String(d.refId || "").trim(),
      createdAtMs: Date.now(),
      live: true,
    };
  }

  function mergedList() {
    const map = new Map();
    const push = (item) => {
      if (!item) return;
      const key = itemKey(item);
      const prev = map.get(key);
      // Firestore 文件（非 live）優先於前景即時項目
      if (!prev || (prev.live && !item.live)) map.set(key, item);
    };
    state.live.forEach(push);
    state.all.forEach(push);
    state.mine.forEach(push);
    return Array.from(map.values())
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      .slice(0, MAX_ITEMS);
  }

  function unreadCount(list) {
    const items = list || mergedList();
    let n = 0;
    items.forEach((item) => {
      if (item.id && !state.readIds.has(item.id)) n += 1;
    });
    return n;
  }

  function updateBadge() {
    const badge = el("btnNotifyCenterBadge");
    if (!badge) return;
    const n = unreadCount();
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = n <= 0;
    const btn = el("btnNotifyCenter");
    if (btn) btn.setAttribute("title", n > 0 ? `通知中心（${n} 則未讀）` : "通知中心");
  }

  function relativeTime(ms) {
    const t = Number(ms || 0);
    if (!t) return "";
    const diff = Date.now() - t;
    if (diff < 60 * 1000) return "剛剛";
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分鐘前`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小時前`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`;
    try {
      const d = new Date(t);
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    } catch {}
    return "";
  }

  function render() {
    const list = mergedList();
    updateBadge();

    const listEl = el("notifyCenterList");
    const emptyEl = el("notifyCenterEmpty");
    if (!listEl) return;

    listEl.textContent = "";
    if (emptyEl) emptyEl.hidden = list.length > 0;

    list.forEach((item) => {
      const unread = Boolean(item.id) && !state.readIds.has(item.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `notify-item${unread ? " unread" : ""}`;
      btn.dataset.notifyId = item.id || "";
      btn.dataset.notifyIndex = String(list.indexOf(item));

      const meta = moduleMeta(item.type);
      const avatar = document.createElement("span");
      avatar.className = "notify-avatar";
      avatar.style.background = meta.color;
      avatar.textContent = (item.module || meta.label).trim().slice(0, 1);

      const main = document.createElement("span");
      main.className = "notify-main";

      const head = document.createElement("span");
      head.className = "notify-head";
      const titleSpan = document.createElement("span");
      titleSpan.className = "notify-title";
      titleSpan.textContent = item.title;
      head.appendChild(titleSpan);
      if (unread) {
        const dot = document.createElement("span");
        dot.className = "notify-dot";
        dot.setAttribute("aria-label", "未讀");
        head.appendChild(dot);
      }

      const body = document.createElement("span");
      body.className = "notify-body";
      body.textContent = item.body || item.module;

      const time = document.createElement("span");
      time.className = "notify-time";
      time.textContent = relativeTime(item.createdAtMs);

      main.appendChild(head);
      main.appendChild(body);
      if (time.textContent) main.appendChild(time);

      btn.appendChild(avatar);
      btn.appendChild(main);
      btn.addEventListener("click", () => openItem(item));
      listEl.appendChild(btn);
    });
  }

  function writeReadIds() {
    const cid = state.cid;
    const uid = state.uid;
    if (!cid || !uid) return Promise.resolve();
    const ids = Array.from(state.readIds).slice(-MAX_READ_IDS);
    return db
      .collection("communities")
      .doc(cid)
      .collection("notificationReads")
      .doc(uid)
      .set({ ids, updatedAt: Date.now() }, { merge: true })
      .catch(() => {});
  }

  function markRead(id) {
    const key = String(id || "").trim();
    if (!key || state.readIds.has(key)) return;
    state.readIds.add(key);
    render();
    writeReadIds();
  }

  function markAllRead() {
    let changed = false;
    mergedList().forEach((item) => {
      if (item.id && !state.readIds.has(item.id)) {
        state.readIds.add(item.id);
        changed = true;
      }
    });
    if (!changed) return;
    render();
    writeReadIds();
  }

  function openItem(item) {
    if (item && item.id) markRead(item.id);
    closeModal();
    const url = String((item && item.url) || "").trim();
    if (!url) return;
    const opener = window.__nwOpenMemberPage;
    if (typeof opener === "function") {
      try { opener(url, item.module || "通知"); return; } catch {}
    }
    try { location.href = url; } catch {}
  }

  function openModal() {
    const modal = el("notifyCenterModal");
    if (!modal) return;
    render();
    modal.hidden = false;
  }

  function closeModal() {
    const modal = el("notifyCenterModal");
    if (modal) modal.hidden = true;
  }

  function showToast(item) {
    if (!item) return;
    let host = el("notifyToastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "notifyToastHost";
      host.className = "notify-toast-host";
      document.body.appendChild(host);
    }
    const meta = moduleMeta(item.type);
    const toast = document.createElement("div");
    toast.className = "notify-toast";
    toast.style.borderLeftColor = meta.color;

    const strong = document.createElement("div");
    strong.className = "notify-toast-title";
    strong.textContent = item.title;
    const small = document.createElement("div");
    small.className = "notify-toast-body";
    small.textContent = item.body || item.module;
    toast.appendChild(strong);
    toast.appendChild(small);
    toast.addEventListener("click", () => {
      try { toast.remove(); } catch {}
      openItem(item);
    });
    host.appendChild(toast);
    setTimeout(() => {
      try { toast.remove(); } catch {}
    }, 6000);
  }

  function handleForeground(data) {
    if (!data) return;
    if (String(data.callId || "").trim()) return;
    const item = normalizeRemote(data);
    if (!item) return;
    const key = itemKey(item);
    if (!state.live.some((x) => itemKey(x) === key)) state.live.unshift(item);
    if (state.live.length > MAX_ITEMS) state.live = state.live.slice(0, MAX_ITEMS);
    render();
    showToast(item);
  }

  function stopListeners() {
    [state.unsubAll, state.unsubMine, state.unsubReads].forEach((fn) => {
      if (typeof fn === "function") {
        try { fn(); } catch {}
      }
    });
    state.unsubAll = null;
    state.unsubMine = null;
    state.unsubReads = null;
  }

  function startListeners() {
    stopListeners();
    const cid = state.cid;
    const uid = state.uid;
    if (!cid || cid === "default" || !uid) return;
    const base = db.collection("communities").doc(cid);
    try {
      state.unsubAll = base
        .collection("notifications")
        .where("audience", "==", "all")
        .onSnapshot(
          (snap) => {
            state.all = (snap && snap.docs ? snap.docs : []).map(normalizeDoc);
            render();
          },
          () => {}
        );
    } catch {}
    try {
      state.unsubMine = base
        .collection("notifications")
        .where("toUid", "==", uid)
        .onSnapshot(
          (snap) => {
            state.mine = (snap && snap.docs ? snap.docs : []).map(normalizeDoc);
            render();
          },
          () => {}
        );
    } catch {}
    try {
      state.unsubReads = base
        .collection("notificationReads")
        .doc(uid)
        .onSnapshot(
          (doc) => {
            const v = doc && doc.exists ? doc.data() || {} : {};
            const ids = Array.isArray(v.ids) ? v.ids : [];
            state.readIds = new Set(ids.map((x) => String(x || "").trim()).filter(Boolean));
            render();
          },
          () => {}
        );
    } catch {}
  }

  function resolveCommunity() {
    try {
      if (typeof window.__nwResolveCommunityId === "function") {
        const cid = String(window.__nwResolveCommunityId() || "").trim();
        if (cid && cid !== "default") return cid;
      }
    } catch {}
    try {
      const saved = String(localStorage.getItem("csp_active_community_v1") || "").trim();
      if (saved && saved !== "default") return saved;
    } catch {}
    try {
      const p = String(new URLSearchParams(location.search).get("c") || "").trim();
      if (p && p !== "default") return p;
    } catch {}
    return "";
  }

  function ensureStarted(attempt) {
    const n = Number.isFinite(attempt) ? attempt : 0;
    const user = auth.currentUser;
    if (!user) return;
    const uid = String(user.uid || "").trim();
    if (!uid) return;
    const cid = resolveCommunity();
    if (!cid) {
      if (n < 20) setTimeout(() => ensureStarted(n + 1), 500);
      return;
    }
    if (state.started && state.uid === uid && state.cid === cid) return;
    state.uid = uid;
    state.cid = cid;
    state.started = true;
    startListeners();
    render();
  }

  function bindUI() {
    const btn = el("btnNotifyCenter");
    if (btn && !btn.dataset.nwNotifyBound) {
      btn.dataset.nwNotifyBound = "1";
      btn.addEventListener("click", openModal);
    }
    const close = el("btnCloseNotifyCenter");
    if (close && !close.dataset.nwNotifyBound) {
      close.dataset.nwNotifyBound = "1";
      close.addEventListener("click", closeModal);
    }
    const backdrop = el("btnNotifyCenterBackdrop");
    if (backdrop && !backdrop.dataset.nwNotifyBound) {
      backdrop.dataset.nwNotifyBound = "1";
      backdrop.addEventListener("click", closeModal);
    }
    const markAll = el("btnNotifyMarkAllRead");
    if (markAll && !markAll.dataset.nwNotifyBound) {
      markAll.dataset.nwNotifyBound = "1";
      markAll.addEventListener("click", markAllRead);
    }
  }

  window.NWNotifyCenter = {
    handleForeground,
    refresh: () => ensureStarted(0),
    open: openModal,
  };

  function boot() {
    bindUI();
    render();
    try {
      auth.onAuthStateChanged((user) => {
        if (!user) {
          stopListeners();
          state.started = false;
          state.uid = "";
          state.cid = "";
          state.all = [];
          state.mine = [];
          state.live = [];
          state.readIds = new Set();
          render();
          return;
        }
        ensureStarted(0);
      });
    } catch {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
