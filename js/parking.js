(function () {
  "use strict";

  const firebaseConfig = window.FIREBASE_CONFIG;
  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}

  const auth = firebase.auth();
  const db = firebase.firestore();
  try {
    db.settings({
      experimentalAutoDetectLongPolling: true,
      experimentalForceLongPolling: true,
      useFetchStreams: false,
      ignoreUndefinedProperties: true,
    });
  } catch {}

  const FieldValue = firebase.firestore.FieldValue;
  const Timestamp = firebase.firestore.Timestamp;

  function formatDateOnly(v) {
    if (!v) return "";
    const d = typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : new Date(v);
    if (!Number.isFinite(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDateTime(v) {
    if (!v) return "";
    const d = typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : new Date(v);
    if (!Number.isFinite(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const tabsEl = document.getElementById("parkingTabs");
  const headerEl = document.getElementById("parkingHeader");
  const titleEl = document.getElementById("parkingTitle");

  const browseListEl = document.getElementById("browseList");
  const browseContentEl = document.getElementById("browseContent");
  const browseFilterPricingEl = document.getElementById("browseFilterPricing");
  const browseFilterSpotTypeEl = document.getElementById("browseFilterSpotType");
  const mineListEl = document.getElementById("mineList");
  const bookingsListEl = document.getElementById("bookingsList");

  const mineContentEl = document.getElementById("mineContent");
  const myBookingsContentEl = document.getElementById("myBookingsContent");

  const btnNewSpotAndListing = document.getElementById("btnNewSpotAndListing");

  const spotListingModal = document.getElementById("spotListingModal");
  const spotLabelEl = document.getElementById("spotLabel");
  const spotTypeEl = document.getElementById("spotType");
  const spotNoteEl = document.getElementById("spotNote");
  const spotListingStatusEl = document.getElementById("spotListingStatus");
  const btnSaveSpotListing = document.getElementById("btnSaveSpotListing");

  const listingSpotEl = document.getElementById("listingSpot");
  const listingPricingModeEl = document.getElementById("listingPricingMode");
  const listingPriceRowEl = document.getElementById("listingPriceRow");
  const listingPriceEl = document.getElementById("listingPrice");
  const listingScheduleTypeEl = document.getElementById("listingScheduleType");
  const listingFixedRangeEl = document.getElementById("listingFixedRange");
  const listingRecurringBlockEl = document.getElementById("listingRecurringBlock");
  const listingStartAtEl = document.getElementById("listingStartAt");
  const listingEndAtEl = document.getElementById("listingEndAt");
  const listingWeekdaysEl = document.getElementById("listingWeekdays");
  const listingWeekdayStartTimeEl = document.getElementById("listingWeekdayStartTime");
  const listingWeekdayEndTimeEl = document.getElementById("listingWeekdayEndTime");
  const listingRangeStartEl = document.getElementById("listingRangeStart");
  const listingRangeEndEl = document.getElementById("listingRangeEnd");
  const listingNoteEl = document.getElementById("listingNote");

  const bookingModal = document.getElementById("bookingModal");
  const bookingModalTitleEl = document.getElementById("bookingModalTitle");
  const bookingUseTypeEl = document.getElementById("bookingUseType");
  const bookingVisitorNameEl = document.getElementById("bookingVisitorName");
  const bookingPlateEl = document.getElementById("bookingPlate");
  const bookingStartAtEl = document.getElementById("bookingStartAt");
  const bookingEndAtEl = document.getElementById("bookingEndAt");
  const bookingFeeHintEl = document.getElementById("bookingFeeHint");
  const bookingStatusEl = document.getElementById("bookingStatus");
  const btnSubmitBooking = document.getElementById("btnSubmitBooking");

  const deleteSpotConfirmModal = document.getElementById("deleteSpotConfirmModal");
  const deleteSpotSpotNameEl = document.getElementById("deleteSpotSpotName");
  const deleteSpotStatusEl = document.getElementById("deleteSpotStatus");
  const btnConfirmDeleteSpot = document.getElementById("btnConfirmDeleteSpot");
  const spotListingModalTitleEl = document.getElementById("spotListingModalTitle");
  let pendingDeleteSpotId = "";
  let editingSpotId = "";
  let editingListingId = "";

  async function executeDeleteSpot(spotId) {
    const id = String(spotId || "").trim();
    if (!id) return;
    setStatus(deleteSpotStatusEl, "刪除中...", false);
    if (btnConfirmDeleteSpot) btnConfirmDeleteSpot.disabled = true;
    try {
      const batch = db.batch();
      const spotRef = db.collection("communities").doc(state.currentCommunityId).collection(COL_SPOTS).doc(id);
      batch.delete(spotRef);
      const relatedSnap = await db
        .collection("communities")
        .doc(state.currentCommunityId)
        .collection(COL_LISTINGS)
        .where("spotId", "==", id)
        .get();
      (relatedSnap && relatedSnap.docs ? relatedSnap.docs : []).forEach((d) => {
        const cur = d.data() || {};
        if (String(cur.status || "active") !== "ended") {
          batch.set(d.ref, { status: "ended", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      });
      await batch.commit();
      setStatus(deleteSpotStatusEl, "", false);
      closeModal(deleteSpotConfirmModal);
      await refresh();
      switchTab("mine");
    } catch (e) {
      setStatus(deleteSpotStatusEl, formatFirebaseError(e), true);
    } finally {
      if (btnConfirmDeleteSpot) btnConfirmDeleteSpot.disabled = false;
    }
  }

  const state = {
    embed: false,
    hideTabs: false,
    currentCommunityId: "default",
    currentCommunityName: "",
    currentUserId: "",
    currentUserEmail: "",
    currentUserProfile: null,
    currentUserName: "",
    currentUserHouseNo: "",
    currentUserRole: "resident",
    manageFilter: "pending",
    spots: [],
    listings: [],
    bookings: [],
    activeBookingListing: null,
  };

  const COL_SPOTS = "parking_spots";
  const COL_LISTINGS = "parking_schedules";
  const COL_BOOKINGS = "parking_bookings";

  function escapeHtml(v) {
    const s = String(v ?? "");
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
  }

  function setStatus(el, message, isError) {
    if (!el) return;
    const t = String(message || "").trim();
    el.textContent = t;
    el.hidden = !t;
    el.classList.toggle("error", Boolean(isError));
  }

  function parseDateTimeLocal(inputEl) {
    const raw = String(inputEl?.value || "").trim();
    if (!raw) return null;
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return null;
    return d;
  }

  function formatDateTime(v) {
    const d = v && typeof v.toDate === "function" ? v.toDate() : v instanceof Date ? v : v ? new Date(v) : null;
    if (!d || !Number.isFinite(d.getTime())) return "";
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function computeFee({ pricingMode, price, startAt, endAt }) {
    const mode = String(pricingMode || "free").trim();
    const amount = Math.max(0, Number(price || 0) || 0);
    if (mode === "free") return 0;
    const s = startAt instanceof Date ? startAt : startAt && typeof startAt.toDate === "function" ? startAt.toDate() : null;
    const e = endAt instanceof Date ? endAt : endAt && typeof endAt.toDate === "function" ? endAt.toDate() : null;
    if (!s || !e) return 0;
    const ms = Math.max(0, e.getTime() - s.getTime());
    if (mode === "hourly") {
      const hours = Math.ceil(ms / 36e5);
      return hours * amount;
    }
    if (mode === "monthly") {
      const months = Math.max(1, Math.ceil(ms / (30 * 24 * 36e5)));
      return months * amount;
    }
    return 0;
  }

  function dateKey(d) {
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function hmKey(d) {
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function validateBookingRange(listing, startAt, endAt) {
    if (!listing || !(startAt instanceof Date) || !(endAt instanceof Date)) {
      return { ok: false, message: "預約時間有誤" };
    }
    if (endAt.getTime() <= startAt.getTime()) return { ok: false, message: "結束時間必須晚於開始時間" };

    const type = String(listing.scheduleType || (listing.startAt || listing.endAt ? "fixed" : "fixed")).trim() || "fixed";

    if (type === "fixed") {
      const lStart = listing.startAt && typeof listing.startAt.toDate === "function" ? listing.startAt.toDate() : listing.startAt ? new Date(listing.startAt) : null;
      const lEnd = listing.endAt && typeof listing.endAt.toDate === "function" ? listing.endAt.toDate() : listing.endAt ? new Date(listing.endAt) : null;
      if (lStart && startAt.getTime() < lStart.getTime()) return { ok: false, message: "預約開始時間不可早於開放開始時間" };
      if (lEnd && endAt.getTime() > lEnd.getTime()) return { ok: false, message: "預約結束時間不可晚於開放結束時間" };
      return { ok: true };
    }

    const weekdaysRaw = Array.isArray(listing.weekdays) ? listing.weekdays.map((x) => String(x)) : [];
    if (!weekdaysRaw.length) return { ok: false, message: "此上架尚未設定開放週別" };
    const weekdaySet = new Set(weekdaysRaw);

    const dailyStart = String(listing.weekdayStartTime || listing.dailyStartTime || "").trim();
    const dailyEnd = String(listing.weekdayEndTime || listing.dailyEndTime || "").trim();
    if (!dailyStart || !dailyEnd) return { ok: false, message: "此上架尚未設定每日開放時段" };

    const rangeStart = String(listing.rangeStart || "").trim();
    const rangeEnd = String(listing.rangeEnd || "").trim();
    if (rangeStart && dateKey(startAt) < rangeStart) return { ok: false, message: `預約日期不可早於 ${rangeStart}` };
    if (rangeEnd && dateKey(endAt) > rangeEnd) return { ok: false, message: `預約日期不可晚於 ${rangeEnd}` };

    const overnight = dailyStart >= dailyEnd;
    const daysApart = Math.round((new Date(dateKey(endAt)).getTime() - new Date(dateKey(startAt)).getTime()) / 86400000);
    if (!overnight && daysApart !== 0) return { ok: false, message: "週期時段預約請選擇同一日內的時間" };
    if (overnight && daysApart > 1) return { ok: false, message: "跨夜時段預約不可超過兩天" };

    const startWk = String(startAt.getDay());
    const endWk = String(endAt.getDay());
    const startOk = weekdaySet.has(startWk);
    const endOk = weekdaySet.has(endWk);

    if (!overnight) {
      if (!startOk) return { ok: false, message: "開始日期不在設定的開放週別內" };
      const sh = hmKey(startAt);
      const eh = hmKey(endAt);
      if (sh < dailyStart || sh > dailyEnd) return { ok: false, message: `開始時間需在每日 ${dailyStart} ~ ${dailyEnd} 之間` };
      if (eh < dailyStart || eh > dailyEnd) return { ok: false, message: `結束時間需在每日 ${dailyStart} ~ ${dailyEnd} 之間` };
      return { ok: true };
    }

    if (daysApart === 0) {
      if (!startOk) return { ok: false, message: "開始日期不在設定的開放週別內" };
      const sh = hmKey(startAt);
      const eh = hmKey(endAt);
      const sameDayValid = (sh >= dailyStart && eh >= sh) || (sh >= dailyStart) || (eh <= dailyEnd && eh <= dailyStart === false);
      if (!(sh >= dailyStart || sh <= dailyEnd)) return { ok: false, message: `開始時間需在 ${dailyStart} ~ 次日 ${dailyEnd}` };
      if (!(eh >= dailyStart || eh <= dailyEnd)) return { ok: false, message: `結束時間需在 ${dailyStart} ~ 次日 ${dailyEnd}` };
      if (sh < dailyStart && sh > dailyEnd) return { ok: false, message: `開始時間需在 ${dailyStart} ~ 次日 ${dailyEnd}` };
      if (eh < dailyStart && eh > dailyEnd) return { ok: false, message: `結束時間需在 ${dailyStart} ~ 次日 ${dailyEnd}` };
      void sameDayValid;
      return { ok: true };
    }

    if (!startOk) return { ok: false, message: "開始日期不在設定的開放週別內" };
    if (!endOk) return { ok: false, message: "結束日期不在設定的開放週別內" };
    const sh = hmKey(startAt);
    const eh = hmKey(endAt);
    if (sh < dailyStart) return { ok: false, message: `跨夜預約的開始時間需 >= ${dailyStart}` };
    if (eh > dailyEnd) return { ok: false, message: `跨夜預約的結束時間需 <= 次日 ${dailyEnd}` };
    return { ok: true };
  }

  function pricingText(listing) {
    const mode = String(listing?.pricingMode || "free").trim();
    const price = Math.max(0, Number(listing?.price || 0) || 0);
    if (mode === "free") return "免費";
    if (mode === "hourly") return `計時 ${price} 元/小時`;
    if (mode === "monthly") return `計月 ${price} 元/月`;
    return "—";
  }

  function spotTypeText(type) {
    const k = String(type || "").trim() || "general";
    if (k === "ev") return "電動車位";
    if (k === "motorcycle") return "重機車位";
    if (k === "handicap") return "愛心車位";
    if (k === "eco") return "節能車";
    return "一般車位";
  }

  function formatDateOnly(v) {
    const s = String(v || "").trim();
    if (!s) return "";
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(v);
    if (!d || !Number.isFinite(d.getTime())) return s;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function weekdayLabels(values) {
    const names = { "0": "日", "1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六" };
    const order = ["1", "2", "3", "4", "5", "6", "0"];
    const set = new Set((values || []).map((x) => String(x)));
    return order.filter((k) => set.has(k)).map((k) => names[k] || k);
  }

  function scheduleText(listing) {
    const type = String(listing?.scheduleType || (listing?.startAt || listing?.endAt ? "fixed" : "fixed")).trim() || "fixed";
    if (type === "recurring") {
      const weekdays = Array.isArray(listing?.weekdays) ? listing.weekdays.slice() : [];
      const wd = weekdayLabels(weekdays);
      const rangeStart = formatDateOnly(listing?.rangeStart);
      const rangeEnd = formatDateOnly(listing?.rangeEnd);
      const range = (rangeStart || rangeEnd) ? `${rangeStart || "—"} ~ ${rangeEnd || "—"}` : "";
      const tmStart = String(listing?.weekdayStartTime || listing?.dailyStartTime || "").trim();
      const tmEnd = String(listing?.weekdayEndTime || listing?.dailyEndTime || "").trim();
      const tm = (tmStart || tmEnd) ? `${tmStart || "—"} ~ ${tmEnd || "—"}` : "";
      const dayText = wd.length ? `每週${wd.join("、")}` : "";
      const parts = [dayText, tm, range].filter(Boolean);
      return parts.join(" · ");
    }
    const s = formatDateTime(listing?.startAt);
    const e = formatDateTime(listing?.endAt);
    if (!s && !e) return "";
    return `${s || "—"} ~ ${e || "—"}`;
  }

  async function resolveCommunityId(keyOverride) {
    const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";
    const keyFromUrl = (() => {
      try {
        const urlParams = new URLSearchParams(location.search);
        return String(urlParams.get("c") || "").trim();
      } catch {
        return "";
      }
    })();
    const saved = (() => {
      try {
        return String(localStorage.getItem(STORAGE_ACTIVE_COMMUNITY) || "").trim();
      } catch {
        return "";
      }
    })();
    const key = String(keyOverride || "").trim() || keyFromUrl || saved;
    if (!key) return "default";
    if (saved && saved === key) return saved;
    try {
      const byIdSnap = await db.collection("communities").where("id", "==", key).limit(1).get();
      const byId = byIdSnap && byIdSnap.docs && byIdSnap.docs[0] ? byIdSnap.docs[0] : null;
      if (byId && byId.exists) {
        const v = byId.data() || {};
        const cid = String(v.id || byId.id || "").trim() || "default";
        try {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid);
        } catch {}
        return cid;
      }
    } catch {}
    try {
      const byUserSnap = await db.collection("communities").where("username", "==", key).limit(1).get();
      const byUser = byUserSnap && byUserSnap.docs && byUserSnap.docs[0] ? byUserSnap.docs[0] : null;
      if (byUser && byUser.exists) {
        const v = byUser.data() || {};
        const cid = String(v.id || byUser.id || "").trim() || "default";
        try {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid);
        } catch {}
        return cid;
      }
    } catch {}

    try {
      const byDoc = await db.collection("communities").doc(key).get();
      if (byDoc && byDoc.exists) {
        const v = byDoc.data() || {};
        const cid = String(v.id || byDoc.id || "").trim() || "default";
        try {
          localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid);
        } catch {}
        return cid;
      }
    } catch {}
    return key;
  }

  function formatFirebaseError(err) {
    const e = err && typeof err === "object" ? err : {};
    const code = String(e.code || "").trim();
    const msg = String(e.message || "").trim();
    if (code && msg) return `${code}｜${msg}`;
    return msg || code || "操作失敗";
  }

  async function loadCommunityName(cid) {
    const communityId = String(cid || "").trim() || "default";
    if (!communityId || communityId === "default") return "";
    try {
      const doc = await db.collection("communities").doc(communityId).get();
      const data = doc && doc.exists ? doc.data() || {} : {};
      return String(data.name || "").trim();
    } catch {
      return "";
    }
  }

  async function loadUserProfile(user) {
    if (!user) return null;
    let data = {};
    try {
      const doc = await db.collection("users").doc(String(user.uid)).get();
      if (doc && doc.exists) data = doc.data() || {};
    } catch {}
    if (!data || !Object.keys(data).length) {
      try {
        const email = String(user.email || "").trim();
        if (email) {
          const snap = await db.collection("users").where("email", "==", email).limit(1).get();
          if (snap && snap.size > 0) data = snap.docs[0].data() || {};
        }
      } catch {}
    }
    return data && typeof data === "object" ? data : {};
  }

  function normalizeRole(roleValue) {
    const role = String(roleValue || "").trim().toLowerCase();
    if (!role) return "resident";
    if (role === "community" || role === "社區") return "community";
    if (role === "admin" || role === "系統管理員" || role === "系統管理者" || role === "系統") return "admin";
    if (role === "resident" || role === "住戶") return "resident";
    return role;
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.hidden = true;
  }

  function openModal(modalEl) {
    if (!modalEl) return;
    modalEl.hidden = false;
  }

  function bindModalClose() {
    document.querySelectorAll("[data-modal-close]").forEach((el) => {
      el.addEventListener("click", () => {
        const modal = el.closest(".modal");
        closeModal(modal);
      });
    });
  }

  function switchTab(tabId) {
    const tab = String(tabId || "browse").trim() || "browse";
    tabsEl?.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", String(b.dataset.tab || "") === tab));
    browseListEl?.classList.toggle("hidden", tab !== "browse");
    mineListEl?.classList.toggle("hidden", tab !== "mine");
    bookingsListEl?.classList.toggle("hidden", tab !== "bookings");
    if (tab === "browse") renderBrowse();
    if (tab === "mine") renderMine();
    if (tab === "bookings") renderMyBookings();
  }

  function ensureEmbedLayout() {
    const params = new URLSearchParams(location.search || "");
    state.embed = String(params.get("embed") || "").trim() === "1";
    state.hideTabs = state.embed && String(params.get("nav") || "").trim() === "0";
    if (state.hideTabs && tabsEl) tabsEl.style.display = "none";
    if (!state.embed) return;

    const layoutEl = document.querySelector(".parcel-layout");
    const midtopEl = document.querySelector(".parcel-midtop");

    if (state.hideTabs && midtopEl) midtopEl.style.display = "none";
    if (layoutEl) {
      if (state.hideTabs) {
        layoutEl.style.gridTemplateRows = "minmax(56px, 8vh) minmax(0, 68vh) minmax(56px, 16vh)";
      } else {
        layoutEl.style.gridTemplateRows = "minmax(56px, 8vh) minmax(56px, 8vh) minmax(0, 60vh) minmax(56px, 16vh)";
      }
    }
  }

  function bindHostMessaging() {
    window.addEventListener("message", (ev) => {
      const data = ev && ev.data ? ev.data : null;
      if (!data || typeof data !== "object") return;
      const origin = String(ev.origin || "").trim();
      if (origin && origin !== String(location.origin || "")) return;
      if (data.type === "PARKING_NAV") {
        const tab = String(data.tab || "").trim();
        if (!tab) return;
        switchTab(tab);
      }
    });
  }

  async function loadAllData() {
    const cid = state.currentCommunityId;
    const uid = state.currentUserId;

    const spotsSnap = await db.collection("communities").doc(cid).collection(COL_SPOTS).where("ownerUid", "==", uid).get();
    state.spots = (spotsSnap && spotsSnap.docs ? spotsSnap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));

    const listingsSnap = await db.collection("communities").doc(cid).collection(COL_LISTINGS).get();
    state.listings = (listingsSnap && listingsSnap.docs ? listingsSnap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));

    const myBookingsSnap = await db.collection("communities").doc(cid).collection(COL_BOOKINGS).where("requesterUid", "==", uid).get();
    state.bookings = (myBookingsSnap && myBookingsSnap.docs ? myBookingsSnap.docs : []).map((d) => ({ id: d.id, ...(d.data() || {}) }));
  }

  function fillSpotSelect() {
    if (!listingSpotEl) return;
    listingSpotEl.innerHTML = state.spots
      .map((s) => `<option value="${escapeHtml(String(s.id || ""))}">${escapeHtml(String(s.label || s.id || ""))}</option>`)
      .join("");
  }

  function renderBrowse() {
    if (!browseContentEl) return;
    const now = new Date();
    const spotsById = new Map(state.spots.filter((s) => s.enabled !== false).map((s) => [String(s.id || ""), s]));
    const validSpotIds = new Set(spotsById.keys());
    const fp = String(browseFilterPricingEl?.value || "all").trim();
    const fs = String(browseFilterSpotTypeEl?.value || "all").trim();
    const list = state.listings
      .filter((x) => String(x.status || "active") === "active")
      .filter((x) => validSpotIds.has(String(x.spotId || "")))
      .filter((x) => {
        const type = String(x.scheduleType || (x.startAt || x.endAt ? "fixed" : "fixed")).trim() || "fixed";
        if (type === "recurring") {
          const rangeEnd = x.rangeEnd ? new Date(`${String(x.rangeEnd)}T23:59:59`) : null;
          return !rangeEnd || rangeEnd.getTime() >= now.getTime();
        }
        const endAt = x.endAt && typeof x.endAt.toDate === "function" ? x.endAt.toDate() : x.endAt ? new Date(x.endAt) : null;
        return !endAt || endAt.getTime() >= now.getTime();
      })
      .filter((x) => {
        if (fp === "all") return true;
        return String(x.pricingMode || "free").trim() === fp;
      })
      .filter((x) => {
        if (fs === "all") return true;
        const spot = spotsById.get(String(x.spotId || ""));
        const spotType = String(spot?.type || "").trim();
        return spotType === fs;
      })
      .sort((a, b) => {
        const at = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
        return bt - at;
      });

    if (!list.length) {
      browseContentEl.innerHTML = `<div class="status">目前沒有可預約的車位</div>`;
      return;
    }

    browseContentEl.innerHTML = list
      .map((l, idx) => {
        const label = String(l.spotLabel || l.spotId || "車位").trim();
        const range = scheduleText(l);
        const ownerHouse = String(l.ownerHouseNo || "").trim();
        const spot = spotsById.get(String(l.spotId || ""));
        const typeLabel = spot ? spotTypeText(spot.type) : "";
        const blockSep = idx > 0 ? "margin-top:10px;" : "";
        return `
          <div class="parcel-item" style="${blockSep}">
            <div class="parcel-info">
              <div class="parcel-no">${escapeHtml(label)}</div>
              <div class="listing-block" style="margin-top:4px; border-radius:6px; padding:10px 12px; background:rgba(245,247,250,0.55);">
                <div class="parcel-desc" style="margin:0;">${escapeHtml([pricingText(l), range].filter(Boolean).join(" · "))}</div>
                <div class="parcel-type" style="margin-top:6px; margin-bottom:0;">${escapeHtml([typeLabel || "", ownerHouse ? `提供者：${ownerHouse}` : "提供者：—"].filter(Boolean).join(" · "))}</div>
              </div>
            </div>
            <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center;">
              <button class="icon-btn icon-btn--primary" type="button" title="預約" aria-label="預約車位" data-book="${escapeHtml(String(l.id || ""))}">
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    browseContentEl.querySelectorAll("[data-book]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.getAttribute("data-book") || "").trim();
        const listing = state.listings.find((x) => String(x.id || "") === id) || null;
        if (!listing) return;
        state.activeBookingListing = listing;
        openBookingModal(listing);
      });
    });
  }

  function renderMine() {
    if (!mineContentEl) return;
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    const toDate = (v) => {
      if (!v) return null;
      if (typeof v.toDate === "function") return v.toDate();
      const d = v instanceof Date ? v : new Date(v);
      return Number.isFinite(d.getTime()) ? d : null;
    };
    const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const parseHM = (hm) => {
      const s = String(hm || "").trim();
      const m = /^(\d{1,2}):(\d{2})$/.exec(s);
      if (!m) return null;
      return { h: Number(m[1]), m: Number(m[2]) };
    };
    const isOutsideOpenRange = (listing) => {
      const type = String(listing?.scheduleType || (listing?.startAt || listing?.endAt ? "fixed" : "fixed")).trim() || "fixed";
      if (type === "recurring") {
        const weekdays = Array.isArray(listing?.weekdays) ? listing.weekdays.map((x) => String(x)) : [];
        if (weekdays.length) {
          const today = String(now.getDay());
          if (!weekdays.includes(today)) return true;
        }
        const rangeStart = String(listing?.rangeStart || "").trim();
        const rangeEnd = String(listing?.rangeEnd || "").trim();
        const todayYMD = toYMD(now);
        if (rangeStart && todayYMD < rangeStart) return true;
        if (rangeEnd && todayYMD > rangeEnd) return true;
        const tms = parseHM(listing?.weekdayStartTime || listing?.dailyStartTime);
        const tme = parseHM(listing?.weekdayEndTime || listing?.dailyEndTime);
        if (tms && tme) {
          const mins = tms.h * 60 + tms.m;
          const mine = tme.h * 60 + tme.m;
          const nowMins = now.getHours() * 60 + now.getMinutes();
          if (mins <= mine) {
            if (nowMins < mins || nowMins > mine) return true;
          } else {
            if (nowMins < mins && nowMins > mine) return true;
          }
        }
        return false;
      }
      const s = toDate(listing?.startAt);
      const e = toDate(listing?.endAt);
      const nowMs = now.getTime();
      if (s && nowMs < s.getTime()) return true;
      if (e && nowMs > e.getTime()) return true;
      return false;
    };

    const spots = state.spots.slice().sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
    const validSpotIds = new Set(spots.map((s) => String(s.id || "")));
    const listingsBySpot = {};
    state.listings
      .filter((l) => String(l.ownerUid || "") === state.currentUserId && validSpotIds.has(String(l.spotId || "")))
      .sort((a, b) => {
        const at = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
        return bt - at;
      })
      .forEach((l) => {
        const key = String(l.spotId || "");
        if (!listingsBySpot[key]) listingsBySpot[key] = [];
        listingsBySpot[key].push(l);
      });

    const section = `
      <div style="display:grid; gap:10px;">
        ${spots.length
          ? spots
              .map((s) => {
                const spotId = String(s.id || "");
                const label = String(s.label || s.id || "").trim();
                const type = String(s.type || "").trim();
                const note = String(s.note || "").trim();
                const listings = listingsBySpot[spotId] || [];
                const listingRows = listings
                  .map((l) => {
                    const range = scheduleText(l);
                    const status = String(l.status || "active").trim();
                    const isEnded = status === "ended";
                    const isActive = status === "active";
                    const outside = !isEnded && isOutsideOpenRange(l);
                    const listingNote = String(l.note || "").trim();
                    const line = [pricingText(l), range, listingNote].filter(Boolean).join(" · ");
                    const checked = (isActive && !outside) ? "checked" : "";
                    const disabled = (isEnded || outside) ? "disabled" : "";
                    return {
                      desc: line,
                      listingId: String(l.id || ""),
                      checked,
                      disabled,
                    };
                  });
                const descHtml = [
                  `<div class="parcel-desc">${escapeHtml([spotTypeText(type) || "—", note].filter(Boolean).join(" · "))}</div>`,
                  ...listingRows.map((r, idx) => {
                    const sepStyle = idx > 0 ? "border-top:1px dashed rgba(0,0,0,0.08); margin-top:10px; padding-top:10px;" : "margin-top:4px;";
                    return `
                      <div class="listing-block" style="${sepStyle} border-radius:6px; padding:10px 12px; background:rgba(245,247,250,0.55);">
                        <div class="parcel-desc" style="display:flex; align-items:center; gap:10px; margin:0;">
                          <label class="switch" style="flex:0 0 auto;">
                            <input type="checkbox" data-listing-switch="${escapeHtml(r.listingId)}" ${r.checked} ${r.disabled}/>
                            <span class="slider"></span>
                          </label>
                          <span style="flex:1 1 auto; min-width:0;">${escapeHtml(r.desc)}</span>
                        </div>
                      </div>
                    `;
                  }),
                ].join("");
                return `
                  <div class="parcel-item">
                    <div class="parcel-info">
                      <div class="parcel-no">${escapeHtml(label || "—")}</div>
                      ${descHtml}
                    </div>
                    <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center;">
                      <button class="icon-btn icon-btn--edit" type="button" title="編輯" aria-label="編輯車位" data-spot-edit="${escapeHtml(spotId)}">
                        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                      <button class="icon-btn icon-btn--danger" type="button" title="刪除" aria-label="刪除車位" data-spot-delete="${escapeHtml(spotId)}">
                        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                `;
              })
              .join("")
          : `<div class="status">尚未新增車位</div>`}
      </div>
    `;

    mineContentEl.innerHTML = section;

    mineContentEl.querySelectorAll("[data-spot-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.getAttribute("data-spot-edit") || "").trim();
        if (!id) return;
        openEditSpotModal(id);
      });
    });

    mineContentEl.querySelectorAll("[data-spot-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = String(btn.getAttribute("data-spot-delete") || "").trim();
        if (!id) return;
        const spot = state.spots.find((s) => String(s.id || "") === id) || null;
        const label = spot ? String(spot.label || spot.id || "").trim() || id : id;
        pendingDeleteSpotId = id;
        if (deleteSpotSpotNameEl) deleteSpotSpotNameEl.textContent = `車位：${label}`;
        setStatus(deleteSpotStatusEl, "", false);
        openModal(deleteSpotConfirmModal);
      });
    });

    mineContentEl.querySelectorAll("[data-listing-switch]").forEach((sw) => {
      sw.addEventListener("change", async () => {
        const id = String(sw.getAttribute("data-listing-switch") || "").trim();
        const listing = state.listings.find((x) => String(x.id || "") === id) || null;
        if (!listing) return;
        const nextStatus = sw.checked ? "active" : "paused";
        try {
          await db
            .collection("communities")
            .doc(state.currentCommunityId)
            .collection(COL_LISTINGS)
            .doc(id)
            .set({ status: nextStatus, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          await refresh();
          switchTab("mine");
        } catch (e) {
          alert(formatFirebaseError(e));
          sw.checked = String(listing.status || "active") === "active";
        }
      });
    });
  }

  function renderMyBookings() {
    if (!myBookingsContentEl) return;
    const list = state.bookings
      .slice()
      .sort((a, b) => {
        const at = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
        return bt - at;
      });
    if (!list.length) {
      myBookingsContentEl.innerHTML = `<div class="status">尚無預約</div>`;
      return;
    }
    const now = new Date();
    myBookingsContentEl.innerHTML = list
      .map((b, idx) => {
        const label = String(b.spotLabel || b.spotId || "車位").trim();
        const range = `${formatDateTime(b.startAt)} ~ ${formatDateTime(b.endAt)}`.trim();
        const status = String(b.status || "pending").trim();
        const statusText = status === "approved" ? "已核准" : status === "rejected" ? "已拒絕" : status === "cancelled" ? "已取消" : status === "completed" ? "已完成" : "待審核";
        const fee = Math.max(0, Number(b.fee || 0) || 0);
        const feeText = fee ? ` · ${fee} 元` : "";
        const paidText = isPaidBooking(b) ? " · 已付款" : "";
        const disableReason = getBookingDisableReason(b, now);
        const disabled = disableReason ? "disabled" : "";
        const btnTitle = disableReason ? `無法取消預約：${escapeHtml(disableReason)}` : `取消預約（${escapeHtml(statusText)}）`;
        const blockSep = idx > 0 ? "margin-top:10px;" : "";
        return `
          <div class="parcel-item" style="${blockSep}">
            <div class="parcel-info">
              <div class="parcel-no">${escapeHtml(label)}</div>
              <div class="listing-block" style="margin-top:4px; border-radius:6px; padding:10px 12px; background:rgba(245,247,250,0.55);">
                <div class="parcel-desc" style="margin:0;">${escapeHtml(range)}${paidText}${feeText}</div>
                <div class="parcel-type" style="margin-top:6px; margin-bottom:0;">${escapeHtml(String(b.plate || "").trim()) || "（未填車牌）"} · ${escapeHtml(statusText)}</div>
              </div>
            </div>
            <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center;">
              <button class="icon-btn icon-btn--danger" type="button" title="${btnTitle}" aria-label="${escapeHtml(disableReason ? `無法取消預約：${disableReason}` : "取消預約")}" data-booking-cancel="${escapeHtml(String(b.id || ""))}" ${disabled}>
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    myBookingsContentEl.querySelectorAll("[data-booking-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = String(btn.getAttribute("data-booking-cancel") || "").trim();
        if (!id) return;
        const b = state.bookings.find((x) => String(x.id || "") === id) || null;
        if (!b) {
          alert("找不到對應預約");
          return;
        }
        const reason = getBookingDisableReason(b);
        if (reason) {
          alert(`無法取消預約：${reason}`);
          return;
        }
        const ok = confirm("確定取消此預約？");
        if (!ok) return;
        try {
          await db
            .collection("communities")
            .doc(state.currentCommunityId)
            .collection(COL_BOOKINGS)
            .doc(id)
            .set({ status: "cancelled", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          await refresh();
          switchTab("bookings");
        } catch (e) {
          alert(formatFirebaseError(e));
        }
      });
    });
  }

  function isPaidBooking(b) {
    if (!b) return false;
    const paid = b.paid;
    if (typeof paid === "boolean") return paid;
    if (paid === 1 || paid === 0) return paid === 1;
    const ps = String(b.paymentStatus || "").trim();
    if (["paid", "done", "已付款", "已支付", "已結帳"].includes(ps)) return true;
    const tx = String(b.transactionId || b.payId || b.paymentId || "").trim();
    if (tx) return true;
    const paidAt = b.paidAt || b.paymentAt;
    if (paidAt) {
      try {
        if (typeof paidAt.toDate === "function") return true;
        if (typeof paidAt === "number" && paidAt > 0) return true;
        if (paidAt && typeof paidAt === "object" && typeof paidAt.seconds === "number" && paidAt.seconds > 0) return true;
        if (typeof paidAt === "string" && paidAt.trim().length) return true;
      } catch (_) {}
    }
    return false;
  }

  function getBookingDisableReason(b, now) {
    if (!b) return "預約不存在";
    const status = String(b.status || "pending").trim();
    if (status === "cancelled") return "此預約已取消";
    if (status === "rejected") return "此預約已被拒絕";
    if (status === "completed") return "此預約已完成";
    if (isPaidBooking(b)) return "已付款預約無法取消";
    const startAt = b.startAt && typeof b.startAt.toDate === "function" ? b.startAt.toDate() : b.startAt ? new Date(b.startAt) : null;
    const endAt = b.endAt && typeof b.endAt.toDate === "function" ? b.endAt.toDate() : b.endAt ? new Date(b.endAt) : null;
    const n = now instanceof Date ? now : new Date();
    const t = n.getTime();
    if (startAt && endAt) {
      if (t > endAt.getTime()) return "預約時間已結束，無法取消";
      if (t >= startAt.getTime() && t <= endAt.getTime()) return "預約進行中，無法取消";
    } else if (endAt) {
      if (t > endAt.getTime()) return "預約時間已結束，無法取消";
    }
    return "";
  }

  function nowIsoLocal() {
    const d = new Date();
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function addHours(date, hours) {
    const d = new Date(date.getTime());
    d.setHours(d.getHours() + hours);
    return d;
  }

  function nowIsoLocalFromDate(d) {
    const pad2 = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function syncListingPriceVisibility() {
    const mode = String(listingPricingModeEl?.value || "free").trim();
    const show = mode !== "free";
    if (listingPriceRowEl) listingPriceRowEl.style.display = show ? "block" : "none";
    if (!show && listingPriceEl) listingPriceEl.value = "0";
  }

  function syncScheduleTypeVisibility() {
    const type = String(listingScheduleTypeEl?.value || "fixed").trim() || "fixed";
    const isFixed = type === "fixed";
    if (listingFixedRangeEl) listingFixedRangeEl.hidden = !isFixed;
    if (listingRecurringBlockEl) listingRecurringBlockEl.hidden = isFixed;
  }

  function readSelectedWeekdays() {
    if (!listingWeekdaysEl) return [];
    const checks = listingWeekdaysEl.querySelectorAll('input[type="checkbox"]');
    const result = [];
    checks.forEach((c) => {
      if (c && c.checked) {
        const v = String(c.value || "").trim();
        if (v) result.push(v);
      }
    });
    return result;
  }

  function openSpotListingModal() {
    editingSpotId = "";
    editingListingId = "";
    if (spotListingModalTitleEl) spotListingModalTitleEl.textContent = "新增車位並上架";
    if (btnSaveSpotListing) btnSaveSpotListing.textContent = "儲存並上架";
    if (spotLabelEl) spotLabelEl.value = "";
    if (spotNoteEl) spotNoteEl.value = "";
    if (spotTypeEl) spotTypeEl.value = "general";
    if (listingPricingModeEl) listingPricingModeEl.value = "free";
    if (listingPriceEl) listingPriceEl.value = "0";
    if (listingScheduleTypeEl) listingScheduleTypeEl.value = "fixed";
    const startIso = nowIsoLocal();
    const endIso = (() => {
      const s = new Date(startIso);
      return nowIsoLocalFromDate(addHours(s, 2));
    })();
    if (listingStartAtEl) listingStartAtEl.value = startIso;
    if (listingEndAtEl) listingEndAtEl.value = endIso;
    if (listingWeekdayStartTimeEl) listingWeekdayStartTimeEl.value = "09:00";
    if (listingWeekdayEndTimeEl) listingWeekdayEndTimeEl.value = "18:00";
    if (listingRangeStartEl) listingRangeStartEl.value = "";
    if (listingRangeEndEl) listingRangeEndEl.value = "";
    if (listingWeekdaysEl) {
      listingWeekdaysEl.querySelectorAll('input[type="checkbox"]').forEach((c) => {
        if (c) c.checked = false;
      });
    }
    if (listingNoteEl) listingNoteEl.value = "";
    syncListingPriceVisibility();
    syncScheduleTypeVisibility();
    setStatus(spotListingStatusEl, "", false);
    openModal(spotListingModal);
  }

  function openEditSpotModal(spotId) {
    const sid = String(spotId || "").trim();
    if (!sid) return;
    const spot = state.spots.find((s) => String(s.id || "") === sid) || null;
    if (!spot) return;
    const listing = (state.listings
      .filter((l) => String(l.spotId || "") === sid && String(l.ownerUid || "") === state.currentUserId)
      .sort((a, b) => {
        const at = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
        const bt = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
        return bt - at;
      })[0]) || null;

    editingSpotId = sid;
    editingListingId = listing ? String(listing.id || "") : "";
    if (spotListingModalTitleEl) spotListingModalTitleEl.textContent = "編輯車位與上架";
    if (btnSaveSpotListing) btnSaveSpotListing.textContent = "儲存變更";

    if (spotLabelEl) spotLabelEl.value = String(spot.label || "").trim();
    if (spotTypeEl) spotTypeEl.value = ["general", "ev", "motorcycle", "handicap"].includes(String(spot.type || "").trim()) ? String(spot.type || "") : "general";
    if (spotNoteEl) spotNoteEl.value = String(spot.note || "").trim();

    if (listingPricingModeEl) listingPricingModeEl.value = ["free", "hourly", "monthly"].includes(String(listing?.pricingMode || "").trim()) ? String(listing.pricingMode || "free") : "free";
    if (listingPriceEl) listingPriceEl.value = String(Math.max(0, Number(listing?.price || 0) || 0));
    if (listingScheduleTypeEl) listingScheduleTypeEl.value = String(listing?.scheduleType || "fixed").trim() || "fixed";
    if (listingNoteEl) listingNoteEl.value = String(listing?.note || "").trim();

    const sStart = listing?.startAt && typeof listing.startAt.toDate === "function" ? listing.startAt.toDate() : null;
    const sEnd = listing?.endAt && typeof listing.endAt.toDate === "function" ? listing.endAt.toDate() : null;
    if (listingStartAtEl) listingStartAtEl.value = sStart ? nowIsoLocalFromDate(sStart) : nowIsoLocal();
    if (listingEndAtEl) listingEndAtEl.value = sEnd ? nowIsoLocalFromDate(sEnd) : nowIsoLocalFromDate(addHours(new Date(), 2));
    if (listingWeekdayStartTimeEl) listingWeekdayStartTimeEl.value = String(listing?.weekdayStartTime || listing?.dailyStartTime || "09:00").trim() || "09:00";
    if (listingWeekdayEndTimeEl) listingWeekdayEndTimeEl.value = String(listing?.weekdayEndTime || listing?.dailyEndTime || "18:00").trim() || "18:00";
    if (listingRangeStartEl) listingRangeStartEl.value = String(listing?.rangeStart || "").trim();
    if (listingRangeEndEl) listingRangeEndEl.value = String(listing?.rangeEnd || "").trim();
    if (listingWeekdaysEl) {
      const set = new Set(Array.isArray(listing?.weekdays) ? listing.weekdays.map((x) => String(x)) : []);
      listingWeekdaysEl.querySelectorAll('input[type="checkbox"]').forEach((c) => {
        const v = String(c.value || "").trim();
        c.checked = set.has(v);
      });
    }
    syncListingPriceVisibility();
    syncScheduleTypeVisibility();
    setStatus(spotListingStatusEl, "", false);
    openModal(spotListingModal);
  }

  async function saveSpotAndListing() {
    const label = String(spotLabelEl?.value || "").trim();
    const rawType = String(spotTypeEl?.value || "").trim();
    const type = ["general", "ev", "motorcycle", "handicap"].includes(rawType) ? rawType : "general";
    const spotNote = String(spotNoteEl?.value || "").trim();
    if (!label) {
      setStatus(spotListingStatusEl, "請輸入車位標示", true);
      return;
    }
    const pricingMode = String(listingPricingModeEl?.value || "free").trim();
    const price = Math.max(0, Number(listingPriceEl?.value || 0) || 0);
    const requireApproval = false;
    const scheduleType = String(listingScheduleTypeEl?.value || "fixed").trim() || "fixed";
    const isEditMode = Boolean(editingSpotId);

    const schedulePayload = {};
    if (scheduleType === "fixed") {
      const startAt = parseDateTimeLocal(listingStartAtEl);
      const endAt = parseDateTimeLocal(listingEndAtEl);
      if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
        setStatus(spotListingStatusEl, "請確認固定期間的開始/結束時間", true);
        return;
      }
      schedulePayload.startAt = Timestamp.fromDate(startAt);
      schedulePayload.endAt = Timestamp.fromDate(endAt);
      ["weekdays", "weekdayStartTime", "weekdayEndTime", "rangeStart", "rangeEnd"].forEach((k) => (schedulePayload[k] = FieldValue.delete()));
    } else {
      const weekdays = readSelectedWeekdays();
      if (!weekdays.length) {
        setStatus(spotListingStatusEl, "請至少選擇一個週別", true);
        return;
      }
      const startTime = String(listingWeekdayStartTimeEl?.value || "").trim();
      const endTime = String(listingWeekdayEndTimeEl?.value || "").trim();
      if (!startTime || !endTime || startTime >= endTime) {
        setStatus(spotListingStatusEl, "請確認每日開始/結束時間", true);
        return;
      }
      const rangeStart = String(listingRangeStartEl?.value || "").trim();
      const rangeEnd = String(listingRangeEndEl?.value || "").trim();
      if (rangeStart && rangeEnd && rangeStart > rangeEnd) {
        setStatus(spotListingStatusEl, "整體有效區間有誤", true);
        return;
      }
      schedulePayload.weekdays = weekdays;
      schedulePayload.weekdayStartTime = startTime;
      schedulePayload.weekdayEndTime = endTime;
      schedulePayload.rangeStart = rangeStart || FieldValue.delete();
      schedulePayload.rangeEnd = rangeEnd || FieldValue.delete();
      schedulePayload.startAt = rangeStart ? Timestamp.fromDate(new Date(`${rangeStart}T00:00:00`)) : FieldValue.delete();
      schedulePayload.endAt = rangeEnd ? Timestamp.fromDate(new Date(`${rangeEnd}T23:59:59`)) : FieldValue.delete();
    }

    setStatus(spotListingStatusEl, "儲存中...", false);
    try {
      const batch = db.batch();
      const colCommunity = db.collection("communities").doc(state.currentCommunityId);

      if (!isEditMode) {
        const spotRef = colCommunity.collection(COL_SPOTS).doc();
        const listingRef = colCommunity.collection(COL_LISTINGS).doc();
        const spotPayload = {
          label,
          type,
          note: spotNote,
          ownerUid: state.currentUserId,
          ownerName: state.currentUserName,
          ownerHouseNo: state.currentUserHouseNo,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          enabled: true,
        };
        const listingPayload = {
          uid: state.currentUserId,
          spotId: spotRef.id,
          spotLabel: String(label || spotRef.id || "").trim(),
          ownerUid: state.currentUserId,
          ownerName: state.currentUserName,
          ownerHouseNo: state.currentUserHouseNo,
          pricingMode,
          price,
          currency: "TWD",
          requireApproval,
          note: String(listingNoteEl?.value || "").trim(),
          scheduleType,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          ...schedulePayload,
        };
        batch.set(spotRef, spotPayload, { merge: true });
        batch.set(listingRef, listingPayload, { merge: true });
      } else {
        const spotId = editingSpotId;
        const listingId = String(editingListingId || "").trim();
        const spotRef = colCommunity.collection(COL_SPOTS).doc(spotId);
        batch.set(
          spotRef,
          {
            label,
            type,
            note: spotNote,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        if (listingId) {
          const listingRef = colCommunity.collection(COL_LISTINGS).doc(listingId);
          const listingUpdates = {
            spotLabel: String(label || spotId || "").trim(),
            pricingMode,
            price,
            currency: "TWD",
            requireApproval,
            note: String(listingNoteEl?.value || "").trim(),
            scheduleType,
            updatedAt: FieldValue.serverTimestamp(),
            ...schedulePayload,
          };
          batch.set(listingRef, listingUpdates, { merge: true });
        }
      }
      await batch.commit();
      closeModal(spotListingModal);
      editingSpotId = "";
      editingListingId = "";
      await refresh();
      switchTab("mine");
    } catch (e) {
      setStatus(spotListingStatusEl, formatFirebaseError(e), true);
    }
  }

  function openBookingModal(listing) {
    const label = String(listing?.spotLabel || listing?.spotId || "車位").trim();
    if (bookingModalTitleEl) bookingModalTitleEl.textContent = `預約車位｜${label}`;
    if (bookingUseTypeEl) bookingUseTypeEl.value = "resident";
    if (bookingVisitorNameEl) bookingVisitorNameEl.value = "";
    if (bookingPlateEl) bookingPlateEl.value = "";
    const startAt = listing?.startAt && typeof listing.startAt.toDate === "function" ? listing.startAt.toDate() : new Date();
    const endAt = listing?.endAt && typeof listing.endAt.toDate === "function" ? listing.endAt.toDate() : addHours(startAt, 2);
    if (bookingStartAtEl) bookingStartAtEl.value = nowIsoLocalFromDate(startAt);
    if (bookingEndAtEl) bookingEndAtEl.value = nowIsoLocalFromDate(addHours(startAt, 1));
    setStatus(bookingStatusEl, "", false);
    updateFeeHint();
    openModal(bookingModal);
  }

  function updateFeeHint() {
    const listing = state.activeBookingListing;
    if (!listing) return;
    const startAt = parseDateTimeLocal(bookingStartAtEl);
    const endAt = parseDateTimeLocal(bookingEndAtEl);
    if (!startAt || !endAt) {
      setStatus(bookingFeeHintEl, "", false);
      return;
    }
    const fee = computeFee({ pricingMode: listing.pricingMode, price: listing.price, startAt, endAt });
    const text = fee ? `預估金額：${fee} 元（僅記錄，不含線上收款）` : "預估金額：0 元";
    setStatus(bookingFeeHintEl, text, false);
  }

  async function submitBooking() {
    const listing = state.activeBookingListing;
    if (!listing) return;
    const plate = String(bookingPlateEl?.value || "").trim();
    if (!plate) {
      setStatus(bookingStatusEl, "請輸入車牌", true);
      return;
    }
    const startAt = parseDateTimeLocal(bookingStartAtEl);
    const endAt = parseDateTimeLocal(bookingEndAtEl);
    if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
      setStatus(bookingStatusEl, "請確認開始/結束時間", true);
      return;
    }
    const rangeOk = validateBookingRange(listing, startAt, endAt);
    if (!rangeOk.ok) {
      setStatus(bookingStatusEl, rangeOk.message, true);
      return;
    }
    const useType = String(bookingUseTypeEl?.value || "resident").trim();
    const visitorName = String(bookingVisitorNameEl?.value || "").trim();
    const fee = computeFee({ pricingMode: listing.pricingMode, price: listing.price, startAt, endAt });
    const status = "approved";
    setStatus(bookingStatusEl, "送出中...", false);

    const doc = db.collection("communities").doc(state.currentCommunityId).collection(COL_BOOKINGS).doc();
    const payload = {
      listingId: String(listing.id || "").trim(),
      spotId: String(listing.spotId || "").trim(),
      spotLabel: String(listing.spotLabel || "").trim(),
      pricingMode: String(listing.pricingMode || "free").trim(),
      price: Math.max(0, Number(listing.price || 0) || 0),
      currency: "TWD",
      fee,
      ownerUid: String(listing.ownerUid || "").trim(),
      ownerHouseNo: String(listing.ownerHouseNo || "").trim(),
      requesterUid: state.currentUserId,
      requesterName: state.currentUserName,
      requesterHouseNo: state.currentUserHouseNo,
      useType,
      visitorName,
      plate,
      startAt: Timestamp.fromDate(startAt),
      endAt: Timestamp.fromDate(endAt),
      status,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    try {
      await doc.set(payload, { merge: true });
      closeModal(bookingModal);
      await refresh();
      switchTab("bookings");
    } catch (e) {
      setStatus(bookingStatusEl, formatFirebaseError(e), true);
    }
  }

  async function refresh() {
    try {
      await loadAllData();
      fillSpotSelect();
      renderBrowse();
    } catch (e) {
      const msg = formatFirebaseError(e);
      if (browseContentEl) browseContentEl.innerHTML = `<div class="status error">${escapeHtml(msg)}</div>`;
      if (mineContentEl) mineContentEl.innerHTML = `<div class="status error">${escapeHtml(msg)}</div>`;
      if (myBookingsContentEl) myBookingsContentEl.innerHTML = `<div class="status error">${escapeHtml(msg)}</div>`;
    }
  }

  function bindEvents() {
    bindModalClose();

    tabsEl?.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = String(btn.dataset.tab || "browse").trim();
        switchTab(tab);
      });
    });

    browseFilterPricingEl?.addEventListener("change", () => renderBrowse());
    browseFilterSpotTypeEl?.addEventListener("change", () => renderBrowse());

    btnNewSpotAndListing?.addEventListener("click", openSpotListingModal);
    listingPricingModeEl?.addEventListener("change", syncListingPriceVisibility);
    listingScheduleTypeEl?.addEventListener("change", syncScheduleTypeVisibility);
    btnSaveSpotListing?.addEventListener("click", saveSpotAndListing);

    bookingStartAtEl?.addEventListener("change", updateFeeHint);
    bookingEndAtEl?.addEventListener("change", updateFeeHint);
    btnSubmitBooking?.addEventListener("click", submitBooking);

    btnConfirmDeleteSpot?.addEventListener("click", async () => {
      const id = String(pendingDeleteSpotId || "").trim();
      pendingDeleteSpotId = "";
      if (!id) return;
      await executeDeleteSpot(id);
    });
  }

  async function bootstrapUser(user) {
    state.currentUserId = user && user.uid ? String(user.uid) : "";
    state.currentUserEmail = user && user.email ? String(user.email) : "";
    const profile = await loadUserProfile(user);
    state.currentUserProfile = profile;

    const name = String(profile?.displayName || profile?.name || profile?.fullName || user.displayName || "").trim() || (state.currentUserEmail ? state.currentUserEmail.split("@")[0] : "");
    state.currentUserName = name || "住戶";

    const houseNo = String(profile?.houseNo || profile?.unit || "").trim();
    const subHouseNo = String(profile?.subHouseNo || profile?.subUnit || profile?.sub || "").trim();
    state.currentUserHouseNo = subHouseNo ? `${houseNo}-${subHouseNo}` : houseNo;

    const params = (() => {
      try {
        return new URLSearchParams(location.search || "");
      } catch {
        return new URLSearchParams("");
      }
    })();
    const roleFromUrl = String(params.get("role") || "").trim();
    const sessionRole = (() => {
      try {
        return String(sessionStorage.getItem("csp_role") || "").trim();
      } catch {
        return "";
      }
    })();
    state.currentUserRole = normalizeRole(roleFromUrl || sessionRole || profile?.role || profile?.userRole || "resident");

    const key = (() => {
      try {
        const urlParams = new URLSearchParams(location.search);
        return String(urlParams.get("c") || "").trim();
      } catch {
        return "";
      }
    })();
    state.currentCommunityId = await resolveCommunityId(key || profile?.community || "");
    state.currentCommunityName = await loadCommunityName(state.currentCommunityId);

    const titleParts = [];
    if (state.currentUserHouseNo) titleParts.push(state.currentUserHouseNo);
    if (state.currentUserName) titleParts.push(state.currentUserName);
    const prefix = titleParts.length ? titleParts.join(" ") : "綠色停車";
    const suffix = state.embed ? "" : (state.currentCommunityName ? `｜${state.currentCommunityName}` : "");
    if (titleEl) titleEl.textContent = `${prefix}${suffix}`;

    await refresh();
    switchTab("browse");
  }

  function renderNeedLogin() {
    if (browseContentEl) browseContentEl.innerHTML = `<div class="status error">請先登入</div>`;
    if (mineContentEl) mineContentEl.innerHTML = `<div class="status error">請先登入</div>`;
    if (myBookingsContentEl) myBookingsContentEl.innerHTML = `<div class="status error">請先登入</div>`;
  }

  ensureEmbedLayout();
  bindHostMessaging();
  bindEvents();
  auth.onAuthStateChanged((user) => {
    if (!user) {
      renderNeedLogin();
      return;
    }
    bootstrapUser(user).catch(() => {
      renderNeedLogin();
    });
  });
})();
