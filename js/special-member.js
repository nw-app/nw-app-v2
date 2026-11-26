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

  function isStandalonePwa() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (e) {}
    return Boolean(window.navigator && window.navigator.standalone);
  }

  function updatePwaBottomInset() {
    var bottomInset = 0;
    var viewport = window.visualViewport;
    if (isStandalonePwa() && viewport) {
      var baseHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
      bottomInset = Math.max(0, Math.round(baseHeight - (viewport.height + viewport.offsetTop)));
    }
    document.documentElement.style.setProperty("--wc-bottom-overlay", bottomInset + "px");
  }

  function schedulePwaBottomInset() {
    updatePwaBottomInset();
    [120, 360, 900].forEach(function (delay) {
      window.setTimeout(updatePwaBottomInset, delay);
    });
  }

  schedulePwaBottomInset();
  window.addEventListener("resize", schedulePwaBottomInset, { passive: true });
  window.addEventListener("orientationchange", schedulePwaBottomInset, { passive: true });
  window.addEventListener("pageshow", schedulePwaBottomInset, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) schedulePwaBottomInset();
  }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", schedulePwaBottomInset, { passive: true });
    window.visualViewport.addEventListener("scroll", schedulePwaBottomInset, { passive: true });
  }

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
  var STORAGE_PHONE_LIST = "csp_special_phone_list_v1";

  // 固定三種字體尺寸：小／中／大
  var FONT_SIZES = [
    { key: "s", label: "小", scale: 0.9 },
    { key: "m", label: "中", scale: 1 },
    { key: "l", label: "大", scale: 1.1 },
  ];
  var SCALES = FONT_SIZES.map(function (f) { return f.scale; });

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
    services: document.getElementById("spServices"),
    home: document.querySelector(".sp-home"),
    brand: document.querySelector(".sp-brand"),
    infoCard: document.querySelector(".sp-info-card"),
    sosCard: document.querySelector(".sp-sos-card"),
    homeNotice: document.getElementById("spHomeNotice"),
    navBadge: document.getElementById("spNavBadge"),
    todayDate: document.getElementById("spTodayDate"),
    todayWeekday: document.getElementById("spTodayWeekday"),
    todayClock: document.getElementById("spTodayClock"),
    communityName: document.getElementById("spCommunityName"),
    greetingLine: document.getElementById("spGreetingLine"),
    avatarImg: document.getElementById("spAvatarImg"),
    avatarInitial: document.getElementById("spAvatarInitial"),
    avatar: document.getElementById("spAvatar"),
    userName: document.getElementById("spUserName"),
    greetName: document.getElementById("spGreetName"),
    greetQr: document.getElementById("spGreetQr"),
    greetQrImg: document.getElementById("spGreetQrImg"),
    greetUnit: document.getElementById("spGreetUnit"),
    greetUnitText: document.getElementById("spGreetUnitText"),
    parcelBadge: document.getElementById("spParcelBadge"),
    fontDown: document.getElementById("spFontDown"),
    fontUp: document.getElementById("spFontUp"),
    fontStatus: document.getElementById("spFontStatus"),
    voiceToggle: document.getElementById("spVoiceToggle"),
    voiceText: document.getElementById("spVoiceText"),
    signOut: document.getElementById("spSignOut"),
    shell: document.querySelector(".sp-shell"),
    bar: document.querySelector(".sp-bar"),
    homeNav: document.getElementById("spHomeNav"),
    intercomNav: document.getElementById("spIntercomNav"),
    supportNav: document.getElementById("spSupportNav"),
    profileNav: document.getElementById("spProfileNav"),
    mic: document.getElementById("spMic"),
    micText: document.getElementById("spMicText"),
    sheet: document.getElementById("spSheet"),
    sheetTitle: document.getElementById("spSheetTitle"),
    sheetBody: document.getElementById("spSheetBody"),
    sheetFt: document.getElementById("spSheetFt"),
    sheetSpeak: document.getElementById("spSheetSpeak"),
    sheetBack: document.getElementById("spSheetBack"),
    voice: document.getElementById("spVoice"),
    voiceVideo: document.getElementById("spVoiceVideo"),
    voiceAskText: document.getElementById("spVoiceAskText"),
    voiceReplyText: document.getElementById("spVoiceReplyText"),
    voiceClose: document.getElementById("spVoiceClose"),
    phone: document.getElementById("spPhone"),
    phoneBody: document.getElementById("spPhoneBody"),
    phoneClose: document.getElementById("spPhoneClose"),
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
    delay: 250,
  };

  // 即時草稿搶先偵測喚醒詞用（見 initVoice）：wakeWatch 為確認計時器，wakeText 為目前聽到的喚醒後指令
  var wakeWatch = null;
  var wakeText = "";

  function wakeWatchClear() {
    if (wakeWatch) { clearTimeout(wakeWatch); wakeWatch = null; }
    wakeText = "";
  }

  // 「附近有什麼」可問的地點關鍵字，命中後產生 Google 地圖搜尋按鈕
  var VOICE_MAP_POI = [
    "水電行", "水電", "便利商店", "超商", "藥局", "藥房", "診所", "醫院",
    "餐廳", "小吃", "麵店", "麵攤", "早餐店", "咖啡", "麵包店", "超市",
    "菜市場", "市場", "銀行", "郵局", "加油站", "五金行", "機車行",
    "停車場", "公園", "理髮", "洗衣",
  ];

  // 每個功能對應長輩可能講出來的幾個講法
  var VOICE_COMMANDS = [
    { action: "back", words: ["回上一頁", "關起來", "關閉", "返回", "上一頁", "不要了"] },
    { action: "signout", words: ["登出"] },
    { action: "parcel", words: ["包裹", "郵件", "快遞", "掛號", "宅配"] },
    { action: "bulletin", words: ["公告", "布告", "社區消息"] },
    { action: "visitor", words: ["訪客", "客人", "有人來", "登記"] },
    { action: "facility", words: ["公設", "預約", "健身房", "教室", "設施", "游泳池"] },
    { action: "meter", words: ["水電", "繳費", "費用", "帳單", "電費", "水費", "度數", "管理費"] },
    { action: "sos", words: ["求救", "救命", "求助", "救護車", "火災", "失火", "報警", "警察", "救我", "緊急"] },
    { action: "bigger", words: ["字大", "字變大", "字太小", "看不清楚"] },
    { action: "smaller", words: ["字小", "字變小", "字太大"] },
    { action: "time", words: ["現在幾點", "幾點", "現在時間", "現在時刻"] },
    { action: "date", words: ["今天幾號", "幾月幾號", "今天日期", "今天幾日", "星期幾", "今天星期"] },
    { action: "weather", words: ["天氣", "會不會下雨", "會下雨", "下雨", "溫度", "氣溫", "會不會冷", "會不會熱"] },
    { action: "home", words: ["回首頁", "回到首頁", "回主頁", "首頁", "主頁"] },
    { action: "support", words: ["功能", "常用服務", "有什麼服務", "有哪些服務"] },
    { action: "notice", words: ["通知", "最新通知", "最新消息"] },
    { action: "intercom", words: ["對講", "對講機", "呼叫", "室內對講", "門口對講"] },
    { action: "profile", words: ["個人", "我的資料", "個人資料"] },
    { action: "call", words: ["打電話", "撥電話", "撥打", "打給管理中心", "管理室電話", "管理中心電話", "電話"] },
    { action: "greet", words: ["你好", "您好", "早安", "午安", "晚安", "哈囉"] },
    { action: "thanks", words: ["謝謝", "感謝", "多謝"] },
    { action: "who", words: ["你是誰", "你叫什麼", "你的名字", "你什麼名字", "你會什麼"] },
    { action: "help", words: ["幫我", "怎麼辦", "不會用", "怎麼用", "教我"] },
    { action: "myunit", words: ["我的戶號", "住戶編號", "我是哪一戶", "我的社區", "我住哪裡"] },
    { action: "bye", words: ["再見", "掰掰", "拜拜"] },
    { action: "maps", words: ["地圖", "帶我去", "哪裡有", "附近有什麼"].concat(VOICE_MAP_POI) },
  ];

  var VOICE_WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  var VOICE_WEATHER_CODE = {
    0: "晴", 1: "晴時多雲", 2: "多雲", 3: "陰", 45: "霧", 48: "霧",
    51: "小雨", 53: "雨", 55: "大雨", 56: "凍雨", 57: "凍雨",
    61: "小雨", 63: "雨", 65: "大雨", 66: "凍雨", 67: "凍雨",
    71: "小雪", 73: "雪", 75: "大雪", 77: "雪粒", 80: "陣雨", 81: "陣雨",
    82: "暴雨", 85: "陣雪", 86: "陣雪", 95: "雷陣雨", 96: "雷陣雨伴冰雹", 99: "雷陣雨伴冰雹",
  };

  function voiceTimeText() {
    var now = new Date();
    return "現在是" + now.getHours() + "點" + now.getMinutes() + "分。";
  }

  function voiceDateText() {
    var now = new Date();
    return "今天是" + (now.getMonth() + 1) + "月" + now.getDate() + "日，" + VOICE_WEEKDAYS[now.getDay()] + "。";
  }

  // 判斷要問哪一天：0 今天、1 明天、2 後天、3 大後天、4 未來幾天
  var VOICE_DAY_NAMES = ["今天", "明天", "後天", "大後天", "未來幾天"];
  function voiceWeatherRange(text) {
    var t = String(text || "");
    if (/未來|一週|一周|這週|這周|這幾天|接下來|往後/.test(t)) return 4;
    if (/大後天/.test(t)) return 3;
    if (/後天/.test(t)) return 2;
    if (/明天|明日|隔天/.test(t)) return 1;
    return 0;
  }

  // 查天氣：先取定位，失敗則用台北；查完用 cb 回傳可直接播報的文字
  function fetchVoiceWeather(cb, range) {
    var day = typeof range === "number" ? range : 0;
    var done = function (text) { if (cb) cb(text); };
    var load = function (lat, lon) {
      fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
        "&current=temperature_2m,apparent_temperature,weather_code" +
        "&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var cur = data && data.current;
          var daily = data && data.daily;
          var hasDaily = !!(daily && daily.time && daily.weather_code);
          // 第 i 天（0=今天）：回傳「多雲，氣溫 22 到 28 度」
          var dayText = function (i) {
            if (!hasDaily || !daily.time[i]) return "";
            var desc = VOICE_WEATHER_CODE[daily.weather_code[i]] || "多雲";
            var lo = Math.round(daily.temperature_2m_min[i]);
            var hi = Math.round(daily.temperature_2m_max[i]);
            return desc + "，氣溫" + lo + "到" + hi + "度";
          };

          // 未來幾天：逐日唸明天、後天、大後天
          if (day === 4) {
            var parts = [];
            for (var i = 1; i <= 3; i++) {
              var t = dayText(i);
              if (t) parts.push(VOICE_DAY_NAMES[i] + "天氣" + t);
            }
            done(parts.length ? "未來三天天氣：" + parts.join("；") + "。" : "天氣資訊暫時無法取得。");
            return;
          }

          // 明天／後天／大後天
          if (day > 0) {
            var dt = dayText(day);
            done(dt ? VOICE_DAY_NAMES[day] + "天氣" + dt + "。" : "天氣資訊暫時無法取得。");
            return;
          }

          // 今天：即時氣溫＋今日高低溫
          if (!cur) {
            var todayText = dayText(0);
            done(todayText ? "今天天氣" + todayText + "。" : "天氣資訊暫時無法取得。");
            return;
          }
          var desc = VOICE_WEATHER_CODE[cur.weather_code] || "多雲";
          var say = "今天天氣" + desc + "，現在氣溫大約" + Math.round(cur.temperature_2m) +
            "度，體感" + Math.round(cur.apparent_temperature) + "度";
          if (hasDaily && daily.time[0]) {
            say += "；今天氣溫" + Math.round(daily.temperature_2m_min[0]) +
              "到" + Math.round(daily.temperature_2m_max[0]) + "度";
          }
          done(say + "。");
        })
        .catch(function () { done("天氣資訊暫時無法取得。"); });
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function (pos) { load(pos.coords.latitude, pos.coords.longitude); },
        function () { load(25.033, 121.5654); },
        { timeout: 4000, maximumAge: 600000 }
      );
    } else {
      load(25.033, 121.5654);
    }
  }

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

  // 彈窗內用：先比對關鍵字；都沒中但講到「今天／明天／後天」等，就當作在問天氣
  function resolveVoiceAction(text) {
    var action = matchVoiceCommand(text);
    if (!action && /今天|明天|後天|這幾天|一週|一周|未來/.test(String(text || ""))) action = "weather";
    return action;
  }

  // 喚醒詞「西北寶寶」：回傳喚醒後剩下的字（沒喚醒回傳 null，只喊喚醒詞則回傳空字串）
  var WAKE_GREETING = "我是西北寶寶，有什麼能為您服務的?";
  // 語音辨識常見的同音誤判，一併視為喚醒詞
  var WAKE_TOKENS = ["西北寶寶", "西寶寶", "西寶寶寶", "西北包包", "西北飽飽", "西貝寶寶"];
  function detectWake(text) {
    var raw = String(text || "");
    var norm = raw.replace(/[\s，,。.、！!？?；;：:]/g, "").toLowerCase();
    var hit = false;
    for (var i = 0; i < WAKE_TOKENS.length; i++) {
      if (norm.indexOf(WAKE_TOKENS[i]) >= 0) { hit = true; break; }
    }
    if (!hit) return null;
    return raw
      .replace(/哈囉|哈罗|你好|嗨|嘿/g, "")
      .replace(/西\s*[北貝贝杯]?\s*[寶包飽保]\s*[寶包飽保]?/g, "")
      .replace(/[北貝贝]\s*[寶包飽保]\s*[寶包飽保]?/g, "")
      .replace(/[寶包飽保]\s*[寶包飽保]+/g, "")
      .replace(/[\s，,。.、！!？?；;：:]+/g, "");
  }

  function runVoiceCommand(action, text) {
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
    if (action === "time") { speak(voiceTimeText()); return; }
    if (action === "date") { speak(voiceDateText()); return; }
    if (action === "myunit") { speak(voiceUnitText()); return; }
    if (action === "weather") {
      var range = voiceWeatherRange(text);
      fetchVoiceWeather(function (t) { speak(t); }, range);
      return;
    }
    if (VOICE_CHAT_ACTIONS[action]) { speak(VOICE_REPLY_TEXT[action] || VOICE_REPLY_FALLBACK); return; }
    if (action === "call") {
      var contact = matchPhoneContact(text);
      if (contact) { dialContact(contact); return; }
      dialPhone();
      return;
    }
    // 地圖查詢需要按鈕，改用語音彈窗呈現
    if (action === "maps") { wakeVoice(text); return; }
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
    wakeWatchClear();
    if (voiceCtl.rec) { try { voiceCtl.rec.stop(); } catch (e) {} }
    voiceCtl.listening = false;
    renderMic();
  }

  function initVoice() {
    if (!voiceCtl.supported) { renderMic(); return; }

    var rec = new SpeechRec();
    rec.lang = "zh-TW";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onstart = function () {
      voiceCtl.listening = true;
      voiceCtl.blocked = false;
      voiceCtl.delay = 250;
      renderMic();
    };
    rec.onresult = function (ev) {
      // 1) 先用「即時草稿」搶先抓喚醒詞「西北寶寶」：一聽到就回應，不必等整段講完
      if (!voicePanel.open) {
        var sawWake = false;
        for (var k = ev.resultIndex; k < ev.results.length; k++) {
          var rr = ev.results[k];
          if (rr.isFinal) continue;
          var draft = String((rr[0] && rr[0].transcript) || "");
          var wk = detectWake(draft);
          if (wk === null) continue;
          sawWake = true;
          if (wk.length > wakeText.length) wakeText = wk;
        }
        if (sawWake) {
          // 每聽到一段草稿就重新倒數 0.25 秒：讓同一句後面的指令有機會一起進來；真的只喊「西北寶寶」也會在 0.25 秒後立刻喚醒
          if (wakeWatch) clearTimeout(wakeWatch);
          wakeWatch = setTimeout(function () {
            wakeWatch = null;
            var cmd = wakeText;
            wakeText = "";
            if (!voicePanel.open) wakeVoice(cmd);
          }, 250);
        }
      }
      if (voicePanel.open) return;

      // 2) 最後結果：完整比對喚醒詞與指令
      var last = ev.results[ev.results.length - 1];
      if (!last || !last.isFinal) return;
      for (var i = 0; i < last.length; i++) {
        var text = last[i] && last[i].transcript;
        // 對講面板開著時：說「撥號」撥出、說「掛斷」掛斷（不需喚醒詞）
        if (handleIntercomVoice(text)) { wakeWatchClear(); return; }
        // 喚醒詞「西北寶寶」：喚醒後開啟語音彈窗並回覆提示音
        var wake = detectWake(text);
        if (wake !== null) { wakeWatchClear(); wakeVoice(wake); return; }
        var action = matchVoiceCommand(text);
        if (action) { wakeWatchClear(); runVoiceCommand(action, text); return; }
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

  /* ---------------- 語音合成：優先挑選男童聲，其次男聲（台灣中文優先） ---------------- */

  // 男童聲名稱（最優先；部分引擎會提供童聲）
  var VOICE_BOY_HINTS = ["boy", "child", "kid", "童", "小男孩", "男孩子"];
  // 常見男聲名稱（Chromium／Edge／Windows）
  var VOICE_MALE_HINTS = [
    "zhiwei", "yunjhe", "yunxi", "yunjian", "yunyang", "yunye", "yunhao",
    "kangkang", "liang", "danny", "wanlung",
  ];
  // 常見女聲名稱，避免被挑中
  var VOICE_FEMALE_HINTS = [
    "hsiaochen", "hsiaoyu", "yating", "hanhan", "meijia", "mei-jia", "sinji",
    "xiaoxiao", "xiaoyi", "xiaomo", "huihui", "yaoyao", "ting-ting", "tingting",
    "xiaoshuang", "hiugaai", "hiumaan", "tracy", "國語", "台灣", "臺灣",
  ];

  var _ttsVoice = null;
  var _ttsVoiceGender = "";

  // 從聲音名稱判斷性別（boy／male／female／未知）
  function ttsVoiceGender(v) {
    var name = String((v && v.name) || "").toLowerCase();
    var i;
    for (i = 0; i < VOICE_BOY_HINTS.length; i++) { if (name.indexOf(VOICE_BOY_HINTS[i]) >= 0) return "boy"; }
    for (i = 0; i < VOICE_MALE_HINTS.length; i++) { if (name.indexOf(VOICE_MALE_HINTS[i]) >= 0) return "male"; }
    for (i = 0; i < VOICE_FEMALE_HINTS.length; i++) { if (name.indexOf(VOICE_FEMALE_HINTS[i]) >= 0) return "female"; }
    return "";
  }

  function scoreTtsVoice(v) {
    var name = String(v.name || "").toLowerCase();
    var lang = String(v.lang || "").toLowerCase().replace(/_/g, "-");
    // 只考慮國語（華語）聲音；粵語（zh-hk／yue）腔調不合，不列入
    if (lang.indexOf("zh-hk") === 0 || lang.indexOf("yue") === 0) return -1;
    var s;
    if (lang.indexOf("zh-tw") === 0) s = 60;
    else if (lang.indexOf("zh") === 0) s = 55;
    else return -1;
    var gender = ttsVoiceGender(v);
    // 男童聲最優先，其次男聲；女聲盡量避免
    if (gender === "boy") s += 50;
    else if (gender === "male") s += 45;
    else if (gender === "female") s -= 40;
    // Edge 的 Online (Natural) 聲音最接近真人，優先
    if (name.indexOf("natural") >= 0 || name.indexOf("online") >= 0) s += 10;
    if (v.localService) s += 2;
    return s;
  }

  function ttsVoice() {
    if (_ttsVoice) return _ttsVoice;
    if (!("speechSynthesis" in window)) return null;
    var voices;
    try { voices = window.speechSynthesis.getVoices() || []; } catch (e) { return null; }
    if (!voices.length) return null;
    var best = null;
    var bestScore = 0;
    voices.forEach(function (v) {
      var s = scoreTtsVoice(v);
      if (s > bestScore) { bestScore = s; best = v; }
    });
    if (best) { _ttsVoice = best; _ttsVoiceGender = ttsVoiceGender(best); }
    return best;
  }

  if ("speechSynthesis" in window) {
    try {
      // 語音清單是非同步載入的，載入完成後重新挑一次
      window.speechSynthesis.onvoiceschanged = function () { _ttsVoice = null; ttsVoice(); };
      ttsVoice();
    } catch (e) {}
  }

  // 套用挑好的聲音（找不到就退回語言設定）
  // 手機若沒有男童／男聲，改用現有聲音並「降低音高」模擬低沉男聲，避免尖細女聲
  function applyTtsVoice(u) {
    var v = ttsVoice();
    var gender = _ttsVoiceGender;
    if (v) {
      u.voice = v;
      if (v.lang) u.lang = v.lang;
    } else {
      u.lang = "zh-TW";
      gender = ""; // 無法判斷時，保守以偏男聲處理
    }
    u.rate = 0.88;
    if (gender === "boy") u.pitch = 1;
    else if (gender === "male") u.pitch = 0.9;
    else u.pitch = 0.6; // 女聲／未知：降音高模擬男聲
    return u;
  }

  // 「西北寶寶」動畫（nwbb.mp4）：每次觸發只播放一次（不循環）
  var _nwbbPlayedAt = 0;
  function playNwbb() {
    var v = el.voiceVideo;
    if (!v || !el.voice || el.voice.hidden) return;
    var now = Date.now();
    // 開啟彈窗與問候語幾乎同時觸發，避免同一時間重複播放
    if (now - _nwbbPlayedAt < 500) return;
    _nwbbPlayedAt = now;
    try {
      v.currentTime = 0;
      var p = v.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {}
  }

  function speak(text) {
    if (!state.voice) return;
    var msg = String(text || "").trim();
    if (!msg || !("speechSynthesis" in window)) return;
    playNwbb();
    try {
      window.speechSynthesis.cancel();
      var u = applyTtsVoice(new SpeechSynthesisUtterance(msg));
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

  // 播報一段話，播完（或被中斷）後執行 onDone
  function speakThen(text, onDone) {
    var done = function () { if (onDone) onDone(); };
    var msg = String(text || "").trim();
    if (!state.voice || !msg || !("speechSynthesis" in window)) { done(); return; }
    playNwbb();
    try {
      window.speechSynthesis.cancel();
      var u = applyTtsVoice(new SpeechSynthesisUtterance(msg));
      var guard = setTimeout(done, 12000);
      var finish = function () { clearTimeout(guard); done(); };
      u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.speak(u);
    } catch (e) { done(); }
  }

  /* ---------------- 語音說話彈窗（上：您的話／下：回覆＋播報） ---------------- */

  var VOICE_REPLY_TEXT = {
    parcel: "好的，我幫您看看有沒有您的包裹。",
    bulletin: "好的，我幫您看社區公告。",
    visitor: "好的，我幫您開啟訪客登記。",
    facility: "好的，我幫您開啟公設預約。",
    meter: "好的，我幫您看水電繳費。",
    sos: "好的，我馬上幫您求救。",
    bigger: "好的，字會變大喔。",
    smaller: "好的，字會變小喔。",
    signout: "好的，我幫您登出。",
    back: "好的，回到上一頁。",
    home: "好的，回到首頁。",
    support: "好的，我幫您打開功能。",
    notice: "好的，我幫您看通知。",
    intercom: "好的，我幫您打開對講。",
    profile: "好的，我幫您看個人資料。",
    call: "好的，我幫您撥打電話。",
    greet: "您好，我是西北寶寶，有什麼能為您服務的?",
    thanks: "不客氣，能幫上忙我很開心。",
    bye: "再見，祝您有美好的一天。",
    who: "我是西北寶寶，社區的語音小幫手。可以幫您看包裹、看公告、訪客登記、公設預約、水電繳費、對講，也可以報時間、日期和天氣。",
    help: "我可以幫您做這些事：看包裹、看公告、訪客登記、公設預約、水電繳費、對講、現在幾點、今天天氣、打電話。您只要說出需求就可以了。",
  };
  var VOICE_REPLY_FALLBACK = "抱歉，我沒聽清楚，請您再說一次。";

  // 這些只需回話（問候、道謝、閒聊），不會開啟任何功能
  var VOICE_CHAT_ACTIONS = { greet: 1, thanks: 1, bye: 1, who: 1, help: 1 };

  // 聽不懂時仍要給回覆：複述聽到的內容，並提示可以怎麼說
  function voiceAskBackText(text) {
    var t = String(text || "").trim();
    if (t.length < 2) return VOICE_REPLY_FALLBACK;
    return "您說的是「" + t + "」。這個我還不會回答，您可以說：看包裹、看公告、看天氣、現在幾點，或是說打電話。";
  }

  // 報出自己的社區與戶號
  function voiceUnitText() {
    var d = state.profile || {};
    var community = String(state.communityName || (el.communityName ? el.communityName.textContent : "") || "").trim();
    var houseNo = String(d.houseNo || d.unit || "").trim();
    var sub = String(d.subUnit || d.subHouseNo || "").trim();
    if (!community && !houseNo) return "我目前查不到您的社區資料。";
    return "您住在" + community + (houseNo ? "，戶號" + houseNo + (sub ? "之" + sub : "") : "") + "。";
  }

  // 電話號碼逐字唸（用空白分隔，語音才會一位一位唸），長輩才聽得清楚
  function voicePhoneText(phone) {
    var digits = String(phone || "").replace(/[^0-9]/g, "");
    if (!digits) return String(phone || "");
    return digits.split("").join(" ");
  }

  // 從句子中找出要查的地點關鍵字（取最長命中者）
  function voiceMapPoi(text) {
    var t = String(text || "").replace(/[\s,，。、！!？?；;：:]/g, "");
    var hit = "";
    VOICE_MAP_POI.forEach(function (w) {
      if (t.indexOf(w) >= 0 && w.length > hit.length) hit = w;
    });
    return hit;
  }

  // 用地點關鍵字開啟 Google 地圖搜尋（帶入使用者目前位置附近）
  function openVoiceMap(poi) {
    var q = String(poi || "").trim();
    if (!q) return;
    var url = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("附近的" + q);
    var win = null;
    try { win = window.open(url, "_blank", "noopener"); } catch (e) {}
    if (!win) { try { location.href = url; } catch (e2) {} }
  }

  // 判斷是否為「地址／地名／店家名」：是的話給 Google 地圖按鈕，否則給 Google 搜尋按鈕
  var VOICE_PLACE_RE = new RegExp([
    "地址", "路", "街", "巷", "弄", "號", "樓", "段", "大道", "圓環", "廣場",
    "市", "區", "里", "村", "鄰",
    "店", "公司", "企業", "商行", "銀行", "診所", "藥局", "藥房", "醫院", "餐廳",
    "咖啡", "超商", "便利商店", "超市", "賣場", "百貨", "加油站", "機車行", "五金行",
    "郵局", "飯店", "旅館", "民宿", "學校", "幼兒園", "補習班", "髮廊", "理髮", "洗衣",
    "眼鏡", "麵包店", "飲料店", "小吃",
    "公園", "廟", "寺", "宮", "教堂", "車站", "捷運", "火車站", "高鐵", "機場", "夜市",
    "市場", "圖書館", "運動中心", "大樓", "社區", "風景區", "老街", "博物館", "美術館",
    "動物園", "觀光", "景點",
    "在哪", "哪裡", "那裏", "怎麼去", "怎麼走", "怎麼到", "帶我去",
  ].join("|"));
  function looksLikePlace(text) {
    return VOICE_PLACE_RE.test(String(text || ""));
  }

  // 用關鍵字開啟 Google 搜尋
  function openVoiceSearch(query) {
    var q = String(query || "").trim();
    if (!q) return;
    var url = "https://www.google.com/search?q=" + encodeURIComponent(q);
    var win = null;
    try { win = window.open(url, "_blank", "noopener"); } catch (e) {}
    if (!win) { try { location.href = url; } catch (e2) {} }
  }

  var voicePanel = {
    open: false,
    busy: false,
    rec: null,
    listening: false,
    timer: null,
    wasGlobal: false,
    asks: [],
    replies: [],
    pending: "",
  };
  var voicePanelBackPending = false;
  var voicePanelAfterBack = null;

  // 記錄用的時間戳（HH:MM:SS）
  function voiceClock() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function voiceRecordHtml(item) {
    var html = '<span class="sp-voice-line">' +
      '<span class="sp-voice-time">' + escapeHtml(item.time) + "</span>" +
      '<span class="sp-voice-body">' + escapeHtml(item.text) + "</span>" +
      "</span>";
    if (item.map) {
      html += '<button type="button" class="sp-voice-map" data-map="' + escapeHtml(item.map) +
        '"><span class="sp-voice-map-icon">🗺</span>開啟地圖看「' + escapeHtml(item.map) + '」</button>';
    }
    if (item.search) {
      html += '<button type="button" class="sp-voice-map sp-voice-search" data-search="' + escapeHtml(item.search) +
        '"><span class="sp-voice-map-icon">🔍</span>用 Google 搜尋「' + escapeHtml(item.search) + '」</button>';
    }
    return html;
  }

  function renderVoiceAsk(draft) {
    if (!el.voiceAskText) return;
    var html = voicePanel.asks.map(voiceRecordHtml).join("");
    if (draft) {
      html += '<span class="sp-voice-line sp-voice-pending"><span class="sp-voice-body">' + escapeHtml(draft) + "</span></span>";
    }
    el.voiceAskText.innerHTML = html || "請開始說話…";
    el.voiceAskText.scrollTop = el.voiceAskText.scrollHeight;
  }

  function renderVoiceReply() {
    if (!el.voiceReplyText) return;
    var html = voicePanel.replies.map(voiceRecordHtml).join("");
    if (voicePanel.pending) {
      html += '<span class="sp-voice-line sp-voice-pending"><span class="sp-voice-body">' + escapeHtml(voicePanel.pending) + "</span></span>";
    }
    el.voiceReplyText.innerHTML = html || "…";
    el.voiceReplyText.scrollTop = el.voiceReplyText.scrollHeight;
  }

  // 過場訊息（查詢中、提示語）暫時顯示在最後一行，不列入紀錄
  function setVoiceReply(text) {
    voicePanel.pending = String(text || "");
    renderVoiceReply();
  }

  // 正式回覆：加一筆帶時間的紀錄（map 為地點關鍵字時附「開啟地圖」按鈕、search 為關鍵字時附「Google 搜尋」按鈕）
  function pushVoiceReply(text, map, search) {
    voicePanel.pending = "";
    voicePanel.replies.push({ time: voiceClock(), text: String(text || ""), map: map || "", search: search || "" });
    renderVoiceReply();
  }

  function voicePanelRestart(delay) {
    clearTimeout(voicePanel.timer);
    voicePanel.timer = setTimeout(function () {
      if (!voicePanel.open || voicePanel.busy) return;
      try { voicePanel.rec.start(); } catch (e) {}
    }, typeof delay === "number" ? delay : 700);
  }

  function voicePanelRec() {
    if (voicePanel.rec) return voicePanel.rec;
    var rec = new SpeechRec();
    rec.lang = "zh-TW";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = function () { voicePanel.listening = true; };
    rec.onresult = function (ev) {
      var draft = "";
      var finalText = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        var t = String((r[0] && r[0].transcript) || "");
        if (r.isFinal) finalText += t;
        else draft += t;
      }
      if (draft) renderVoiceAsk(draft);
      if (finalText.trim()) respondToVoice(finalText.trim());
    };
    rec.onerror = function (ev) {
      var err = String((ev && ev.error) || "");
      if (err === "not-allowed" || err === "service-not-allowed") {
        setVoiceReply("沒有麥克風權限，請允許使用麥克風後再試一次。");
      } else if (err === "network") {
        voicePanelRestart(2500);
      }
    };
    rec.onend = function () {
      voicePanel.listening = false;
      if (voicePanel.open && !voicePanel.busy) voicePanelRestart();
    };
    voicePanel.rec = rec;
    return rec;
  }

  // 依關鍵字產生回覆；比對到功能時，播完回覆後自動開啟該功能
  function respondToVoice(text) {
    voicePanel.busy = true;
    try { voicePanel.rec.stop(); } catch (e) {}
    voicePanel.asks.push({ time: voiceClock(), text: text });
    renderVoiceAsk("");
    var action = resolveVoiceAction(text);

    // 播完回覆後：有 action 就關閉彈窗並開啟功能，否則恢復收音
    var finishReply = function (reply, runnable, map, search) {
      if (!voicePanel.open) return;
      pushVoiceReply(reply, map, search);
      speakThen(reply, function () {
        if (!voicePanel.open) return;
        if (!runnable) { voicePanel.busy = false; voicePanelRestart(); return; }
        // 關閉彈窗（會退回一筆歷史）後才開啟功能，避免歷史堆疊錯亂
        var run = function () {
          if (typeof runnable === "function") runnable();
          else runVoiceAction(runnable);
        };
        var didBack = closeVoicePanel(false);
        if (didBack) voicePanelAfterBack = run;
        else run();
      });
    };

    // 時間／日期／自己的社區戶號：直接播報答案，不開啟任何功能
    if (action === "time") { finishReply(voiceTimeText(), ""); return; }
    if (action === "date") { finishReply(voiceDateText(), ""); return; }
    if (action === "myunit") { finishReply(voiceUnitText(), ""); return; }

    // 地圖：找出要問的地點，回覆並附上「開啟地圖」按鈕
    if (action === "maps") {
      var poi = voiceMapPoi(text);
      if (!poi) {
        finishReply("您想找附近的什麼呢？例如水電行、藥局、便利商店、餐廳。", "");
        return;
      }
      finishReply("好的，我幫您找附近的" + poi + "，請點下面的按鈕開啟地圖。", "", poi);
      return;
    }

    // 天氣：依問的「今天／明天／後天／未來幾天」查詢後播報
    if (action === "weather") {
      var range = voiceWeatherRange(text);
      setVoiceReply("正在為您查詢" + VOICE_DAY_NAMES[range] + "的天氣…");
      fetchVoiceWeather(function (reply) { finishReply(reply, ""); }, range);
      return;
    }

    // 打電話：先看是不是「請打電話給<姓名/暱稱>」，問號碼就報號碼，否則直接撥管理中心
    // 撥號動作在語音辨識到指令的同步脈絡中立即執行，避免瀏覽器彈出確認（不需再按按鍵）
    if (action === "call") {
      var contact = matchPhoneContact(text);
      if (contact) {
        var cname = String(contact.name || "對方");
        pushVoiceReply("好的，正在為您撥打" + cname + "的電話。");
        speak("好的，正在為您撥打" + cname + "的電話。");
        dialContact(contact);
        voicePanel.busy = false;
        if (voicePanel.open) closeVoicePanel(false);
        return;
      }
      setVoiceReply("正在為您查詢電話…");
      var askNumber = /幾號|多少|是什麼|號碼/.test(String(text));
      resolveDialPhone(function (phone) {
        if (!phone) { finishReply("目前沒有設定管理中心的電話，請洽管理中心。", ""); return; }
        if (askNumber) { finishReply("管理中心的電話是" + voicePhoneText(phone) + "。", ""); return; }
        // 管理中心電話也直接撥，不等待語音播完
        pushVoiceReply("好的，正在為您撥打" + voicePhoneText(phone) + "。");
        speak("好的，正在為您撥打" + voicePhoneText(phone) + "。");
        dialPhone();
        voicePanel.busy = false;
        if (voicePanel.open) closeVoicePanel(false);
      });
      return;
    }

    if (action) {
      // 問候、道謝、閒聊類只回話，不開啟任何功能
      var runnable = VOICE_CHAT_ACTIONS[action] ? "" : action;
      finishReply(VOICE_REPLY_TEXT[action] || VOICE_REPLY_FALLBACK, runnable);
      return;
    }

    // 聽不懂時：先判斷是不是地址／地名／店家名——是就給 Google 地圖按鈕，否則給 Google 搜尋按鈕
    var q = String(text || "").trim();
    if (q.length >= 2) {
      if (looksLikePlace(q)) {
        finishReply("我幫您在 Google 地圖上找「" + q + "」，請點下面的按鈕查看。", "", q);
      } else {
        finishReply("這個我幫您用 Google 搜尋「" + q + "」，請點下面的按鈕查看。", "", "", q);
      }
      return;
    }

    // 聽不懂也要回覆：複述聽到的內容並提示可以怎麼說
    finishReply(voiceAskBackText(text), "");
  }

  function runVoiceAction(action) {
    if (action === "back") { if (sheetOpen) hideSheet(false); return; }
    if (action === "signout") { if (el.signOut) el.signOut.click(); return; }
    if (action === "bigger") { stepScale(1); return; }
    if (action === "smaller") { stepScale(-1); return; }
    if (action === "call") { dialPhone(); return; }
    handleAction(action, true);
  }

  // 被喚醒詞「西北寶寶」喚醒：開啟語音彈窗、回覆提示音；若同一句還有指令就直接執行
  function wakeVoice(firstCommand) {
    if (voicePanel.open) return;
    openVoicePanel(WAKE_GREETING, firstCommand);
  }

  function openVoicePanel(greeting, firstCommand) {
    if (!el.voice) return;
    if (!voiceCtl.supported) { toast("這個瀏覽器不支援語音輸入"); return; }
    var greet = String(greeting || "").trim() || WAKE_GREETING;
    var first = String(firstCommand || "").trim();
    voicePanel.open = true;
    voicePanel.busy = false;
    voicePanel.asks = [];
    voicePanel.replies = [];
    voicePanel.pending = "";
    renderVoiceAsk("");
    setVoiceReply(first ? "…" : "請說出您的需求，例如「看公告」「今天天氣」「明天會不會下雨」「現在幾點」…");
    el.voice.hidden = false;
    playNwbb();
    try { history.pushState({ __spVoice: true }, ""); } catch (e) {}
    // 暫停主頁的背景語音，改用彈窗專屬的收音
    voicePanel.wasGlobal = Boolean(voiceCtl.want || voiceCtl.listening);
    voiceStop();
    clearTimeout(voicePanel.timer);
    voicePanelRec();
    speakThen(greet, function () {
      if (!voicePanel.open) return;
      if (first) { respondToVoice(first); return; }
      voicePanelRestart(200);
    });
  }

  // 回傳 true 表示有呼叫 history.back()（歷史會在稍後由 popstate 收尾）
  function closeVoicePanel(fromPop) {
    if (!voicePanel.open) return false;
    voicePanel.open = false;
    voicePanel.busy = false;
    clearTimeout(voicePanel.timer);
    if (voicePanel.rec) { try { voicePanel.rec.stop(); } catch (e) {} }
    stopSpeak();
    if (el.voice) el.voice.hidden = true;
    var didBack = false;
    if (!fromPop) {
      try {
        if (history.state && history.state.__spVoice) {
          voicePanelBackPending = true;
          history.back();
          didBack = true;
        }
      } catch (e) {}
    }
    // 關閉彈窗後一定要恢復「西北寶寶」常駐收音，否則喚醒詞會失效、要喊多次才有反應
    if (!voiceCtl.blocked) voiceStart();
    return didBack;
  }

  /* ---------------- 字級 ---------------- */

  // 把任意舊字級對應到最接近的固定字級（小／中／大）
  function nearestScale(scale) {
    var best = SCALES[1];
    var bestDiff = Infinity;
    SCALES.forEach(function (v) {
      var d = Math.abs(v - scale);
      if (d < bestDiff) { bestDiff = d; best = v; }
    });
    return best;
  }

  // 目前字級對應「小／中／大」的標籤
  function fontSizeLabel(scale) {
    var best = null;
    var bestDiff = Infinity;
    FONT_SIZES.forEach(function (f) {
      var d = Math.abs(f.scale - scale);
      if (d < bestDiff) { bestDiff = d; best = f; }
    });
    return best ? best.label : "中";
  }

  // 同步「小／中／大」三顆按鈕的選取狀態
  function syncFontButtons() {
    var nodes = document.querySelectorAll('[data-action="font-size"]');
    for (var i = 0; i < nodes.length; i++) {
      var s = parseFloat(nodes[i].getAttribute("data-scale"));
      nodes[i].classList.toggle("is-active", isFinite(s) && Math.abs(s - state.scale) < 0.001);
    }
  }

  function applyScale(scale) {
    state.scale = scale;
    document.documentElement.style.setProperty("--fs", String(scale));
    try { localStorage.setItem(STORAGE_SCALE, String(scale)); } catch (e) {}
    if (el.fontDown) el.fontDown.disabled = scale <= SCALES[0];
    if (el.fontUp) el.fontUp.disabled = scale >= SCALES[SCALES.length - 1];
    if (el.fontStatus) el.fontStatus.textContent = "字體：" + fontSizeLabel(scale);
    syncFontButtons();
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

  // 指定固定字級（小／中／大）
  function setFontSize(scale) {
    if (!isFinite(scale)) return;
    applyScale(scale);
    speak("字體改成" + fontSizeLabel(scale));
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
  // 面板堆疊：從「功能」頁進入「我的包裹」等子頁時，把上一頁存起來，
  // 按「回上一頁」可回到功能頁，而不是直接關閉回首頁。
  var sheetStack = [];
  var currentSheetOpt = null;

  // 常用服務區塊平常收在文件尾端（hidden），只有「功能」面板開啟時搬進面板
  function parkServices() {
    if (!el.services) return;
    el.services.hidden = true;
    if (el.services.parentNode !== document.body) document.body.appendChild(el.services);
  }

  function openSheet(options) {
    var opt = options || {};
    if (!el.sheet) return;
    var replacing = sheetOpen;
    var fromBack = !!opt.__fromBack;
    // 若已有面板開著（例如從「功能」頁點進「我的包裹」），把目前面板存進堆疊，
    // 之後按「回上一頁」可回到此面板。
    if (replacing && currentSheetOpt && !fromBack) {
      sheetStack.push(currentSheetOpt);
    }
    currentSheetOpt = opt;
    sheetOpen = true;
    // 面板底部改為顯示同一條底部導覽（把主導覽移進面板頁尾）
    if (el.bar && el.sheetFt && el.bar.parentNode !== el.sheetFt) el.sheetFt.appendChild(el.bar);
    // 換到別的面板時，先把「常用服務」收起來
    if (el.services && el.services.parentNode === el.sheetBody && opt.node !== el.services) parkServices();
    el.sheet.classList.toggle("has-frame", Boolean(opt.frameUrl));
    if (el.sheetTitle) el.sheetTitle.textContent = String(opt.title || "");
    // 若目前面板內容是對講，切換面板前先清理通話連線
    if (el.sheetBody && el.sheetBody.querySelector("#intercomCallModal90")) {
      cleanupIntercomActive({ updateStatus: "ended" });
    }
    el.sheetBody.innerHTML = "";
    if (opt.frameUrl) {
      var frame = document.createElement("iframe");
      frame.className = "sp-frame";
      frame.setAttribute("allow", "camera; microphone; clipboard-write; autoplay; fullscreen");
      frame.setAttribute("allowfullscreen", "true");
      frame.src = String(opt.frameUrl);
      el.sheetBody.appendChild(frame);
    } else if (opt.node) {
      opt.node.hidden = false;
      el.sheetBody.appendChild(opt.node);
      if (opt.html) {
        var extra = document.createElement("div");
        extra.className = "sp-sheet-extra";
        extra.innerHTML = String(opt.html);
        el.sheetBody.appendChild(extra);
      }
      if (typeof opt.afterRender === "function") opt.afterRender(el.sheetBody);
    } else {
      el.sheetBody.innerHTML = String(opt.html || "");
      if (typeof opt.afterRender === "function") opt.afterRender(el.sheetBody);
    }
    el.sheet.hidden = false;
    el.sheet.dataset.speak = String(opt.speakText || opt.title || "");
    // 首次開面板 pushState；從堆疊回上一頁時不 push（歷史紀錄已在正確位置）
    if (!fromBack) {
      try { history.pushState({ __spSheet: true }, ""); } catch (e) {}
    }
    if (!opt.silent) speak(opt.speakText || opt.title || "");
  }

  function hideSheet(fromPop) {
    if (!sheetOpen) return false;
    // 若堆疊裡有上一頁，回到上一頁而不是直接關閉
    if (sheetStack.length > 0) {
      var prev = sheetStack.pop();
      var restoreOpt = {};
      for (var k in prev) {
        if (Object.prototype.hasOwnProperty.call(prev, k)) restoreOpt[k] = prev[k];
      }
      restoreOpt.__fromBack = true;
      openSheet(restoreOpt);
      if (!fromPop) {
        // 按鈕觸發：同步把歷史紀錄退一格（popstate 會被 sheetBackPending 擋下）
        try { sheetBackPending = true; history.back(); } catch (e) {}
      }
      return false;
    }
    sheetOpen = false;
    currentSheetOpt = null;
    sheetStack = [];
    setActiveNav(el.homeNav);
    stopSpeak();
    // 底部導覽移回主頁面
    if (el.bar && el.shell && el.bar.parentNode !== el.shell) el.shell.appendChild(el.bar);
    if (el.sheet) {
      // 若目前面板內容是對講，關閉面板前先清理通話連線
      if (el.sheetBody && el.sheetBody.querySelector("#intercomCallModal90")) {
        cleanupIntercomActive({ updateStatus: "ended" });
      }
      el.sheet.hidden = true;
      el.sheet.classList.remove("has-frame");
      if (el.services && el.services.parentNode === el.sheetBody) parkServices();
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
    return true;
  }

  window.addEventListener("popstate", function () {
    // 忽略自己呼叫 history.back() 造成的那一次 popstate，避免把剛開啟的面板關掉
    if (sheetBackPending) { sheetBackPending = false; return; }
    if (phonePanelBackPending) { phonePanelBackPending = false; return; }
    if (voicePanelBackPending) {
      voicePanelBackPending = false;
      // 彈窗關閉後要接續執行的功能（例如「看公告」）
      var afterBack = voicePanelAfterBack;
      voicePanelAfterBack = null;
      if (afterBack) afterBack();
      return;
    }
    if (voicePanel.open) { closeVoicePanel(true); return; }
    if (phonePanel.open) { closePhonePanel(true); return; }
    if (sheetOpen) hideSheet(true);
  });

  el.sheetSpeak.addEventListener("click", function () {
    var text = el.sheet.dataset.speak || (el.sheetTitle ? el.sheetTitle.textContent : "");
    if (state.voice) speak(text);
    else toast("語音報讀已關閉，可按右下角「語音開」打開");
  });

  if (el.sheetBack) {
    el.sheetBack.addEventListener("click", function () {
      var closed = hideSheet(false);
      // 只有真的關閉面板（回到首頁）時才語音說「回上一頁」；
      // 若只是回到上一層子頁面，openSheet 會自己報讀該頁標題。
      if (state.voice && closed) speak("回上一頁");
    });
  }

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

  function renderClock() {
    if (!el.todayClock) return;
    var t = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    el.todayClock.textContent = pad(t.getHours()) + "：" + pad(t.getMinutes()) + "：" + pad(t.getSeconds());
    // 時段變動時（跨整點）自動更新問候語
    if (el.greetingLine) {
      var text = greetingByHour(t.getHours());
      if (el.greetingLine.textContent !== text) el.greetingLine.textContent = text;
    }
  }

  // 依時段回傳問候語（每三小時一段，跨午夜 21:00~00:00 歸到「晚安」）
  function greetingByHour(hour) {
    var h = hour;
    if (h >= 0 && h < 3) return "很晚囉！該睡覺了。";
    if (h >= 3 && h < 6) return "還沒天亮！再睡一下。";
    if (h >= 6 && h < 9) return "早安！來做運動身體好。";
    if (h >= 9 && h < 12) return "上午好！今天該做什麼事呢？";
    if (h >= 12 && h < 15) return "午安！吃飽沒？";
    if (h >= 15 && h < 18) return "下午囉！來點下午茶。";
    if (h >= 18 && h < 21) return "晚上好！今天過的好嗎？";
    return "晚安！祝您有個好夢。";
  }

  function renderGreeting() {
    var d = state.profile || {};
    var name = String(d.displayName || d.name || "").trim();
    var hour = new Date().getHours();
    if (el.greetingLine) el.greetingLine.textContent = greetingByHour(hour);
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
    renderClock();

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

  /* 問候區上方顯示本人 QR code（未自訂時採動態預設碼：社區編號-A戶號編號ADDT-子戶號） */
  // 解析本人 QR code 的內容 token（無則回空字串）
  function resolveQrToken() {
    return new Promise(function (resolve) {
      var d = state.profile || {};
      var sub = String(d.subUnit || d.subHouseNo || d.sub || "").trim();

      var custom = String(d.qrToken || "").trim();
      if (custom && custom !== "A000ADDT") { resolve(custom); return; }

      var cid = String(state.cid || "").trim();
      var houseNo = String(d.houseNo || d.unit || "").trim();
      if (!cid || cid === "default" || !houseNo) { resolve(""); return; }

      db.collection("communities").doc(cid).get()
        .then(function (doc) {
          var v = doc && doc.exists ? (doc.data() || {}) : {};
          var code = String(v.username || state.code || "").trim();
          var key = houseNo.toLowerCase();
          var unitNo = "";
          var units = Array.isArray(v.units) ? v.units : [];
          for (var i = 0; i < units.length; i++) {
            var u = units[i];
            if (u && String(u.id || "").trim().toLowerCase() === key) {
              // 優先使用 unitNo（戶號編號），若未設定則回退使用 id（戶號）
              unitNo = String(u.unitNo || u.id || "").trim();
              break;
            }
          }
          if (!code || !unitNo) { resolve(""); return; }
          var base = code + "-A" + unitNo + "ADDT";
          resolve(sub ? base + "-" + sub : base);
        })
        .catch(function () { resolve(""); });
    });
  }

  // 以 qrcode-generator 產生 QR code 圖片（GIF base64 data URL）
  function generateQrDataUrl(token) {
    if (!token) return "";
    if (typeof qrcode !== "function") return "";
    try {
      var qr = qrcode(0, "M");
      qr.addData(String(token));
      qr.make();
      // cellSize=4, margin=2：產出解析度足夠、邊界適中的 QR 圖
      return qr.createDataURL(4, 2);
    } catch (e) {
      return "";
    }
  }

  function qrImageUrl(token) {
    if (!token) return "";
    // 優先使用本機函式庫產生的 data URL（離線可用、不需外部 API）
    var dataUrl = generateQrDataUrl(token);
    if (dataUrl) return dataUrl;
    // 後援：外部 QR 服務（僅在本機函式庫未載入時使用）
    return "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=" + encodeURIComponent(token);
  }

  function renderGreetQr() {
    if (!el.greetQr || !el.greetQrImg) return;
    resolveQrToken().then(function (token) {
      if (!token) {
        el.greetQr.hidden = true;
        el.greetQrImg.removeAttribute("src");
        return;
      }
      el.greetQrImg.src = qrImageUrl(token);
      el.greetQr.hidden = false;
    });
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
    if (el.navBadge) {
      el.navBadge.textContent = String(n);
      el.navBadge.hidden = n <= 0;
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

  function openBulletinSheet(opt) {
    var list = state.bulletins;
    var body = list.length
      ? list.map(bulletinItemHtml).join("")
      : '<div class="sp-empty"><div class="sp-empty-icon">📢</div>目前沒有新公告</div>';
    openSheet({
      title: (opt && opt.title) || "社區公告",
      html: '<h3 class="sp-sheet-subhd">社區公告</h3>' + body,
      speakText: list.length ? "社區公告，共 " + list.length + " 則" : "目前沒有新公告",
      silent: !!(opt && opt.silent),
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
      icon: "SOS",
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

  // 找出可撥打的電話：優先用住戶自訂號碼，其次用社區設定的管理中心電話
  function resolveDialPhone(cb) {
    var ms = loadMemberSettings();
    if (ms.sosMode === "custom" && ms.sosCustomPhone) { cb(ms.sosCustomPhone); return; }
    loadSosConfig().then(function (cfg) { cb(String(cfg.phone || "").trim()); });
  }

  function dialPhone() {
    resolveDialPhone(function (phone) {
      if (!phone) { toast("目前沒有設定管理中心的電話，請洽管理中心"); return; }
      toast("正在為您撥號：" + phone);
      location.href = "tel:" + phone;
    });
  }

  /* ---------------- 六大功能點擊 ---------------- */

  function openFrame(title, url) {
    openSheet({ title: title, frameUrl: url, speakText: title + "，打開了。看完了請按左上角的回上一頁" });
  }

  function moduleUrl(page, extra) {
    var q = [];
    if (state.code) q.push("c=" + encodeURIComponent(state.code));
    if (extra) q.push(extra);
    return page + (q.length ? "?" + q.join("&") : "");
  }

  function goHome() {
    // 首頁按鈕：直接關閉所有面板、清空堆疊，回到首頁（不是只退一層）
    if (sheetOpen) {
      sheetStack = [];
      currentSheetOpt = null;
      hideSheet(false);
    }
    if (el.home) el.home.scrollTo({ top: 0, behavior: "smooth" });
    setActiveNav(el.homeNav);
  }

  function handleAction(action, silent) {
    if (action === "home") { if (!silent) speak("首頁"); goHome(); return; }
    if (action === "support") { if (!silent) speak("功能"); openSupportSheet({ silent: !!silent }); return; }
    if (action === "notice") {
      if (!silent) speak("通知");
      loadBulletins().then(function () { openBulletinSheet({ silent: !!silent, title: "通知" }); });
      return;
    }
    if (action === "profile") { if (!silent) speak("個人"); openProfileSheet({ silent: !!silent }); return; }
    if (action === "intercom") {
      if (!silent) speak("對講");
      setActiveNav(el.intercomNav);
      openIntercomCallModal();
      return;
    }
    if (action === "parcel") {
      if (!silent) speak("我的包裹");
      loadParcels().then(openParcelSheet);
      return;
    }
    if (action === "bulletin") {
      if (!silent) speak("社區公告");
      loadBulletins().then(function () { openBulletinSheet({ silent: !!silent }); });
      return;
    }
    if (action === "visitor") {
      if (!silent) speak("訪客登記");
      openFrame("訪客登記", moduleUrl("visitor-resident.html", "embed=1"));
      return;
    }
    if (action === "facility") {
      if (!silent) speak("公設預約");
      openFrame("公設預約", moduleUrl("facility.html"));
      return;
    }
    if (action === "live-news") {
      if (!silent) speak("直播新聞");
      openFrame("直播新聞", moduleUrl("livetv.html"));
      return;
    }
    if (action === "live-music") {
      if (!silent) speak("創作音樂");
      openFrame("創作音樂", moduleUrl("livemusic.html"));
      return;
    }
    if (action === "live-broadcast") {
      if (!silent) speak("線上廣播");
      openFrame("線上廣播", moduleUrl("broadcasttv.html"));
      return;
    }
    if (action === "live-video") {
      if (!silent) speak("熱門影片");
      openFrame("熱門影片", moduleUrl("videotv.html"));
      return;
    }
    if (action === "meter") {
      if (!silent) speak("水電繳費");
      openFrame("水電繳費", moduleUrl("number-list.html"));
      return;
    }
    if (action === "sos") {
      if (!silent) speak("SOS");
      triggerSos();
    }
  }

  function openSupportSheet(opt) {
    openSheet({
      title: "功能",
      node: el.services,
      speakText: "常用服務，請選擇您需要的功能",
      silent: !!(opt && opt.silent),
    });
  }

  function openProfileSheet(opt) {
    var profile = state.profile || {};
    var name = String(profile.displayName || profile.name || "住戶").trim();
    var houseNo = String(profile.houseNo || profile.unit || "").trim();
    var sub = String(profile.subUnit || profile.subHouseNo || "").trim();
    var unit = houseNo ? houseNo + (sub ? "-" + sub : "") : "尚未設定";
    var community = state.communityName || "社區服務系統";

    // 大頭照：優先用住戶資料，其次用登入帳號頭像，都沒有則顯示姓名首字
    var avatarUrl = String(profile.avatarDataUrl || profile.avatar || "").trim();
    if (!avatarUrl) {
      try { avatarUrl = String((auth.currentUser && auth.currentUser.photoURL) || "").trim(); } catch (e) {}
    }
    var initial = (name ? name.slice(0, 1) : "") || "住";
    var photoHtml = avatarUrl
      ? '<img class="sp-profile-photo-img" src="' + escapeHtml(avatarUrl) + '" alt="大頭照">'
      : '<span class="sp-profile-photo-initial">' + escapeHtml(initial) + "</span>";

    openSheet({
      title: "我的資料",
      html:
        '<div class="sp-profile-card">' +
          '<div class="sp-profile-photo">' + photoHtml + "</div>" +
          '<div class="sp-profile-info">' +
            '<div class="sp-profile-name">' + escapeHtml(name) + "</div>" +
            '<div class="sp-profile-field">社區：' + escapeHtml(community) + "</div>" +
            '<div class="sp-profile-field">戶號：' + escapeHtml(unit) + "</div>" +
          "</div>" +
          '<div class="sp-profile-qr" id="spProfileQr" hidden>' +
            '<img id="spProfileQrImg" alt="QR code">' +
          "</div>" +
        "</div>" +
        '<div class="sp-sheet-action-list">' +
          '<div class="sp-font-sizes" role="group" aria-label="字體大小">' +
            '<div class="sp-font-sizes-label">字體大小</div>' +
            '<div class="sp-font-sizes-row">' +
              FONT_SIZES.map(function (f) {
                return '<button class="sp-font-size" type="button" data-action="font-size" data-scale="' +
                  f.scale + '">' + f.label + "</button>";
              }).join("") +
            "</div>" +
          "</div>" +
          '<button class="sp-btn sp-btn-ghost" type="button" data-action="toggle-voice"><span id="spProfileVoiceText">' + (state.voice ? "語音報讀：開啟" : "語音報讀：關閉") + "</span></button>" +
          '<button class="sp-btn sp-btn-ghost" type="button" data-action="phone-settings">電話設定</button>' +
          '<button class="sp-btn sp-btn-ghost" type="button" id="spProfileSignOut">登出</button>' +
        "</div>",
      speakText: "我的資料，" + name + "，戶號 " + unit,
      silent: !!(opt && opt.silent),
    });
    syncFontButtons();

    // QR code 圖片（開卡後非同步解析再顯示）
    resolveQrToken().then(function (token) {
      var box = document.getElementById("spProfileQr");
      var img = document.getElementById("spProfileQrImg");
      if (!token || !box || !img) return;
      img.src = qrImageUrl(token);
      box.hidden = false;
    });
  }

  /* 大頭照連續點 5 次：切換回一般版（member.html），並記住版本供下次登入 */
  var avatarTapCount = 0;
  var avatarTapTimer = null;

  function switchToGeneralVersion() {
    try {
      if (state.uid) {
        db.collection("users").doc(state.uid).set({ specialMode: false }, { merge: true });
      }
    } catch (e) {}
    var key = String(state.code || state.cid || "").trim();
    location.href = "member.html" + (key ? "?c=" + encodeURIComponent(key) : "");
  }

  function registerAvatarTap() {
    avatarTapCount += 1;
    if (avatarTapTimer) clearTimeout(avatarTapTimer);
    if (avatarTapCount >= 5) {
      avatarTapCount = 0;
      if (avatarTapTimer) { clearTimeout(avatarTapTimer); avatarTapTimer = null; }
      switchToGeneralVersion();
      return;
    }
    avatarTapTimer = setTimeout(function () { avatarTapCount = 0; avatarTapTimer = null; }, 2000);
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

  /* ---------------- 電話設定（常用電話，供西北寶寶語音撥打） ---------------- */

  var phonePanel = { open: false, formOpen: false, editingId: "" };
  var phonePanelBackPending = false;

  function phoneListKey() {
    return String(state.cid || "default") + "::" + String(state.uid || "anon");
  }

  function loadPhoneList() {
    try {
      var map = JSON.parse(localStorage.getItem(STORAGE_PHONE_LIST) || "{}") || {};
      var arr = map[phoneListKey()];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function savePhoneList(list) {
    try {
      var map = JSON.parse(localStorage.getItem(STORAGE_PHONE_LIST) || "{}") || {};
      map[phoneListKey()] = Array.isArray(list) ? list : [];
      localStorage.setItem(STORAGE_PHONE_LIST, JSON.stringify(map));
    } catch (e) {}
  }

  function newPhoneId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function findPhone(id) {
    var found = null;
    loadPhoneList().forEach(function (item) {
      if (item && item.id === id) found = item;
    });
    return found;
  }

  // 從句子中找出要撥打的聯絡人：比對電話清單的姓名或暱稱（取最長命中者）
  function matchPhoneContact(text) {
    var t = String(text || "").replace(/[\s，,。.、！!？?；;：:]/g, "");
    if (!t) return null;
    var best = null;
    var bestLen = 0;
    loadPhoneList().forEach(function (item) {
      [String(item.name || "").trim(), String(item.nick || "").trim()].forEach(function (alias) {
        var a = alias.replace(/[\s，,。.、！!？?；;：:]/g, "");
        if (a && t.indexOf(a) >= 0 && a.length > bestLen) { bestLen = a.length; best = item; }
      });
    });
    return best;
  }

  function dialContact(item) {
    var tel = String((item && item.tel) || "").trim();
    if (!tel) { toast("這筆電話沒有號碼"); return; }
    toast("正在為您撥號：" + tel);
    location.href = "tel:" + tel;
  }

  function phoneFormHtml() {
    var editing = phonePanel.editingId ? findPhone(phonePanel.editingId) : null;
    var name = editing ? String(editing.name || "") : "";
    var nick = editing ? String(editing.nick || "") : "";
    var tel = editing ? String(editing.tel || "") : "";
    return '<div class="sp-phone-form">' +
      '<div class="sp-phone-form-title">' + (editing ? "編輯電話" : "新增電話") + "</div>" +
      '<label class="sp-phone-field"><span>姓名（必填）</span>' +
        '<input type="text" id="spPhoneName" autocomplete="name" value="' + escapeHtml(name) + '" placeholder="例如：王小明"></label>' +
      '<label class="sp-phone-field"><span>暱稱（選填，也可用來呼叫）</span>' +
        '<input type="text" id="spPhoneNick" autocomplete="nickname" value="' + escapeHtml(nick) + '" placeholder="例如：兒子、王醫師"></label>' +
      '<label class="sp-phone-field"><span>電話號碼（必填）</span>' +
        '<input type="tel" id="spPhoneTel" inputmode="tel" value="' + escapeHtml(tel) + '" placeholder="例如：0912345678"></label>' +
      '<div class="sp-btn-row sp-btn-row-2">' +
        '<button class="sp-btn sp-btn-ghost" type="button" data-phone-action="cancel">取消</button>' +
        '<button class="sp-btn sp-btn-primary" type="button" data-phone-action="save">儲存</button>' +
      "</div>" +
    "</div>";
  }

  function renderPhoneList() {
    if (!el.phoneBody) return;
    var list = loadPhoneList();
    var html = "";
    if (phonePanel.formOpen) html += phoneFormHtml();
    if (list.length) {
      list.forEach(function (item) {
        html += '<div class="sp-phone-item">' +
          '<div class="sp-phone-item-main">' +
            '<div class="sp-phone-item-name">' + escapeHtml(item.name || "未命名") + "</div>" +
            (item.nick ? '<div class="sp-phone-item-nick">暱稱：' + escapeHtml(item.nick) + "</div>" : "") +
            '<div class="sp-phone-item-tel">' + escapeHtml(item.tel || "") + "</div>" +
          "</div>" +
          '<button class="sp-phone-item-btn" type="button" data-phone-action="edit" data-id="' + escapeHtml(item.id) + '">編輯</button>' +
          '<button class="sp-phone-item-btn is-danger" type="button" data-phone-action="delete" data-id="' + escapeHtml(item.id) + '">刪除</button>' +
        "</div>";
      });
    } else if (!phonePanel.formOpen) {
      html += '<div class="sp-phone-empty">還沒有設定電話。<br>按下面的「新增電話」把常用電話記下來，之後只要對西北寶寶說「請打電話給○○」就可以直接撥號。</div>';
    }
    if (!phonePanel.formOpen) {
      html += '<button class="sp-btn sp-btn-primary" type="button" data-phone-action="add">＋ 新增電話</button>';
    }
    el.phoneBody.innerHTML = html;
  }

  function focusPhoneForm() {
    var nameNode = document.getElementById("spPhoneName");
    if (nameNode) { try { nameNode.focus(); } catch (e) {} }
  }

  function savePhoneForm() {
    var nameNode = document.getElementById("spPhoneName");
    var nickNode = document.getElementById("spPhoneNick");
    var telNode = document.getElementById("spPhoneTel");
    var name = nameNode ? String(nameNode.value || "").trim() : "";
    var nick = nickNode ? String(nickNode.value || "").trim() : "";
    var tel = telNode ? String(telNode.value || "").replace(/[^0-9+#*]/g, "").trim() : "";
    if (!name) { toast("請輸入姓名"); if (nameNode) nameNode.focus(); speak("請輸入姓名"); return; }
    if (!tel) { toast("請輸入電話號碼"); if (telNode) telNode.focus(); speak("請輸入電話號碼"); return; }
    var list = loadPhoneList();
    if (phonePanel.editingId) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === phonePanel.editingId) {
          list[i].name = name; list[i].nick = nick; list[i].tel = tel;
          break;
        }
      }
    } else {
      list.push({ id: newPhoneId(), name: name, nick: nick, tel: tel });
    }
    savePhoneList(list);
    phonePanel.formOpen = false;
    phonePanel.editingId = "";
    renderPhoneList();
    toast("已儲存");
    speak("已儲存" + name + "的電話");
  }

  function deletePhoneItem(id) {
    var list = loadPhoneList();
    var target = null;
    list.forEach(function (it) { if (it.id === id) target = it; });
    if (!target) return;
    confirmDialog({
      icon: "🗑️",
      title: "要刪除嗎？",
      text: "要刪除「" + (target.name || "這筆電話") + "」嗎？",
      okText: "要刪除",
      cancelText: "不要",
    }).then(function (ok) {
      if (!ok) return;
      var next = list.filter(function (it) { return it.id !== id; });
      savePhoneList(next);
      if (phonePanel.editingId === id) { phonePanel.editingId = ""; phonePanel.formOpen = false; }
      renderPhoneList();
      toast("已刪除");
      speak("已刪除");
    });
  }

  function openPhonePanel() {
    if (!el.phone) return;
    phonePanel.open = true;
    phonePanel.formOpen = false;
    phonePanel.editingId = "";
    el.phone.hidden = false;
    try { history.pushState({ __spPhone: true }, ""); } catch (e) {}
    renderPhoneList();
    speak("電話設定，可以新增、編輯或刪除常用電話");
  }

  function closePhonePanel(fromPop) {
    if (!phonePanel.open) return false;
    phonePanel.open = false;
    phonePanel.formOpen = false;
    phonePanel.editingId = "";
    if (el.phone) el.phone.hidden = true;
    var didBack = false;
    if (!fromPop) {
      try {
        if (history.state && history.state.__spPhone) {
          phonePanelBackPending = true;
          history.back();
          didBack = true;
        }
      } catch (e) {}
    }
    return didBack;
  }

  function handlePhoneAction(action, id) {
    if (action === "add") { phonePanel.formOpen = true; phonePanel.editingId = ""; renderPhoneList(); focusPhoneForm(); speak("新增電話"); return; }
    if (action === "edit") { phonePanel.formOpen = true; phonePanel.editingId = id; renderPhoneList(); focusPhoneForm(); speak("編輯電話"); return; }
    if (action === "cancel") { phonePanel.formOpen = false; phonePanel.editingId = ""; renderPhoneList(); return; }
    if (action === "save") { savePhoneForm(); return; }
    if (action === "delete") { deletePhoneItem(id); }
  }

  /* ---------------- 事件綁定 ---------------- */

  function bindEvents() {
    if (el.sosCard) el.sosCard.addEventListener("click", function () { handleAction("sos"); });
    if (el.homeNotice) el.homeNotice.addEventListener("click", function () {
      speak("通知");
      loadBulletins().then(function () { openBulletinSheet({ title: "通知", silent: true }); });
    });

    // 品牌列（Logo 與「QAi生活網」文字）：按下報讀品牌名稱
    if (el.brand) el.brand.addEventListener("click", function () { speak("QAi生活網"); });

    // 住戶 QR code 圖：按下報讀「QR code」
    if (el.greetQrImg) el.greetQrImg.addEventListener("click", function () { speak("QR code"); });

    // 社區／戶號標籤：按下報讀「社區名稱＋戶號之＋子戶號」
    if (el.greetUnit) el.greetUnit.addEventListener("click", function () {
      var d = state.profile || {};
      var houseNo = String(d.houseNo || d.unit || "").trim();
      var sub = String(d.subUnit || d.subHouseNo || "").trim();
      var community = String(state.communityName || (el.communityName ? el.communityName.textContent : "") || "").trim();
      speak(community + houseNo + (sub ? "之" + sub : ""));
    });

    // 今日日期／時間卡：按下報讀「現在時間＋現在日期」
    if (el.infoCard) el.infoCard.addEventListener("click", function () {
      var now = new Date();
      var weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
      var timeText = now.getHours() + "點" + now.getMinutes() + "分";
      var dateText = (now.getMonth() + 1) + "月" + now.getDate() + "日" + weekdays[now.getDay()];
      speak(timeText + dateText);
    });

    if (el.homeNav) el.homeNav.addEventListener("click", function () {
      goHome();
      speak("首頁");
    });
    if (el.supportNav) el.supportNav.addEventListener("click", function () {
      speak("功能");
      setActiveNav(el.supportNav);
      openSupportSheet({ silent: true });
    });
    if (el.intercomNav) el.intercomNav.addEventListener("click", function () {
      speak("對講");
      setActiveNav(el.intercomNav);
      openIntercomCallModal();
    });
    if (el.profileNav) el.profileNav.addEventListener("click", function () {
      speak("個人");
      setActiveNav(el.profileNav);
      openProfileSheet({ silent: true });
    });

    if (el.sheetBody) el.sheetBody.addEventListener("click", function (ev) {
      var signOut = ev.target && ev.target.closest ? ev.target.closest("#spProfileSignOut") : null;
      if (signOut) { if (el.signOut) el.signOut.click(); return; }
      var avatarEl = ev.target && ev.target.closest ? ev.target.closest(".sp-profile-photo-img, .sp-profile-photo-initial") : null;
      if (avatarEl) { registerAvatarTap(); return; }
      var actionButton = ev.target && ev.target.closest ? ev.target.closest("[data-action]") : null;
      if (!actionButton) return;
      var action = String(actionButton.getAttribute("data-action") || "");
      if (action === "toggle-voice") toggleVoice();
      else if (action === "phone-settings") openPhonePanel();
      else if (action === "font-down") stepScale(-1);
      else if (action === "font-size") setFontSize(parseFloat(actionButton.getAttribute("data-scale")));
      else handleAction(action);
    });

    // LOGO 連續快按 3 下：重新整理頁面
    var brandLogo = document.getElementById("spBrandLogo");
    if (brandLogo) {
      var logoTaps = 0;
      var logoTimer = null;
      brandLogo.addEventListener("click", function (ev) {
        ev.preventDefault();
        logoTaps += 1;
        if (logoTimer) clearTimeout(logoTimer);
        if (logoTaps >= 3) {
          logoTaps = 0;
          logoTimer = null;
          location.reload();
          return;
        }
        logoTimer = setTimeout(function () { logoTaps = 0; logoTimer = null; }, 600);
      });
    }

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
        openVoicePanel();
      });
    }

    if (el.voiceClose) el.voiceClose.addEventListener("click", function () { closeVoicePanel(false); });

    // 電話設定彈窗：關閉鈕與清單／表單的事件代理（內容會動態重建）
    if (el.phoneClose) el.phoneClose.addEventListener("click", function () { closePhonePanel(false); });
    if (el.phoneBody) {
      el.phoneBody.addEventListener("click", function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest("[data-phone-action]") : null;
        if (!btn) return;
        handlePhoneAction(String(btn.getAttribute("data-phone-action") || ""), String(btn.getAttribute("data-id") || ""));
      });
    }

    // 語音回覆區的「開啟地圖／Google 搜尋」按鈕（事件代理，回覆內容會動態重建）
    if (el.voiceReplyText) {
      el.voiceReplyText.addEventListener("click", function (ev) {
        var node = ev.target;
        var btn = node && node.closest ? node.closest(".sp-voice-map") : null;
        if (!btn) return;
        var search = btn.getAttribute("data-search");
        if (search) { openVoiceSearch(search); return; }
        openVoiceMap(btn.getAttribute("data-map"));
      });
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (voicePanel.open) { closeVoicePanel(false); return; }
      if (!el.dialog.hidden) return;
      if (phonePanel.open) { closePhonePanel(false); return; }
      if (sheetOpen) hideSheet(false);
    });
  }

  function setActiveNav(active) {
    [el.homeNav, el.supportNav, el.intercomNav, el.profileNav].forEach(function (button) {
      if (!button) return;
      var selected = button === active;
      button.classList.toggle("is-active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  /* ---------------- 啟動 ---------------- */

  function restorePreferences() {
    var stored = parseFloat(localStorage.getItem(STORAGE_SCALE) || "");
    var scale = isFinite(stored) ? nearestScale(stored) : SCALES[1];
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
    renderClock();
    setInterval(renderClock, 1000);
  });

  // ==================== 對講（div modal，移植自 member.js） ====================

  var intercomIncomingUnsub = null;
  var intercomActive = null;
  var intercomRingCtx = null;
  var intercomRingOsc = null;
  var intercomRingGain = null;
  var intercomRingCompressor = null;
  var intercomRingTimer = null;
  var intercomRingAudio = null;
  var intercomLastIncomingMs = 0;
  var intercomLastIncomingId = "";
  var intercomLastIncomingNotifyId = "";
  var intercomIncomingPromptEl = null;
  var intercomIncomingPromptCallId = "";
  var intercomIncomingPromptUnsubDoc = null;

  function intercomResolveCommunityId() {
    return String(state.cid || "default").trim() || "default";
  }

  function ensureModal(id) {
    var modal = document.getElementById(id);
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal";
    modal.id = id;
    modal.hidden = true;
    document.body.appendChild(modal);
    return modal;
  }

  function bindModalClose(modal, onClose) {
    if (!modal) return function () {};
    var close = function () {
      modal.hidden = true;
      if (typeof onClose === "function") onClose();
    };
    var onClick = function (e) {
      var el = e.target && e.target.closest ? e.target.closest("[data-modal-close]") : null;
      if (!el) return;
      e.preventDefault();
      close();
    };
    modal.addEventListener("click", onClick);
    var onKey = function (e) {
      if (e.key !== "Escape") return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return function () {
      modal.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }

  function startIntercomOscillatorRingtone(mode) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      intercomRingCtx = intercomRingCtx || new Ctx();
      if (intercomRingCtx && intercomRingCtx.state === "suspended") {
        intercomRingCtx.resume().catch(function () {});
      }
      intercomRingGain = intercomRingCtx.createGain();
      intercomRingGain.gain.value = 0.0001;
      intercomRingCompressor = intercomRingCtx.createDynamicsCompressor();
      try {
        intercomRingCompressor.threshold.setValueAtTime(-24, intercomRingCtx.currentTime);
        intercomRingCompressor.knee.setValueAtTime(30, intercomRingCtx.currentTime);
        intercomRingCompressor.ratio.setValueAtTime(12, intercomRingCtx.currentTime);
        intercomRingCompressor.attack.setValueAtTime(0.003, intercomRingCtx.currentTime);
        intercomRingCompressor.release.setValueAtTime(0.25, intercomRingCtx.currentTime);
      } catch (e) {}
      intercomRingGain.connect(intercomRingCompressor);
      intercomRingCompressor.connect(intercomRingCtx.destination);
      intercomRingOsc = [];

      var m = String(mode || "incoming").trim() || "incoming";
      var incomingNotes = [523.25, 659.25, 783.99, 659.25];
      var waitingNotes = [440.0, 554.37];
      var i = 0;

      var playNote = function (freq, durationMs) {
        if (!intercomRingCtx || !intercomRingGain) return;
        var ctx = intercomRingCtx;
        var now = ctx.currentTime;
        var dur = Math.max(0.08, Number(durationMs || 220) / 1000);
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(Number(freq || 440), now);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(1.0, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(g);
        g.connect(intercomRingGain);
        osc.start(now);
        osc.stop(now + dur + 0.02);
        intercomRingOsc.push(osc);
      };

      var tick = function () {
        if (!intercomRingCtx || !intercomRingGain) return;
        var volume = m === "waiting" ? 0.36 : 0.52;
        try { intercomRingGain.gain.setTargetAtTime(volume, intercomRingCtx.currentTime, 0.05); } catch (e) {}
        if (m === "waiting") {
          playNote(waitingNotes[i % waitingNotes.length], 140);
          i += 1;
          return;
        }
        playNote(incomingNotes[i % incomingNotes.length], 220);
        i += 1;
      };

      tick();
      intercomRingTimer = window.setInterval(tick, m === "waiting" ? 900 : 520);
    } catch (e) {}
  }

  function startIntercomRingtone(mode) {
    stopIntercomRingtone();
    try {
      var sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (sw) sw.postMessage({ type: "INTERCOM_RING_STOP" });
    } catch (e) {}
    var m = String(mode || "incoming").trim() || "incoming";
    try {
      intercomRingAudio = new Audio("./mp3/ring.mp3");
      intercomRingAudio.loop = true;
      intercomRingAudio.preload = "auto";
      intercomRingAudio.volume = m === "waiting" ? 0.65 : 0.85;
      var p = intercomRingAudio.play();
      if (p && typeof p.then === "function") {
        var ok = false;
        p.then(function () { ok = true; }).catch(function () { ok = false; });
        window.setTimeout(function () {
          if (!ok && !intercomRingTimer) startIntercomOscillatorRingtone(m);
        }, 220);
        return;
      }
      if (intercomRingAudio.paused) startIntercomOscillatorRingtone(m);
      return;
    } catch (e) {}
    startIntercomOscillatorRingtone(m);
  }

  function stopIntercomRingtone() {
    if (intercomRingTimer) {
      window.clearInterval(intercomRingTimer);
      intercomRingTimer = null;
    }
    try {
      if (intercomRingAudio) {
        intercomRingAudio.pause();
        intercomRingAudio.currentTime = 0;
      }
    } catch (e) {}
    intercomRingAudio = null;
    try {
      if (intercomRingGain) intercomRingGain.gain.value = 0;
    } catch (e) {}
    try {
      var list = Array.isArray(intercomRingOsc) ? intercomRingOsc : (intercomRingOsc ? [intercomRingOsc] : []);
      list.forEach(function (osc) {
        try { osc.stop(); } catch (e) {}
      });
    } catch (e) {}
    intercomRingOsc = null;
    intercomRingGain = null;
    intercomRingCompressor = null;
  }

  function createIntercomPeerConnection() {
    var cfg = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
    return new RTCPeerConnection(cfg);
  }

  function readUserProfileForCall(uid) {
    var id = String(uid || "").trim();
    if (!id) return Promise.resolve({});
    return db.collection("users").doc(id).get().then(function (snap) {
      var data = snap && snap.exists ? (snap.data() || {}) : {};
      return {
        uid: id,
        name: String(data.displayName || data.name || data.email || "").trim(),
        houseNo: String(data.houseNo || data.unit || "").trim(),
        subUnit: String(data.subUnit || data.subHouseNo || "").trim(),
        community: String(data.community || "").trim(),
        avatarDataUrl: String(data.avatarDataUrl || "").trim(),
      };
    }).catch(function () {
      return { uid: id };
    });
  }

  function setIntercomPeerVisual(modal, opts) {
    if (!modal) return;
    var avatarEl = modal.querySelector(opts.avatarSelector);
    var imageEl = modal.querySelector(opts.imageSelector);
    var textEl = avatarEl ? avatarEl.querySelector(".intercom-avatar-text") : null;
    var nameEl = modal.querySelector(opts.nameSelector);
    var subEl = modal.querySelector(opts.subSelector);
    var displayName = String(opts.name || "").trim() || "使用者";
    var displaySub = String(opts.sub || "").trim() || "語音通話";
    var avatar = String(opts.avatarDataUrl || "").trim();
    var defaultAvatar = String(opts.defaultAvatar || "").trim();
    var initial = String(opts.fallbackInitial || displayName.slice(0, 1) || "U").trim().slice(0, 1).toUpperCase() || "U";

    if (nameEl) nameEl.textContent = displayName;
    if (subEl) subEl.textContent = displaySub;
    if (textEl) textEl.textContent = initial;
    else if (avatarEl) avatarEl.textContent = initial;
    var imgSrc = avatar || defaultAvatar;
    if (avatarEl) avatarEl.classList.toggle("has-image", Boolean(imgSrc));
    if (imageEl) {
      if (imgSrc) {
        imageEl.src = imgSrc;
        imageEl.alt = displayName;
        imageEl.hidden = false;
      } else {
        imageEl.removeAttribute("src");
        imageEl.alt = "";
        imageEl.hidden = true;
      }
    }
  }

  function scheduleIntercomModalHide(modal, delayMs) {
    if (!modal) return;
    var token = Date.now() + "_" + Math.random();
    modal.dataset.intercomHideToken = token;
    window.setTimeout(function () {
      if (modal.dataset.intercomHideToken === token) modal.hidden = true;
    }, Math.max(0, Number(delayMs || 0)));
  }

  function closeIntercomIncomingPrompt(opts) {
    opts = opts || {};
    var prompt = intercomIncomingPromptEl;
    intercomIncomingPromptEl = null;
    intercomIncomingPromptCallId = "";
    if (intercomIncomingPromptUnsubDoc) {
      try { intercomIncomingPromptUnsubDoc(); } catch (e) {}
      intercomIncomingPromptUnsubDoc = null;
    }
    stopIntercomRingtone();
    if (!prompt) return;
    if (Number(opts.delayMs || 0) > 0) scheduleIntercomModalHide(prompt, opts.delayMs);
    else prompt.hidden = true;
  }

  function prepareIntercomModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    modal.dataset.intercomHideToken = "";
  }

  // 將對講面板重置為「待命」狀態（掛斷後呼叫，讓使用者可重新撥打）
  function resetIntercomStandby(modal) {
    if (!modal) return;
    modal.hidden = false;
    modal.dataset.intercomHideToken = "";
    setIntercomCallStatus("待命", false);
    setIntercomPermissionHelp("", false);
    var t = modal.querySelector("#intercomTimer");
    if (t) t.textContent = "00:00";
    var callBtn = modal.querySelector("#btnIntercomCallAdmin");
    if (callBtn) {
      callBtn.hidden = false;
      callBtn.disabled = false;
      // ensureIntercomCallModal 會重建 innerHTML，呼叫按鈕的 onclick 會遺失，需重新綁定
      callBtn.onclick = function () {
        intercomStartOutgoingToAdmin({ communityId: intercomResolveCommunityId() });
      };
    }
    // 未撥號時「掛斷」無作用
    var hangupBtn = modal.querySelector("#btnIntercomHangup");
    if (hangupBtn) hangupBtn.disabled = true;
    setIntercomSpeakerButtonEnabled(modal, false);
    setIntercomPeerVisual(modal, {
      avatarSelector: "#intercomPeerInitialMember",
      imageSelector: "#intercomPeerAvatarMember",
      nameSelector: "#intercomPeerName",
      subSelector: "#intercomPeerSub",
      name: "管理中心",
      sub: "點擊下方開始撥號",
      avatarDataUrl: "",
      defaultAvatar: "logo.svg",
      fallbackInitial: "管",
    });
  }

  // 對講面板開著時（不需喚醒詞）：說「撥號」自動按下撥號鈕撥出、說「掛斷」自動按下掛斷鈕掛斷
  function handleIntercomVoice(text) {
    var modal = document.getElementById("intercomCallModal90");
    if (!modal || modal.hidden) return false;
    var t = String(text || "").replace(/[\s,，。、！!？?；;：:]/g, "");
    if (!t) return false;
    // 掛斷：通話中（掛斷鈕可用）才處理
    if (/掛斷|掛掉|結束通話|不講了|關掉通話|斷話|斷線/.test(t)) {
      var hangupBtn = modal.querySelector("#btnIntercomHangup");
      if (hangupBtn && !hangupBtn.disabled) { hangupBtn.click(); return true; }
    }
    // 撥號：未撥號（撥號鈕可用且顯示）才處理
    if (/撥號|撥出|撥打|開始撥/.test(t)) {
      var callBtn = modal.querySelector("#btnIntercomCallAdmin");
      if (callBtn && !callBtn.disabled && !callBtn.hidden) { callBtn.click(); return true; }
    }
    return false;
  }

  function attachIntercomRemoteAudio(audioId, remoteStream) {
    var audio = document.getElementById(String(audioId || ""));
    if (!audio) return null;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1;
    audio.srcObject = remoteStream || null;
    var tryPlay = function () {
      try { return audio.play(); } catch (e) { return null; }
    };
    audio.onloadedmetadata = function () {
      var p = tryPlay();
      if (p && typeof p.catch === "function") p.catch(function () {});
    };
    var p = tryPlay();
    if (p && typeof p.catch === "function") p.catch(function () {});
    return audio;
  }

  function setIntercomPermissionHelp(message, isError) {
    var modal = document.getElementById("intercomCallModal90");
    if (!modal) return;
    var el = modal.querySelector("#intercomPermissionHelp");
    if (!el) return;
    var text = String(message || "").trim();
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle("error", Boolean(isError));
  }

  function buildMicrophonePermissionMessage(err) {
    var code = String((err && (err.name || err.code || err.message)) || "").toLowerCase();
    if (code.indexOf("denied") >= 0 || code.indexOf("notallowed") >= 0) {
      return "請點網址列權限圖示，將麥克風改成允許後，再重新撥打。";
    }
    return "請確認裝置已有可用麥克風，並已開啟網站麥克風權限。";
  }

  function setIntercomCallStatus(text, isError) {
    var modal = document.getElementById("intercomCallModal90");
    if (!modal) return;
    var el = modal.querySelector("#intercomCallState");
    if (!el) return;
    var t = String(text || "").trim();
    el.textContent = t;
    el.classList.toggle("error", Boolean(isError));
  }

  function formatIntercomTimer(ms) {
    var sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    var mm = String(Math.floor(sec / 60)).padStart(2, "0");
    var ss = String(sec % 60).padStart(2, "0");
    return mm + ":" + ss;
  }

  function startIntercomTimer(startAtMs) {
    if (!intercomActive) return;
    var active = intercomActive;
    active.startedAtMs = Number(startAtMs || Date.now());
    if (active.timerId) {
      window.clearInterval(active.timerId);
      active.timerId = null;
    }
    var tick = function () {
      var modal = document.getElementById("intercomCallModal90");
      if (!modal || !active.startedAtMs) return;
      var el = modal.querySelector("#intercomTimer");
      if (!el) return;
      el.textContent = formatIntercomTimer(Date.now() - active.startedAtMs);
    };
    tick();
    active.timerId = window.setInterval(tick, 500);
  }

  function setIntercomSpeakerButtonEnabled(modal, enabled) {
    if (!modal) return;
    var btn = modal.querySelector("#btnIntercomSpeaker");
    if (!btn) return;
    var on = Boolean(enabled);
    btn.hidden = !on;
    btn.disabled = !on;
  }

  async function setIntercomAudioOutputMode(mode) {
    var modal = document.getElementById("intercomCallModal90");
    if (!modal) return false;
    var audio = document.getElementById("intercomRemoteAudioMember");
    if (!audio) return false;
    if (typeof audio.setSinkId !== "function") {
      setIntercomPermissionHelp("此裝置/瀏覽器不支援切換「聽筒/擴音」。", false);
      return false;
    }
    var m = String(mode || "earpiece").trim() || "earpiece";
    var wantSpeaker = m === "speaker";
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      var outputs = (devices || []).filter(function (d) { return d && d.kind === "audiooutput"; });
      var normalize = function (s) { return String(s || "").trim().toLowerCase(); };
      var isDefault = function (d) { return normalize(d && d.deviceId) === "default"; };
      var isCommunications = function (d) { return normalize(d && d.deviceId) === "communications" || /communications|通訊|通话|通話/i.test(String(d && d.label || "")); };
      var isSpeaker = function (d) { return /speaker|擴音|喇叭/i.test(String(d && d.label || "")); };
      var nonDefault = outputs.filter(function (d) { return d && !isDefault(d); });
      var comm = nonDefault.find(isCommunications) || outputs.find(isCommunications) || null;
      var speaker = nonDefault.find(isSpeaker) || nonDefault[0] || null;
      var sinkId = wantSpeaker
        ? String((speaker && speaker.deviceId) || "default").trim() || "default"
        : String((comm && comm.deviceId) || "default").trim() || "default";
      await audio.setSinkId(sinkId);
      if (intercomActive) intercomActive.audioOutputMode = wantSpeaker ? "speaker" : "earpiece";
      setIntercomPermissionHelp("", false);
      return true;
    } catch (e) {
      setIntercomPermissionHelp("無法切換音訊輸出，請確認瀏覽器允許切換音訊裝置。", false);
      return false;
    }
  }

  function bindIntercomSpeakerButton(modal) {
    if (!modal) return;
    var btn = modal.querySelector("#btnIntercomSpeaker");
    if (!btn) return;
    var audio = document.getElementById("intercomRemoteAudioMember");
    var supported = Boolean(audio && typeof audio.setSinkId === "function");
    btn.hidden = true;
    btn.dataset.supported = supported ? "1" : "0";
    btn.disabled = true;
    btn.innerHTML = "<span>擴音</span>";
    btn.onclick = async function () {
      var current = intercomActive && intercomActive.audioOutputMode ? String(intercomActive.audioOutputMode) : "earpiece";
      var next = current === "speaker" ? "earpiece" : "speaker";
      var ok = await setIntercomAudioOutputMode(next);
      if (ok) btn.innerHTML = "<span>" + (next === "speaker" ? "聽筒" : "擴音") + "</span>";
    };
  }

  function ensureIntercomHistoryModal() {
    var modal = ensureModal("intercomHistoryModal90");
    modal.style.zIndex = "1210";
    modal.style.setProperty("--modal-width", "90%");
    modal.style.setProperty("--modal-height", "90%");
    modal.innerHTML =
      '<div class="modal-backdrop" data-modal-close="1"></div>' +
      '<div class="modal-dialog trae-browser-inspect-draggable" role="dialog" aria-modal="true" style="display:flex;flex-direction:column;">' +
      '<div class="modal-hd"><h3 class="modal-title">通話紀錄</h3>' +
      '<button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button></div>' +
      '<div class="modal-body" style="padding:0;min-height:0;flex:1 1 auto;">' +
      '<iframe id="intercomHistoryIframe" src="" frameborder="0" allow="autoplay; clipboard-write; encrypted-media" style="width:100%;height:100%;display:block;"></iframe>' +
      '</div></div>';
    return modal;
  }

  function openIntercomHistoryModal(opts) {
    opts = opts || {};
    var cid = String(opts.communityId || intercomResolveCommunityId() || "").trim();
    var role = String(opts.toRole || "resident").trim() || "resident";
    var modal = ensureIntercomHistoryModal();
    var iframe = modal.querySelector("#intercomHistoryIframe");
    if (!iframe) return;
    var q = new URLSearchParams();
    if (cid) q.set("c", cid);
    if (role) q.set("toRole", role);
    var url = q.toString() ? ("./callrecord.html?" + q.toString()) : "./callrecord.html";
    iframe.src = url;
    prepareIntercomModal(modal);
    var detach = function () {};
    detach = bindModalClose(modal, function () {
      detach();
      try { iframe.src = ""; } catch (e) {}
    });
  }

  function bindIntercomHistoryButton(modal, opts) {
    if (!modal) return;
    var btn = modal.querySelector("#btnIntercomHistory");
    if (!btn) return;
    btn.onclick = function () { openIntercomHistoryModal(opts); };
  }

  function ensureIntercomCallModal() {
    var modal = document.getElementById("intercomCallModal90");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "intercomCallModal90";
      document.body.appendChild(modal);
    }
    modal.classList.remove("modal", "modal-intercom-incoming", "modal-intercom-call");
    modal.style.cssText = "";
    modal.innerHTML =
      '<div class="chatcall-body">' +
      '<div class="chatcall-avatar has-image" id="intercomPeerInitialMember" aria-hidden="true">' +
      '<img id="intercomPeerAvatarMember" src="logo.svg" alt="管理中心" />' +
      '<span class="intercom-avatar-text">管</span>' +
      '</div>' +
      '<h2 class="chatcall-name" id="intercomPeerName">管理中心</h2>' +
      '<div class="chatcall-sub" id="intercomPeerSub">語音通話</div>' +
      '<div class="chatcall-status" id="intercomCallState">待命</div>' +
      '<div class="chatcall-timer" id="intercomTimer">00:00</div>' +
      '<div class="chatcall-help" id="intercomPermissionHelp" hidden></div>' +
      '<audio id="intercomRemoteAudioMember" autoplay playsinline></audio>' +
      '</div>' +
      '<div class="chatcall-actions" style="margin-top:12px;">' +
      '<div class="chatcall-actions-row">' +
      '<button class="chatcall-btn danger" type="button" id="btnIntercomHangup" disabled>掛斷</button>' +
      '<button class="chatcall-btn success" type="button" id="btnIntercomCallAdmin">撥號</button>' +
      '</div>' +
      '<div class="chatcall-actions-row">' +
      '<button class="chatcall-btn ghost small" type="button" id="btnIntercomSpeaker" hidden>擴音</button>' +
      '<button class="chatcall-btn ghost small" type="button" id="btnIntercomHistory">通話紀錄</button>' +
      '</div>' +
      '</div>';
    return modal;
  }

  function ensureIntercomIncomingModal() {
    var modal = ensureModal("intercomIncomingModalMember");
    modal.classList.remove("modal-intercom-incoming", "modal-intercom-call");
    modal.style.zIndex = "1200";
    modal.style.setProperty("--modal-width", "90%");
    modal.style.setProperty("--modal-height", "90%");
    modal.innerHTML =
      '<div class="modal-backdrop" data-modal-close="1"></div>' +
      '<div class="modal-dialog trae-browser-inspect-draggable" role="dialog" aria-modal="true" aria-labelledby="intercomIncomingTitleMember" style="display:flex;flex-direction:column;">' +
      '<div class="modal-hd">' +
      '<h3 class="modal-title" id="intercomIncomingTitleMember">通話</h3>' +
      '<button class="modal-close" type="button" data-modal-close="1" aria-label="關閉">×</button>' +
      '</div>' +
      '<div class="modal-body chatcall-body">' +
      '<div class="chatcall-avatar" id="intercomIncomingInitialMember" aria-hidden="true">' +
      '<img id="intercomIncomingAvatarMember" alt="" hidden />' +
      '<span class="intercom-avatar-text">—</span>' +
      '</div>' +
      '<h2 class="chatcall-name" id="intercomIncomingNameMember">—</h2>' +
      '<div class="chatcall-sub" id="intercomIncomingSubMember">—</div>' +
      '<div class="chatcall-status" id="intercomIncomingStateMember">等待接聽</div>' +
      '</div>' +
      '<div class="modal-ft" style="justify-content:center;">' +
      '<div class="chatcall-actions">' +
      '<button class="chatcall-btn danger" type="button" id="btnIntercomRejectMember">掛斷</button>' +
      '<button class="chatcall-btn success" type="button" id="btnIntercomAcceptMember">接通</button>' +
      '</div></div></div>';
    return modal;
  }

  async function cleanupIntercomActive(opts) {
    opts = opts || {};
    var active = intercomActive;
    intercomActive = null;
    stopIntercomRingtone();
    if (!active) return;
    if (active.modalEl) {
      if (Number(opts.closeDelayMs || 0) > 0) scheduleIntercomModalHide(active.modalEl, opts.closeDelayMs);
      else active.modalEl.hidden = true;
    }
    try {
      if (active.timerId) window.clearInterval(active.timerId);
    } catch (e) {}
    try {
      if (opts.updateStatus && active.callDocRef) {
        await active.callDocRef.set(
          {
            status: String(opts.updateStatus),
            endedAtMs: Date.now(),
            endedAt: FieldValue.serverTimestamp(),
            endedByUid: String(auth.currentUser ? auth.currentUser.uid : ""),
          },
          { merge: true }
        );
      }
    } catch (e) {}
    try { if (active.unsubDoc) active.unsubDoc(); } catch (e) {}
    try { if (active.unsubCandidates) active.unsubCandidates(); } catch (e) {}
    try { if (active.unsubCandidates2) active.unsubCandidates2(); } catch (e) {}
    try { if (active.detachModal) active.detachModal(); } catch (e) {}
    try { if (active.pc) active.pc.close(); } catch (e) {}
    try { if (active.localStream) active.localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try {
      var audio = document.getElementById("intercomRemoteAudioMember");
      if (audio) {
        audio.pause();
        audio.srcObject = null;
      }
    } catch (e) {}
  }

  async function intercomStartOutgoingToAdmin(opts) {
    opts = opts || {};
    var cid = String(opts.communityId || intercomResolveCommunityId() || "default").trim() || "default";
    var user = auth.currentUser;
    if (!user) return;

    await cleanupIntercomActive();
    var modal = ensureIntercomCallModal();
    prepareIntercomModal(modal);
    bindIntercomSpeakerButton(modal);
    bindIntercomHistoryButton(modal, { communityId: cid, toRole: "resident" });
    if (intercomActive) intercomActive.audioOutputMode = "earpiece";
    var detach = function () {};
    detach = bindModalClose(modal, function () {
      detach();
      cleanupIntercomActive({ updateStatus: "ended" });
    });

    var hangupBtn = modal.querySelector("#btnIntercomHangup");
    var callBtn = modal.querySelector("#btnIntercomCallAdmin");
    if (callBtn) callBtn.disabled = true;
    // 開始撥號後「掛斷」才可使用
    if (hangupBtn) hangupBtn.disabled = false;
    setIntercomSpeakerButtonEnabled(modal, false);
    setIntercomCallStatus("正在呼叫…", false);
    var timerEl = modal.querySelector("#intercomTimer");
    if (timerEl) timerEl.textContent = "00:00";
    setIntercomPermissionHelp("", false);
    startIntercomRingtone("waiting");

    // 立即綁定掛斷按鈕，讓「正在呼叫…」期間也能掛斷
    if (hangupBtn) hangupBtn.onclick = function () {
      setIntercomCallStatus("通話已結束", false);
      cleanupIntercomActive({ updateStatus: "ended" }).then(function () {
        resetIntercomStandby(modal);
      });
    };

    var callDocRef = db.collection("calls").doc();
    var pc = createIntercomPeerConnection();
    var remoteStream = new MediaStream();
    attachIntercomRemoteAudio("intercomRemoteAudioMember", remoteStream);
    var localStream = null;

    pc.ontrack = function (ev) {
      var list = ev && ev.streams && ev.streams[0] ? ev.streams[0].getTracks() : [];
      list.forEach(function (t) { remoteStream.addTrack(t); });
      attachIntercomRemoteAudio("intercomRemoteAudioMember", remoteStream);
    };

    var offerCandidatesRef = callDocRef.collection("offerCandidates");
    pc.onicecandidate = function (ev) {
      if (!ev || !ev.candidate) return;
      var c = ev.candidate;
      var json = typeof c.toJSON === "function" ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
      offerCandidatesRef.add(Object.assign({}, json, { createdAtMs: Date.now() })).catch(function () {});
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      stopIntercomRingtone();
      setIntercomCallStatus("無法開啟麥克風，請確認瀏覽器權限。", true);
      setIntercomPermissionHelp(buildMicrophonePermissionMessage(err), true);
      try { pc.close(); } catch (e) {}
      if (callBtn) callBtn.disabled = false;
      if (hangupBtn) hangupBtn.disabled = true;
      return;
    }
    localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

    var fromProfile = await readUserProfileForCall(user.uid);
    var offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    try {
      await callDocRef.set(
        {
          community: cid,
          fromUid: String(user.uid),
          fromRole: "resident",
          fromName: String(fromProfile.name || user.email || "住戶").trim(),
          fromHouseNo: String(fromProfile.houseNo || "").trim(),
          fromSubHouseNo: String(fromProfile.subUnit || "").trim(),
          fromAvatarDataUrl: String(fromProfile.avatarDataUrl || "").trim(),
          toRole: "admin",
          status: "ringing",
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: Date.now(),
          offer: { type: offer.type, sdp: offer.sdp },
        },
        { merge: true }
      );
    } catch (err) {
      stopIntercomRingtone();
      setIntercomCallStatus("呼叫失敗，請稍後再試。", true);
      setIntercomPermissionHelp("請確認網路連線，或稍後再試。", true);
      try { pc.close(); } catch (e) {}
      try { localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      if (callBtn) callBtn.disabled = false;
      if (hangupBtn) hangupBtn.disabled = true;
      return;
    }

    var unsubDoc = callDocRef.onSnapshot(async function (snap) {
      var data = snap && snap.exists ? (snap.data() || {}) : null;
      if (!data) return;
      var st = String(data.status || "").trim();
      if (st === "accepted") {
        if (!pc.currentRemoteDescription && data.answer && data.answer.type && data.answer.sdp) {
          try { await pc.setRemoteDescription(new RTCSessionDescription(data.answer)); } catch (e) {}
        }
        setIntercomCallStatus("已接通", false);
        stopIntercomRingtone();
        setIntercomPermissionHelp("", false);
        if (callBtn) callBtn.hidden = true;
        setIntercomSpeakerButtonEnabled(modal, true);
        var audioEl = document.getElementById("intercomRemoteAudioMember");
        if (audioEl && typeof audioEl.setSinkId === "function") await setIntercomAudioOutputMode("earpiece");
        if (intercomActive && !intercomActive.timerId) startIntercomTimer(Date.now());
        return;
      }
      if (st === "rejected" || st === "ended" || st === "busy" || st === "missed") {
        setIntercomCallStatus(st === "busy" ? "後台忙線中" : (st === "rejected" ? "後台已掛斷" : "通話已結束"), false);
        await cleanupIntercomActive({ closeDelayMs: 1000 });
        resetIntercomStandby(modal);
      }
    });

    var unsubAnswerCandidates = callDocRef.collection("answerCandidates").onSnapshot(function (snap) {
      (snap.docChanges ? snap.docChanges() : []).forEach(function (ch) {
        if (!ch || ch.type !== "added") return;
        var v = ch.doc && ch.doc.data ? (ch.doc.data() || {}) : {};
        if (!v || !v.candidate) return;
        try { pc.addIceCandidate(new RTCIceCandidate(v)); } catch (e) {}
      });
    });

    intercomActive = {
      callDocRef: callDocRef,
      pc: pc,
      localStream: localStream,
      remoteStream: remoteStream,
      audioOutputMode: "earpiece",
      unsubDoc: unsubDoc,
      unsubCandidates: unsubAnswerCandidates,
      detachModal: detach,
      modalEl: modal,
    };
  }

  async function intercomAnswerIncomingCall(callDocRef, data) {
    var user = auth.currentUser;
    if (!user) return;
    var d = data && typeof data === "object" ? data : {};
    if (!d.offer || !d.offer.type || !d.offer.sdp) return;

    await cleanupIntercomActive();
    var modal = ensureIntercomCallModal();
    prepareIntercomModal(modal);
    bindIntercomSpeakerButton(modal);
    bindIntercomHistoryButton(modal, { communityId: String(d.community || intercomResolveCommunityId() || "").trim(), toRole: "resident" });
    if (intercomActive) intercomActive.audioOutputMode = "earpiece";
    var detach = function () {};
    detach = bindModalClose(modal, function () {
      detach();
      cleanupIntercomActive({ updateStatus: "ended" });
    });

    var hangupBtn = modal.querySelector("#btnIntercomHangup");
    var callBtn = modal.querySelector("#btnIntercomCallAdmin");
    if (callBtn) callBtn.hidden = true;
    if (hangupBtn) hangupBtn.disabled = false;
    setIntercomSpeakerButtonEnabled(modal, false);
    var timerEl = modal.querySelector("#intercomTimer");

    var fromName = String(d.fromName || "社區後台").trim() || "社區後台";
    var fromSub = String(d.fromHouseNo || "").trim();
    setIntercomPeerVisual(modal, {
      avatarSelector: "#intercomPeerInitialMember",
      imageSelector: "#intercomPeerAvatarMember",
      nameSelector: "#intercomPeerName",
      subSelector: "#intercomPeerSub",
      name: fromName,
      sub: fromSub || "社區後台",
      avatarDataUrl: String(d.fromAvatarDataUrl || "").trim(),
      fallbackInitial: fromName,
    });
    if (timerEl) timerEl.textContent = "00:00";
    setIntercomPermissionHelp("", false);
    setIntercomCallStatus("接通中…", false);

    // 立即綁定掛斷按鈕，讓「接通中…」期間也能掛斷
    if (hangupBtn) hangupBtn.onclick = function () {
      setIntercomCallStatus("通話已結束", false);
      cleanupIntercomActive({ updateStatus: "ended" }).then(function () {
        resetIntercomStandby(modal);
      });
    };

    var pc = createIntercomPeerConnection();
    var remoteStream = new MediaStream();
    attachIntercomRemoteAudio("intercomRemoteAudioMember", remoteStream);
    var localStream = null;

    pc.ontrack = function (ev) {
      var list = ev && ev.streams && ev.streams[0] ? ev.streams[0].getTracks() : [];
      list.forEach(function (t) { remoteStream.addTrack(t); });
      attachIntercomRemoteAudio("intercomRemoteAudioMember", remoteStream);
    };

    var answerCandidatesRef = callDocRef.collection("answerCandidates");
    pc.onicecandidate = function (ev) {
      if (!ev || !ev.candidate) return;
      var c = ev.candidate;
      var json = typeof c.toJSON === "function" ? c.toJSON() : { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex };
      answerCandidatesRef.add(Object.assign({}, json, { createdAtMs: Date.now() })).catch(function () {});
    };

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      setIntercomCallStatus("無法開啟麥克風，請確認瀏覽器權限。", true);
      setIntercomPermissionHelp(buildMicrophonePermissionMessage(err), true);
      try { pc.close(); } catch (e) {}
      return;
    }
    localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
    } catch (e) {
      setIntercomCallStatus("通話初始化失敗。", true);
      try { pc.close(); } catch (e2) {}
      return;
    }

    var fromProfile = await readUserProfileForCall(user.uid);
    var answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    var startedAtMs = Date.now();
    await callDocRef.set(
      {
        status: "accepted",
        acceptedAtMs: startedAtMs,
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedByUid: String(user.uid),
        acceptedByName: String(fromProfile.name || user.email || "住戶").trim(),
        answer: { type: answer.type, sdp: answer.sdp },
        toUid: String(user.uid),
        toRole: "resident",
      },
      { merge: true }
    );
    setIntercomCallStatus("已接通", false);
    stopIntercomRingtone();
    setIntercomPermissionHelp("", false);
    setIntercomSpeakerButtonEnabled(modal, true);
    var audioEl2 = document.getElementById("intercomRemoteAudioMember");
    if (audioEl2 && typeof audioEl2.setSinkId === "function") await setIntercomAudioOutputMode("earpiece");

    var unsubOfferCandidates = callDocRef.collection("offerCandidates").onSnapshot(function (snap) {
      (snap.docChanges ? snap.docChanges() : []).forEach(function (ch) {
        if (!ch || ch.type !== "added") return;
        var v = ch.doc && ch.doc.data ? (ch.doc.data() || {}) : {};
        if (!v || !v.candidate) return;
        try { pc.addIceCandidate(new RTCIceCandidate(v)); } catch (e) {}
      });
    });

    var unsubDoc = callDocRef.onSnapshot(async function (snap) {
      var v = snap && snap.exists ? (snap.data() || {}) : null;
      if (!v) return;
      var st = String(v.status || "").trim();
      if (st === "ended" || st === "rejected") {
        setIntercomCallStatus("通話已結束", false);
        await cleanupIntercomActive({ closeDelayMs: 1000 });
        resetIntercomStandby(modal);
      }
    });

    intercomActive = {
      callDocRef: callDocRef,
      pc: pc,
      localStream: localStream,
      remoteStream: remoteStream,
      audioOutputMode: "earpiece",
      unsubDoc: unsubDoc,
      unsubCandidates: unsubOfferCandidates,
      detachModal: detach,
      modalEl: modal,
    };
    startIntercomTimer(startedAtMs);
    prepareIntercomModal(modal);
  }

  function startMemberIntercomIncomingListener(communityId) {
    var cid = String(communityId || "").trim();
    var user = auth.currentUser;
    if (!user) return;
    if (intercomIncomingUnsub) {
      try { intercomIncomingUnsub(); } catch (e) {}
      intercomIncomingUnsub = null;
    }
    intercomLastIncomingMs = 0;
    intercomLastIncomingId = "";
    var minMs = Date.now() - 5 * 60 * 1000;
    var myUid = String(user.uid || "").trim();

    intercomIncomingUnsub = db
      .collection("calls")
      .where("toRole", "==", "resident")
      .where("toUid", "==", myUid)
      .where("status", "==", "ringing")
      .limit(20)
      .onSnapshot(async function (snap) {
        var docs = snap && snap.docs ? snap.docs : [];
        var list = docs
          .map(function (d) { return Object.assign({ id: d.id }, (d.data() || {})); })
          .filter(function (x) { return x && String(x.status || "") === "ringing"; })
          .sort(function (a, b) { return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0); });
        var latest = list[0] || null;
        if (!latest) {
          closeIntercomIncomingPrompt({ delayMs: 0 });
          return;
        }
        var latestCommunityRaw = String(latest.community || "").trim();
        var latestCommunityLower = latestCommunityRaw.toLowerCase();
        var myCid = String(intercomResolveCommunityId() || "").trim();
        var isUserCommunityMatch = !latestCommunityRaw
          || latestCommunityRaw === "default"
          || (cid && latestCommunityRaw === cid)
          || (myCid && latestCommunityRaw === myCid)
          || (myCid && myCid.toLowerCase() === latestCommunityLower);
        if (latestCommunityRaw && !isUserCommunityMatch) {
          return;
        }
        var createdAtMs = Number(latest.createdAtMs || 0);
        var callId = String(latest.id || "").trim();
        if (!callId) return;
        if (callId === intercomIncomingPromptCallId) return;
        if (callId === intercomLastIncomingId) return;
        if (createdAtMs && createdAtMs < minMs) return;
        intercomLastIncomingMs = createdAtMs;
        intercomLastIncomingId = callId;

        if (intercomActive) {
          try {
            await db.collection("calls").doc(callId).set({ status: "busy", endedAtMs: Date.now(), endedAt: FieldValue.serverTimestamp() }, { merge: true });
          } catch (e) {}
          return;
        }

        closeIntercomIncomingPrompt({ delayMs: 0 });
        var prompt = ensureIntercomIncomingModal();
        prepareIntercomModal(prompt);
        intercomIncomingPromptEl = prompt;
        intercomIncomingPromptCallId = callId;
        var callDocRef = db.collection("calls").doc(callId);
        if (intercomIncomingPromptUnsubDoc) {
          try { intercomIncomingPromptUnsubDoc(); } catch (e) {}
          intercomIncomingPromptUnsubDoc = null;
        }
        intercomIncomingPromptUnsubDoc = callDocRef.onSnapshot(function (docSnap) {
          var v = docSnap && docSnap.exists ? (docSnap.data() || {}) : null;
          var st = String((v && v.status) || "").trim();
          if (!v || (st && st !== "ringing")) closeIntercomIncomingPrompt({ delayMs: 0 });
        }, function () {});
        var detach2 = function () {};
        detach2 = bindModalClose(prompt, function () {
          detach2();
          callDocRef
            .set({ status: "missed", endedAtMs: Date.now(), endedAt: FieldValue.serverTimestamp() }, { merge: true })
            .catch(function () {});
          closeIntercomIncomingPrompt({ delayMs: 0 });
        });
        var btnAccept = prompt.querySelector("#btnIntercomAcceptMember");
        var btnReject = prompt.querySelector("#btnIntercomRejectMember");

        var fromName = String(latest.fromName || "社區後台").trim() || "社區後台";
        var fromHouse = String(latest.fromHouseNo || "").trim();
        setIntercomPeerVisual(prompt, {
          avatarSelector: "#intercomIncomingInitialMember",
          imageSelector: "#intercomIncomingAvatarMember",
          nameSelector: "#intercomIncomingNameMember",
          subSelector: "#intercomIncomingSubMember",
          name: fromName,
          sub: fromHouse || "社區後台",
          avatarDataUrl: String(latest.fromAvatarDataUrl || "").trim(),
          fallbackInitial: fromName,
        });

        if (btnReject) {
          btnReject.onclick = async function () {
            try { await callDocRef.set({ status: "rejected", endedAtMs: Date.now(), endedAt: FieldValue.serverTimestamp() }, { merge: true }); } catch (e) {}
            closeIntercomIncomingPrompt({ delayMs: 1000 });
          };
        }
        if (btnAccept) {
          btnAccept.onclick = async function () {
            closeIntercomIncomingPrompt({ delayMs: 0 });
            await intercomAnswerIncomingCall(callDocRef, latest);
          };
        }

        startIntercomRingtone("incoming");
        prepareIntercomModal(prompt);
      }, function (err) {
        console.warn("[special-member] 來電監聽失敗", err && err.code);
      });
  }

  function openIntercomCallModal() {
    var cid = intercomResolveCommunityId();
    var modal = ensureIntercomCallModal();
    bindIntercomSpeakerButton(modal);
    bindIntercomHistoryButton(modal, { communityId: cid, toRole: "resident" });
    var callBtn = modal.querySelector("#btnIntercomCallAdmin");
    var hangupBtn = modal.querySelector("#btnIntercomHangup");
    if (callBtn) {
      callBtn.hidden = false;
      callBtn.disabled = false;
      callBtn.onclick = function () { intercomStartOutgoingToAdmin({ communityId: cid }); };
    }
    // 未撥號時「掛斷」無作用
    if (hangupBtn) hangupBtn.disabled = true;
    if (hangupBtn) hangupBtn.onclick = function () {
      setIntercomCallStatus("通話已結束", false);
      cleanupIntercomActive({ updateStatus: "ended" }).then(function () {
        resetIntercomStandby(modal);
      });
    };
    setIntercomPeerVisual(modal, {
      avatarSelector: "#intercomPeerInitialMember",
      imageSelector: "#intercomPeerAvatarMember",
      nameSelector: "#intercomPeerName",
      subSelector: "#intercomPeerSub",
      name: "管理中心",
      sub: "點擊下方開始撥號",
      avatarDataUrl: "",
      defaultAvatar: "logo.svg",
      fallbackInitial: "管",
    });
    setIntercomCallStatus("待命", false);
    setIntercomPermissionHelp("", false);
    var timerEl = modal.querySelector("#intercomTimer");
    if (timerEl) timerEl.textContent = "00:00";
    openSheet({ node: modal, title: "對講", speakText: "對講" });
  }

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
        renderGreetQr();
        startMemberIntercomIncomingListener(state.cid);
        return Promise.all([loadParcels(), loadBulletins()]);
      })
      .catch(function (err) {
        console.error("[special-member] 初始化失敗", err);
      });
  });
})();
