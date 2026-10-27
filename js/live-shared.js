/**
 * 區大直播共用工具
 * 由 admin.js（後台）與 live-meeting.js（住戶端）共用，避免同一份邏輯重複實作而走鐘。
 * 以 window.NWLive 暴露，需在 admin.js / live-meeting.js 之前載入。
 */
(function () {
  "use strict";

  // 解析 YouTube 影片 ID（支援 watch / youtu.be / embed / v / shorts / live）
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

  // 直播狀態：idle 未開播 / live 直播中 / ended 已結束
  const STATUSES = ["idle", "live", "ended"];

  function normalizeStatus(data) {
    const d = data || {};
    const raw = String(d.liveMeetingStatus || "").trim();
    if (STATUSES.indexOf(raw) !== -1) return raw;
    // 舊資料沒有 status 欄位：有連結且未被關閉者視為直播中
    const hasUrl = !!youtubeVideoId(d.liveMeetingYoutubeUrl);
    return (hasUrl && d.liveMeetingEnabled !== false) ? "live" : "idle";
  }

  function statusLabel(status) {
    if (status === "live") return "直播中";
    if (status === "ended") return "已結束";
    return "未開播";
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // YYYY-MM-DD HH:mm
  function formatDateTime(date) {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  // YYYY-MM-DDTHH:mm（給 datetime-local input 用）
  function formatDateTimeInput(date) {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function parseDateTime(val) {
    if (!val) return null;
    const d = new Date(val);
    if (!d || Number.isNaN(d.getTime())) return null;
    return d;
  }

  function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // 將 liveMeetingHistory 文件正規化為前端使用格式
  function normalizeHistoryDoc(id, data) {
    const d = data || {};
    const dt = toDate(d.datetime);
    return {
      id: id,
      title: String(d.title || "").trim(),
      datetime: dt && dt.getTime() ? dt : null,
      youtubeUrl: String(d.youtubeUrl || "").trim(),
      createdAt: toDate(d.createdAt) || new Date(0),
    };
  }

  // 歷史影片排序：日期新到舊，同日再依建立時間新到舊
  function sortHistoryDesc(items) {
    const list = Array.isArray(items) ? items.slice() : [];
    list.sort((a, b) => {
      const ta = a.datetime ? a.datetime.getTime() : 0;
      const tb = b.datetime ? b.datetime.getTime() : 0;
      if (ta !== tb) return tb - ta;
      const ca = a.createdAt ? a.createdAt.getTime() : 0;
      const cb = b.createdAt ? b.createdAt.getTime() : 0;
      return cb - ca;
    });
    return list;
  }

  window.NWLive = {
    youtubeVideoId: youtubeVideoId,
    STATUSES: STATUSES,
    normalizeStatus: normalizeStatus,
    statusLabel: statusLabel,
    formatDateTime: formatDateTime,
    formatDateTimeInput: formatDateTimeInput,
    parseDateTime: parseDateTime,
    normalizeHistoryDoc: normalizeHistoryDoc,
    sortHistoryDesc: sortHistoryDesc,
  };
})();
