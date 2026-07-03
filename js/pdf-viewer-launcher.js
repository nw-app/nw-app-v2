(function () {
  'use strict';

  function openPdfViewer(dataUrl, filename) {
    const raw = String(dataUrl || '').trim();
    if (!raw) {
      window.alert('PDF 內容不存在。');
      return;
    }
    const key = `nw_pdf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      filename: String(filename || '附件.pdf').trim() || '附件.pdf',
      dataUrl: raw,
      savedAt: Date.now(),
      sourceUrl: String(location.href || './').trim() || './',
    };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      window.alert('PDF 暫存失敗，請稍後再試。');
      return;
    }
    const url = `./pdf-viewer.html?key=${encodeURIComponent(key)}`;
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      location.href = url;
    }
  }

  window.openPdfViewer = openPdfViewer;
})();
