(function () {
  "use strict";

  var STORAGE_KEY = "parking_view_records_v1";
  var MAX_HISTORY = 50;
  var OCR_TIMEOUT_MS = 15000;

  // ------- 台灣車牌格式規則 -------------------------------------------------
  // X: 英文 A-Z；Y: 數字 0-9；Z: 英數混合 A-Z0-9
  // 評分: perfect=100；格式符合但字元需修正時依修正數扣分
  var TW_RULES = [
    // --- 汽車 ---
    { key: "car-new",       label: "汽車·新型",       type: "car",  regex: /^[A-Z]{3}-[0-9]{4}$/,   perfect: 100, prefer: 8 },
    { key: "car-old-24",    label: "汽車·舊型 2-4",   type: "car",  regex: /^[A-Z]{2}-[0-9]{4}$/,   perfect: 95,  prefer: 5 },
    { key: "car-old-42",    label: "汽車·舊型 4-2",   type: "car",  regex: /^[0-9]{4}-[A-Z]{2}$/,   perfect: 95,  prefer: 5 },
    { key: "car-old-z4",    label: "汽車·舊型 ZZ-4",  type: "car",  regex: /^[A-Z0-9]{2}-[0-9]{4}$/, perfect: 90, prefer: 3 },
    { key: "car-old-4z",    label: "汽車·舊型 4-ZZ",  type: "car",  regex: /^[0-9]{4}-[A-Z0-9]{2}$/, perfect: 90, prefer: 3 },
    // --- 重型機車 ---
    { key: "hmoto-new",     label: "重機·新型",       type: "moto", regex: /^[A-Z]{3}-[0-9]{4}$/,   perfect: 100, prefer: 7 },
    { key: "hmoto-old-22",  label: "重機·舊型 2-2",   type: "moto", regex: /^[A-Z]{2}-[0-9]{2}$/,   perfect: 90,  prefer: 4 },
    { key: "hmoto-old-23",  label: "重機·舊型 2-3",   type: "moto", regex: /^[A-Z]{2}-[0-9]{3}$/,   perfect: 92,  prefer: 4 },
    { key: "hmoto-old-24",  label: "重機·舊型 2-4",   type: "moto", regex: /^[A-Z]{2}-[0-9]{4}$/,   perfect: 95,  prefer: 5 },
    // --- 一般機車 ---
    { key: "moto-new",      label: "機車·新型",       type: "moto", regex: /^[A-Z]{3}-[0-9]{4}$/,   perfect: 100, prefer: 6 },
    { key: "moto-old-33",   label: "機車·舊型 3-3",   type: "moto", regex: /^[A-Z]{3}-[0-9]{3}$/,   perfect: 92,  prefer: 4 },
    { key: "moto-old-z33",  label: "機車·舊型 Z3-3",  type: "moto", regex: /^[A-Z0-9]{3}-[0-9]{3}$/, perfect: 88, prefer: 2 },
  ];

  // 常見 OCR 誤辨校正 (針對台灣車牌字元)
  // 依位置 (字母區 or 數字區) 選擇優先校正方向
  // v305 數字救援：擴充字典 + 加入數字自身相似表 (3↔8, 6↔0 等)
  var OCR_CORRECT_LETTER = {
    "0": "O", "1": "I", "2": "Z", "3": "E", "4": "A", "5": "S",
    "6": "G", "7": "T", "8": "B", "9": "Q"
  };
  var OCR_CORRECT_DIGIT = {
    "O": "0", "Q": "0", "D": "0", "C": "0", "U": "0",
    "I": "1", "L": "1",
    "Z": "2",
    "E": "3", "F": "3",
    "A": "4", "H": "4", "V": "4",
    "S": "5",
    "G": "6",
    "T": "7", "Y": "7",
    "B": "8", "X": "8",
    "P": "9", "R": "9"
  };
  // 數字自身相似 (OCR 常把 3 看成 8、6 看成 0、5 看成 6 等) — v305 新增
  var DIGIT_SELF_SIMILAR = {
    "0": ["6", "8", "9"],
    "3": ["8", "5"],
    "5": ["3", "6", "8"],
    "6": ["0", "5", "8"],
    "8": ["0", "3", "5", "6", "9"],
    "9": ["0", "8", "4"],
    "2": ["7"],
    "7": ["2", "1"]
  };
  var OCR_CORRECT_ALNUM = Object.assign({}, OCR_CORRECT_DIGIT, OCR_CORRECT_LETTER);

  // ------- 共用狀態 / DOM ----------------------------------------------------
  var state = {
    stream: null,
    facing: "environment",
    cameraOn: false,
    autoRec: false,
    autoTimer: null,
    ocrBusy: false,
    ocrWarm: false,
    currentType: "car",
    lastResult: null,
    records: [],
    currentCommunityId: "default",
    currentUserId: "",
  };
  var els = {};
  function $(id) { return document.getElementById(id); }

  function elInit() {
    var map = [
      ["video","cameraVideo"],["canvas","cameraCanvas"],["capturedImg","capturedImg"],
      ["wrap","cameraWrap"],["placeholder","cameraPlaceholder"],["hint","cameraHint"],
      ["scan","scanOverlay"],["btnToggle","btnToggleCam"],["btnToggleLabel","btnToggleCamLabel"],
      ["btnFacing","btnSwitchFacing"],["btnCapture","btnCapture"],
      ["btnAuto","btnAutoRec"],["btnAutoLabel","btnAutoRecLabel"],
      ["typeCar","typeCar"],["typeMoto","typeMoto"],
      ["resultCard","resultCard"],["resultBadge","resultBadge"],["subLabel","plateSubLabel"],
      ["plateDisplay","plateDisplay"],["plateInput","plateInput"],["btnSave","btnSaveRecord"],
      ["confFill","confidenceFill"],["confText","confidenceText"],
      ["resultTypeSwitch","resultTypeSwitch"],
      ["progress","ocrProgress"],
      ["manualType","manualType"],["manualPlate","manualPlate"],["btnManual","btnManualSave"],
      ["cameraPanel","cameraPanel"],["historyPanel","historyPanel"],["tabs","pvTabs"],
      ["historyList","historyList"],["btnClearHistory","btnClearHistory"],
      ["layout","pvLayout"]
    ];
    for (var i = 0; i < map.length; i++) els[map[i][0]] = $(map[i][1]);
  }

  function escapeHtml(v) {
    var s = String(v == null ? "" : v);
    return s.replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c;
    });
  }

  function formatDateTime(v) {
    var d = v instanceof Date ? v : new Date(v);
    if (!Number.isFinite(d.getTime())) return "";
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  // ------- 車牌字串正規化 / 格式化 / 校正 ------------------------------------
  function normalizePlate(raw) {
    var s = String(raw || "").trim().toUpperCase();
    s = s.replace(/[^A-Z0-9\-]/g, "");
    if (s.length > 12) s = s.slice(0, 12);
    return s;
  }

  function stripDash(plate) {
    return String(plate || "").replace(/[^A-Z0-9]/g, "").toUpperCase();
  }

  // 自動在正確位置插入 "-" (若尚未有)，並回傳格式化字串
  function formatPlate(rawPlate) {
    var p = stripDash(rawPlate);
    if (!p) return "";
    // 候選位置逐一嘗試，回傳第一個能通過台灣車牌規則的組合
    var candidates = [];
    var len = p.length;
    if (len >= 4 && len <= 8) {
      for (var d = 2; d <= 5; d++) {
        if (d < len) candidates.push(p.slice(0, d) + "-" + p.slice(d));
      }
    }
    candidates.push(p);
    var best = null; var bestScore = -1;
    for (var i = 0; i < candidates.length; i++) {
      var r = matchTWFormat(candidates[i]);
      if (r && r.score > bestScore) { best = candidates[i]; bestScore = r.score; }
    }
    if (best) return best;
    // 完全無匹配時，依長度給合理預設分隔
    if (len === 4) return p;
    if (len === 5) return p.slice(0, 2) + "-" + p.slice(2);
    if (len === 6) return p.slice(0, 2) + "-" + p.slice(2);
    if (len === 7) return p.slice(0, 3) + "-" + p.slice(3);
    if (len === 8) return p.slice(0, 4) + "-" + p.slice(4);
    return p;
  }

  // 在候選字串上嘗試插入 dash 的各種位置，回傳所有合法候選
  function tryAllDashes(noDash) {
    var s = String(noDash || "").toUpperCase();
    if (!s) return [];
    var out = [s];
    for (var d = 1; d < s.length; d++) {
      out.push(s.slice(0, d) + "-" + s.slice(d));
    }
    return out;
  }

  // 比對 TW_RULES 並計算分數
  function matchTWFormat(plateWithDash) {
    if (!plateWithDash) return null;
    var best = null;
    for (var i = 0; i < TW_RULES.length; i++) {
      var rule = TW_RULES[i];
      if (rule.regex.test(plateWithDash)) {
        var s = rule.perfect + (rule.prefer || 0);
        if (!best || s > best.score) {
          best = { score: s, rule: rule, plate: plateWithDash, edits: 0 };
        }
      }
    }
    return best;
  }

  // 對字母區 / 數字區 做 OCR 校正 (依規則欄位屬性)
  // v305 數字救援：改為二階遞迴 (最多 2 次) 直到穩定
  // v306 救援：混合區 [A-Z0-9] 停用單向校正 (避免合法字母 A/P 被強轉 4/9 造成全錯)
  function applyCorrectionByRule(noDash, rule) {
    if (!rule) return noDash;
    var plateWithDash = formatPlateByRule(noDash, rule);
    if (!plateWithDash) return noDash;
    var leftP = rule.regex.source.split("-")[0];
    var rightP = rule.regex.source.split("-")[1];
    var leftIsLetterOnly = /\[A-Z\]/.test(leftP) && !/0-9/.test(leftP);
    var leftIsDigitOnly = /\[0-9\]/.test(leftP) && !/A-Z/.test(leftP);
    var rightIsLetterOnly = /\[A-Z\]/.test(rightP) && !/0-9/.test(rightP);
    var rightIsDigitOnly = /\[0-9\]/.test(rightP) && !/A-Z/.test(rightP);
    function correctOne(plate) {
      var parts = plate.split("-");
      if (parts.length !== 2) return plate;
      var left = parts[0].split("").map(function (ch) {
        if (leftIsLetterOnly) return OCR_CORRECT_LETTER[ch] || ch;
        if (leftIsDigitOnly)  return OCR_CORRECT_DIGIT[ch]  || ch;
        // v306 救援：混合區 [A-Z0-9] 不做任何單向校正 (保留原字元)
        return ch;
      }).join("");
      var right = parts[1].split("").map(function (ch) {
        if (rightIsLetterOnly) return OCR_CORRECT_LETTER[ch] || ch;
        if (rightIsDigitOnly)  return OCR_CORRECT_DIGIT[ch]  || ch;
        // v306 救援：混合區不校正
        return ch;
      }).join("");
      return left + "-" + right;
    }
    var last = plateWithDash;
    for (var i = 0; i < 2; i++) {
      var next = correctOne(last);
      if (next === last) break;
      last = next;
    }
    return last;
  }

  // v305 數字救援：針對數字區做「自身相似替換」產生多路徑候選 (3↔8, 6↔0 等)
  // 為避免組合爆炸，一次只替換 1 個字元，最多回傳 3 個候選
  function generateDigitSimilar(plateWithDash, rule) {
    if (!plateWithDash || !rule) return [];
    var parts = plateWithDash.split("-");
    if (parts.length !== 2) return [];
    var rightP = rule.regex.source.split("-")[1];
    var leftP = rule.regex.source.split("-")[0];
    var rightLD = /\[0-9\]/.test(rightP) && !/A-Z/.test(rightP);
    var leftLD = /\[0-9\]/.test(leftP) && !/A-Z/.test(leftP);
    if (!rightLD && !leftLD) return [];
    var out = [];
    var targets = [];
    if (leftLD) {
      for (var li = 0; li < parts[0].length; li++) {
        var lc = parts[0][li];
        if (DIGIT_SELF_SIMILAR[lc]) {
          DIGIT_SELF_SIMILAR[lc].forEach(function (alt) {
            targets.push({ side: "L", idx: li, from: lc, to: alt });
          });
        }
      }
    }
    if (rightLD) {
      for (var ri = 0; ri < parts[1].length; ri++) {
        var rc = parts[1][ri];
        if (DIGIT_SELF_SIMILAR[rc]) {
          DIGIT_SELF_SIMILAR[rc].forEach(function (alt) {
            targets.push({ side: "R", idx: ri, from: rc, to: alt });
          });
        }
      }
    }
    for (var t = 0; t < Math.min(targets.length, 3); t++) {
      var tv = targets[t];
      var lp = parts[0].split(""), rp = parts[1].split("");
      if (tv.side === "L") lp[tv.idx] = tv.to;
      else rp[tv.idx] = tv.to;
      out.push(lp.join("") + "-" + rp.join(""));
    }
    return out;
  }

  // 依規則長度在對的位置插入 dash
  function formatPlateByRule(noDash, rule) {
    if (!rule) return formatPlate(noDash);
    var s = stripDash(noDash);
    // 以規則: A{B}-C{D} 求出 dash 應插入位置 = 左側長度量
    var src = rule.regex.source;
    var m = src.match(/^(.+?)-(.+)$/);
    if (!m) return s;
    var leftLen = avgQuantifierLen(m[1]);
    var rightLen = avgQuantifierLen(m[2]);
    var total = leftLen + rightLen;
    if (s.length < total) return null;
    // 若 s 太長，從中切長度最接近的 window
    if (s.length > total) {
      var bestWin = null; var bestDist = Infinity;
      for (var i = 0; i <= s.length - total; i++) {
        var w = s.slice(i, i + total);
        var d = 0;
        // 與規則字元屬性差異 (字母區要有字母，數字區要有數字)
        for (var k = 0; k < total; k++) {
          var c = w[k]; var isL = /[A-Z]/.test(c); var isD = /[0-9]/.test(c);
          var wantL = k < leftLen;
          if (wantL && !isL && leftLenPartIsLetter(rule)) d += 1.5;
          if (wantL && !isD && leftLenPartIsDigit(rule))  d += 1.5;
          if (!wantL && !isD && rightLenPartIsDigit(rule)) d += 1.5;
          if (!wantL && !isL && rightLenPartIsLetter(rule)) d += 1.5;
        }
        if (d < bestDist) { bestDist = d; bestWin = w; }
      }
      s = bestWin || s.slice(0, total);
    }
    return s.slice(0, leftLen) + "-" + s.slice(leftLen);
  }
  function leftLenPartIsLetter(rule){return /^\[A-Z\]/.test(rule.regex.source);}
  function leftLenPartIsDigit(rule){return /^\[0-9\]/.test(rule.regex.source);}
  function rightLenPartIsDigit(rule){return /-\[0-9\]/.test(rule.regex.source);}
  function rightLenPartIsLetter(rule){return /-\[A-Z\]/.test(rule.regex.source);}

  // v305 數字救援：位置型別評分 — 數字位是數字 / 字母位是字母 的型別檢查
  // v306 救援：改為「只扣分不加分」(型別錯誤才懲罰, 型別正確不額外獎勵) — 消除雜訊候選分數膨脹 (滿分 +18 導致雜訊打敗真實車牌)
  function scoreTypeBonus(plateWithDash, rule) {
    if (!plateWithDash || !rule) return 0;
    var parts = plateWithDash.split("-");
    if (parts.length !== 2) return 0;
    var leftP = rule.regex.source.split("-")[0];
    var rightP = rule.regex.source.split("-")[1];
    var leftLL = /\[A-Z\]/.test(leftP) && !/0-9/.test(leftP);
    var leftLD = /\[0-9\]/.test(leftP) && !/A-Z/.test(leftP);
    var rightLD = /\[0-9\]/.test(rightP) && !/A-Z/.test(rightP);
    var rightLL = /\[A-Z\]/.test(rightP) && !/0-9/.test(rightP);
    var penalty = 0;
    var left = parts[0], right = parts[1];
    for (var i = 0; i < left.length; i++) {
      var c = left[i]; var isL = /[A-Z]/.test(c); var isD = /[0-9]/.test(c);
      if (leftLL && isD) penalty -= 1.5;      // 字母區出現數字 (常見 0→O 沒校正時)
      else if (leftLD && isL) penalty -= 2;   // 數字區出現字母 (常見 O→0 沒校正時)
    }
    for (var j = 0; j < right.length; j++) {
      var d = right[j]; var rL = /[A-Z]/.test(d); var rD = /[0-9]/.test(d);
      if (rightLD && rL) penalty -= 2;        // 數字區出現字母 (這是 v304 使用者回饋數字差的主因之一: O/Q/D/A/E 被看成字母)
      else if (rightLL && rD) penalty -= 1.5; // 字母區出現數字
    }
    return penalty;
  }

  // 解析 [X]{N} 形式得到長度 (取最大值)
  function avgQuantifierLen(patternPart) {
    var m = patternPart.match(/\{(\d+)(?:,(\d+))?\}/);
    if (!m) return 1;
    return m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10);
  }

  // ------- 圖像預處理 (提升 OCR 辨識率) ---------------------------------------
  // pipeline 名稱：
  //  - original  : 原圖裁切 (對比良好的白牌)
  //  - gray      : 灰階 + 自動對比 (一般路燈/陰影)
  //  - bw        : 灰階 + Otsu 二值化 (白底黑字或黑底白字反轉)
  //  - enhance2x : 灰階 + 雙線性放大 2x + 對比增強 + 輕度銳化 (Tesseract 最佳字元大小 30-50px)
  function preprocessImage(dataUrl, pipelineName, callback) {
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      try {
        var out = applyPipeline(img, pipelineName);
        callback(null, out);
      } catch (e) { callback(e, null); }
    };
    img.onerror = function (e) { callback(e, null); };
    img.src = dataUrl;
  }

  function applyPipeline(img, name) {
    var src = document.createElement("canvas");
    src.width = img.naturalWidth || img.width;
    src.height = img.naturalHeight || img.height;
    var sctx = src.getContext("2d");
    if (!sctx) return null;
    sctx.drawImage(img, 0, 0, src.width, src.height);
    if (name === "original") return src.toDataURL("image/png");

    var data = sctx.getImageData(0, 0, src.width, src.height);
    var w = data.width; var h = data.height;
    var px = data.data;
    var gray = new Uint8ClampedArray(w * h);

    // 灰階 (Rec. 709)
    for (var i = 0, j = 0; i < px.length; i += 4, j++) {
      gray[j] = (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722) | 0;
    }

    if (name === "gray") {
      // 自動對比：丟頭尾 1% 後拉伸到 0-255
      stretchContrast(gray, 1);
      writeBackGray(px, gray, w, h);
      sctx.putImageData(data, 0, 0);
      return src.toDataURL("image/png");
    }

    if (name === "bw") {
      stretchContrast(gray, 1);
      var t = otsuThreshold(gray, w, h);
      // 多數車牌白底黑字：若前景(字)平均比背景亮，代表黑底白字 → 反轉
      invertIfNeeded(px, gray, w, h, t);
      sctx.putImageData(data, 0, 0);
      return src.toDataURL("image/png");
    }

    if (name === "enhance2x") {
      stretchContrast(gray, 1.6);  // v309 準確率 3：對比從 1.3 → 1.6 (+23%，數字圓弧/尖角更銳利
      writeBackGray(px, gray, w, h);
      sctx.putImageData(data, 0, 0);
      var dst = document.createElement("canvas");
      dst.width = w * 2; dst.height = h * 2;
      var dctx = dst.getContext("2d");
      if (!dctx) return src.toDataURL("image/png");
      dctx.imageSmoothingEnabled = true;
      dctx.imageSmoothingQuality = "high";
      dctx.drawImage(src, 0, 0, dst.width, dst.height);
      // v309 準確率 3：銳化強度 +30% (5x → 6.5x，數字 3/8、0/6、1/7 邊緣更清晰
      unsharp(dctx, dst.width, dst.height, 6.5);
      return dst.toDataURL("image/png");
    }
    return src.toDataURL("image/png");
  }

  function stretchContrast(gray, percent) {
    var hist = new Uint32Array(256);
    for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length;
    var cut = (total * (percent || 1) / 100) | 0;
    var lo = 0; var acc = 0;
    for (lo = 0; lo < 256; lo++) { if (acc + hist[lo] >= cut) break; acc += hist[lo]; }
    var hi = 255; acc = 0;
    for (hi = 255; hi >= 0; hi--) { if (acc + hist[hi] >= cut) break; acc += hist[hi]; }
    if (hi <= lo) return;
    var scale = 255 / (hi - lo);
    for (var k = 0; k < gray.length; k++) {
      var v = gray[k];
      if (v < lo) gray[k] = 0;
      else if (v > hi) gray[k] = 255;
      else gray[k] = ((v - lo) * scale) | 0;
    }
  }

  function otsuThreshold(gray, w, h) {
    var hist = new Uint32Array(256);
    var total = w * h;
    for (var i = 0; i < total; i++) hist[gray[i]]++;
    var sum = 0; for (var t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0; var wB = 0; var max = 0; var threshold = 128;
    for (var t2 = 0; t2 < 256; t2++) {
      wB += hist[t2]; if (wB === 0) continue;
      var wF = total - wB; if (wF === 0) break;
      sumB += t2 * hist[t2];
      var mB = sumB / wB;
      var mF = (sum - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; threshold = t2; }
    }
    return threshold;
  }

  function invertIfNeeded(px, gray, w, h, threshold) {
    // 計算 4 個角落平均 (背景) 與中央 60% 區域平均
    var corners = [0, w - 1, (h - 1) * w, w * h - 1];
    var bgSum = 0;
    for (var i = 0; i < corners.length; i++) bgSum += gray[corners[i]];
    var bgAvg = bgSum / corners.length;
    var cxS = Math.floor(w * 0.2), cxE = Math.floor(w * 0.8);
    var cyS = Math.floor(h * 0.2), cyE = Math.floor(h * 0.8);
    var fgSum = 0, fgN = 0;
    for (var y = cyS; y < cyE; y++) {
      for (var x = cxS; x < cxE; x++) { fgSum += gray[y * w + x]; fgN++; }
    }
    var fgAvg = fgN ? fgSum / fgN : bgAvg;
    var bgLighter = bgAvg > fgAvg;
    for (var j = 0, k2 = 0; j < px.length; j += 4, k2++) {
      var v = gray[k2] <= threshold ? 0 : 255;
      if (!bgLighter) v = 255 - v; // 反轉為白底黑字
      px[j] = px[j + 1] = px[j + 2] = v;
    }
  }

  function writeBackGray(px, gray, w, h) {
    for (var i = 0, j = 0; i < px.length; i += 4, j++) {
      px[i] = px[i + 1] = px[i + 2] = gray[j];
    }
  }

  function unsharp(ctx, w, h, strength) {
    var k = strength || 5;
    var img = ctx.getImageData(0, 0, w, h);
    var src = img.data;
    var copy = new Uint8ClampedArray(src);
    // 簡化版 3x3 銳化: kernel center=5, 四鄰=-1
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        for (var c = 0; c < 3; c++) {
          var i = ((y * w + x) * 4) + c;
          var v = k * copy[i]
            - copy[i - 4] - copy[i + 4]
            - copy[i - w * 4] - copy[i + w * 4];
          if (v < 0) v = 0; else if (v > 255) v = 255;
          src[i] = v | 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ------- 攝影機 / 頁面基礎 -----------------------------------------------
  function ensureEmbedLayout() {
    try {
      var params = new URLSearchParams(location.search || "");
      var embed = String(params.get("embed") || "").trim() === "1";
      if (!embed || !els.layout) return;
      els.layout.style.gridTemplateRows = "minmax(56px, 8vh) minmax(56px, 8vh) minmax(0, 1fr) max-content";
    } catch {}
  }

  function setProgress(msg, active) {
    if (!els.progress) return;
    var t = String(msg || "").trim();
    els.progress.textContent = t;
    els.progress.classList.toggle("active", !!(active && t.length > 0));
  }

  function flashErrorInCard(message) {
    if (!els.resultCard || !message) return;
    renderResultRaw({ error: message });
  }

  async function openCamera() {
    if (!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function")) {
      setProgress("此裝置或瀏覽器不支援攝影機，請改用手動登錄。", true);
      flashErrorInCard("此瀏覽器不支援攝影機 API，請使用手動登錄列輸入車牌。");
      return false;
    }
    closeCamera(false);
    setProgress("正在開啟攝影機（若出現權限提示請選擇「允許」）...", true);
    try {
      var constraints = {
        audio: false,
        video: {
          facingMode: { ideal: state.facing },
          width: { ideal: state.facing === "environment" ? 1920 : 1280 },
          height: { ideal: state.facing === "environment" ? 1080 : 720 },
        },
      };
      var stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.stream = stream;
      state.cameraOn = true;
      if (els.video) {
        els.video.srcObject = stream;
        try { await els.video.play(); } catch (_e) {}
      }
      if (els.placeholder) els.placeholder.classList.add("hidden");
      if (els.btnToggleLabel) els.btnToggleLabel.textContent = "關閉攝影機";
      if (els.btnCapture) els.btnCapture.disabled = false;
      if (els.scan) els.scan.classList.remove("hidden");
      if (els.capturedImg) els.capturedImg.classList.add("hidden");
      setProgress("攝影機已開啟。請將車牌置於框內，點擊「擷取辨識」或開啟自動辨識。", false);
      return true;
    } catch (err) {
      var name = err && err.name ? err.name : "";
      var msg;
      if (name === "NotAllowedError" || name === "SecurityError")
        msg = "已拒絕攝影機權限，請至瀏覽器設定 → 網站設定 → 開啟相機權限後重新整理。";
      else if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
        msg = "無法開啟指定鏡頭；若使用筆電請確認未被其他應用程式佔用。";
      else if (name === "NotReadableError")
        msg = "攝影機硬體被其他程式占用，請關閉視訊會議/條碼掃描 App 後重試。";
      else
        msg = "開啟攝影機失敗：" + (err && err.message ? err.message : "未知錯誤");
      setProgress(msg, true);
      flashErrorInCard(msg);
      state.cameraOn = false;
      return false;
    }
  }

  function closeCamera(clearHint) {
    stopAutoRec();
    if (state.stream) {
      try { state.stream.getTracks().forEach(function (t) { try { t.stop(); } catch {} }); } catch {}
      state.stream = null;
    }
    if (els.video) {
      try { els.video.pause(); } catch {}
      els.video.srcObject = null;
    }
    state.cameraOn = false;
    if (els.btnToggleLabel) els.btnToggleLabel.textContent = "開啟攝影機";
    if (els.btnCapture) els.btnCapture.disabled = true;
    if (els.scan) els.scan.classList.add("hidden");
    if (els.capturedImg) els.capturedImg.classList.add("hidden");
    if (clearHint !== false && els.placeholder) els.placeholder.classList.remove("hidden");
  }

  async function switchFacing() {
    state.facing = (state.facing === "environment" ? "user" : "environment");
    if (state.cameraOn) {
      var prev = state.facing === "environment" ? "user" : "environment";
      var ok = await openCamera();
      if (!ok) state.facing = prev;
    }
  }

  function captureFrame() {
    if (!els.canvas || !els.video) return null;
    var v = els.video;
    var w = v.videoWidth || 0; var h = v.videoHeight || 0;
    if (!w || !h) return null;
    // v309 準確率 2：先暫停視訊 → 1 幀再截圖 → 恢復播放，消除行動裝置快門動態模糊
    try { v.pause(); } catch (_eP) {}
    try {
      var c = els.canvas;
      c.width = w; c.height = h;
      var ctx = c.getContext("2d");
      if (!ctx) return null;
      try { ctx.drawImage(v, 0, 0, w, h); } catch (_e) { return null; }
      // v309 準確率 1：裁切更聚焦 2:1 車牌比例（上下 0.30/0.70、左右 0.17/0.83）
      // 車牌字元從 15-25px 提升到 Tesseract 最佳 30-50px，直接提升辨識基礎
      var cropTop = Math.round(h * 0.30), cropBottom = Math.round(h * 0.70);
      var cropLeft = Math.round(w * 0.17), cropRight = Math.round(w * 0.83);
      var croppedW = Math.max(10, cropRight - cropLeft);
      var croppedH = Math.max(10, cropBottom - cropTop);
      var tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      var tctx = tmp.getContext("2d");
      if (!tctx) return null;
      tctx.drawImage(v, 0, 0, w, h);
      c.width = croppedW; c.height = croppedH;
      var ctx2 = c.getContext("2d");
      if (!ctx2) return null;
      ctx2.drawImage(tmp, cropLeft, cropTop, croppedW, croppedH, 0, 0, croppedW, croppedH);
      try { return c.toDataURL("image/jpeg", 0.95); } catch (_e2) { return null; }
    } finally {
      try { v.play(); } catch (_ePl) {}
    }
  }

  function captureFrameWithRetry(maxAttempts) {
    var n = Math.max(1, maxAttempts || 3);
    for (var i = 0; i < n; i++) {
      var out = captureFrame();
      if (out) return out;
    }
    return null;
  }

  function showCaptured(dataUrl) {
    if (!els.capturedImg || !dataUrl) return;
    els.capturedImg.src = dataUrl;
    els.capturedImg.classList.remove("hidden");
  }

  function promiseWithTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; reject(new Error(message || "作業逾時")); }, ms);
      Promise.resolve(promise).then(
        function (val) { if (!timedOut) { clearTimeout(timer); resolve(val); } },
        function (err) { if (!timedOut) { clearTimeout(timer); reject(err); } }
      );
    });
  }

  async function warmupTesseract() {
    if (typeof Tesseract === "undefined") return false;
    if (state.ocrWarm) return true;
    setProgress("正在準備 OCR 模組（首次啟動較久，請稍候）...", true);
    try {
      var worker = await promiseWithTimeout(
        createOCRWorker(function () {}),
        OCR_TIMEOUT_MS,
        "OCR 模組預備逾時"
      );
      try { await worker.terminate(); } catch (_e) {}
      state.ocrWarm = true;
      if (!state.cameraOn) setProgress("OCR 模組就緒。點擊「開啟攝影機」後開始掃描。", false);
      else setProgress("OCR 模組就緒。請將車牌置於框內並點擊「擷取辨識」。", false);
      return true;
    } catch (err) {
      setProgress("OCR 模組預備失敗：" + (err && err.message ? err.message : err), true);
      return false;
    }
  }

  async function createOCRWorker(loggerFn) {
    var worker = await Tesseract.createWorker("eng", 1, { logger: loggerFn || function () {} });
    // 關鍵：只允許車牌會出現的字元 (A-Z 與 0-9)，大幅排除雜訊
    var letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var digits = "0123456789";
    var whitelist = letters + digits + "-";
    try {
      await worker.setParameters({
        tessedit_char_whitelist: whitelist,
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "7",           // 將整張圖視為「單行文字」，對車牌短字串最穩健 (v303 PSM 8 太過極端，導致全無輸出)
        // v309 速度 2：關閉 4 個 dawg 字典 (系統/頻率/標點/數字) — whitelist 已足夠，節省 20~40% OCR 運算時間
        load_system_dawg: "0",
        load_freq_dawg: "0",
        load_punc_dawg: "0",
        load_number_dawg: "0",
      });
    } catch (_e) {}
    return worker;
  }

  async function runSingleOCR(dataUrl, progressLabel, logger) {
    if (typeof Tesseract === "undefined") return null;
    var worker = null;
    try {
      worker = await promiseWithTimeout(
        createOCRWorker(logger),
        OCR_TIMEOUT_MS,
        progressLabel + " 逾時"
      );
      var res = await promiseWithTimeout(
        worker.recognize(dataUrl),
        OCR_TIMEOUT_MS,
        progressLabel + " 逾時"
      );
      try { await worker.terminate(); } catch {}
      worker = null;
      state.ocrWarm = true;
      return res.data;
    } catch (err) {
      try { if (worker) await worker.terminate(); } catch {}
      throw err;
    } finally {
      try { if (worker) await worker.terminate(); } catch {}
    }
  }

  // ------- 多路徑 OCR 主流程 ----------------------------------------------
  async function runOCRAggregate(originalDataUrl) {
    if (state.ocrBusy) return null;
    if (typeof Tesseract === "undefined") {
      setProgress("OCR 模組尚未載入；請確認網路連線後重新整理頁面。", true);
      flashErrorInCard("OCR 引擎 (Tesseract.js) 無法載入。請確認：1) 裝置有網際網路 2) 未被擋廣告套件擋下 jsdelivr CDN。");
      return null;
    }
    state.ocrBusy = true;
    try {
      // 產生 4 種預處理圖 (original 優先作為最穩健基線；命中即可提早中斷節省時間)
      var processed = {};
      var pipelines = ["original", "enhance2x", "bw", "gray"];
      setProgress("正在做圖像預處理並辨識 (1/" + pipelines.length + ")...", true);
      for (var i = 0; i < pipelines.length; i++) {
        var name = pipelines[i];
        if (name === "original") { processed[name] = originalDataUrl; continue; }
        processed[name] = await new Promise(function (resolve) {
          preprocessImage(originalDataUrl, name, function (e, d) { resolve(e ? null : d); });
        });
        if (!processed[name]) processed[name] = originalDataUrl;
      }

      // 依序對每個 pipeline OCR；若有任一達到完美匹配（高分），提前中斷
      var allCandidates = [];
      var perfect = false;
      for (var k2 = 0; k2 < pipelines.length; k2++) {
        var pn = pipelines[k2];
        var label = "辨識 (" + (k2 + 1) + "/" + pipelines.length + ") - " + pn;
        setProgress(label + " ...", true);
        try {
          var d = await runSingleOCR(processed[pn], label, function (m) {
            if (m && m.status && typeof m.progress === "number") {
              var pct = Math.round(m.progress * 100);
              setProgress(label + " " + pct + "%", true);
            }
          });
          var agg = aggregateCandidates(d ? d.text : "", d ? d.confidence : 0, pn);
          for (var j = 0; j < agg.length; j++) allCandidates.push(agg[j]);
          // 提早中斷條件: 已出現 score >= 90 的高信心候選
          for (var m = 0; m < agg.length; m++) {
            if (agg[m].score && agg[m].score >= 80) { perfect = true; break; } // v309 速度 1：提早中斷門檻 90→80，節省後續 2~3 次 OCR
          }
          if (perfect) break;
        } catch (eOcr) { /* 繼續其他 pipeline */ }
      }

      // 用台灣車牌規則 + OCR 信心度 選出最佳
      var chosen = chooseBestPlate(allCandidates, state.currentType);
      return chosen;
    } finally {
      state.ocrBusy = false;
    }
  }

  // 從 OCR 文字 (可能多行) 萃取出候選車牌 (帶評分)
  function aggregateCandidates(rawText, ocrConfidence, pipeline) {
    var text = String(rawText || "");
    var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var rawSeeds = [];
    lines.forEach(function (line) {
      var l = line.toUpperCase();
      rawSeeds.push(l);
      var tokens = l.split(/\s+/).filter(Boolean);
      tokens.forEach(function (t) { rawSeeds.push(t); });
      var segs = l.split(/[^\w\-]+/).filter(Boolean);
      segs.forEach(function (s) { rawSeeds.push(s); });
      // 去除所有分隔，再嘗試每個 dash 位置
      var joined = l.replace(/[^A-Z0-9]/g, "");
      if (joined.length >= 4 && joined.length <= 9) {
        var dss = tryAllDashes(joined);
        dss.forEach(function (ds) { rawSeeds.push(ds); });
        // 滑動視窗: 車牌 5~8 字元，若太長取子字串
        for (var w = 4; w <= 8; w++) {
          for (var i = 0; i + w <= joined.length; i++) {
            var sub = joined.slice(i, i + w);
            rawSeeds.push(sub);
            var subDash = tryAllDashes(sub);
            subDash.forEach(function (sd) { rawSeeds.push(sd); });
          }
        }
      }
    });

    // 對每個 seed: 正規化 → 嘗試每條規則 → 套用字元校正 → 重新比對規則算分
    var results = [];
    var seen = {};
    for (var s = 0; s < rawSeeds.length; s++) {
      var seed = rawSeeds[s];
      var norm = normalizePlate(seed);
      if (!norm) continue;
      var noDash = stripDash(norm);
      if (noDash.length < 4 || noDash.length > 9) continue;

      // 針對每條規則: 嘗試依格式長度切 dash → 校正字母/數字區 → 重新評分
      for (var r = 0; r < TW_RULES.length; r++) {
        var rule = TW_RULES[r];
        var byRule = formatPlateByRule(noDash, rule);
        if (!byRule) continue;
        var corrected = applyCorrectionByRule(noDash, rule);
        var candidates2 = [byRule, corrected];
        // 也嘗試 "未校正但 formatPlate 產生的版本"
        var fp = formatPlate(noDash);
        if (fp && candidates2.indexOf(fp) === -1) candidates2.push(fp);
        // v309 準確率 4：generateDigitSimilar 本身 L230 有 rightLD/leftLD 純數字區防護，且 v308 已撤銷型別加分，故安全開啟
        // 只作用在純數字區 (8/6、0/9、3/8 混淆替換產生多路徑候選，最多 3 個，解決 v304 數字準確率低的症狀)
        var sims = generateDigitSimilar(corrected, rule);
        for (var si = 0; si < sims.length; si++) {
          if (candidates2.indexOf(sims[si]) === -1) candidates2.push(sims[si]);
        }

        for (var k = 0; k < candidates2.length; k++) {
          var plate = candidates2[k];
          var match = matchTWFormat(plate);
          if (!match) continue;
          // 計算原始 OCR 到最終字串的字元編輯距離 (字母↔數字校正 算半分)
          var edits = estimateEdits(noDash, stripDash(plate));
          // v308 救援：回到 v304 穩健評分基礎 (最後一個使用者說「有改善」的版本)
          //   - 完全不呼叫 scoreTypeBonus (v305~v307 加減法造成連續惡化, 全數撤銷)
          //   - edits 扣分權重回到 v304 的 -2.5 (v307 的 -2.0 刪除)
          var finalScore = match.score - edits * 2.5 + (ocrConfidence || 0) * 0.40;
          // v305 數字救援 + v307 評分優化: 位置型別評分 全數撤銷 (不穩定)
          // if (k === 1) finalScore += scoreTypeBonus(plate, rule);
          // pipeline 加權: enhance2x=5 (放大 2x 後字元大小接近 Tesseract 最佳) / original=3 / bw=2 / gray=0
          if (pipeline === "enhance2x") finalScore += 5;
          else if (pipeline === "original") finalScore += 3;
          else if (pipeline === "bw") finalScore += 2;
          // 使用者目前選擇的車種加成 (car/moto)
          if (state.currentType === "car"  && rule.type === "car")  finalScore += 6;
          if (state.currentType === "moto" && rule.type === "moto") finalScore += 6;
          var key = plate + "|" + rule.key;
          if (seen[key] != null && seen[key] >= finalScore) continue;
          seen[key] = finalScore;
          results.push({
            plate: plate, score: finalScore,
            rule: rule, edits: edits,
            confidence: Math.max(0, Math.min(100, Math.round((ocrConfidence || 0) * 0.4 + Math.max(0, Math.min(100, finalScore)) * 0.6))),
            pipeline: pipeline, rawOCR: text,
          });
        }
      }
    }
    // 單純 "有格式但未匹配規則" 的 fallback 候選 (至少能讓使用者手動修)
    if (!results.length) {
      var anyFmt = formatPlate(noDash);
      if (anyFmt && anyFmt.length >= 5) {
        results.push({
          plate: anyFmt, score: 10,
          rule: null, edits: 0,
          confidence: Math.max(20, Math.min(60, Math.round(ocrConfidence || 50))),
          pipeline: pipeline, rawOCR: text,
        });
      }
    }
    return results;
  }

  function estimateEdits(aDashless, bDashless) {
    var a = String(aDashless || ""), b = String(bDashless || "");
    if (a === b) return 0;
    // 取較短者長度做逐一比對 (若長度不同則差值直接算 edit)
    var n = Math.min(a.length, b.length);
    var diff = Math.abs(a.length - b.length);
    for (var i = 0; i < n; i++) {
      if (a[i] !== b[i]) {
        // v308 救援: 回到 v304 穩定版 (只用 OCR_CORRECT_ALNUM 雙向校正算半分)
        // v307 的 DIGIT_SELF_SIMILAR 半分擴充在此撤銷 (造成連續惡化不穩定)
        var ca = OCR_CORRECT_ALNUM[a[i]];
        var cb = OCR_CORRECT_ALNUM[b[i]];
        if (ca === b[i] || cb === a[i] || (ca && ca === cb)) diff += 0.5;
        else diff += 1;
      }
    }
    return diff;
  }

  // 從數千筆候選中挑選最佳 (分數最高，分數相同以較少 edits 優先)
  function chooseBestPlate(candidates, preferredType) {
    if (!candidates || !candidates.length) {
      return { plate: "", confidence: 0, rule: null, score: 0, edits: 0, pipeline: "", rawOCR: "" };
    }
    candidates.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if ((a.edits || 0) !== (b.edits || 0)) return (a.edits || 0) - (b.edits || 0);
      return (b.confidence || 0) - (a.confidence || 0);
    });
    var best = candidates[0];
    // --- 關鍵: 極低信心門檻 (score < 10) 才視為失敗；v308 雙保險
    //   - v303 門檻 40 太高導致全部被擋掉 (致命反模式)
    //   - v304/v305/v306 門檻 20 仍不穩定 (v307 出現全未偵測到)
    //   - v308 再降到 10: 即使 edits 多 + 管線加權低, 也至少能輸出 (手動微調可接受)
    if (!best || (best.score || 0) < 10) {
      return { plate: "", confidence: 0, rule: null, score: best ? best.score : 0, edits: 0, pipeline: "", rawOCR: (best && best.rawOCR) || "" };
    }
    // 若使用者選的是 moto，但最佳解是 car 且分數差距 < 6，則退回同型的最高分
    if (preferredType && best.rule && best.rule.type !== preferredType) {
      for (var i = 1; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.rule && c.rule.type === preferredType && (best.score - c.score) < 6) {
          best = c; break;
        }
      }
    }
    return {
      plate: best.plate,
      confidence: best.confidence || 0,
      rule: best.rule || null,
      score: best.score || 0,
      edits: best.edits || 0,
      pipeline: best.pipeline || "",
      rawOCR: best.rawOCR || "",
    };
  }

  function renderResultRaw(opts) {
    if (!els.resultCard) return;
    els.resultCard.classList.remove("hidden");
    if (els.subLabel) els.subLabel.textContent = "";
    if (opts && opts.error) {
      if (els.plateDisplay) {
        els.plateDisplay.style.color = "#b91c1c";
        els.plateDisplay.style.fontSize = "16px";
        els.plateDisplay.style.letterSpacing = "0";
        els.plateDisplay.textContent = opts.error;
      }
      if (els.resultBadge) els.resultBadge.textContent = "錯誤";
      if (els.plateInput) els.plateInput.value = "";
      if (els.confFill) els.confFill.style.width = "0%";
      if (els.confText) els.confText.textContent = "— %";
    } else {
      if (els.plateDisplay) {
        els.plateDisplay.style.color = "";
        els.plateDisplay.style.fontSize = "";
        els.plateDisplay.style.letterSpacing = "";
      }
    }
    scrollResultIntoView();
  }

  function renderResult(best) {
    var plate = best ? best.plate : "";
    var confidence = best ? (best.confidence || 0) : 0;
    var vehicleType = (best && best.rule) ? best.rule.type : state.currentType;
    var subLabel = (best && best.rule) ? best.rule.label : "未知格式";
    state.lastResult = { plate: plate, confidence: confidence, type: vehicleType, rule: best && best.rule };
    if (els.resultCard) els.resultCard.classList.remove("hidden");
    if (els.resultBadge) {
      els.resultBadge.textContent = vehicleType === "moto" ? "機車" : "汽車";
      els.resultBadge.className = "plate-badge " + (vehicleType === "moto" ? "moto" : "car");
    }
    if (els.subLabel) {
      els.subLabel.textContent = subLabel + (best && best.pipeline ? " ‧ " + best.pipeline : "");
      els.subLabel.style.display = "block";
      els.subLabel.style.marginBottom = "8px";
      els.subLabel.style.fontSize = "12px";
      els.subLabel.style.color = "#6b7280";
      els.subLabel.style.fontWeight = "700";
      els.subLabel.style.textAlign = "center";
    }
    if (els.plateDisplay) {
      els.plateDisplay.style.color = "";
      els.plateDisplay.style.fontSize = "";
      els.plateDisplay.style.letterSpacing = "";
    }
    var display = plate ? formatPlate(plate) : "（未偵測到，請手動輸入）";
    if (els.plateDisplay) els.plateDisplay.textContent = display;
    if (els.plateInput) els.plateInput.value = stripDash(plate);
    var pct = Math.max(0, Math.min(100, Number(confidence) || 0));
    if (els.confFill) els.confFill.style.width = pct + "%";
    if (els.confText) els.confText.textContent = pct + " %";
    if (els.resultTypeSwitch) {
      els.resultTypeSwitch.querySelectorAll("button").forEach(function (b) {
        b.classList.toggle("active", String(b.dataset.rtype || "") === vehicleType);
      });
    }
    switchResultType(vehicleType);
    scrollResultIntoView();
  }

  function scrollResultIntoView() {
    if (!els.resultCard) return;
    try {
      if (typeof els.resultCard.scrollIntoView === "function") {
        els.resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (_e) {}
  }

  function switchResultType(type) {
    var t = String(type || "car");
    state.currentType = t;
    if (state.lastResult) state.lastResult.type = t;
    if (els.resultBadge && (!state.lastResult || !state.lastResult.rule)) {
      els.resultBadge.textContent = t === "moto" ? "機車" : "汽車";
      els.resultBadge.className = "plate-badge " + (t === "moto" ? "moto" : "car");
    }
    if (els.typeCar) els.typeCar.classList.toggle("active", t === "car");
    if (els.typeMoto) els.typeMoto.classList.toggle("active", t === "moto");
  }

  async function doCaptureAndRecognize() {
    if (!state.cameraOn) {
      setProgress("請先點擊「開啟攝影機」後再進行辨識。", true);
      return;
    }
    var dataUrl = captureFrameWithRetry(3);
    if (!dataUrl) {
      var msg = "尚未取得影像串流（畫面尚未就緒）。請等待 1~2 秒讓攝影機啟動完成後再嘗試。";
      setProgress(msg, true);
      flashErrorInCard(msg);
      return;
    }
    showCaptured(dataUrl);
    var best = await runOCRAggregate(dataUrl);
    if (!best || !best.plate) {
      var noPlateMsg = "未偵測到符合台灣車牌格式的字串。建議：①靠近車牌 20~40 公分 ②光線充足無反光 ③角度正面；仍失敗可手動輸入下方。";
      setProgress(noPlateMsg, true);
      flashErrorInCard(noPlateMsg);
      state.lastResult = null;
      return;
    }
    renderResult(best);
    var score = best.score || 0;
    var suggest = score >= 95 ? "信心度高，可直接儲存。"
      : (score >= 70 ? "建議核對字元是否正確，再按下「儲存」。"
                   : "字元可能有誤，請手動修正後再儲存。");
    setProgress("辨識完成：" + (best.rule ? best.rule.label : "") + " 信心度 " + (best.confidence || 0) + "%。" + suggest, score >= 95 ? false : true);
  }

  function startAutoRec() {
    if (state.autoTimer) return;
    if (!state.cameraOn) {
      setProgress("請先開啟攝影機，再啟用自動辨識。", true);
      return;
    }
    state.autoRec = true;
    if (els.btnAuto) els.btnAuto.setAttribute("aria-pressed", "true");
    if (els.btnAutoLabel) els.btnAutoLabel.textContent = "自動辨識：開";
    if (els.btnAuto) { els.btnAuto.classList.add("cam-btn-primary"); els.btnAuto.classList.remove("cam-btn-ghost"); }
    setProgress("自動辨識已開啟，每 3 秒自動擷取一次。", false);
    var tick = async function () {
      if (!state.autoRec) return;
      if (state.cameraOn && !state.ocrBusy) { await doCaptureAndRecognize(); }
      state.autoTimer = setTimeout(tick, 3000);
    };
    state.autoTimer = setTimeout(tick, 1500);
  }

  function stopAutoRec() {
    state.autoRec = false;
    if (state.autoTimer) { clearTimeout(state.autoTimer); state.autoTimer = null; }
    if (els.btnAuto) els.btnAuto.setAttribute("aria-pressed", "false");
    if (els.btnAutoLabel) els.btnAutoLabel.textContent = "自動辨識：關";
    if (els.btnAuto) { els.btnAuto.classList.remove("cam-btn-primary"); els.btnAuto.classList.add("cam-btn-ghost"); }
  }

  // ------- 歷史紀錄 ---------------------------------------------------------
  function loadRecords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { state.records = []; return; }
      var arr = JSON.parse(raw);
      state.records = Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch (_e) { state.records = []; }
  }
  function saveRecords() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records.slice(0, MAX_HISTORY))); }
    catch (_e) {}
  }
  function addRecord(record) {
    var now = Date.now();
    var r = Object.assign({
      id: "r_" + now + "_" + Math.random().toString(36).slice(2, 8),
      createdAt: now, plate: "", type: "car", confidence: 0,
      image: "", source: "capture", ruleKey: "", ruleLabel: "",
    }, record || {});
    state.records.unshift(r);
    if (state.records.length > MAX_HISTORY) state.records = state.records.slice(0, MAX_HISTORY);
    saveRecords(); renderHistory();
  }
  function renderHistory() {
    if (!els.historyList) return;
    if (!state.records.length) {
      els.historyList.innerHTML = '<div class="empty-state">尚無辨識紀錄</div>'; return;
    }
    els.historyList.innerHTML = state.records.map(function (r) {
      var typeText = String(r.type || "car") === "moto" ? "機車" : "汽車";
      var badgeCls = String(r.type || "car") === "moto" ? "moto" : "car";
      var srcText = String(r.source || "capture") === "manual" ? "手動登錄" : "攝影辨識";
      var conf = Math.max(0, Math.min(100, Number(r.confidence) || 0));
      var display = formatPlate(r.plate) || "—";
      var thumb = r.image ? ("<img src=\"" + escapeHtml(r.image) + "\" alt=\"\" />") : "";
      var placeholderThumb = "<div style=\"width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-weight:900;\">" + (typeText === "機車" ? "🏍️" : "🚗") + "</div>";
      var ruleTag = r.ruleLabel ? ("<span class=\"plate-badge\" style=\"margin-left:6px;background:rgba(255,255,255,0.6);color:#374151;border-color:#d1d5db;\">" + escapeHtml(r.ruleLabel) + "</span>") : "";
      return ("<div class=\"history-item\" data-id=\"" + escapeHtml(String(r.id || "")) + "\">" +
        "<div class=\"history-thumb\">" + (thumb || placeholderThumb) + "</div>" +
        "<div style=\"min-width:0;\">" +
          "<div style=\"display:flex;align-items:center;gap:8px;flex-wrap:wrap;\">" +
            "<div class=\"history-plate\">" + escapeHtml(display) + "</div>" +
            "<span class=\"plate-badge " + badgeCls + "\">" + typeText + "</span>" + ruleTag +
          "</div>" +
          "<div class=\"history-meta\">" + escapeHtml(formatDateTime(r.createdAt)) + " · " + escapeHtml(srcText) + (conf ? (" · 信心度 " + conf + "%") : "") + "</div>" +
        "</div>" +
        "<button class=\"cam-btn cam-btn-ghost\" type=\"button\" style=\"padding:0 10px;min-height:36px;\" data-del=\"" + escapeHtml(String(r.id || "")) + "\" aria-label=\"刪除紀錄\">" +
          "<svg viewBox=\"0 0 24 24\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"width:18px;height:18px;\"><polyline points=\"3 6 5 6 21 6\"/><path d=\"M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6\"/><path d=\"M10 11v6M14 11v6\"/><path d=\"M17 6V4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2\"/></svg>" +
        "</button></div>");
    }).join("");
    els.historyList.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = String(btn.getAttribute("data-del") || "").trim();
        if (!id) return;
        var ok = confirm("確定要刪除此筆紀錄？");
        if (!ok) return;
        state.records = state.records.filter(function (r) { return String(r.id || "") !== id; });
        saveRecords(); renderHistory();
      });
    });
  }

  // ------- 事件綁定 --------------------------------------------------------
  function bindTabs() {
    if (!els.tabs) return;
    els.tabs.querySelectorAll(".tab-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        var tab = String(b.dataset.tab || "").trim();
        if (!tab) return;
        els.tabs.querySelectorAll(".tab-btn").forEach(function (x) { x.classList.toggle("active", x === b); });
        var isCam = tab === "camera";
        if (els.cameraPanel) els.cameraPanel.classList.toggle("hidden", !isCam);
        if (els.historyPanel) els.historyPanel.classList.toggle("hidden", isCam);
        if (!isCam) renderHistory();
      });
    });
  }

  function bindTypeSwitch() {
    [els.typeCar, els.typeMoto].forEach(function (b) {
      if (!b) return;
      b.addEventListener("click", function () { switchResultType(String(b.dataset.type || "car")); });
    });
    if (els.resultTypeSwitch) {
      els.resultTypeSwitch.querySelectorAll("button").forEach(function (b) {
        b.addEventListener("click", function () { switchResultType(String(b.dataset.rtype || "car")); });
      });
    }
  }

  function bindCameraButtons() {
    if (els.btnToggle) {
      els.btnToggle.addEventListener("click", async function () {
        if (state.cameraOn) { closeCamera(); setProgress("攝影機已關閉。", false); }
        else { var ok = await openCamera(); if (ok) warmupTesseract(); }
      });
    }
    if (els.btnFacing) els.btnFacing.addEventListener("click", function () { switchFacing(); });
    if (els.btnCapture) {
      els.btnCapture.addEventListener("click", function () {
        if (!state.ocrWarm) warmupTesseract().then(function () { doCaptureAndRecognize(); });
        else doCaptureAndRecognize();
      });
    }
    if (els.btnAuto) {
      els.btnAuto.addEventListener("click", function () {
        if (!state.cameraOn) { setProgress("請先開啟攝影機再使用自動辨識。", true); return; }
        if (state.autoRec) stopAutoRec();
        else { if (!state.ocrWarm) warmupTesseract().then(function () { startAutoRec(); }); else startAutoRec(); }
      });
    }
  }

  function bindSaveButtons() {
    if (els.btnSave) {
      els.btnSave.addEventListener("click", function () {
        var raw = els.plateInput ? els.plateInput.value : "";
        var plate = normalizePlate(raw);
        if (!plate) { alert("請先辨識或在結果區的輸入框輸入車牌號碼。"); return; }
        var type = state.lastResult ? state.lastResult.type : state.currentType;
        var conf = state.lastResult ? state.lastResult.confidence : 0;
        var image = (els.capturedImg && !els.capturedImg.classList.contains("hidden")) ? els.capturedImg.src : "";
        var src = (state.lastResult && state.lastResult.plate) ? "capture" : "manual";
        var rule = state.lastResult && state.lastResult.rule;
        addRecord({ plate: plate, type: type, confidence: conf, image: image, source: src, ruleKey: rule ? rule.key : "", ruleLabel: rule ? rule.label : "" });
        setProgress("已儲存：" + formatPlate(plate) + "（" + (type === "moto" ? "機車" : "汽車") + "）", false);
        if (els.resultCard) els.resultCard.classList.add("hidden");
        state.lastResult = null;
      });
    }
    if (els.btnManual) {
      els.btnManual.addEventListener("click", function () {
        var raw = els.manualPlate ? els.manualPlate.value : "";
        var plate = normalizePlate(raw);
        if (!plate) { alert("請輸入車牌號碼。"); return; }
        var type = String(els.manualType ? els.manualType.value : "car");
        // 手動輸入仍嘗試匹配規則，存入 ruleLabel 方便識別
        var dash = formatPlate(plate);
        var match = matchTWFormat(dash);
        addRecord({ plate: dash, type: type, confidence: 0, image: "", source: "manual", ruleKey: match ? match.rule.key : "", ruleLabel: match ? match.rule.label : "" });
        if (els.manualPlate) els.manualPlate.value = "";
        setProgress("已手動登錄：" + formatPlate(plate) + "（" + (type === "moto" ? "機車" : "汽車") + "）", false);
      });
    }
    if (els.btnClearHistory) {
      els.btnClearHistory.addEventListener("click", function () {
        if (!state.records.length) return;
        var ok = confirm("確定要清空所有辨識紀錄？此動作無法復原。");
        if (!ok) return;
        state.records = []; saveRecords(); renderHistory();
      });
    }
  }

  function resolveCommunityId() {
    var STORAGE = "csp_active_community_v1", keyFromUrl = "", saved = "";
    try { keyFromUrl = String(new URLSearchParams(location.search).get("c") || "").trim(); } catch (_e) {}
    try { saved = String(localStorage.getItem(STORAGE) || "").trim(); } catch (_e) {}
    return keyFromUrl || saved || "default";
  }

  function onVisibility() {
    document.addEventListener("visibilitychange", function () { if (document.hidden && state.cameraOn) stopAutoRec(); });
    window.addEventListener("beforeunload", function () { closeCamera(false); });
  }

  function initHintForUnsupportedMedia() {
    if (!els.hint) return;
    var hasMD = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
    if (!hasMD) els.hint.textContent = "此瀏覽器不支援攝影機，請使用下方手動登錄";
  }

  function init() {
    elInit();
    state.currentCommunityId = resolveCommunityId();
    try {
      var fb = typeof firebase !== "undefined" ? firebase : null;
      if (fb && fb.auth && typeof fb.auth === "function") {
        try {
          var user = fb.auth().currentUser;
          if (user) state.currentUserId = String(user.uid || "");
          fb.auth().onAuthStateChanged(function (u) { state.currentUserId = u ? String(u.uid || "") : ""; });
        } catch (_e) {}
      }
    } catch (_e) {}
    loadRecords(); ensureEmbedLayout();
    bindTabs(); bindTypeSwitch(); bindCameraButtons(); bindSaveButtons();
    onVisibility(); renderHistory(); initHintForUnsupportedMedia();
    if (typeof Tesseract !== "undefined") setTimeout(function () { warmupTesseract(); }, 400);
    else {
      setProgress("OCR 引擎未載入（需連網）。仍可使用手動登錄。", true);
      flashErrorInCard("OCR 引擎 (Tesseract.js) 未從 CDN 載入。請檢查網路或關閉擋廣告套件後重新整理，仍可改以手動登錄輸入車牌。");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
