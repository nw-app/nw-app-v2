/*
 * 管理費催收通知函（fee-notice）
 * 用途：
 *   1) 後台（finance.js）：預覽、下載 PDF／圖片、產生免登入公開連結
 *   2) 公開頁 fee-notice.html?c={cid}&id={noticeId}（無需登入即可瀏覽）
 * 命名空間：window.NwFeeNotice
 * Firestore：communities/{cid}/financeNotices/{noticeId}
 */
(function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function toNum(v, fallback) {
    const n = Number(String(v == null ? "" : v).replace(/[,\s$]/g, ""));
    if (Number.isFinite(n)) return n;
    return typeof fallback === "number" ? fallback : 0;
  }

  function fmtMoney(v) {
    return toNum(v, 0).toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function sanitizeFilename(name) {
    return String(name == null ? "" : name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "notice";
  }

  /** 西元日期字串（YYYY-MM-DD）轉民國日期 */
  function rocDate(ymdStr) {
    const m = String(ymdStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(ymdStr || "");
    return (Number(m[1]) - 1911) + "年" + Number(m[2]) + "月" + Number(m[3]) + "日";
  }

  /** YYYY-MM 轉民國年月 */
  function rocMonth(mm) {
    const m = String(mm || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(mm || "");
    return (Number(m[1]) - 1911) + "年" + Number(m[2]) + "月";
  }

  /** 樣板代換：{key} → 對應值（未提供時保留原樣） */
  function fillTpl(tpl, map) {
    return String(tpl == null ? "" : tpl).replace(/\{(\w+)\}/g, function (m, k) {
      return map && map[k] != null ? String(map[k]) : m;
    });
  }

  /** 通知函可用的代換欄位（供設定頁說明） */
  var TPL_KEYS = ["{unit}", "{name}", "{community}", "{owe}", "{amount}", "{paid}",
    "{issuedAt}", "{deadline}", "{first}", "{last}", "{count}"];

  const CSS_TEXT = [
      ".fn-print{position:absolute;left:-99999px;top:0;width:794px;background:#fff;}",
      ".fn-sheet{width:794px;box-sizing:border-box;padding:48px 56px;background:#fff;color:#111827;",
      "font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;font-size:15px;line-height:1.9;}",
      ".fn-head{text-align:center;margin:0 0 16px;}",
      ".fn-community{font-size:20px;font-weight:900;letter-spacing:2px;}",
      ".fn-doc-title{font-size:26px;font-weight:900;letter-spacing:6px;margin-top:6px;}",
      ".fn-doc-no{font-size:12px;color:#6b7280;margin-top:8px;}",
      ".fn-meta{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:14px;margin:8px 0 16px;}",
      ".fn-body p{margin:0 0 10px;}",
      ".fn-subject{font-weight:900;}",
      ".fn-table{width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:14px;}",
      ".fn-table th,.fn-table td{border:1px solid #9ca3af;padding:7px 10px;}",
      ".fn-table th{background:#f3f4f6;font-weight:900;text-align:center;}",
      ".fn-table td.c{text-align:center;}",
      ".fn-table td.n{text-align:right;font-variant-numeric:tabular-nums;}",
      ".fn-table td.strong{font-weight:900;color:#b91c1c;}",
      ".fn-table tfoot td{font-weight:900;background:#fafafa;}",
      ".fn-total{font-weight:900;color:#b91c1c;}",
      ".fn-sign{margin-top:34px;text-align:right;}",
      ".fn-sign-org{font-size:17px;font-weight:900;letter-spacing:1px;}",
      ".fn-sign-date{margin-top:6px;font-size:14px;color:#374151;}",
      ".fn-note{margin-top:16px;font-size:12px;color:#6b7280;}",
      ".fn-preview .fn-sheet{width:100%;padding:26px 22px;font-size:13px;}",
      ".fn-preview .fn-community{font-size:17px;}",
      ".fn-preview .fn-doc-title{font-size:20px;letter-spacing:3px;}",
      ".fn-preview .fn-table{font-size:12px;}",
      ".fn-preview .fn-table th,.fn-preview .fn-table td{padding:5px 7px;}",
      ".fn-preview .fn-sign{margin-top:22px;}",
      ".fn-page{display:flex;justify-content:center;padding:16px;box-sizing:border-box;}",
      ".fn-page .fn-sheet{max-width:100%;box-shadow:0 10px 30px rgba(17,24,39,.12);border-radius:6px;}",
      "@media (max-width:820px){",
      ".fn-page{padding:10px;}",
      ".fn-page .fn-sheet{width:100%;padding:24px 18px;font-size:13px;}",
      ".fn-page .fn-community{font-size:16px;}",
      ".fn-page .fn-doc-title{font-size:19px;letter-spacing:2px;}",
      ".fn-page .fn-table{font-size:12px;}",
      ".fn-page .fn-table th,.fn-page .fn-table td{padding:5px 6px;}",
      ".fn-page .fn-meta{font-size:12px;}",
      ".fn-page .fn-sign-org{font-size:15px;}",
      "}"
    ].join("");

  function ensureStyles() {
    if (document.getElementById("fnStyles")) return;
    const st = document.createElement("style");
    st.id = "fnStyles";
    st.textContent = CSS_TEXT;
    document.head.appendChild(st);
  }

  /** 產生催收通知函 HTML */
  function buildNoticeHtml(payload) {
    const p = payload || {};
    const months = Array.isArray(p.months) ? p.months : [];
    const sum = function (key) {
      return months.reduce(function (a, x) { return a + toNum(x && x[key], 0); }, 0);
    };
    const totalAmount = p.totalAmount != null ? toNum(p.totalAmount, 0) : sum("amount");
    const totalPaid = p.totalPaid != null ? toNum(p.totalPaid, 0) : sum("paid");
    const totalOwe = p.totalOwe != null ? toNum(p.totalOwe, 0) : sum("owe");
    const bodyRows = months.map(function (x) {
      return "<tr>" +
        '<td class="c">' + esc(rocMonth(x.month)) + "</td>" +
        '<td class="n">' + fmtMoney(x.amount) + "</td>" +
        '<td class="n">' + fmtMoney(x.paid) + "</td>" +
        '<td class="n strong">' + fmtMoney(x.owe) + "</td>" +
        "</tr>";
    }).join("") || '<tr><td class="c" colspan="4">無欠繳紀錄</td></tr>';
    const first = months.length ? rocMonth(months[0].month) : "—";
    const last = months.length ? rocMonth(months[months.length - 1].month) : "—";
    const community = String(p.communityName || "本社區");
    const issuedAt = String(p.issuedAt || "");
    const deadline = String(p.deadline || "");
    const unit = String(p.unit || "");
    const name = String(p.name || "");
    const noticeNo = String(p.noticeNo || "");
    const contact = String(p.contact || "");
    const note = String(p.note || "");
    /* 可自訂欄位：未設定時沿用系統預設用語 */
    const docTitle = String(p.docTitle || "").trim() || "管理費催收通知函";
    const signer = String(p.signer || "").trim() || (community + " 管理委員會");
    const tplMap = {
      community: community, unit: unit, name: name,
      owe: fmtMoney(totalOwe), amount: fmtMoney(totalAmount), paid: fmtMoney(totalPaid),
      issuedAt: rocDate(issuedAt), deadline: rocDate(deadline),
      first: first, last: last, count: String(months.length), contact: contact
    };
    const subjectRaw = String(p.subject || "").trim();
    const subjectHtml = subjectRaw
      ? esc(fillTpl(subjectRaw, tplMap))
      : '台端積欠本社區管理費計新台幣 <span class="fn-total">' + fmtMoney(totalOwe) +
        "</span> 元整，請於期限內完成繳納，請查照。";
    const closingRaw = String(p.closing || "").trim();
    const closingText = closingRaw
      ? fillTpl(closingRaw, tplMap)
      : "請於 " + rocDate(deadline) + " 前完成繳納；如已繳納，請忽略本通知，感謝您的配合。";
    return '<div class="fn-sheet">' +
      '<div class="fn-head">' +
      '<div class="fn-community">' + esc(community) + "</div>" +
      '<div class="fn-doc-title">' + esc(docTitle) + "</div>" +
      (noticeNo ? '<div class="fn-doc-no">文號：' + esc(noticeNo) + "</div>" : "") +
      "</div>" +
      '<div class="fn-meta">' +
      "<div>受文者：" + esc([unit, name].filter(Boolean).join(" ") || "—") + "</div>" +
      "<div>發文日期：" + esc(rocDate(issuedAt)) + "</div>" +
      "</div>" +
      '<div class="fn-body">' +
      '<p class="fn-subject">主旨：' + subjectHtml + "</p>" +
      "<p>說明：</p>" +
      "<p>一、經查台端自 " + esc(first) + " 起至 " + esc(last) + " 止，管理費繳納情形如下表：</p>" +
      '<table class="fn-table"><thead><tr><th>欠繳月份</th><th>應繳金額</th><th>已繳金額</th><th>尚欠金額</th></tr></thead>' +
      "<tbody>" + bodyRows + "</tbody>" +
      '<tfoot><tr><td class="c">合計</td><td class="n">' + fmtMoney(totalAmount) +
      '</td><td class="n">' + fmtMoney(totalPaid) +
      '</td><td class="n strong">' + fmtMoney(totalOwe) + "</td></tr></tfoot></table>" +
      '<p>二、累計尚欠金額計新台幣 <span class="fn-total">' + fmtMoney(totalOwe) + "</span> 元整。</p>" +
      "<p>三、" + esc(closingText) + "</p>" +
      "<p>四、如有疑義，請洽本社區管理中心" + (contact ? "（" + esc(contact) + "）" : "") + "。</p>" +
      "</div>" +
      (note ? '<div class="fn-note">備註：' + esc(note) + "</div>" : "") +
      '<div class="fn-sign">' +
      '<div class="fn-sign-org">' + esc(signer) + "</div>" +
      '<div class="fn-sign-date">中華民國 ' + esc(rocDate(issuedAt)) + "</div>" +
      "</div>" +
      "</div>";
  }

  /** 產生純文字版通知內容（供複製、Email、簡訊使用） */
  function buildNoticeText(payload) {
    const p = payload || {};
    const months = Array.isArray(p.months) ? p.months : [];
    const sum = function (key) {
      return months.reduce(function (a, x) { return a + toNum(x && x[key], 0); }, 0);
    };
    const totalOwe = p.totalOwe != null ? toNum(p.totalOwe, 0) : sum("owe");
    const community = String(p.communityName || "本社區");
    const docTitle = String(p.docTitle || "").trim() || "管理費催收通知函";
    const lines = [];
    lines.push("【" + community + "】" + docTitle);
    lines.push("受文者：" + ([p.unit, p.name].filter(Boolean).join(" ") || "—"));
    lines.push("發文日期：" + rocDate(p.issuedAt));
    if (months.length) {
      lines.push("欠繳月份：共 " + months.length + " 期（" + rocMonth(months[0].month) +
        " 起至 " + rocMonth(months[months.length - 1].month) + " 止）");
    } else {
      lines.push("欠繳月份：無");
    }
    lines.push("合計尚欠：新台幣 " + fmtMoney(totalOwe) + " 元整");
    lines.push("繳納期限：" + rocDate(p.deadline));
    if (String(p.contact || "").trim()) lines.push("洽詢方式：" + String(p.contact).trim());
    if (String(p.note || "").trim()) lines.push("備註：" + String(p.note).trim());
    return lines.join("\n");
  }

  /** 產生供 html2canvas 擷取的離屏節點（固定 A4 版面） */
  function buildPrintNode(payload) {
    ensureStyles();
    const el = document.createElement("div");
    el.className = "fn-print";
    el.innerHTML = buildNoticeHtml(payload);
    return el;
  }

  function toCanvas(payload) {
    const h2c = window.html2canvas;
    if (!h2c) return Promise.reject(new Error("圖片元件未載入"));
    const node = buildPrintNode(payload);
    document.body.appendChild(node);
    return h2c(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true })
      .then(function (canvas) {
        if (node.parentNode) node.parentNode.removeChild(node);
        return canvas;
      }, function (err) {
        if (node.parentNode) node.parentNode.removeChild(node);
        throw err;
      });
  }

  function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    try { a.click(); } catch (e) { /* 忽略 */ }
    window.setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 500);
  }

  function downloadImage(payload, filename) {
    return toCanvas(payload).then(function (canvas) {
      downloadDataUrl(canvas.toDataURL("image/png"), filename);
      return true;
    });
  }

  function downloadPdf(payload, filename) {
    return toCanvas(payload).then(function (canvas) {
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      return import("https://esm.sh/jspdf@2.5.1").then(function (mod) {
        const JsPDF = mod && (mod.jsPDF || mod.default);
        if (!JsPDF) throw new Error("jsPDF 載入失敗");
        const pdf = new JsPDF({ orientation: "p", unit: "mm", format: "a4" });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const imgW = pageW;
        const imgH = (canvas.height * imgW) / canvas.width;
        let offset = 0;
        pdf.addImage(imgData, "JPEG", 0, 0, imgW, imgH);
        while (imgH - (offset + pageH) > 0) {
          offset += pageH;
          pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, -offset, imgW, imgH);
        }
        pdf.save(filename);
        return true;
      });
    });
  }

  /** 以隱藏 iframe 叫用瀏覽器列印（避免彈出視窗被阻擋） */
  function printSheet(payload) {
    return new Promise(function (resolve) {
      const p = payload || {};
      const title = [p.communityName, "管理費催收通知函"].filter(Boolean).join(" ");
      const html = "<!doctype html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\"/>" +
        "<title>" + esc(title) + "</title><style>" + CSS_TEXT +
        "@page{size:A4;margin:12mm;}" +
        "html,body{margin:0;padding:0;background:#fff;}" +
        ".fn-sheet{width:auto;padding:0;box-shadow:none;border-radius:0;}" +
        "</style></head><body>" + buildNoticeHtml(p) + "</body></html>";
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.position = "fixed";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.width = "0";
      frame.style.height = "0";
      frame.style.border = "0";
      frame.style.visibility = "hidden";
      document.body.appendChild(frame);
      const remove = function () {
        window.setTimeout(function () {
          if (frame.parentNode) frame.parentNode.removeChild(frame);
        }, 1500);
      };
      const win = frame.contentWindow;
      const doc = win && win.document;
      if (!doc) { remove(); resolve(false); return; }
      doc.open();
      doc.write(html);
      doc.close();
      window.setTimeout(function () {
        try {
          win.focus();
          win.print();
          resolve(true);
        } catch (e) {
          resolve(false);
        }
        remove();
      }, 220);
    });
  }

  /** 產生免登入公開連結 */
  function publicUrl(communityId, noticeId) {
    let base = String(location.href || "").split("#")[0].split("?")[0];
    base = base.replace(/[^/]*$/, "");
    return base + "fee-notice.html?c=" + encodeURIComponent(String(communityId || "")) +
      "&id=" + encodeURIComponent(String(noticeId || ""));
  }

  function shareLine(url, message) {
    const text = String(message || "").trim();
    const payload = (text ? text + "\n" : "") + String(url || "");
    window.open("https://line.me/R/msg/text/?" + encodeURIComponent(payload), "_blank", "noopener");
  }

  /** 以 Email 客戶端開啟（mailto，零成本不需後端） */
  function shareEmail(to, subject, body) {
    const url = "mailto:" + encodeURIComponent(String(to || "").trim()) +
      "?subject=" + encodeURIComponent(String(subject || "")) +
      "&body=" + encodeURIComponent(String(body || ""));
    window.location.href = url;
  }

  /** 以簡訊應用程式開啟（sms:，零成本不需後端） */
  function shareSms(phone, body) {
    const num = String(phone || "").replace(/[^\d+]/g, "");
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const sep = isIos ? "&" : "?";
    window.location.href = "sms:" + num + (num ? sep : "?") + "body=" + encodeURIComponent(String(body || ""));
  }

  function copyText(text) {
    const v = String(text == null ? "" : text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(v).then(function () { return true; }, function () { return legacyCopy(v); });
    }
    return Promise.resolve(legacyCopy(v));
  }

  function legacyCopy(v) {
    try {
      const ta = document.createElement("textarea");
      ta.value = v;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function noticeFilename(payload, ext) {
    const p = payload || {};
    const who = [p.unit, p.name].filter(Boolean).join("_");
    return sanitizeFilename(p.communityName || "社區") + "_管理費催收通知_" +
      sanitizeFilename(who || "住戶") + "." + String(ext || "pdf");
  }

  /* ---------------- 公開頁（無需登入） ---------------- */

  function mountSheet(container, payload) {
    if (!container) return;
    ensureStyles();
    container.classList.add("fn-page");
    container.innerHTML = buildNoticeHtml(payload);
  }

  function bootPublic() {
    const app = document.getElementById("feeNoticeApp");
    if (!app) return;
    const statusEl = document.getElementById("fnStatus");
    const setStatus = function (msg, isErr) {
      if (!statusEl) return;
      const t = String(msg || "").trim();
      statusEl.textContent = t;
      statusEl.hidden = !t;
      statusEl.classList.toggle("error", Boolean(isErr));
    };
    let cid = "";
    let id = "";
    try {
      const sp = new URL(location.href).searchParams;
      cid = String(sp.get("c") || "").trim();
      id = String(sp.get("id") || "").trim();
    } catch (e) { /* 忽略 */ }
    if (!cid || !id) { setStatus("連結不完整，請確認網址是否正確。", true); return; }
    if (!window.firebase || !firebase.apps) { setStatus("系統尚未就緒，請稍後再試。", true); return; }
    try {
      if (!firebase.apps.length) {
        if (!window.FIREBASE_CONFIG) { setStatus("缺少系統設定。", true); return; }
        firebase.initializeApp(window.FIREBASE_CONFIG);
      }
    } catch (e) {
      setStatus("系統初始化失敗。", true);
      return;
    }
    setStatus("讀取中...", false);
    firebase.firestore().collection("communities").doc(cid)
      .collection("financeNotices").doc(id).get().then(function (snap) {
        if (!snap || !snap.exists) { setStatus("查無此通知函，可能已刪除或連結已失效。", true); return; }
        const data = snap.data() || {};
        setStatus("", false);
        mountSheet(app, data);
        bindPublicActions(data, cid, id);
        const actions = document.getElementById("fnActions");
        if (actions) actions.hidden = false;
        const sub = document.getElementById("fnSub");
        if (sub) sub.textContent = [data.unit, data.name].filter(Boolean).join(" ") || "—";
        try {
          document.title = (data.communityName ? data.communityName + " " : "") + "管理費催收通知函";
        } catch (e) { /* 忽略 */ }
      }).catch(function (err) {
        const code = String(err && err.code ? err.code : "");
        setStatus(code.indexOf("permission-denied") !== -1 ? "沒有權限讀取此通知函。" : "讀取失敗，請稍後再試。", true);
      });
  }

  function bindPublicActions(data, cid, id) {
    ensureStyles();
    const url = publicUrl(cid, id);
    const setBusy = function (btn, busy, label) {
      if (!btn) return;
      btn.disabled = Boolean(busy);
      if (label != null) btn.textContent = label;
    };
    const pdfBtn = document.getElementById("fnDownloadPdf");
    const imgBtn = document.getElementById("fnDownloadImage");
    const lineBtn = document.getElementById("fnShareLine");
    const copyBtn = document.getElementById("fnCopyLink");
    if (pdfBtn) pdfBtn.onclick = function () {
      setBusy(pdfBtn, true, "產生中...");
      downloadPdf(data, noticeFilename(data, "pdf"))
        .then(function () { setBusy(pdfBtn, false, "下載 PDF"); })
        .catch(function () { setBusy(pdfBtn, false, "下載 PDF"); window.alert("PDF 產生失敗，請稍後再試。"); });
    };
    if (imgBtn) imgBtn.onclick = function () {
      setBusy(imgBtn, true, "產生中...");
      downloadImage(data, noticeFilename(data, "png"))
        .then(function () { setBusy(imgBtn, false, "下載圖片"); })
        .catch(function () { setBusy(imgBtn, false, "下載圖片"); window.alert("圖片產生失敗，請稍後再試。"); });
    };
    if (lineBtn) lineBtn.onclick = function () {
      shareLine(url, (data.communityName || "本社區") + " 管理費催收通知");
    };
    if (copyBtn) copyBtn.onclick = function () {
      copyText(url).then(function (ok) {
        copyBtn.textContent = ok ? "已複製連結" : "複製失敗";
        window.setTimeout(function () { copyBtn.textContent = "複製連結"; }, 1800);
      });
    };
  }

  window.NwFeeNotice = {
    esc: esc,
    rocDate: rocDate,
    tplKeys: TPL_KEYS,
    fillTpl: fillTpl,
    ensureStyles: ensureStyles,
    buildNoticeHtml: buildNoticeHtml,
    buildNoticeText: buildNoticeText,
    buildPrintNode: buildPrintNode,
    downloadImage: downloadImage,
    downloadPdf: downloadPdf,
    print: printSheet,
    publicUrl: publicUrl,
    shareLine: shareLine,
    shareEmail: shareEmail,
    shareSms: shareSms,
    copyText: copyText,
    noticeFilename: noticeFilename,
    mount: mountSheet
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootPublic);
  else bootPublic();
})();
