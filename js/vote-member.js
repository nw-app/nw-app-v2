(function () {
  'use strict';

  // 初始化 Firebase
  const firebaseConfig = window.FIREBASE_CONFIG;
  if (!firebaseConfig) {
    console.error("Missing FIREBASE_CONFIG");
  }

  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    // 如果已经初始化过，会抛出错误，我们可以忽略
    console.log("Firebase already initialized or error:", e);
  }

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

  const STORAGE_ACTIVE_COMMUNITY = 'csp_active_community_v1';
  const SHARE_PAGE = 'checkin-vote-share.html';

  const titleEl = document.getElementById('voteMemberTitle');
  const tabsEl = document.getElementById('voteProjectTabs');
  const summaryEl = document.getElementById('voteSummary');
  const topicBtnsEl = document.getElementById('voteList');
  const panelEl = document.getElementById('votePanel');
  const searchInput = document.getElementById('voteSearchInput');
  const searchClear = document.getElementById('btnVoteSearchClear');
  const toastEl = document.getElementById('voteToast');

  /* 頁面狀態（身分／專案／議題／名單／暫存選取） */
  const state = {
    uid: '',
    displayName: '',
    houseNo: '',
    subHouseNo: '',
    cid: '',
    projects: [],
    projectIndex: 0,
    topics: [],
    topicIndex: 0,
    roster: [],
    entry: null,
    selections: {},
    dirty: new Set(),
    query: '',
    noticeKey: '',
    loading: true,
    error: '',
    busy: false,
  };

  let rosterUnsub = null;
  let toastTimer = null;

  /* ===================== 共用工具 ===================== */

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message, isError) {
    if (!toastEl) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    const text = String(message || '').trim();
    if (!text) {
      toastEl.hidden = true;
      toastEl.textContent = '';
      toastEl.classList.remove('error');
      return;
    }
    toastEl.textContent = text;
    toastEl.classList.toggle('error', Boolean(isError));
    toastEl.hidden = false;
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toastEl.hidden = true;
    }, isError ? 3200 : 2000);
  }

  const EMPTY_ICON = `<svg class="parcel-empty-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5h16v11H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M8 11.5l2.6 2.6L16 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  function emptyHtml(title, desc) {
    return `<div class="parcel-empty">${EMPTY_ICON}
      <div class="parcel-empty-title">${escapeHtml(title)}</div>
      ${desc ? `<div class="parcel-empty-desc">${escapeHtml(desc)}</div>` : ''}
    </div>`;
  }

  function skeletonHtml(count) {
    return new Array(count || 1).fill(0).map(() => `
      <div class="parcel-skeleton">
        <div class="sk-line w40"></div>
        <div class="sk-line tall w80"></div>
        <div class="sk-line w60"></div>
      </div>
    `).join('');
  }

  /* ===================== 社區與身分解析 ===================== */

  async function resolveCommunityId(keyOverride) {
    const keyFromUrl = (() => {
      try {
        return String(new URLSearchParams(location.search).get('c') || '').trim();
      } catch {
        return '';
      }
    })();
    const saved = (() => {
      try { return String(localStorage.getItem(STORAGE_ACTIVE_COMMUNITY) || '').trim(); } catch { return ''; }
    })();
    const key = String(keyOverride || '').trim() || keyFromUrl || saved;
    if (!key) return 'default';
    if (saved && saved === key) return saved;

    try {
      const byIdSnap = await db.collection('communities').where('id', '==', key).limit(1).get();
      const byId = byIdSnap && byIdSnap.docs && byIdSnap.docs[0] ? byIdSnap.docs[0] : null;
      if (byId && byId.exists) {
        const v = byId.data() || {};
        const cid = String(v.id || byId.id || '').trim() || 'default';
        try { localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid); } catch {}
        return cid;
      }
    } catch {}
    try {
      const byUserSnap = await db.collection('communities').where('username', '==', key).limit(1).get();
      const byUser = byUserSnap && byUserSnap.docs && byUserSnap.docs[0] ? byUserSnap.docs[0] : null;
      if (byUser && byUser.exists) {
        const v = byUser.data() || {};
        const cid = String(v.id || byUser.id || '').trim() || 'default';
        try { localStorage.setItem(STORAGE_ACTIVE_COMMUNITY, cid); } catch {}
        return cid;
      }
    } catch {}
    return key;
  }

  function readCommunityCandidates(userData) {
    const out = [];
    const push = (v) => {
      const s = String(v || '').trim();
      if (!s || out.includes(s)) return;
      out.push(s);
    };
    push(userData?.community);
    try { push(new URLSearchParams(location.search).get('c')); } catch {}
    try { push(localStorage.getItem(STORAGE_ACTIVE_COMMUNITY)); } catch {}
    return out.length ? out : ['default'];
  }

  function nameFromEmail(email) {
    const e = String(email || '').trim();
    if (!e) return '';
    return String((e.split('@')[0] || '')).trim();
  }

  /* 戶號／姓名正規化：全形破折號與空白統一，避免與名單對不上 */
  function normalizeUnitText(value) {
    return String(value == null ? '' : value).replace(/[－–—]/g, '-').replace(/\s+/g, '').trim();
  }

  function makeResidentKey(houseNo, subHouseNo, name) {
    const h = String(houseNo || '').trim();
    const s = String(subHouseNo || '').trim();
    const n = String(name || '').trim();
    if (!h || !n) return '';
    return `${h}__${s}__${n}`;
  }

  /* 由名單中找出登入住戶本人的那一筆（優先 UID，其次戶號＋姓名） */
  function matchRosterEntry(list, me) {
    const rows = Array.isArray(list) ? list.filter(Boolean) : [];
    const uid = String((me && me.uid) || '').trim();
    const houseNo = normalizeUnitText(me && me.houseNo);
    const subHouseNo = normalizeUnitText(me && me.subHouseNo);
    const name = String((me && me.name) || '').trim();

    if (uid) {
      const byUid = rows.find((item) => String(item.residentUid || '').trim() === uid);
      if (byUid) return byUid;
    }

    const keys = new Set();
    const fullKey = makeResidentKey(houseNo, subHouseNo, name);
    const baseKey = makeResidentKey(houseNo, '', name);
    if (fullKey) keys.add(fullKey);
    if (baseKey) keys.add(baseKey);
    if (keys.size) {
      const byKey = rows.find((item) => keys.has(String(item.residentKey || '').trim()));
      if (byKey) return byKey;
    }

    if (houseNo) {
      const sameHouse = rows.filter((item) => normalizeUnitText(item.houseNo) === houseNo);
      if (sameHouse.length) {
        if (name) {
          const named = sameHouse.find((item) => String(item.name || '').trim() === name);
          if (named) return named;
        }
        if (subHouseNo) {
          const bySub = sameHouse.find((item) => normalizeUnitText(item.subHouseNo) === subHouseNo);
          if (bySub) return bySub;
        }
        if (sameHouse.length === 1) return sameHouse[0];
      }
    }

    if (!houseNo && name) {
      const sameName = rows.filter((item) => String(item.name || '').trim() === name);
      if (sameName.length === 1) return sameName[0];
    }

    return null;
  }

  /* ===================== 資料載入 ===================== */

  function projectSettings(project) {
    const v = (project && project.settings) || {};
    return {
      requireCheckinBeforeVote: v.requireCheckinBeforeVote !== false,
    };
  }

  function currentProject() {
    return state.projects[state.projectIndex] || null;
  }

  function rosterCollection() {
    const project = currentProject();
    return db.collection('communities').doc(state.cid)
      .collection('checkinVoteProjects').doc(String((project && project.id) || ''))
      .collection('roster');
  }

  function stopRosterWatch() {
    if (rosterUnsub) {
      try { rosterUnsub(); } catch {}
      rosterUnsub = null;
    }
  }

  function normalizeTopic(doc) {
    const v = doc.data() || {};
    const options = Array.isArray(v.options) ? v.options : [];
    return {
      id: doc.id,
      title: String(v.title || '').trim() || '未命名議題',
      code: String(v.code || '').trim(),
      description: String(v.description || '').trim(),
      enabled: v.enabled !== false,
      singleChoice: v.singleChoice !== false,
      maxChoices: Math.max(0, Number(v.maxChoices || 0) || 0),
      order: Number(v.order || 0) || 0,
      options: options.map((opt, index) => ({
        id: String((opt && opt.id) || `opt${index + 1}`).trim(),
        label: String((opt && opt.label) || '').trim() || `選項 ${index + 1}`,
        code: String((opt && opt.code) || '').trim(),
      })),
    };
  }

  function normalizeRosterEntry(doc) {
    const v = doc.data() || {};
    return {
      id: doc.id,
      residentUid: String(v.residentUid || '').trim(),
      residentKey: String(v.residentKey || '').trim(),
      name: String(v.name || '').trim() || '住戶',
      houseNo: String(v.houseNo || '').trim(),
      subHouseNo: String(v.subHouseNo || '').trim(),
      checkedIn: v.checkedIn === true,
      votes: v.votes && typeof v.votes === 'object' ? v.votes : {},
    };
  }

  function me() {
    return {
      uid: state.uid,
      houseNo: state.houseNo,
      subHouseNo: state.subHouseNo,
      name: state.displayName,
    };
  }

  async function loadProjects() {
    let activeProjectId = '';
    try {
      const cSnap = await db.collection('communities').doc(state.cid).get();
      const cdata = cSnap && cSnap.exists ? (cSnap.data() || {}) : {};
      activeProjectId = String(cdata.checkinVoteActiveProjectId || '').trim();
    } catch {}

    const snap = await db.collection('communities').doc(state.cid)
      .collection('checkinVoteProjects').get();
    const projects = (snap && snap.docs ? snap.docs : [])
      .map((doc) => {
        const v = doc.data() || {};
        return {
          id: doc.id,
          name: String(v.name || '').trim() || '未命名專案',
          description: String(v.description || '').trim(),
          archived: v.archived === true,
          createdAtMs: Number(v.createdAtMs || 0) || 0,
          settings: v.settings && typeof v.settings === 'object' ? v.settings : {},
        };
      })
      .filter((project) => !project.archived)
      .sort((a, b) => (b.createdAtMs - a.createdAtMs) || a.name.localeCompare(b.name, 'zh-Hant'));

    state.projects = projects;
    const activeIndex = projects.findIndex((project) => project.id === activeProjectId);
    state.projectIndex = activeIndex >= 0 ? activeIndex : 0;
  }

  async function loadProjectData() {
    const project = currentProject();
    if (!project) {
      state.topics = [];
      state.roster = [];
      state.entry = null;
      state.topicIndex = 0;
      return;
    }

    const topicsSnap = await db.collection('communities').doc(state.cid)
      .collection('checkinVoteProjects').doc(project.id)
      .collection('topics').get();
    state.topics = (topicsSnap && topicsSnap.docs ? topicsSnap.docs : [])
      .map(normalizeTopic)
      .filter((topic) => topic.enabled !== false)
      .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'zh-Hant'));
    state.topicIndex = 0;

    const rosterSnap = await rosterCollection().get();
    state.roster = (rosterSnap && rosterSnap.docs ? rosterSnap.docs : []).map(normalizeRosterEntry);
    state.entry = matchRosterEntry(state.roster, me());

    resetSelections();
  }

  /* ===================== 選取狀態 ===================== */

  function savedVoteIds(topicId) {
    const votes = state.entry && state.entry.votes ? state.entry.votes : null;
    const vote = votes ? votes[String(topicId)] : null;
    return vote && Array.isArray(vote.optionIds)
      ? vote.optionIds.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
  }

  function sameIds(a, b) {
    const x = Array.isArray(a) ? a.slice().sort() : [];
    const y = Array.isArray(b) ? b.slice().sort() : [];
    if (x.length !== y.length) return false;
    return x.every((item, index) => item === y[index]);
  }

  function pendingIds(topicId) {
    const saved = savedVoteIds(topicId);
    const draft = state.selections[String(topicId)];
    return Array.isArray(draft) ? draft : saved;
  }

  /* 重新載入或名單變動時，尚未送出的選取保留、其餘回到已投票的內容 */
  function resetSelections() {
    const next = {};
    state.topics.forEach((topic) => {
      next[topic.id] = state.dirty.has(topic.id) && Array.isArray(state.selections[topic.id])
        ? state.selections[topic.id]
        : savedVoteIds(topic.id);
    });
    state.selections = next;
  }

  function isLocked() {
    const project = currentProject();
    if (!project) return true;
    if (!state.entry) return true;
    return projectSettings(project).requireCheckinBeforeVote && !state.entry.checkedIn;
  }

  function lockedReason() {
    if (!state.entry) return '您的戶號未列入本專案名單';
    return '要完成報到才能投票';
  }

  function noticeKey() {
    const project = currentProject();
    if (!project || state.loading || state.error) return '';
    if (!state.entry) return 'no-roster';
    if (projectSettings(project).requireCheckinBeforeVote && !state.entry.checkedIn) return 'need-checkin';
    return '';
  }

  /* ===================== 渲染 ===================== */

  function unvotedCount() {
    return state.topics.filter((topic) => savedVoteIds(topic.id).length === 0).length;
  }

  function renderTabs() {
    if (!tabsEl) return;
    if (!state.projects.length) {
      tabsEl.innerHTML = `<button class="tab-btn active" type="button" disabled>無投票專案</button>`;
      return;
    }
    tabsEl.innerHTML = state.projects.map((project, index) => {
      const active = index === state.projectIndex;
      const badge = active ? unvotedCount() : 0;
      return `<button class="tab-btn${active ? ' active' : ''}" type="button" data-project-index="${index}">${escapeHtml(project.name)}${badge > 0 ? `<span class="tab-count">${badge}</span>` : ''}</button>`;
    }).join('');
  }

  function renderSummary() {
    if (!summaryEl) return;
    const project = currentProject();
    if (!project || state.loading || state.error) {
      summaryEl.hidden = true;
      summaryEl.innerHTML = '';
      return;
    }
    const total = state.topics.length;
    const done = total - unvotedCount();
    const checkinText = state.entry ? (state.entry.checkedIn ? '已報到' : '未報到') : '無名單';
    summaryEl.innerHTML = `
      <div class="psum-item"><span class="psum-num">${total}</span><span class="psum-label">議題</span></div>
      <div class="psum-item${done ? '' : ' danger'}"><span class="psum-num">${done}</span><span class="psum-label">已投票</span></div>
      <div class="psum-item"><span class="psum-num" style="font-size:calc(15px * var(--fs, 1))">${escapeHtml(checkinText)}</span><span class="psum-label">報到狀態</span></div>
      <button class="btn-result" type="button" id="btnVoteResult">結果</button>
    `;
    summaryEl.hidden = false;
  }

  function filterTopics() {
    const q = String(state.query || '').trim().toLowerCase();
    const all = state.topics.map((topic, index) => ({ topic, index }));
    if (!q) return all;
    return all.filter(({ topic }) => {
      const hay = [topic.title, topic.code, topic.description]
        .concat(topic.options.map((opt) => opt.label))
        .map((x) => String(x || ''))
        .join(' ')
        .toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function ensureTopicIndex() {
    const rows = filterTopics();
    if (!rows.length) return;
    if (!rows.some((row) => row.index === state.topicIndex)) {
      state.topicIndex = rows[0].index;
    }
  }

  /* 議題按鈕：頁面一次只顯示一個議題，由按鈕切換 */
  function renderTopics() {
    if (!topicBtnsEl) return;
    const project = currentProject();
    if (state.loading || state.error || !project) {
      topicBtnsEl.innerHTML = '';
      return;
    }
    const rows = filterTopics();
    topicBtnsEl.innerHTML = rows.map(({ topic, index }) => {
      const done = savedVoteIds(topic.id).length > 0;
      return `<button class="vote-topic-btn${index === state.topicIndex ? ' is-active' : ''}" type="button" data-topic-index="${index}">
        <span class="vtt-idx">${index + 1}</span>
        <span class="vtt-title">${escapeHtml(topic.title)}</span>
        ${done ? '<span class="vtt-done">已投票</span>' : ''}
      </button>`;
    }).join('');
  }

  function noticeHtml() {
    if (noticeKey() === 'no-roster') {
      return `<div class="vote-notice"><b>查無您的住戶名單</b><span>您的戶號尚未列入本專案名單，請洽管理服務中心確認後再投票。</span></div>`;
    }
    if (noticeKey() === 'need-checkin') {
      return `<div class="vote-notice"><b>要完成報到才能投票</b><span>請先至服務台完成報到，本頁會自動更新投票權限。</span></div>`;
    }
    return '';
  }

  function topicCard(topic, index) {
    const saved = savedVoteIds(topic.id);
    const draft = pendingIds(topic.id);
    const voted = saved.length > 0;
    const changed = !sameIds(draft, saved);
    const locked = isLocked();
    const maxChoices = topic.singleChoice ? 1 : Math.max(0, Number(topic.maxChoices || 0) || 0);

    const optionsHtml = topic.options.map((opt) => {
      const checked = draft.indexOf(opt.id) >= 0;
      return `
        <label class="vote-option${checked ? ' is-selected' : ''}${locked ? ' is-locked' : ''}">
          <input type="${topic.singleChoice ? 'radio' : 'checkbox'}" name="cv-topic-${index}" value="${escapeHtml(opt.id)}" data-topic-index="${index}"${checked ? ' checked' : ''}${locked ? ' disabled' : ''} />
          <span class="vote-option-label">${escapeHtml(opt.label)}</span>
          ${opt.code ? `<span class="vote-option-code">${escapeHtml(opt.code)}</span>` : ''}
        </label>
      `;
    }).join('');

    return `
      <article class="vote-card${voted ? ' is-voted' : ''}" data-index="${index}">
        <div class="vote-hd">
          <div class="vote-title">${escapeHtml(topic.title)}</div>
          <div class="vote-tags">
            ${topic.code ? `<span class="vote-tag">${escapeHtml(topic.code)}</span>` : ''}
            ${voted ? `<span class="vote-tag done">已投票</span>` : ''}
          </div>
        </div>
        ${topic.description ? `<div class="vote-desc">${escapeHtml(topic.description)}</div>` : ''}
        <div class="vote-options">${optionsHtml}</div>
        <div class="vote-foot">
          <span class="vote-hint" data-vote-hint="${index}">${escapeHtml(voteHint(topic, locked, maxChoices))}</span>
          <button class="btn-vote" type="button" data-vote-submit="${index}"${locked || !changed ? ' disabled' : ''}>${voted ? '更新投票' : '送出投票'}</button>
        </div>
      </article>
    `;
  }

  function voteHint(topic, locked, maxChoices) {
    if (locked) return lockedReason();
    if (topic.singleChoice) return '單選';
    if (maxChoices > 0) return `多選（最多 ${maxChoices} 項）`;
    return '多選（不限項數）';
  }

  function renderPanel() {
    if (!panelEl) return;

    if (state.loading) {
      panelEl.innerHTML = skeletonHtml(1);
      return;
    }
    if (state.error) {
      panelEl.innerHTML = `<div class="status error">${escapeHtml(state.error)}</div>`;
      return;
    }
    if (!state.projects.length) {
      panelEl.innerHTML = emptyHtml('目前沒有投票專案', '請洽管理服務中心確認是否已開啟線上投票。');
      return;
    }
    if (!state.topics.length) {
      panelEl.innerHTML = emptyHtml('此專案尚無投票議題', '待管理單位建立議題後即可進行投票。');
      return;
    }
    if (!filterTopics().length) {
      panelEl.innerHTML = emptyHtml('沒有符合的議題', '試試其他關鍵字，或清除搜尋條件。');
      return;
    }

    const topic = state.topics[state.topicIndex];
    state.noticeKey = noticeKey();
    panelEl.innerHTML = noticeHtml() + topicCard(topic, state.topicIndex);
  }

  /* 單一議題卡片就地同步（避免重繪造成捲動位置跳動） */
  function syncPanel() {
    if (!panelEl) return;
    const topic = state.topics[state.topicIndex];
    const card = panelEl.querySelector('.vote-card');
    if (!topic || !card) return;

    const saved = savedVoteIds(topic.id);
    const draft = pendingIds(topic.id);
    const locked = isLocked();
    const changed = !sameIds(draft, saved);
    const maxChoices = topic.singleChoice ? 1 : Math.max(0, Number(topic.maxChoices || 0) || 0);

    card.querySelectorAll('.vote-option').forEach((row) => {
      const input = row.querySelector('input');
      if (!input) return;
      const on = draft.indexOf(input.value) >= 0;
      input.checked = on;
      input.disabled = locked;
      row.classList.toggle('is-selected', on);
      row.classList.toggle('is-locked', locked);
    });

    const btn = card.querySelector('[data-vote-submit]');
    if (btn) {
      btn.disabled = locked || !changed || state.busy;
      btn.textContent = saved.length ? '更新投票' : '送出投票';
    }

    const hintEl = card.querySelector('.vote-hint');
    if (hintEl) hintEl.textContent = voteHint(topic, locked, maxChoices);

    const tags = card.querySelector('.vote-tags');
    if (tags) {
      const doneTag = tags.querySelector('.vote-tag.done');
      if (saved.length && !doneTag) {
        const span = document.createElement('span');
        span.className = 'vote-tag done';
        span.textContent = '已投票';
        tags.appendChild(span);
      } else if (!saved.length && doneTag) {
        doneTag.remove();
      }
    }
    card.classList.toggle('is-voted', saved.length > 0);
  }

  function renderAll() {
    renderTabs();
    renderSummary();
    ensureTopicIndex();
    renderTopics();
    renderPanel();
  }

  /* ===================== 動作 ===================== */

  function openResult() {
    const project = currentProject();
    if (!project) {
      showToast('請先選擇投票專案', true);
      return;
    }
    const cid = String(state.cid || 'default').trim() || 'default';
    const url = new URL(
      `${SHARE_PAGE}?v=40&c=${encodeURIComponent(cid)}&p=${encodeURIComponent(project.id)}`,
      location.href
    ).href;
    const opened = window.open(url, '_blank');
    if (!opened) {
      showToast('請允許彈出視窗以開啟結果頁面', true);
      return;
    }
    try { opened.focus(); } catch {}
  }

  async function submitVote(index) {
    const topic = state.topics[index];
    const project = currentProject();
    if (!topic || !project || !state.entry) {
      showToast('無法投票，請確認名單狀態', true);
      return;
    }
    if (isLocked()) {
      showToast(lockedReason(), true);
      return;
    }
    const ids = pendingIds(topic.id);
    if (!ids.length) {
      showToast('請至少選擇一個選項', true);
      return;
    }

    const card = panelEl ? panelEl.querySelector('.vote-card') : null;
    const btn = card ? card.querySelector('[data-vote-submit]') : null;
    state.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = '送出中...';
    }

    try {
      const now = Date.now();
      const vote = {
        optionIds: ids.slice(),
        updatedAtMs: now,
        method: 'resident',
        operatorUid: state.uid,
        operatorName: state.displayName,
      };
      // 以點記法只更新本次議題，避免覆蓋其他議題的票
      await rosterCollection().doc(state.entry.id).update({
        [`votes.${topic.id}`]: vote,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: now,
      });
      state.entry.votes = { ...(state.entry.votes || {}), [topic.id]: vote };
      state.dirty.delete(topic.id);
      state.selections[topic.id] = ids.slice();
      state.busy = false;
      syncPanel();
      renderSummary();
      renderTopics();
      showToast('投票完成');
    } catch (e) {
      console.error('Error saving vote:', e);
      state.busy = false;
      state.dirty.add(topic.id);
      syncPanel();
      showToast('投票失敗，請稍後再試', true);
    }
  }

  async function switchProject(index) {
    const next = Number(index);
    if (!Number.isInteger(next) || next < 0 || next >= state.projects.length) return;
    if (next === state.projectIndex) return;
    state.projectIndex = next;
    state.query = '';
    state.dirty = new Set();
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.hidden = true;
    state.loading = true;
    state.error = '';
    renderAll();
    try {
      await loadProjectData();
      state.loading = false;
      renderAll();
      watchRoster();
    } catch (e) {
      console.error('Error switching project:', e);
      state.loading = false;
      state.error = '載入投票資料失敗，請稍後再試';
      renderAll();
    }
  }

  /* 名單即時同步：服務台完成報到後，本頁自動解除投票限制 */
  function watchRoster() {
    stopRosterWatch();
    if (!currentProject()) return;
    rosterUnsub = rosterCollection().onSnapshot((snap) => {
      state.roster = (snap && snap.docs ? snap.docs : []).map(normalizeRosterEntry);
      state.entry = matchRosterEntry(state.roster, me());
      resetSelections();
      const nextKey = noticeKey();
      if (nextKey !== state.noticeKey) {
        state.noticeKey = nextKey;
        renderPanel();
      } else {
        syncPanel();
      }
      renderSummary();
      renderTopics();
    }, (err) => {
      console.error('Roster watch failed:', err);
    });
  }

  /* ===================== 事件 ===================== */

  function bindEvents() {
    if (summaryEl) {
      summaryEl.addEventListener('click', (evt) => {
        if (evt.target.closest('#btnVoteResult')) openResult();
      });
    }

    if (tabsEl) {
      tabsEl.addEventListener('click', (evt) => {
        const btn = evt.target.closest('.tab-btn');
        if (!btn) return;
        switchProject(btn.getAttribute('data-project-index'));
      });
    }

    if (topicBtnsEl) {
      topicBtnsEl.addEventListener('click', (evt) => {
        const btn = evt.target.closest('.vote-topic-btn');
        if (!btn) return;
        const index = Number(btn.getAttribute('data-topic-index'));
        if (!Number.isInteger(index) || index === state.topicIndex) return;
        state.topicIndex = index;
        renderTopics();
        renderPanel();
        if (panelEl) panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (panelEl) {
      panelEl.addEventListener('change', (evt) => {
        const input = evt.target.closest('input[data-topic-index]');
        if (!input) return;
        const index = Number(input.getAttribute('data-topic-index'));
        const topic = state.topics[index];
        if (!topic) return;

        let ids = pendingIds(topic.id).slice();
        if (topic.singleChoice) {
          ids = [String(input.value || '')];
        } else if (input.checked) {
          if (ids.indexOf(input.value) < 0) ids.push(input.value);
          const max = Math.max(0, Number(topic.maxChoices || 0) || 0);
          if (max > 0 && ids.length > max) {
            ids = ids.filter((x) => x !== input.value);
            input.checked = false;
            showToast(`此議題最多只能選 ${max} 項`, true);
          }
        } else {
          ids = ids.filter((x) => x !== input.value);
        }

        state.selections[topic.id] = ids;
        state.dirty.add(topic.id);
        syncPanel();
      });

      panelEl.addEventListener('click', (evt) => {
        const btn = evt.target.closest('[data-vote-submit]');
        if (!btn || btn.disabled) return;
        submitVote(Number(btn.getAttribute('data-vote-submit')));
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.query = searchInput.value;
        if (searchClear) searchClear.hidden = !String(searchInput.value || '').trim();
        ensureTopicIndex();
        renderTopics();
        renderPanel();
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        state.query = '';
        searchClear.hidden = true;
        ensureTopicIndex();
        renderTopics();
        renderPanel();
        if (searchInput) { try { searchInput.focus(); } catch {} }
      });
    }

    window.addEventListener('pagehide', stopRosterWatch);
  }

  /* ===================== 啟動 ===================== */

  async function reload() {
    state.loading = true;
    state.error = '';
    renderAll();
    try {
      await loadProjects();
      await loadProjectData();
      state.loading = false;
      renderAll();
      watchRoster();
    } catch (e) {
      console.error('Error loading vote data:', e);
      state.loading = false;
      state.error = '載入投票資料失敗，請稍後再試';
      renderAll();
    }
  }

  async function loadProfile(user) {
    if (!user) return;

    state.uid = String(user.uid || '').trim();

    let data = {};
    try {
      const doc = await db.collection('users').doc(state.uid).get();
      if (doc.exists) data = doc.data() || {};
      if (!Object.keys(data).length) {
        const email = String(user.email || '').trim();
        if (email) {
          const snap = await db.collection('users').where('email', '==', email).limit(1).get();
          if (snap.size > 0) data = snap.docs[0].data() || {};
        }
      }
    } catch (e) {
      console.error('Error fetching user data:', e);
      data = {};
    }

    const displayName = String(
      data.displayName ||
      data.name ||
      data.fullName ||
      user.displayName ||
      nameFromEmail(user.email) ||
      ''
    ).trim();
    const houseNo = String(data.houseNo || data.unit || '').trim();
    const subHouseNo = String(data.subHouseNo || data.subUnit || data.sub || '').trim();
    const fullHouseNo = houseNo ? (subHouseNo ? `${houseNo}-${subHouseNo}` : houseNo) : '';

    state.displayName = displayName;
    state.houseNo = houseNo;
    state.subHouseNo = subHouseNo;
    if (titleEl) titleEl.textContent = `${fullHouseNo || '戶號'} ${displayName || '姓名'}`;

    const candidates = readCommunityCandidates({ community: String(data.community || '').trim() });

    for (const key of candidates) {
      const cid = await resolveCommunityId(key);
      if (!cid) continue;
      state.cid = cid;
      try {
        await loadProjects();
      } catch (e) {
        console.error('Error loading projects:', e);
        state.projects = [];
      }
      if (state.projects.length) break;
    }

    if (!state.cid) state.cid = await resolveCommunityId(candidates[0] || '');
    await reload();
  }

  function init() {
    bindEvents();

    // 檢查登入狀態
    auth.onAuthStateChanged(async (user) => {
      const showNeedLogin = () => {
        state.loading = false;
        state.error = '請先在主頁登入後再開啟此頁面';
        renderAll();
      };

      if (!user) {
        window.setTimeout(() => {
          const current = auth.currentUser;
          if (current) {
            loadProfile(current).catch((e) => console.error('Error loading profile:', e));
            return;
          }
          let embedded = true;
          try { embedded = window.self !== window.top; } catch { embedded = true; }
          if (embedded) showNeedLogin();
          else location.replace('index.html');
        }, 2500);
        return;
      }

      try {
        await loadProfile(user);
      } catch (e) {
        console.error('Error loading profile:', e);
        state.loading = false;
        state.error = '載入資料失敗，請稍後再試';
        renderAll();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
