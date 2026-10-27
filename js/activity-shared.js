/* 社區活動共用工具
 * 前台 bulletin-activity.js 與後台 admin.js 共用，避免同一套解析邏輯重複實作。
 * 對外：window.NWActivity
 */
(function () {
  "use strict";

  /** 從 YouTube 各種網址格式解析出 videoId */
  function youtubeVideoId(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    const m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/))([A-Za-z0-9_-]{6,})/);
    if (m && m[1]) return m[1];
    try {
      const uo = new URL(u);
      if (uo.hostname.includes("youtube.com") || uo.hostname.includes("youtu.be")) {
        const v = uo.searchParams.get("v");
        if (v) return v;
      }
    } catch (e) {}
    return "";
  }

  function youtubeEmbedUrl(url) {
    const id = youtubeVideoId(url);
    return id ? `https://www.youtube.com/embed/${id}?rel=0` : "";
  }

  /** YouTube 縮圖（取代清單中直接內嵌 iframe，避免一次載入多個播放器） */
  function youtubeThumbUrl(url) {
    const id = youtubeVideoId(url);
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "";
  }

  function googlePhotosAlbumId(url) {
    const u = String(url || "").trim();
    const m = u.match(/photos\.google\.com\/[^/]+\/[^/]+\/([A-Za-z0-9_-]{10,})/);
    if (m && m[1]) return m[1];
    const m2 = u.match(/\/([A-Za-z0-9_-]{20,})/);
    if (m2 && m2[1]) return m2[1];
    return "";
  }

  function googlePhotosDirectUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    try {
      const host = new URL(u).hostname.toLowerCase();
      if (host.includes("photos.google.com") || host.includes("goo.gl") || host.includes("photos.app.goo.gl")) return u;
    } catch (e) {}
    return u;
  }

  function normalizePhotoPreviewUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    if (/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?|$)/i.test(u)) return u;
    const id = googlePhotosAlbumId(u);
    if (id) return `https://lh3.googleusercontent.com/${encodeURIComponent(id)}=w1200`;
    return "";
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === "function") {
      try {
        const d = value.toDate();
        return isNaN(d.getTime()) ? null : d;
      } catch (e) { return null; }
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDateTime(value) {
    const d = toDate(value);
    if (!d) return value ? String(value) : "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** 轉為 <input type="datetime-local"> 可用的值 */
  function formatDateTimeInput(value) {
    const d = toDate(value);
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function timeMillis(item) {
    const t = (item && (item.activityTime || item.createdAt)) || null;
    if (!t) return 0;
    if (typeof t.toMillis === "function") return t.toMillis();
    const d = toDate(t);
    return d ? d.getTime() : 0;
  }

  /** 依活動時間（或建立時間）由新到舊排序 */
  function sortByTimeDesc(list) {
    return (Array.isArray(list) ? list.slice() : []).sort((a, b) => timeMillis(b) - timeMillis(a));
  }

  /** 將 Firestore querySnapshot 的 doc 轉為 { id, ...data } */
  function normalizeItem(doc) {
    const data = (doc && typeof doc.data === "function") ? (doc.data() || {}) : (doc || {});
    const id = (doc && doc.id) ? doc.id : String(data.id || "");
    return Object.assign({}, data, { id: String(id || "") });
  }

  window.NWActivity = {
    youtubeVideoId,
    youtubeEmbedUrl,
    youtubeThumbUrl,
    googlePhotosAlbumId,
    googlePhotosDirectUrl,
    normalizePhotoPreviewUrl,
    formatDateTime,
    formatDateTimeInput,
    toDate,
    timeMillis,
    sortByTimeDesc,
    normalizeItem,
  };
})();
