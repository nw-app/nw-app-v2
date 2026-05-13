(() => {
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) throw new Error("Missing FIREBASE_CONFIG");

  try {
    firebase.initializeApp(firebaseConfig);
  } catch {}
  const auth = firebase.auth();
  const db = firebase.firestore();
  try {
    db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
  } catch {}

  const STORAGE_CONFIG = "csp_config_v1";
  const STORAGE_ACCOUNTS = "csp_accounts_v1";
  const STORAGE_ACTIVE_COMMUNITY = "csp_active_community_v1";

  const state = {
    communities: [],
    config: null,
    unsubCommunities: null,
    unsubConfig: null,
  };
  const catalogResidentButtons = [
    { id: "resident-bulletin", name: "公告", defaultUrl: "#resident/resident-bulletin", hint: "通知" },
    { id: "resident-parcel", name: "包裹通知", defaultUrl: "#resident/resident-parcel", hint: "收發" },
    { id: "resident-facility", name: "設施預約", defaultUrl: "#resident/resident-facility", hint: "預約" },
    { id: "resident-parking", name: "綠色停車", defaultUrl: "#resident/resident-parking", hint: "車位" },
  ];

  const navEl = document.getElementById("nav");
  const contentEl = document.getElementById("content");
  const pageTitleEl = document.getElementById("pageTitle");
  const pageSubtitleEl = document.getElementById("pageSubtitle");

  function defaultConfig() {
    const toButton = (x) => ({ enabled: true, url: x.defaultUrl });
    return { residentButtons: Object.fromEntries(catalogResidentButtons.map((x) => [x.id, toButton(x)])) };
  }

  function loadAccounts() {
    return { communities: state.communities, residents: [] };
  }

  function resolveActiveCommunityId() {
    const accounts = loadAccounts();
    const saved = localStorage.getItem(STORAGE_ACTIVE_COMMUNITY);
    const first = accounts.communities.find((x) => x && x.enabled)?.id || accounts.communities[0]?.id || "";
    if (saved && accounts.communities.some((x) => x && x.id === saved)) return saved;
    if (first) {
      localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, first);
      return first;
    }
    return "default";
  }

  function configDocRef(communityId) {
    return db.collection("communities").doc(String(communityId || "default")).collection("settings").doc("app_config");
  }

  function loadConfig() {
    try {
      const parsed = state.config && typeof state.config === "object" ? state.config : {};
      const d = defaultConfig();
      return { residentButtons: { ...d.residentButtons, ...(parsed.residentButtons || {}) } };
    } catch {
      return defaultConfig();
    }
  }

  function refreshLoginInfo(user) {
    const accounts = loadAccounts();
    const cid = resolveActiveCommunityId();
    const cname = accounts.communities.find((c) => c.id === cid)?.name || cid;
    const el = document.getElementById("loginInfo");
    if (el) el.textContent = `已登入：${user.email || "（未知）"}｜${cname}`;
  }

  function ensureConfigSubscription() {
    const cid = resolveActiveCommunityId();
    if (state.unsubConfig) state.unsubConfig();
    state.unsubConfig = configDocRef(cid).onSnapshot(
      (doc) => {
        state.config = doc && doc.exists ? (doc.data() || null) : null;
        render();
      },
      () => {
        state.config = null;
        render();
      }
    );
  }

  function ensureCommunitiesSubscription(user) {
    if (state.unsubCommunities) return;
    state.unsubCommunities = db.collection("communities").onSnapshot(
      (snap) => {
        state.communities = snap.docs.map((d) => {
          const v = d.data() || {};
          return { id: String(v.id || d.id), name: String(v.name || ""), enabled: v.enabled !== false };
        });
        refreshLoginInfo(user);
        ensureConfigSubscription();
        render();
      },
      () => {
        state.communities = [];
        refreshLoginInfo(user);
        ensureConfigSubscription();
        render();
      }
    );
  }

  function parseRoute() {
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    if (!raw) return { moduleId: "home" };
    const parts = raw.split("/");
    const role = parts[0] || "resident";
    if (role !== "resident") return { moduleId: "home" };
    return { moduleId: parts[1] || "home" };
  }

  function buildNav() {
    const cfg = loadConfig();
    const items = [{ id: "home", name: "首頁", hint: "Home", icon: "home", enabled: true, url: "#resident/home" }]
      .concat(catalogResidentButtons.map((x) => ({ ...x, ...cfg.residentButtons[x.id] })));
    navEl.innerHTML = items
      .filter((x) => x.enabled)
      .map((m) => `
            <a href="${m.url || "#resident/home"}" data-id="${m.id}" aria-current="false">
              <span aria-hidden="true">${icon(m.icon || "dot")}</span>
              <span class="label">${m.name}</span>
              <span class="hint">${m.hint || ""}</span>
            </a>
          `)
      .join("");
    navEl.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        location.hash = a.getAttribute("href");
      });
    });
  }

  function icon(kind) {
    if (kind === "home") {
      return `
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 10.5 12 4l8 6.5V20a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 20v-9.5Z" stroke="white" stroke-width="1.7" />
              <path d="M9 21v-7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7" stroke="white" stroke-width="1.7" />
            </svg>
          `;
    }
    return `
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 21.5c5.247 0 9.5-4.253 9.5-9.5S17.247 2.5 12 2.5 2.5 6.753 2.5 12 6.753 21.5 12 21.5Z" stroke="white" stroke-width="1.7" opacity="0.9"/>
            <path d="M12 8.2h.01" stroke="white" stroke-width="3.2" stroke-linecap="round"/>
            <path d="M12 16v-5" stroke="white" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        `;
  }

  function setActive(moduleId) {
    navEl.querySelectorAll("a").forEach((a) => a.setAttribute("aria-current", a.dataset.id === moduleId ? "page" : "false"));

    if (moduleId === "resident-bulletin") {
      pageTitleEl.textContent = "公告";
      pageSubtitleEl.textContent = "最新公告與重要通知（示意）";
      contentEl.innerHTML = bulletinView();
      return;
    }
    if (moduleId === "resident-parcel") {
      pageTitleEl.textContent = "包裹通知";
      pageSubtitleEl.textContent = "待領取包裹提醒（示意）";
      contentEl.innerHTML = parcelView();
      return;
    }
    if (moduleId === "resident-facility") {
      pageTitleEl.textContent = "設施預約";
      pageSubtitleEl.textContent = "查看時段與我的預約（示意）";
      contentEl.innerHTML = facilityView();
      return;
    }
    if (moduleId === "resident-parking") {
      pageTitleEl.textContent = "綠色停車";
      pageSubtitleEl.textContent = "我的車位與充電資訊（示意）";
      contentEl.innerHTML = parkingView();
      return;
    }
    pageTitleEl.textContent = "首頁";
    pageSubtitleEl.textContent = "住戶前台頁面後續再規劃設計（示意）";
    contentEl.innerHTML = homeView();
  }

  function homeView() {
    const cfg = loadConfig();
    const enabled = catalogResidentButtons
      .map((x) => ({ ...x, ...cfg.residentButtons[x.id] }))
      .filter((x) => x.enabled);

    return `
          <div class="grid">
            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>快速入口</h2>
                  <p>此處按鈕可由系統管理員設定啟用/連結</p>
                </div>
                <span class="tag red">入口</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  ${enabled.map((b) => `
                    <div class="item">
                      <div>
                        <div style="font-weight:900;">${b.name}</div>
                        <div class="meta">
                          <span class="tag red">啟用</span>
                          <span class="tag">${b.url || b.defaultUrl}</span>
                        </div>
                      </div>
                      <button class="btn btn-primary" type="button" data-open="${b.id}">開啟</button>
                    </div>
                  `).join("")}
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>住戶資訊（示意）</h2>
                  <p>後續可串接住戶資料、通知、我的預約</p>
                </div>
                <span class="tag">預留</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">未讀公告</div>
                      <div class="muted" style="margin-top:6px;">2 則</div>
                    </div>
                    <span class="tag red">提醒</span>
                  </div>
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">待領取包裹</div>
                      <div class="muted" style="margin-top:6px;">1 件</div>
                    </div>
                    <span class="tag">通知</span>
                  </div>
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">我的預約</div>
                      <div class="muted" style="margin-top:6px;">今晚 19:00 健身房</div>
                    </div>
                    <span class="tag">行程</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        `;
  }

  function bulletinView() {
    return `
          <div class="grid">
            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>公告列表</h2>
                  <p>分類與置頂（示意）</p>
                </div>
                <span class="tag red">通知</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  ${[
                    { title: "【置頂】電梯年度保養通知", meta: ["重要通知", "2026/05/07"], tag: "置頂" },
                    { title: "游泳池清潔消毒時間調整", meta: ["設備維護", "2026/05/06"], tag: "更新" },
                    { title: "端午節社區活動報名", meta: ["活動訊息", "2026/05/05"], tag: "活動" },
                  ].map((x) => `
                    <div class="item">
                      <div>
                        <div style="font-weight:900;">${x.title}</div>
                        <div class="meta">
                          <span class="tag red">${x.tag}</span>
                          <span class="tag">${x.meta[0]}</span>
                          <span class="tag">${x.meta[1]}</span>
                        </div>
                      </div>
                      <button class="btn" type="button" data-read>閱讀</button>
                    </div>
                  `).join("")}
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>閱讀狀態（預留）</h2>
                  <p>後續可加入未讀提醒、收藏、回覆</p>
                </div>
                <span class="tag">預留</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">未讀</div>
                      <div class="muted" style="margin-top:6px;">2 則</div>
                    </div>
                    <span class="tag red">提醒</span>
                  </div>
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">已讀</div>
                      <div class="muted" style="margin-top:6px;">15 則</div>
                    </div>
                    <span class="tag">統計</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        `;
  }

  function parcelView() {
    return `
          <div class="grid">
            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>待領取</h2>
                  <p>由社區後台登記後推送（示意）</p>
                </div>
                <span class="tag red">提醒</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  ${[
                    { title: "A-1203｜宅配", meta: ["17:10 到貨", "狀態：待領取"] },
                    { title: "A-1203｜郵局掛號", meta: ["15:42 到貨", "狀態：待領取"] },
                  ].map((x) => `
                    <div class="item">
                      <div>
                        <div style="font-weight:900;">${x.title}</div>
                        <div class="meta">
                          <span class="tag">${x.meta[0]}</span>
                          <span class="tag red">${x.meta[1]}</span>
                        </div>
                      </div>
                      <button class="btn" type="button">確認</button>
                    </div>
                  `).join("")}
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>領取紀錄（預留）</h2>
                  <p>後續可串接簽收、QR Code</p>
                </div>
                <span class="tag">預留</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">最近領取</div>
                      <div class="muted" style="margin-top:6px;">2026/05/06 19:20</div>
                    </div>
                    <span class="tag">紀錄</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        `;
  }

  function facilityView() {
    return `
          <div class="grid">
            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>可預約時段（示意）</h2>
                  <p>後續可加入規則、名額、付款等</p>
                </div>
                <span class="tag red">預約</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  ${[
                    { title: "健身房｜19:00–20:00", meta: ["剩餘：3", "狀態：可預約"] },
                    { title: "交誼廳｜20:00–22:00", meta: ["剩餘：1", "狀態：可預約"] },
                  ].map((x) => `
                    <div class="item">
                      <div>
                        <div style="font-weight:900;">${x.title}</div>
                        <div class="meta">
                          <span class="tag">${x.meta[0]}</span>
                          <span class="tag red">${x.meta[1]}</span>
                        </div>
                      </div>
                      <button class="btn btn-primary" type="button">預約</button>
                    </div>
                  `).join("")}
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>我的預約（示意）</h2>
                  <p>後續可加入取消、改期與審核</p>
                </div>
                <span class="tag">行程</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">健身房｜今晚 19:00–20:00</div>
                      <div class="meta">
                        <span class="tag red">已確認</span>
                        <span class="tag">人數：3</span>
                      </div>
                    </div>
                    <button class="btn" type="button">取消</button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        `;
  }

  function parkingView() {
    return `
          <div class="grid">
            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>我的車位（示意）</h2>
                  <p>後續可串接充電樁狀態、費率</p>
                </div>
                <span class="tag red">綠能</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">B1-086｜EV</div>
                      <div class="meta">
                        <span class="tag red">充電樁：私人</span>
                        <span class="tag">狀態：正常</span>
                      </div>
                    </div>
                    <button class="btn" type="button">詳情</button>
                  </div>
                </div>
              </div>
            </section>

            <section class="card">
              <div class="card-hd">
                <div>
                  <h2>使用規範（預留）</h2>
                  <p>可加入違規提醒、申請流程</p>
                </div>
                <span class="tag">預留</span>
              </div>
              <div class="card-bd">
                <div class="list">
                  <div class="item">
                    <div>
                      <div style="font-weight:900;">停車規範</div>
                      <div class="muted" style="margin-top:6px;">示意文字</div>
                    </div>
                    <span class="tag">公告</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        `;
  }

  function hydrateHomeButtons() {
    contentEl.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-open");
        location.hash = `#resident/${id}`;
      });
    });
  }

  function render() {
    buildNav();
    const r = parseRoute();
    setActive(r.moduleId);
    if (r.moduleId === "home") hydrateHomeButtons();
  }

  const btnGoCommunity = document.getElementById("btnGoCommunity");
  if (btnGoCommunity) {
    btnGoCommunity.addEventListener("click", () => {
      location.href = "admin.html#community/community-dashboard";
    });
  }

  const bindSignOut = () => {
    const btn = document.getElementById("btnSignOut");
    if (!btn || btn._boundSignOut) return;
    btn._boundSignOut = true;
    btn.addEventListener("click", async () => {
      try {
        sessionStorage.removeItem("csp_role");
        await auth.signOut();
      } catch {}
      location.href = "index.html";
    });
  };
  bindSignOut();
  document.addEventListener("DOMContentLoaded", bindSignOut);

  auth.onAuthStateChanged((user) => {
    const role = sessionStorage.getItem("csp_role");
    if (!user) {
      location.href = "index.html";
      return;
    }
    if (role !== "resident") {
      location.href = "index.html";
      return;
    }
    refreshLoginInfo(user);
    const fallback = document.getElementById("userAvatarFallback");
    if (fallback) fallback.textContent = String(user.email || "U").trim().slice(0, 1).toUpperCase() || "U";
    ensureCommunitiesSubscription(user);
    render();
  });

  window.addEventListener("hashchange", () => render());
})();
