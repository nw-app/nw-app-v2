/* 社區前台｜長者簡易版（special-member.html）
   目標使用者：不熟悉 APP 操作、視力或操作能力較弱的使用者。
   設計取捨：
   - 只用 Firebase Auth + Firestore，不引入其他框架
   - 包裹／公告直接在頁面上用超大文字呈現（不跳頁）
   - 訪客登記／公設預約／水電繳費沿用既有模組頁（以全螢幕面板嵌入）
   - 任何面板都有一顆超大「回上一頁」
   - 瀏覽器返回鍵＝關閉面板，避免使用者迷路
*/
(function () {
  "use strict";

  var firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");
  try { firebase.initializeApp(firebaseConfig); } catch (e) {}

  var auth = firebase.auth();
  var db = firebase.firestore();
  var FieldValue = firebase.firestore.FieldValue;

  var STORAGE_SCALE = "csp_special_scale_v1";
  var STORAGE_VOICE = "csp_special_voice_v1";
  var STORAGE_MEMBER_SETTINGS = "csp_member_settings_v1";
  var STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";

  var SCALES = [1, 1.15, 1.32, 1.5];

  var state = {
    uid: "",
    profile: {},
    cid: "",
    code: "",
    communityName: "",
    scale: 1,
    voice: true,
    parcels: [],
    bulletins: [],
    parcelError: false,
  };

  var el = {
    grid: document.getElementById("spGrid"),
    home: document.querySelector(".sp-home"),
    sosCard: document.querySelector(".sp-sos-card"),
    noticeCard: document.getElementById("spNoticeCard"),
    noticeTitle: document.getElementById("spNoticeTitle"),
    noticeText: document.getElementById("spNoticeText"),
    noticeCount: document.getElementById("spNoticeCount"),
    navBadge: document.getElementById("spNavBadge"),
    todayDate: document.getElementById("spTodayDate"),
    todayWeekday: document.getElementById("spTodayWeekday"),
    communityName: document.getElementById("spCommunityName"),
    greetingLine: document.getElementById("spGreetingLine"),
    avatarImg: document.getElementById("spAvatarImg"),
    avatarInitial: document.getElementById("spAvatarInitial"),
    avatar: document.getElementById("spAvatar"),
    userName: document.getElementById("spUserName"),
    greetName: document.getElementById("spGreetName"),
    greetUnit: document.getElementById("spGreetUnit"),
    greetUnitText: document.getElementById("spGreetUnitText"),
    parcelBadge: document.getElementById("spParcelBadge"),
    fontDown: document.getElementById("spFontDown"),
    fontUp: document.getElementById("spFontUp"),
    fontStatus: document.getElementById("spFontStatus"),
    voiceToggle: document.getElementById("spVoiceToggle"),
    voiceText: document.getElementById("spVoiceText"),
    signOut: document.getElementById("spSignOut"),
    homeNav: document.getElementById("spHomeNav"),
    noticeNav: document.getElementById("spNoticeNav"),
    supportNav: document.getElementById("spSupportNav"),
    profileNav: document.getElementById("spProfileNav"),
    mic: document.getElementById("spMic"),
    micText: document.getElementById("spMicText"),
    sheet: document.getElementById("spSheet"),
    sheetTitle: document.getElementById("spSheetTitle"),
    sheetBody: document.getElementById("spSheetBody"),
    sheetBack: document.getElementById("spSheetBack"),
    sheetSpeak: document.getElementById("spSheetSpeak"),
    dialog: document.getElementById("spDialog"),
    dialogIcon: document.getElementById("spDialogIcon"),
    dialogTitle: document.getElementById("spDialogTitle"),
    dialogText: document.getElementById("spDialogText"),
    dialogOk: document.getElementById("spDialogOk"),
    dialogCancel: document.getElementById("spDialogCancel"),
    toast: document.getElementById("spToast"),
  };

  /* ---------------- 小工具 ---------------- */

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeDash(value) {
    return String(value || "").replace(/[－–—]/g, "-").trim();
  }

  function tsToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") {
      try { return value.toDate(); } catch (e) { return null; }
    }
    if (value instanceof Date) return value;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function fmtDate(d) {
    if (!d) return "";
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmtTime(d) {
    if (!d) return "";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function fmtDateTime(d) {
    if (!d) return "";
    return fmtDate(d) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  var toastTimer = null;
  function toast(message) {
    if (!el.toast) return;
    el.toast.textContent = String(message || "");
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.hidden = true;
    }, 2800);
  }

  /* ---------------- 語音輸入（用講的開啟功能） ---------------- */

  var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;

  var voiceCtl = {
    supported: Boolean(SpeechRec),
    rec: null,
    listening: false,
    want: false,
    suspended: false,
    blocked: false,
    tapped: false,
    timer: null,
    delay: 600,
  };

  // 每個功能對應長輩可能講出來的幾個講法
  var VOICE_COMMANDS = [
    { action: "back", words: ["回上一頁", "關起來", "關閉", "返回", "上一頁", "不要了"] },
    { action: "signout", words: ["登出"] },
    { action: "parcel", words: ["包裹", "郵件", "快遞", "掛號"] },
    { action: "bulletin", words: ["公告", "布告", "消息", "通知"] },
    { action: "visitor", words: ["訪客", "客人", "有人來", "登記"] },
    { action: "facility", words: ["公設", "預約", "健身房", "教室", "設施"] },
    { action: "meter", words: ["水電", "繳費", "費用", "帳單", "電費", "水費", "度數"] },
    { action: "sos", words: ["求救", "救命", "求助", "救護車"] },
    { action: "bigger", words: ["字大", "字變大"] },
    { action: "smaller", words: ["字小", "字變小"] },
  ];

  function matchVoiceCommand(text) {
    var t = String(text || "").replace(/[\s,，。、！!？?；;：:]/g, "");
    if (!t) return "";
    var hit = "";
    var hitLen = 0;
    VOICE_COMMANDS.forEach(function (cmd) {
      cmd.words.forEach(function (w) {
        if (t.indexOf(w) >= 0 && w.length > hitLen) { hit = cmd.action; hitLen = w.length; }
      });
    });
    return hit;
  }

  function runVoiceCommand(action) {
    if (action === "back") {
      if (sheetOpen) hideSheet(false);
      else toast("已經在前面了");
      return;
    }
    if (action === "signout") {
      if (el.signOut) el.signOut.click();
      return;
    }
    if (action === "bigger") { stepScale(1); return; }
    if (action === "smaller") { stepScale(-1); return; }
    handleAction(action);
  }

  function renderMic() {
    if (!el.mic) return;
    if (!voiceCtl.supported) { el.mic.hidden = true; return; }
    el.mic.hidden = false;
    el.mic.classList.toggle("is-listening", voiceCtl.listening);
    el.mic.setAttribute("aria-pressed", voiceCtl.listening ? "true" : "false");
    if (el.micText) {
      el.micText.textContent = voiceCtl.listening ? "正在聽" : voiceCtl.want ? "準備中" : voiceCtl.blocked ? "點我開麥" : "語音";
    }
  }

  function voiceRestart(delay) {
    if (!voiceCtl.supported) return;
    clearTimeout(voiceCtl.timer);
    voiceCtl.timer = setTimeout(function () { voiceStart(); }, typeof delay === "number" ? delay : voiceCtl.delay);
  }

  function voiceStart() {
    if (!voiceCtl.supported || !voiceCtl.rec || voiceCtl.suspended) return;
    voiceCtl.want = true;
    renderMic();
    if (voiceCtl.listening) return;
    try { voiceCtl.rec.start(); } catch (e) {}
  }

  function voiceStop() {
    voiceCtl.want = false;
    clearTimeout(voiceCtl.timer);
    if (voiceCtl.rec) { try { voiceCtl.rec.stop(); } catch (e) {} }
    voiceCtl.listening = false;
    renderMic();
  }

  function initVoice() {
    if (!voiceCtl.supported) { renderMic(); return; }

    var rec = new SpeechRec();
    rec.lang = "zh-TW";
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    rec.onstart = function () {
      voiceCtl.listening = true;
      voiceCtl.blocked = false;
      voiceCtl.delay = 600;
      renderMic();
    };
    rec.onresult = function (ev) {
      var last = ev.results[ev.results.length - 1];
      if (!last || !last.isFinal) return;
      for (var i = 0; i < last.length; i++) {
        var action = matchVoiceCommand(last[i] && last[i].transcript);
        if (action) { runVoiceCommand(action); return; }
      }
    };
    rec.onerror = function (ev) {
      var err = String((ev && ev.error) || "");
      if (err === "not-allowed" || err === "service-not-allowed") {
        voiceCtl.want = false;
        voiceCtl.listening = false;
        voiceCtl.blocked = true;
        renderMic();
        return;
      }
      if (err === "network") voiceCtl.delay = 2500;
    };
    rec.onend = function () {
      voiceCtl.listening = false;
      renderMic();
      if (voiceCtl.want && !voiceCtl.suspended) voiceRestart();
    };

    voiceCtl.rec = rec;
    renderMic();
    // 開頁就先試著聽；若權限尚未給過，等第一次觸控再自動接手
    voiceStart();
    document.addEventListener("pointerdown", function (ev) {
      if (voiceCtl.tapped) return;
      if (el.mic && ev.target && ev.target.closest && ev.target.closest("#spMic")) return;
      voiceCtl.tapped = true;
      if (!voiceCtl.want && !voiceCtl.listening) voiceStart();
    });
  }

  /* ---------------- 語音報讀 ---------------- */

  function speak(text) {
    if (!state.voice) return;
    var msg = String(text || "").trim();
    if (!msg || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(msg);
      u.lang = "zh-TW";
      u.rate = 0.88;
      // 播放時暫停收音，避免把自己的聲音聽成指令
      u.onstart = function () {
        voiceCtl.suspended = true;
        if (voiceCtl.rec) { try { voiceCtl.rec.stop(); } catch (e) {} }
      };
      var resume = function () {
        voiceCtl.suspended = false;
        if (voiceCtl.want) voiceRestart();
      };
      u.onend = resume;
      u.onerror = resume;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function stopSpeak() {
    if (!("speechSynthesis" in window)) return;
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }

  /* ---------------- 字級 ---------------- */

  function applyScale(scale) {
    state.scale = scale;
    document.documentElement.style.setProperty("--fs", String(scale));
    try { localStorage.setItem(STORAGE_SCALE, String(scale)); } catch (e) {}
    if (el.fontDown) el.fontDown.disabled = scale <= SCALES[0];
    if (el.fontUp) el.fontUp.disabled = scale >= SCALES[SCALES.length - 1];
    if (el.fontStatus) el.fontStatus.textContent = scale <= 1 ? "目前標準" : "目前 " + Math.round(scale * 100) + "%";
  }

  function stepScale(direction) {
    var idx = 0;
    var best = Infinity;
    SCALES.forEach(function (v, i) {
      var diff = Math.abs(v - state.scale);
      if (diff < best) { best = diff; idx = i; }
    });
    var next = Math.min(SCALES.length - 1, Math.max(0, idx + direction));
    if (SCALES[next] === state.scale) return;
    applyScale(SCALES[next]);
    speak(direction > 0 ? "字變大了" : "字變小了");
  }

  /* ---------------- 確認彈窗（不可點背景關閉） ---------------- */

  function confirmDialog(options) {
    var opt = options || {};
    return new Promise(function (resolve) {
      if (!el.dialog) {
        resolve(true);
        return;
      }
      if (el.dialogIcon) el.dialogIcon.textContent = String(opt.icon || "❓");
      if (el.dialogTitle) el.dialogTitle.textContent = String(opt.title || "確定嗎？");
      if (el.dialogText) {
        el.dialogText.textContent = String(opt.text || "");
        el.dialogText.hidden = !opt.text;
      }
      if (el.dialogOk) el.dialogOk.textContent = String(opt.okText || "要");
      if (el.dialogCancel) el.dialogCancel.textContent = String(opt.cancelText || "不要");

      var done = function (result) {
        el.dialogOk.removeEventListener("click", onOk);
        el.dialogCancel.removeEventListener("click", onCancel);
        el.dialog.hidden = true;
        resolve(result);
      };
      var onOk = function () { done(true); };
      var onCancel = function () { done(false); };

      el.dialogOk.addEventListener("click", onOk);
      el.dialogCancel.addEventListener("click", onCancel);
      el.dialog.hidden = false;
      if (el.dialogCancel) el.dialogCancel.focus();
      speak(opt.title || "");
    });
  }

  /* ---------------- 全螢幕面板 ---------------- */

  var sheetOpen = false;
  var sheetBackPending = false;

  function openSheet(options) {
    var opt = options || {};
    if (!el.sheet) return;
    var replacing = sheetOpen;
    sheetOpen = true;
    el.sheet.classList.toggle("has-frame", Boolean(opt.frameUrl));
    if (el.sheetTitle) el.sheetTitle.textContent = String(opt.title || "");
    el.sheetBody.innerHTML = "";
    if (opt.frameUrl) {
      var frame = document.createElement("iframe");
      frame.className = "sp-frame";
      frame.setAttribute("allow", "camera; microphone; clipboard-write; autoplay");
      frame.src = String(opt.frameUrl);
      el.sheetBody.appendChild(frame);
    } else {
      el.sheetBody.innerHTML = String(opt.html || "");
      if (typeof opt.afterRender === "function") opt.afterRender(el.sheetBody);
    }
    el.sheet.hidden = false;
    el.sheet.dataset.speak = String(opt.speakText || opt.title || "");
    // 若原本已開著面板（例如用語音直接換功能），沿用同一筆歷史紀錄，避免返回鍵要多按一次
    if (!replacing) {
      try { history.pushState({ __spSheet: true }, ""); } catch (e) {}
    }
    speak(opt.speakText || opt.title || "");
  }

  function hideSheet(fromPop) {
    if (!sheetOpen) return;
    sheetOpen = false;
    stopSpeak();
    if (el.sheet) {
      el.sheet.hidden = true;
      el.sheet.classList.remove("has-frame");
      el.sheetBody.innerHTML = "";
      delete el.sheet.dataset.speak;
    }
    if (!fromPop) {
      try {
        if (history.state && history.state.__spSheet) {
          sheetBackPending = true;
          history.back();
        }
      } catch (e) {}
    }
  }

  window.addEventListener("popstate", function () {
    // 忽略自己呼叫 history.back() 造成的那一次 popstate，避免把剛開啟的面板關掉
    if (sheetBackPending) { sheetBackPending = false; return; }
    if (sheetOpen) hideSheet(true);
  });

  el.sheetBack.addEventListener("click", function () { hideSheet(false); });
  el.sheetSpeak.addEventListener("click", function () {
    var text = el.sheet.dataset.speak || (el.sheetTitle ? el.sheetTitle.textContent : "");
    if (state.voice) speak(text);
    else toast("語音報讀已關閉，可按右下角「語音開」打開");
  });

  /* ---------------- 社區與住戶資料 ---------------- */

  function readUrlCommunityKey() {
    try {
      return String(new URLSearchParams(location.search).get("c") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function resolveCommunity(key) {
    var result = { id: "default", code: "", name: "" };
    var raw = String(key || "").trim();
    if (!raw) return Promise.resolve(result);

    function fromDoc(doc) {
      if (!doc || !doc.exists) return null;
      var v = doc.data() || {};
      return {
        id: String(v.id || doc.id || "").trim() || "default",
        code: String(v.username || "").trim() || raw,
        name: String(v.name || v.displayName || "").trim(),
      };
    }

    return db.collection("communities").where("id", "==", raw).limit(1).get()
      .then(function (snap) {
        var found = fromDoc(snap && snap.docs ? snap.docs[0] : null);
        if (found) return found;
        return db.collection("communities").where("username", "==", raw).limit(1).get();
      })
      .then(function (snap) {
        if (snap && snap.docs && snap.docs[0]) {
          var found = fromDoc(snap.docs[0]);
          if (found) return found;
        }
        return db.collection("communities").doc(raw).get();
      })
      .then(function (doc) {
        return fromDoc(doc) || { id: raw, code: raw, name: "" };
      })
      .catch(function () {
        return { id: raw, code: raw, name: "" };
      });
  }

  function buildUnitKeys() {
    var d = state.profile || {};
    var houseNo = normalizeDash(d.houseNo || d.unit || "");
    var sub = normalizeDash(d.subHouseNo || d.subUnit || d.sub || "");
    var full = houseNo ? (sub ? houseNo + "-" + sub : houseNo) : "";
    var variants = [];
    [houseNo, full].forEach(function (v) {
      if (v && variants.indexOf(v) < 0) variants.push(v);
    });
    var keys = [];
    variants.forEach(function (v) {
      keys.push(v);
      keys.push(v.replace(/-/g, "－"));
    });
    return keys.filter(function (v, i, arr) {
      return v && arr.indexOf(v) === i;
    });
  }

  function renderGreeting() {
    var d = state.profile || {};
    var name = String(d.displayName || d.name || "").trim();
    var hour = new Date().getHours();
    var greet = hour < 5 ? "夜深了" : hour < 11 ? "早安" : hour < 18 ? "午安" : "晚安";
    if (el.greetingLine) el.greetingLine.textContent = greet + "，今天過得還好嗎？";
    if (el.greetName) el.greetName.textContent = name || "您好";

    var houseNo = String(d.houseNo || d.unit || "").trim();
    var sub = String(d.subUnit || d.subHouseNo || "").trim();
    var unitText = houseNo ? houseNo + (sub ? "-" + sub : "") : "";
    if (el.greetUnit) el.greetUnit.hidden = false;
    if (el.greetUnitText) el.greetUnitText.textContent = unitText || "住戶";

    var today = new Date();
    var weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    if (el.todayDate) el.todayDate.textContent = (today.getMonth() + 1) + "月" + today.getDate() + "日";
    if (el.todayWeekday) el.todayWeekday.textContent = weekdays[today.getDay()];

    // 登入者大頭照：優先用住戶資料，其次用登入帳號的頭像，都沒有則顯示姓名首字
    var avatarUrl = String(d.avatarDataUrl || d.avatar || "").trim();
    if (!avatarUrl) {
      try { avatarUrl = String((auth.currentUser && auth.currentUser.photoURL) || "").trim(); } catch (e) {}
    }
    if (el.avatarImg) {
      if (avatarUrl) {
        el.avatarImg.src = avatarUrl;
        el.avatarImg.hidden = false;
      } else {
        el.avatarImg.removeAttribute("src");
        el.avatarImg.hidden = true;
      }
    }
    if (el.avatarInitial) {
      el.avatarInitial.textContent = (name ? name.slice(0, 1) : "") || "住";
      el.avatarInitial.hidden = Boolean(avatarUrl);
    }

    if (el.userName) el.userName.textContent = name || "您好";

    if (el.communityName) el.communityName.textContent = state.communityName || "社區服務系統";
    document.title = (state.communityName ? state.communityName + "｜" : "") + "簡易版";
  }

  /* ---------------- 我的包裹 ---------------- */

  function loadParcels() {
    var cid = state.cid;
    var keys = buildUnitKeys();
    if (!cid || !keys.length) {
      state.parcels = [];
      state.parcelError = !keys.length;
      renderParcelBadge();
      return Promise.resolve();
    }
    var ref = db.collection("communities").doc(cid).collection("parcels");
    var collected = {};
    var jobs = [];
    keys.forEach(function (k) {
      ["unit", "houseNo"].forEach(function (field) {
        jobs.push(
          ref.where(field, "==", k).limit(200).get()
            .then(function (snap) {
              if (snap && snap.forEach) {
                snap.forEach(function (doc) {
                  collected[doc.id] = Object.assign({ id: doc.id }, doc.data() || {});
                });
              }
            })
            .catch(function (err) {
              console.warn("[special-member] 包裹查詢失敗", field, k, err && err.code);
            })
        );
      });
    });
    return Promise.all(jobs).then(function () {
      var list = Object.keys(collected).map(function (id) { return collected[id]; });
      list.sort(function (a, b) {
        var ap = String(a.status || "") === "pending" ? 0 : 1;
        var bp = String(b.status || "") === "pending" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (tsToDate(b.createdAt) || tsToDate(b.arrivedAt) || 0) - (tsToDate(a.createdAt) || tsToDate(a.arrivedAt) || 0);
      });
      state.parcels = list;
      state.parcelError = false;
      renderParcelBadge();
    });
  }

  function isPendingParcel(p) {
    return String(p && p.status ? p.status : "") === "pending";
  }

  function renderParcelBadge() {
    var n = state.parcels.filter(isPendingParcel).length;
    if (el.parcelBadge) {
      el.parcelBadge.textContent = String(n);
      el.parcelBadge.hidden = n <= 0;
    }
    [el.noticeCount, el.navBadge].forEach(function (badge) {
      if (!badge) return;
      badge.textContent = String(n);
      badge.hidden = n <= 0;
    });
    if (el.noticeCard) el.noticeCard.dataset.action = n > 0 ? "parcel" : "bulletin";
    if (el.noticeTitle) {
      el.noticeTitle.textContent = state.parcelError
        ? "您的戶號尚未設定"
        : n > 0
          ? "您有 " + n + " 件包裹待領取"
          : "您目前沒有待領包裹";
    }
    if (el.noticeText) {
      if (state.parcelError) {
        el.noticeText.textContent = "請洽管理中心設定戶號，或點這裡查看社區公告。";
      } else if (n > 0) {
        var first = state.parcels.filter(isPendingParcel)[0];
        var arrived = first && (tsToDate(first.createdAt) || tsToDate(first.arrivedAt));
        var days = arrived ? Math.max(0, Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(arrived).setHours(0, 0, 0, 0)) / 86400000)) : 0;
        el.noticeText.textContent = days > 0
          ? "已在大廳包裹櫃等待領取 " + days + " 天。點這裡看取件說明。"
          : "已放在大廳包裹櫃，點這裡看取件說明。";
      } else {
        el.noticeText.textContent = "點這裡查看社區最新公告。";
      }
    }
  }

  function parcelItemHtml(p) {
    var pending = isPendingParcel(p);
    var company = String(p.company || p.type || "包裹").trim();
    var arrived = tsToDate(p.createdAt) || tsToDate(p.arrivedAt);
    var fields = [];
    if (arrived) fields.push('<span class="sp-item-field">到貨：<b>' + fmtDateTime(arrived) + "</b></span>");
    if (String(p.shelf || "").trim()) fields.push('<span class="sp-item-field">儲位：<b>' + escapeHtml(p.shelf) + "</b></span>");
    var no = String(p.trackNo || p.internalSerial || "").trim();
    if (no) fields.push('<span class="sp-item-field">編號：<b>' + escapeHtml(no) + "</b></span>");
    var note = String(p.note || "").trim();

    return (
      '<div class="sp-item">' +
        '<div class="sp-item-top">' +
          '<div class="sp-item-title">' + escapeHtml(company) + "</div>" +
          '<div class="sp-item-time">' + (pending ? "🔴 還沒領" : "✅ 已領取") + "</div>" +
        "</div>" +
        '<div class="sp-item-fields">' + fields.join("") + "</div>" +
        (note ? '<div class="sp-item-body">' + escapeHtml(note) + "</div>" : "") +
      "</div>"
    );
  }

  function openParcelSheet() {
    var pending = state.parcels.filter(isPendingParcel);
    var claimed = state.parcels.filter(function (p) { return !isPendingParcel(p); });
    var head = "";
    var body = "";

    if (state.parcelError && !buildUnitKeys().length) {
      body = '<div class="sp-empty"><div class="sp-empty-icon">🏠</div>您的帳號還沒有設定戶號，請洽管理中心。</div>';
    } else if (!state.parcels.length) {
      body = '<div class="sp-empty"><div class="sp-empty-icon">😊</div>目前沒有您的包裹</div>';
    } else {
      head =
        '<div class="sp-item" style="border-color:var(--brand);background:var(--brand-soft);">' +
          '<div class="sp-item-title">還沒領的包裹：' + pending.length + " 件</div>" +
        "</div>";
      body =
        pending.map(parcelItemHtml).join("") +
        (claimed.length
          ? '<div class="sp-empty" style="padding:1.2rem 0 0.4rem;">以下已經領過</div>' + claimed.slice(0, 10).map(parcelItemHtml).join("")
          : "");
    }

    openSheet({
      title: "我的包裹",
      html: head + body,
      speakText: "我的包裹，還沒領的有 " + pending.length + " 件",
    });
  }

  /* ---------------- 社區公告 ---------------- */

  function bulletinTime(b) {
    return tsToDate(b.createdAt) || tsToDate(b.updatedAt) || tsToDate(b.publishedAt);
  }

  function loadBulletins() {
    var cid = state.cid;
    if (!cid) {
      state.bulletins = [];
      return Promise.resolve();
    }
    return db.collection("communities").doc(cid).collection("bulletins")
      .where("type", "==", "community")
      .limit(60)
      .get()
      .then(function (snap) {
        var list = [];
        if (snap && snap.forEach) {
          snap.forEach(function (doc) {
            list.push(Object.assign({ id: doc.id }, doc.data() || {}));
          });
        }
        var pinned = function (x) { return x && x.isPinned ? 1 : 0; };
        var important = function (x) { return x && x.isImportant ? 1 : 0; };
        var timeOf = function (x) {
          var d = bulletinTime(x);
          return d ? d.getTime() : 0;
        };
        list.sort(function (a, b) {
          if (pinned(a) !== pinned(b)) return pinned(b) - pinned(a);
          if (important(a) !== important(b)) return important(b) - important(a);
          return timeOf(b) - timeOf(a);
        });
        state.bulletins = list;
      })
      .catch(function (err) {
        console.warn("[special-member] 公告讀取失敗", err && err.code);
        state.bulletins = [];
      });
  }

  function bulletinItemHtml(b) {
    var d = bulletinTime(b);
    var title = String(b.title || "社區公告").trim();
    var content = String(b.content || "").trim();
    var marks = [];
    if (b.isPinned) marks.push("📌 置頂");
    if (b.isImportant) marks.push("⚠️ 重要");
    var images = Array.isArray(b.images) ? b.images.filter(Boolean) : [];
    var imgHtml = images.length
      ? '<img src="' + escapeHtml(images[0]) + '" alt="" style="width:100%;border-radius:0.8rem;margin-top:0.6rem;" />'
      : "";

    return (
      '<div class="sp-item">' +
        '<div class="sp-item-top">' +
          '<div class="sp-item-title">' + escapeHtml(title) + "</div>" +
          (d ? '<div class="sp-item-time">' + fmtDate(d) + "</div>" : "") +
        "</div>" +
        (marks.length ? '<div class="sp-item-field">' + marks.join("　") + "</div>" : "") +
        (content ? '<div class="sp-item-body">' + escapeHtml(content) + "</div>" : "") +
        imgHtml +
      "</div>"
    );
  }

  function openBulletinSheet() {
    var list = state.bulletins;
    var body = list.length
      ? list.map(bulletinItemHtml).join("")
      : '<div class="sp-empty"><div class="sp-empty-icon">📢</div>目前沒有新公告</div>';
    openSheet({
      title: "社區公告",
      html: body,
      speakText: list.length ? "社區公告，共 " + list.length + " 則" : "目前沒有新公告",
    });
  }

  /* ---------------- SOS 一鍵求助 ---------------- */

  function loadMemberSettings() {
    var key = String(state.cid || "default") + "::" + String(state.uid || "anon");
    try {
      var map = JSON.parse(localStorage.getItem(STORAGE_MEMBER_SETTINGS) || "{}") || {};
      var obj = (map && typeof map === "object" && map[key]) ? map[key] : {};
      return {
        sosMode: String(obj.sosMode || "default").trim() === "custom" ? "custom" : "default",
        sosCustomPhone: String(obj.sosCustomPhone || "").trim(),
      };
    } catch (e) {
      return { sosMode: "default", sosCustomPhone: "" };
    }
  }

  function loadSosConfig() {
    return db.collection("communities").doc(state.cid).collection("settings").doc("app_config")
      .get()
      .then(function (doc) {
        var v = doc && doc.exists ? (doc.data() || {}) : {};
        return {
          mode: String(v.sosActionMode || "").trim(),
          phone: String(v.sosPhoneNumber || "").trim(),
        };
      })
      .catch(function () {
        return { mode: "", phone: "" };
      });
  }

  function recordSosEvent(dialedPhone, dialedFrom) {
    var d = state.profile || {};
    var now = new Date();
    var houseNo = String(d.houseNo || d.unit || "").trim() || "—";
    var subHouseNo = String(d.subHouseNo || d.subUnit || "").trim();
    var name = String(d.displayName || d.name || "").trim() || "住戶";

    return db.collection("sos_alerts").add({
      community: state.cid,
      houseNo: houseNo,
      subHouseNo: subHouseNo,
      name: name,
      status: "待處理",
      record: "",
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      createdBy: state.uid,
      createdByEmail: String((auth.currentUser && auth.currentUser.email) || ""),
      datetimeText: fmtDate(now) + " " + fmtTime(now),
      dialedPhone: String(dialedPhone || ""),
      dialedFrom: String(dialedFrom || ""),
      source: "special-member",
    });
  }

  function triggerSos() {
    return confirmDialog({
      icon: "🆘",
      title: "要通知管理中心嗎？",
      text: "按「要」就會立刻通知管理中心，請在原地等我們。",
      okText: "要，通知",
      cancelText: "不要",
    }).then(function (ok) {
      if (!ok) return;
      var ms = loadMemberSettings();
      var useCustom = ms.sosMode === "custom" && ms.sosCustomPhone;
      if (useCustom) {
        toast("正在為您撥號：" + ms.sosCustomPhone);
        location.href = "tel:" + ms.sosCustomPhone;
        return;
      }
      return loadSosConfig().then(function (cfg) {
        if (cfg.mode === "phone" && cfg.phone) {
          recordSosEvent(cfg.phone, "community-phone").catch(function () {});
          toast("正在為您撥號：" + cfg.phone);
          location.href = "tel:" + cfg.phone;
          return;
        }
        return recordSosEvent("", "community-backend").then(function () {
          openSheet({
            title: "已通知管理中心",
            html:
              '<div class="sp-empty">' +
                '<div class="sp-empty-icon">✅</div>' +
                '<div style="font-size:1.6rem;color:var(--ink);">已通知管理中心</div>' +
                '<div style="margin-top:0.6rem;">請留在原地，管理中心會盡快與您聯絡。</div>' +
              "</div>",
            speakText: "已經通知管理中心，請留在原地等待",
          });
        }).catch(function () {
          toast("通知失敗，請直接撥打管理中心電話");
        });
      });
    });
  }

  /* ---------------- 六大功能點擊 ---------------- */

  function openFrame(title, url) {
    openSheet({ title: title, frameUrl: url, speakText: title + "，打開了。看完請按最下面的回上一頁" });
  }

  function moduleUrl(page, extra) {
    var q = [];
    if (state.code) q.push("c=" + encodeURIComponent(state.code));
    if (extra) q.push(extra);
    return page + (q.length ? "?" + q.join("&") : "");
  }

  function handleAction(action) {
    if (action === "support") { openSupportSheet(); return; }
    if (action === "profile") { openProfileSheet(); return; }
    if (action === "parcel") {
      speak("我的包裹");
      loadParcels().then(openParcelSheet);
      return;
    }
    if (action === "bulletin") {
      speak("社區公告");
      loadBulletins().then(openBulletinSheet);
      return;
    }
    if (action === "visitor") {
      speak("訪客登記");
      openFrame("訪客登記", moduleUrl("visitor-resident.html", "embed=1"));
      return;
    }
    if (action === "facility") {
      speak("公設預約");
      openFrame("公設預約", moduleUrl("facility.html"));
      return;
    }
    if (action === "meter") {
      speak("水電繳費");
      openFrame("水電繳費", moduleUrl("number-list.html"));
      return;
    }
    if (action === "sos") {
      speak("一鍵求助");
      triggerSos();
    }
  }

  function openSupportSheet() {
    openSheet({
      title: "客服與住戶服務",
      html:
        '<div class="sp-support-intro">請選擇您需要的協助。若有緊急狀況，請使用「緊急求助」通知管理室。</div>' +
        '<div class="sp-sheet-action-list">' +
          '<button class="sp-btn sp-btn-ghost" type="button" data-action="visitor">訪客登記</button>' +
          '<button class="sp-btn sp-btn-ghost" type="button" data-action="facility">公設預約</button>' +
          '<button class="sp-btn sp-btn-ghost" type="button" data-action="meter">水電繳費</button>' +
          '<button class="sp-btn sp-btn-primary" type="button" data-action="sos">緊急求助</button>' +
        "</div>",
      speakText: "客服與住戶服務，請選擇您需要的協助",
    });
  }

  function openProfileSheet() {
    var profile = state.profile || {};
    var name = String(profile.displayName || profile.name || "住戶").trim();
    var houseNo = String(profile.houseNo || profile.unit || "").trim();
    var sub = String(profile.subUnit || profile.subHouseNo || "").trim();
    var unit = houseNo ? houseNo + (sub ? "-" + sub : "") : "尚未設定";
    var community = state.communityName || "社區服務系統";
    openSheet({
      title: "我的資料",
      html:
        '<div class="sp-profile-card">' +
          '<div class="sp-profile-name">' + escapeHtml(name) + "</div>" +
          '<div class="sp-profile-field">社區：' + escapeHtml(community) + "</div>" +
          '<div class="sp-profile-field">戶號：' + escapeHtml(unit) + "</div>" +
        "</div>" +
        '<div class="sp-sheet-action-list">' +
          '<button class="sp-btn sp-btn-ghost" type="button" data-action="font-down">字體縮小</button>' +
          '<button class="sp-btn sp-btn-ghost" type="button" data-action="toggle-voice"><span id="spProfileVoiceText">' + (state.voice ? "語音報讀：開啟" : "語音報讀：關閉") + "</span></button>" +
          '<button class="sp-btn sp-btn-ghost" type="button" id="spProfileSignOut">登出</button>' +
        "</div>",
      speakText: "我的資料，" + name + "，戶號 " + unit,
    });
  }

  function toggleVoice() {
    state.voice = !state.voice;
    if (el.voiceToggle) el.voiceToggle.setAttribute("aria-pressed", state.voice ? "true" : "false");
    if (el.voiceText) el.voiceText.textContent = state.voice ? "語音開" : "語音關";
    var profileVoiceText = document.getElementById("spProfileVoiceText");
    if (profileVoiceText) profileVoiceText.textContent = state.voice ? "語音報讀：開啟" : "語音報讀：關閉";
    try { localStorage.setItem(STORAGE_VOICE, state.voice ? "1" : "0"); } catch (e) {}
    if (state.voice) speak("語音已打開");
    else stopSpeak();
  }

  /* ---------------- 事件綁定 ---------------- */

  function bindEvents() {
    if (el.grid) {
      el.grid.addEventListener("click", function (ev) {
        var tile = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
        if (!tile) return;
        handleAction(String(tile.getAttribute("data-action") || ""));
      });
    }

    if (el.sosCard) el.sosCard.addEventListener("click", function () { handleAction("sos"); });
    if (el.noticeCard) el.noticeCard.addEventListener("click", function () {
      handleAction(String(el.noticeCard.dataset.action || "bulletin"));
    });

    if (el.homeNav) el.homeNav.addEventListener("click", function () {
      if (sheetOpen) hideSheet(false);
      if (el.home) el.home.scrollTo({ top: 0, behavior: "smooth" });
      setActiveNav(el.homeNav);
    });
    if (el.noticeNav) el.noticeNav.addEventListener("click", function () {
      setActiveNav(el.noticeNav);
      handleAction("bulletin");
    });
    if (el.supportNav) el.supportNav.addEventListener("click", function () {
      setActiveNav(el.supportNav);
      openSupportSheet();
    });
    if (el.profileNav) el.profileNav.addEventListener("click", function () {
      setActiveNav(el.profileNav);
      openProfileSheet();
    });

    if (el.sheetBody) el.sheetBody.addEventListener("click", function (ev) {
      var signOut = ev.target && ev.target.closest ? ev.target.closest("#spProfileSignOut") : null;
      if (signOut) { if (el.signOut) el.signOut.click(); return; }
      var actionButton = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
      if (!actionButton) return;
      var action = String(actionButton.getAttribute("data-action") || "");
      if (action === "toggle-voice") toggleVoice();
      else if (action === "font-down") stepScale(-1);
      else handleAction(action);
    });

    if (el.fontDown) el.fontDown.addEventListener("click", function () { stepScale(-1); });
    if (el.fontUp) el.fontUp.addEventListener("click", function () { stepScale(1); });

    if (el.voiceToggle) {
      el.voiceToggle.addEventListener("click", toggleVoice);
    }

    if (el.signOut) {
      el.signOut.addEventListener("click", function () {
        confirmDialog({
          icon: "🚪",
          title: "要登出嗎？",
          text: "登出後要重新輸入帳號密碼才能再進來。",
          okText: "要登出",
          cancelText: "不要",
        }).then(function (ok) {
          if (!ok) return;
          auth.signOut().finally(function () {
            location.replace("index.html");
          });
        });
      });
    }

    if (el.mic) {
      el.mic.addEventListener("click", function () {
        voiceCtl.tapped = true;
        if (voiceCtl.listening || voiceCtl.want) voiceStop();
        else voiceStart();
      });
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (!el.dialog.hidden) return;
      if (sheetOpen) hideSheet(false);
    });
  }

  function setActiveNav(active) {
    [el.homeNav, el.noticeNav, el.supportNav, el.profileNav].forEach(function (button) {
      if (!button) return;
      var selected = button === active;
      button.classList.toggle("is-active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  /* ---------------- 啟動 ---------------- */

  function restorePreferences() {
    var scale = parseFloat(localStorage.getItem(STORAGE_SCALE) || "");
    if (!isFinite(scale) || SCALES.indexOf(scale) < 0) scale = SCALES[1];
    applyScale(scale);

    var voice = localStorage.getItem(STORAGE_VOICE);
    state.voice = voice === null ? true : voice === "1";
    if (el.voiceToggle) el.voiceToggle.setAttribute("aria-pressed", state.voice ? "true" : "false");
    if (el.voiceText) el.voiceText.textContent = state.voice ? "語音開" : "語音關";
  }

  document.addEventListener("DOMContentLoaded", function () {
    restorePreferences();
    bindEvents();
    initVoice();
  });

  auth.onAuthStateChanged(function (user) {
    if (!user) {
      location.replace("index.html");
      return;
    }
    state.uid = String(user.uid || "");

    var urlKey = readUrlCommunityKey();
    var storedKey = "";
    try { storedKey = String(localStorage.getItem(STORAGE_ACTIVE_COMMUNITY) || "").trim(); } catch (e) {}

    db.collection("users").doc(state.uid).get()
      .then(function (doc) {
        state.profile = doc && doc.exists ? (doc.data() || {}) : {};
        var fromProfile = String(state.profile.community || "").trim();
        return resolveCommunity(fromProfile || urlKey || storedKey);
      })
      .catch(function (err) {
        console.warn("[special-member] 讀取住戶資料失敗", err && err.code);
        state.profile = {};
        return resolveCommunity(urlKey || storedKey);
      })
      .then(function (community) {
        state.cid = community.id || "default";
        state.code = community.code || "";
        state.communityName = community.name || "";
        try {
          if (state.cid && state.cid !== "default") localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, state.cid);
        } catch (e) {}
        renderGreeting();
        return Promise.all([loadParcels(), loadBulletins()]);
      })
      .catch(function (err) {
        console.error("[special-member] 初始化失敗", err);
      });
  });
})();
