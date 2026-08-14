(function () {
  'use strict';

  const titleEl = document.getElementById('viewerTitle');
  const statusEl = document.getElementById('viewerStatus');
  const pagesEl = document.getElementById('pdfPages');
  const btnDownload = document.getElementById('btnDownloadPdf');
  const btnClose = document.getElementById('btnClosePdfViewer');
  let sourceUrl = './';
  let currentBlobUrl = '';
  let currentFilename = '附件.pdf';

  function isLineBrowser() {
    const ua = String(navigator.userAgent || '').toLowerCase();
    return ua.includes('line/') || ua.includes(' line ');
  }

  function isEmbeddedRestrictedBrowser() {
    const ua = String(navigator.userAgent || '').toLowerCase();
    if (isLineBrowser()) return true;
    if (ua.includes('fban') || ua.includes('fbav')) return true;
    if (ua.includes('instagram')) return true;
    if (ua.includes('micromessenger') || ua.includes('wechat')) return true;
    return false;
  }

  function setStatus(text, isError) {
    if (!statusEl) return;
    statusEl.textContent = String(text || '').trim();
    statusEl.classList.toggle('error', !!isError);
  }

  function getPayload() {
    try {
      const params = new URLSearchParams(location.search);
      const key = String(params.get('key') || '').trim();
      if (!key) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      try { localStorage.removeItem(key); } catch {}
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function dataUrlToUint8Array(dataUrl) {
    const raw = String(dataUrl || '').trim();
    const comma = raw.indexOf(',');
    if (comma < 0) throw new Error('bad-data-url');
    const meta = raw.slice(0, comma).toLowerCase();
    if (!meta.includes(';base64')) throw new Error('not-base64');
    const base64 = raw.slice(comma + 1);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function renderPdf(bytes, filename) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) throw new Error('pdfjs-missing');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    if (titleEl) titleEl.textContent = filename;
    setStatus(`共 ${pdf.numPages} 頁`, false);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      const wrapper = document.createElement('section');
      wrapper.className = 'pdf-page';
      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = `第 ${pageNumber} / ${pdf.numPages} 頁`;

      wrapper.appendChild(canvas);
      wrapper.appendChild(label);
      pagesEl.appendChild(wrapper);

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;
    }
  }

  async function forceDownloadPdf() {
    if (!currentBlobUrl) {
      setStatus('PDF 尚未準備完成，請稍後再試。', true);
      return;
    }
    if (isEmbeddedRestrictedBrowser()) {
      const name = isLineBrowser() ? 'LINE 內建瀏覽器' : '目前的內建瀏覽器';
      setStatus(`${name}封鎖了直接下載。請點右上角選單「用瀏覽器開啟」，或在 PDF 頁面上長按選擇「另存新檔」。`, true);
      window.alert(`${name}封鎖了直接下載功能。\n\n解決方式：\n① 點擊右上角選單 → 選擇「用瀏覽器開啟」或「在外部瀏覽器中開啟」，即可正常下載；\n② 或直接在 PDF 頁面上長按，選擇「另存新檔/下載圖片」。`);
      return;
    }
    const a = document.createElement('a');
    a.href = currentBlobUrl;
    a.download = currentFilename;
    document.body.appendChild(a);
    try { a.click(); } catch {}
    setTimeout(() => {
      if (a && a.parentNode) a.parentNode.removeChild(a);
    }, 500);
  }

  async function init() {
    const payload = getPayload();
    if (!payload || !payload.dataUrl) {
      setStatus('找不到 PDF 資料，請回上一頁重新點選。', true);
      return;
    }

    const filename = String(payload.filename || '附件.pdf').trim() || '附件.pdf';
    currentFilename = filename;
    sourceUrl = String(payload.sourceUrl || './').trim() || './';
    if (titleEl) titleEl.textContent = filename;

    try {
      const bytes = dataUrlToUint8Array(payload.dataUrl);
      const headTxt = String.fromCharCode(...bytes.slice(0, 5));
      if (headTxt !== '%PDF-') {
        setStatus('PDF 檔案內容異常，可能檔案已損毀或格式錯誤。', true);
        return;
      }

      const blob = new Blob([bytes], { type: 'application/pdf' });
      currentBlobUrl = URL.createObjectURL(blob);
      if (btnDownload) {
        btnDownload.href = currentBlobUrl;
        btnDownload.download = filename;
        btnDownload.addEventListener('click', (e) => {
          e.preventDefault();
          forceDownloadPdf();
        });
      }

      await renderPdf(bytes, filename);
    } catch (err) {
      console.error(err);
      setStatus('PDF 載入失敗，請重新上傳有效的 PDF 檔案。', true);
    }

    window.addEventListener('beforeunload', () => {
      if (currentBlobUrl) {
        try { URL.revokeObjectURL(currentBlobUrl); } catch {}
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      try {
        if (window.opener && !window.opener.closed) {
          window.close();
          return;
        }
      } catch {}
      try {
        if (history.length > 1 && document.referrer) {
          history.back();
          return;
        }
      } catch {}
      try {
        location.replace(sourceUrl);
        return;
      } catch {}
      location.href = './';
    });
  }

  init();
})();
