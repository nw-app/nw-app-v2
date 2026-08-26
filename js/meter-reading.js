(function () {
  'use strict';

  const METER_TYPES_DEFAULT = Object.freeze({
    ELECTRIC: { id: 'electric', name: '電錶', unit: '度', digits: 4, icon: '⚡', color: '#f59e0b' },
    WATER: { id: 'water', name: '自來水錶', unit: '度', digits: 4, icon: '💧', color: '#0ea5e9' },
    GAS: { id: 'gas', name: '天然氣瓦斯錶', unit: '度', digits: 4, icon: '🔥', color: '#ef4444' }
  });

  let METER_TYPES = Object.freeze(JSON.parse(JSON.stringify(METER_TYPES_DEFAULT)));
  let __meterSettingsCache = null;
  let __meterSettingsCachedAt = 0;

  function normalizeMeterTypeFromRaw(raw) {
    const base = Object.values(METER_TYPES_DEFAULT).reduce((o, t) => { o[t.id] = { id: t.id, name: t.name, unit: t.unit, digits: t.digits, icon: t.icon, color: t.color }; return o; }, {});
    const order = ['electric', 'water', 'gas'];
    if (!raw || typeof raw !== 'object') return { map: Object.freeze(base), order, settings: null };
    order.forEach((id) => {
      const r = raw[id];
      if (!r || typeof r !== 'object') return;
      const b = base[id];
      if (!b) return;
      if (typeof r.id === 'string' && r.id) b.id = r.id;
      if (typeof r.name === 'string' && r.name.trim()) b.name = r.name.trim();
      if (typeof r.unit === 'string' && r.unit.trim()) b.unit = r.unit.trim();
      if (typeof r.enabled === 'boolean') b.enabled = r.enabled;
      const digits = Number.isFinite(Number(r.digits)) ? Math.max(2, Math.min(8, Math.floor(Number(r.digits)))) : NaN;
      if (Number.isFinite(digits)) b.digits = digits;
      const up = Number.isFinite(Number(r.unitPrice)) ? Math.max(0, Number(r.unitPrice)) : NaN;
      if (Number.isFinite(up)) b.unitPrice = up;
      const pf = Number.isFinite(Number(r.presetFee)) ? Math.max(0, Number(r.presetFee)) : NaN;
      if (Number.isFinite(pf)) b.presetFee = pf;
      if (typeof r.icon === 'string' && r.icon.trim()) b.icon = r.icon.trim();
    });
    const enabledOrder = order.filter(id => base[id].enabled !== false);
    const mapOut = {};
    Object.keys(base).forEach(id => { mapOut[id.toUpperCase()] = Object.freeze(base[id]); mapOut[id] = Object.freeze(base[id]); });
    return { map: Object.freeze(mapOut), order: enabledOrder.length ? enabledOrder : order, settings: JSON.parse(JSON.stringify(raw)) };
  }

  function getActiveMeterTypesMap() { return METER_TYPES; }
  function getActiveMeterTypeIds() { return (window.__nwMeterOrder || ['electric','water','gas']).filter(id => {
    const m = METER_TYPES[id] || METER_TYPES[(id||'').toUpperCase()];
    return m && (m.enabled !== false);
  }); }

  async function loadCommunityMeterSettings(db, communityId, force) {
    const nowT = Date.now();
    if (!force && __meterSettingsCache && (nowT - __meterSettingsCachedAt) < 60*1000 && __meterSettingsCache.communityId === communityId) return __meterSettingsCache.payload;
    const cid = String(communityId || '').trim();
    const def = normalizeMeterTypeFromRaw(null);
    if (!db || !cid || cid === 'default') {
      METER_TYPES = def.map; window.__nwMeterOrder = def.order; __meterSettingsCache = null; return null;
    }
    try {
      const snap = await db.collection('communities').doc(cid).get();
      const doc = snap && snap.exists ? (snap.data() || {}) : {};
      const raw = doc.meterSettings || null;
      const nr = normalizeMeterTypeFromRaw(raw);
      METER_TYPES = nr.map;
      window.__nwMeterOrder = nr.order;
      __meterSettingsCache = { communityId: cid, payload: nr.settings || raw, normalized: nr, fetchedAt: nowT };
      __meterSettingsCachedAt = nowT;
      return nr.settings || raw;
    } catch (e) {
      console.warn('[meter-reading] loadCommunityMeterSettings failed:', e);
      METER_TYPES = def.map; window.__nwMeterOrder = def.order; __meterSettingsCache = null; return null;
    }
  }

  function digitBoxesStringify(digits, initial, meterColor) {
    const n = Math.max(2, Math.min(8, Number.isFinite(Number(digits)) ? Math.floor(Number(digits)) : 4));
    const base = Math.max(0, Math.min(Math.pow(10, n)-1, Number.isFinite(Number(initial)) ? Math.floor(Number(initial)) : 0));
    const arr = String(base).padStart(n, '0').split('');
    const color = String(meterColor || '#1f2937');
    const boxes = arr.map((d) => `<div class="nl-digit"><div class="nl-digit-inner" style="color:${color};border-color:${color}77;">${d}</div></div>`).join('');
    return boxes;
  }

  const VALIDATION_STATUS = Object.freeze({
    PENDING: 'pending',
    VALID: 'valid',
    ABNORMAL: 'abnormal',
    DISPUTED: 'disputed',
    RESOLVED: 'resolved'
  });

  const FEE_TIERS = Object.freeze({
    electric: [
      { limit: 120, rate: 1.63 },
      { limit: 330, rate: 2.38 },
      { limit: 500, rate: 3.55 },
      { limit: 700, rate: 4.11 },
      { limit: Infinity, rate: 5.20 }
    ],
    water: [
      { limit: 20, rate: 7.85 },
      { limit: 40, rate: 9.39 },
      { limit: 60, rate: 11.68 },
      { limit: Infinity, rate: 13.98 }
    ],
    gas: [
      { limit: 100, rate: 16.80 },
      { limit: 300, rate: 20.50 },
      { limit: Infinity, rate: 24.20 }
    ]
  });

  const ABNORMAL_THRESHOLDS = Object.freeze({
    electric: { minIncrease: -10, maxIncreaseRatio: 2.5 },
    water: { minIncrease: -5, maxIncreaseRatio: 3.0 },
    gas: { minIncrease: -5, maxIncreaseRatio: 3.0 }
  });

  const STORAGE_CACHE_PREFIX = 'nwapp:meter:cache:';
  const STORAGE_LOGS = 'nwapp:meter:logs';

  function pad2(n) { return String(n).padStart(2, '0'); }
  function genId() { return 'mr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function genLogId() { return 'ml_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function formatDateYYYYMM(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function formatDateFull(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function toDateValue(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (v && typeof v.toDate === 'function') {
      try {
        const d = v.toDate();
        return isNaN(d.getTime()) ? null : d;
      } catch { return null; }
    }
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function getMeterType(typeId) {
    const id = String(typeId || '').trim().toLowerCase();
    return Object.values(METER_TYPES).find(t => t.id === id) || null;
  }

  function safeParseNumber(v) {
    if (v === null || v === undefined || v === '') return NaN;
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/[,\s]/g, ''));
    return isNaN(n) ? NaN : n;
  }

  function isValidMeterNumber(typeId, value) {
    const t = getMeterType(typeId);
    if (!t) return false;
    const n = safeParseNumber(value);
    if (isNaN(n)) return false;
    if (n < 0) return false;
    if (!Number.isInteger(n)) return false;
    const maxVal = Math.pow(10, t.digits) - 1;
    return n <= maxVal;
  }

  function calcUsage(prevValue, currValue, typeId) {
    const p = safeParseNumber(prevValue);
    const c = safeParseNumber(currValue);
    if (isNaN(p) || isNaN(c)) return NaN;
    let usage = c - p;
    if (usage < 0) {
      const t = getMeterType(typeId);
      const maxVal = t ? Math.pow(10, t.digits) : 1000000;
      usage = c + (maxVal - p);
    }
    return usage;
  }

  function calcFee(usage, typeId, opts) {
    const u = safeParseNumber(usage);
    if (isNaN(u) || u < 0) return 0;
    const t = getMeterType(typeId);
    const up = Number.isFinite(Number(opts && opts.unitPrice)) ? Number(opts.unitPrice) : (t && Number.isFinite(Number(t.unitPrice)) ? Number(t.unitPrice) : NaN);
    const pf = Number.isFinite(Number(opts && opts.presetFee)) ? Number(opts.presetFee) : (t && Number.isFinite(Number(t.presetFee)) ? Number(t.presetFee) : 0);
    let total = 0;
    if (Number.isFinite(up) && up >= 0) {
      total = u * up + (pf || 0);
    } else {
      const tiers = FEE_TIERS[typeId] || [];
      let remaining = u;
      let prevLimit = 0;
      for (const tier of tiers) {
        const tierRange = tier.limit - prevLimit;
        if (remaining <= 0) break;
        const inTier = Math.min(remaining, tierRange);
        total += inTier * tier.rate;
        remaining -= inTier;
        prevLimit = tier.limit;
        if (tier.limit === Infinity) break;
      }
      total = total + (pf || 0);
    }
    return Math.round(total * 100) / 100;
  }

  function detectAbnormal(record, historyAvg) {
    const t = getMeterType(record.meterType);
    if (!t) return { isAbnormal: false, reasons: [] };
    const thresholds = ABNORMAL_THRESHOLDS[t.id] || {};
    const reasons = [];
    const usage = safeParseNumber(record.usage);

    if (isNaN(usage)) {
      reasons.push('無法計算用量');
      return { isAbnormal: true, reasons };
    }

    if (usage < thresholds.minIncrease) {
      reasons.push(`用量異常低：${usage}${t.unit}（最小允許 ${thresholds.minIncrease}${t.unit}）`);
    }

    const prev = safeParseNumber(record.previousValue);
    const curr = safeParseNumber(record.currentValue);
    if (!isNaN(prev) && !isNaN(curr) && curr < prev && (!getMeterType(record.meterType) || !calcUsage(prev, curr, record.meterType))) {
      reasons.push(`本次數值(${curr})小於上次數值(${prev})，且無翻轉跡象`);
    }

    const avg = safeParseNumber(historyAvg);
    if (!isNaN(avg) && avg > 0) {
      const ratio = usage / avg;
      if (ratio > thresholds.maxIncreaseRatio) {
        reasons.push(`用量漲幅過大：本期 ${usage}${t.unit}，歷史平均 ${avg}${t.unit}（${ratio.toFixed(1)}倍）`);
      }
    }

    return { isAbnormal: reasons.length > 0, reasons };
  }

  let __db = null;
  let __auth = null;
  function ensureServices() {
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg) return { db: null, auth: null, ok: false, msg: '缺少 FIREBASE_CONFIG' };
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
    } catch {}
    try {
      if (!__auth) __auth = firebase.auth();
    } catch {}
    try {
      if (!__db) {
        __db = firebase.firestore();
        __db.settings({
          experimentalAutoDetectLongPolling: true,
          experimentalForceLongPolling: true,
          useFetchStreams: false,
          ignoreUndefinedProperties: true
        });
      }
    } catch {}
    return { db: __db, auth: __auth, ok: !!__db && !!__auth };
  }

  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(STORAGE_CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function cacheSet(key, value, ttlMs) {
    try {
      const payload = { v: value, t: Date.now(), ttl: ttlMs || 0 };
      localStorage.setItem(STORAGE_CACHE_PREFIX + key, JSON.stringify(payload));
    } catch {}
  }
  function cacheClear() {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_CACHE_PREFIX));
      keys.forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  function writeLog(entry) {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_LOGS) || '[]');
      list.unshift({ id: genLogId(), ts: Date.now(), ...entry });
      while (list.length > 500) list.pop();
      localStorage.setItem(STORAGE_LOGS, JSON.stringify(list));
    } catch {}
  }
  function readLogs(filter) {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_LOGS) || '[]');
      if (!filter) return list;
      return list.filter(filter);
    } catch { return []; }
  }

  async function getLastRecord(db, communityId, meterId) {
    if (!db || !communityId || !meterId) return null;
    try {
      const snap = await db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings')
        .where('meterId', '==', String(meterId))
        .orderBy('readingDate', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      if (snap.empty) return null;
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    } catch (e) {
      console.warn('[meter] getLastRecord failed:', e);
      return null;
    }
  }

  async function getHistoryAvg(db, communityId, meterId, meterType, months) {
    if (!db || !communityId || !meterId) return NaN;
    const count = months || 6;
    try {
      const snap = await db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings')
        .where('meterId', '==', String(meterId))
        .orderBy('readingDate', 'desc')
        .limit(count)
        .get();
      if (snap.empty) return NaN;
      const usages = [];
      snap.docs.forEach(doc => {
        const d = doc.data() || {};
        const u = safeParseNumber(d.usage);
        if (!isNaN(u) && u >= 0) usages.push(u);
      });
      if (!usages.length) return NaN;
      return usages.reduce((a, b) => a + b, 0) / usages.length;
    } catch { return NaN; }
  }

  async function listRecordsByHouse(db, communityId, houseNo, options) {
    if (!db || !communityId) return [];
    const opts = options || {};
    const meterType = opts.meterType || '';
    const dateFrom = opts.dateFrom || '';
    const dateTo = opts.dateTo || '';
    const uid = opts.uid || '';
    const resultsById = new Map();
    const tryQuery = async (buildRef) => {
      try {
        const ref = buildRef();
        const snap = await ref.orderBy('readingDate', 'desc').limit(opts.limit || 200).get();
        snap.docs.forEach(doc => {
          const d = doc.data() || {};
          if (meterType && d.meterType !== meterType) return;
          const rDate = toDateValue(d.readingDate);
          const rdStr = rDate ? formatDateYYYYMM(rDate) : '';
          if (dateFrom && rdStr < dateFrom) return;
          if (dateTo && rdStr > dateTo) return;
          if (!resultsById.has(doc.id)) resultsById.set(doc.id, { id: doc.id, ...d });
        });
        return true;
      } catch (e) {
        console.warn('[meter] listRecordsByHouse sub-query failed:', e);
        return false;
      }
    };
    const coll = () => db
      .collection('communities').doc(String(communityId))
      .collection('meterReadings');
    if (houseNo) {
      await tryQuery(() => coll().where('houseNo', '==', String(houseNo)));
    }
    if (uid) {
      await tryQuery(() => coll().where('residentUid', '==', String(uid)));
      await tryQuery(() => coll().where('createdBy.uid', '==', String(uid)));
    }
    let list = Array.from(resultsById.values());
    list.sort((a, b) => {
      const da = a.readingDate ? new Date(a.readingDate).getTime() : 0;
      const db2 = b.readingDate ? new Date(b.readingDate).getTime() : 0;
      return db2 - da;
    });
    if (opts.limit && list.length > opts.limit) list = list.slice(0, opts.limit);
    return list;
  }

  async function listRecordsByCommunity(db, communityId, options) {
    if (!db || !communityId) return [];
    const opts = options || {};
    try {
      let ref = db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings');
      const snap = await ref.orderBy('readingDate', 'desc').limit(opts.limit || 500).get();
      const list = [];
      snap.docs.forEach(doc => {
        const d = doc.data() || {};
        if (opts.meterType && d.meterType !== opts.meterType) return;
        if (opts.houseNo && d.houseNo !== opts.houseNo) return;
        if (opts.period) {
          const rDate = toDateValue(d.readingDate);
          const rdStr = rDate ? formatDateYYYYMM(rDate) : '';
          if (rdStr !== opts.period) return;
        }
        if (opts.status) {
          const st = String(d.validationStatus || VALIDATION_STATUS.PENDING);
          if (st !== opts.status) return;
        }
        list.push({ id: doc.id, ...d });
      });
      return list;
    } catch (e) {
      console.warn('[meter] listRecordsByCommunity failed:', e);
      return [];
    }
  }

  async function validateRecord(db, communityId, rawData) {
    const errors = [];
    const warnings = [];

    const meterId = String(rawData.meterId || '').trim();
    const houseNo = String(rawData.houseNo || '').trim();
    const meterType = String(rawData.meterType || '').trim();
    const currentValue = safeParseNumber(rawData.currentValue);
    const readingDate = toDateValue(rawData.readingDate) || new Date();
    const operatorId = String(rawData.operatorId || '').trim();
    const period = String(rawData.period || formatDateYYYYMM(readingDate)).trim();
    const source = String(rawData.source || '').trim().toLowerCase();
    const isResidentSource = source.includes('resident') || String(rawData.residentUid || '').trim().length > 0;

    if (!meterId) errors.push('儀表編號不可為空');
    if (!houseNo) errors.push('住戶門牌號不可為空');
    const t = getMeterType(meterType);
    if (!t) errors.push('儀表類型錯誤');
    if (isNaN(currentValue)) errors.push('抄錶數字格式錯誤');
    else if (!isValidMeterNumber(meterType, currentValue)) {
      errors.push(`${t ? t.name : '儀表'}數字位數不符（最多${t ? t.digits : '?'}位整數）`);
    }
    if (!operatorId) warnings.push('缺少抄表人員編號');

    const last = await getLastRecord(db, communityId, meterId);
    let previousValue = last ? safeParseNumber(last.currentValue) : (safeParseNumber(rawData.previousValue));
    if (isNaN(previousValue) || previousValue < 0) previousValue = 0;

    if (!isNaN(currentValue) && !isNaN(previousValue) && currentValue < previousValue) {
      const mt = getMeterType(meterType);
      if (!mt || calcUsage(previousValue, currentValue, meterType) <= 0) {
        errors.push(`${mt ? mt.name : '儀表'}本期數值(${currentValue})不得小於上期數值(${previousValue})`);
      }
    }

    const usage = calcUsage(previousValue, currentValue, meterType);
    const fee = calcFee(usage, meterType);
    const historyAvg = await getHistoryAvg(db, communityId, meterId, meterType, 6);
    const abnormalCheck = detectAbnormal({
      meterType, previousValue, currentValue, usage
    }, historyAvg);
    let status = isResidentSource ? VALIDATION_STATUS.PENDING : VALIDATION_STATUS.VALID;
    if (abnormalCheck.isAbnormal) {
      status = isResidentSource ? VALIDATION_STATUS.PENDING : VALIDATION_STATUS.ABNORMAL;
      warnings.push(...abnormalCheck.reasons);
    }
    if (errors.length > 0) status = VALIDATION_STATUS.PENDING;

    writeLog({
      action: 'validate_record',
      communityId, meterId, houseNo, meterType,
      source, isResidentSource,
      currentValue, previousValue, usage,
      computedStatus: status,
      valid: errors.length === 0,
      errors: errors.slice(),
      warnings: warnings.slice()
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      status,
      data: {
        meterId,
        houseNo,
        meterType,
        previousValue: previousValue,
        currentValue,
        usage: isNaN(usage) ? 0 : Math.round(usage * 100) / 100,
        fee,
        readingDate,
        period,
        operatorId,
        validationStatus: status,
        abnormalReasons: warnings.filter(w => abnormalCheck.reasons.includes(w)),
        lastRecordId: last ? last.id : '',
        source: String(rawData.source || (isResidentSource ? 'resident_app' : 'admin_app')),
        residentUid: String(rawData.residentUid || '').trim(),
        residentName: String(rawData.residentName || '').trim()
      }
    };
  }

  async function createRecord(db, communityId, rawData, operatorInfo) {
    const v = await validateRecord(db, communityId, rawData);
    if (!v.valid) {
      const errMsg = (v.errors || []).join('；') || '驗證失敗';
      writeLog({
        action: 'create_record_fail',
        communityId, meterId: rawData.meterId,
        houseNo: rawData.houseNo, meterType: rawData.meterType,
        errors: v.errors, warnings: v.warnings, operator: operatorInfo
      });
      try { console.error('[meter-reading] createRecord validation failed:', v.errors, rawData); } catch {}
      return { ok: false, errors: v.errors, warnings: v.warnings, _errorMessage: errMsg };
    }
    try {
      const id = genId();
      const safeResidentUid = String(rawData.residentUid || (operatorInfo && operatorInfo.uid) || v.data.residentUid || '').trim();
      const safeResidentName = String(rawData.residentName || (operatorInfo && operatorInfo.name) || v.data.residentName || '').trim();
      const safeHouseNo = String(rawData.houseNo || (operatorInfo && operatorInfo.houseNo) || v.data.houseNo || '').trim() || '—';
      const createdByUid = String((operatorInfo && operatorInfo.uid) || safeResidentUid || '').trim();
      const createdByName = String((operatorInfo && operatorInfo.name) || safeResidentName || '').trim();
      const createdByRole = String((operatorInfo && operatorInfo.role) || (safeResidentUid ? 'resident' : 'system')).trim();
      const safeSource = String(v.data.source || rawData.source || (safeResidentUid ? 'resident_app' : 'admin_app')).trim().toLowerCase();
      const data = {
        ...v.data,
        residentUid: safeResidentUid,
        residentName: safeResidentName,
        houseNo: safeHouseNo,
        source: safeSource,
        id,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
        createdBy: {
          uid: createdByUid,
          name: createdByName,
          role: createdByRole,
          houseNo: safeHouseNo
        },
        modifyHistory: [],
        dispute: null
      };
      try { console.log('[meter-reading] createRecord writing doc:', id, data.meterType, data.houseNo, data.currentValue); } catch {}
      await db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings').doc(id)
        .set(data);
      const snap = await db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings').doc(id)
        .get();
      if (!snap || !snap.exists) {
        throw new Error('寫入後無法讀取文件，Firestore 同步失敗');
      }
      writeLog({
        action: 'create_record',
        recordId: id, communityId,
        meterId: data.meterId, houseNo: data.houseNo,
        meterType: data.meterType, currentValue: data.currentValue,
        usage: data.usage, fee: data.fee, status: data.validationStatus,
        operator: operatorInfo, residentUid: data.residentUid
      });
      try { console.log('[meter-reading] createRecord success:', id, 'status=', data.validationStatus); } catch {}
      cacheClear();
      return { ok: true, id, data, warnings: v.warnings };
    } catch (e) {
      const msg = String(e && e.message || e) || '未知寫入錯誤';
      try { console.error('[meter-reading] createRecord firestore error:', msg, e, rawData); } catch {}
      writeLog({
        action: 'create_record_error',
        communityId, meterId: rawData.meterId,
        houseNo: rawData.houseNo, meterType: rawData.meterType,
        currentValue: rawData.currentValue,
        error: msg, stack: e && e.stack ? String(e.stack).slice(0, 500) : '',
        operator: operatorInfo
      });
      return { ok: false, errors: ['儲存失敗：' + msg], _errorMessage: msg };
    }
  }

  async function updateRecord(db, communityId, recordId, patch, operatorInfo, reason) {
    if (!db || !communityId || !recordId) return { ok: false, errors: ['參數錯誤'] };
    try {
      const docRef = db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings').doc(String(recordId));
      const docSnap = await docRef.get();
      if (!docSnap.exists) return { ok: false, errors: ['查無此筆紀錄'] };
      const oldData = docSnap.data() || {};
      const modifyEntry = {
        at: Date.now(),
        atIso: new Date().toISOString(),
        by: operatorInfo || {},
        reason: String(reason || '').trim(),
        before: {},
        after: {}
      };
      const allowedKeys = ['currentValue', 'previousValue', 'usage', 'fee', 'readingDate', 'period', 'operatorId', 'validationStatus', 'abnormalReasons'];
      const updateData = {};
      for (const k of allowedKeys) {
        if (!(k in patch)) continue;
        const newVal = patch[k];
        const oldVal = oldData[k];
        if (JSON.stringify(newVal) === JSON.stringify(oldVal)) continue;
        modifyEntry.before[k] = oldVal;
        modifyEntry.after[k] = newVal;
        updateData[k] = newVal;
      }
      if (!Object.keys(updateData).length) return { ok: false, errors: ['無資料變更'] };
      updateData.modifyHistory = firebase.firestore.FieldValue.arrayUnion(modifyEntry);
      updateData.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
      updateData.updatedAtMs = Date.now();
      updateData.updatedBy = operatorInfo || {};
      await docRef.set(updateData, { merge: true });
      writeLog({
        action: 'update_record', recordId, communityId,
        changes: modifyEntry, operator: operatorInfo
      });
      cacheClear();
      return { ok: true, modifyEntry };
    } catch (e) {
      writeLog({
        action: 'update_record_error', recordId, communityId,
        error: String(e && e.message || e), operator: operatorInfo
      });
      return { ok: false, errors: ['更新失敗：' + (e && e.message || e)] };
    }
  }

  async function submitDispute(db, communityId, recordId, payload) {
    if (!db || !communityId || !recordId) return { ok: false, errors: ['參數錯誤'] };
    const p = payload || {};
    try {
      const docRef = db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings').doc(String(recordId));
      const docSnap = await docRef.get();
      if (!docSnap.exists) return { ok: false, errors: ['查無此筆紀錄'] };
      const residentName = String(
        p.residentName || p.reporterName || (p.submittedBy && p.submittedBy.name) || ''
      ).trim();
      const residentUid = String(
        p.residentUid || p.reporterUid || (p.submittedBy && p.submittedBy.uid) || ''
      ).trim();
      const houseNo = String(
        p.reporterHouseNo || p.houseNo || (p.submittedBy && p.submittedBy.houseNo) || ''
      ).trim();
      const description = String(p.description || p.reason || '').trim();
      const photoKeys = Array.isArray(p.photos) ? p.photos.filter(Boolean) : [];
      const primaryPhoto = String(p.photoDataUrl || (photoKeys[0] || '')).trim();
      if (!description) return { ok: false, errors: ['請填寫核異說明'] };
      const dispute = {
        id: 'ds_' + Date.now().toString(36),
        submittedAt: Date.now(),
        submittedBy: p.submittedBy || (residentUid ? { uid: residentUid, name: residentName, houseNo } : {}),
        reporterUid: residentUid,
        reporterName: residentName,
        reporterHouseNo: houseNo,
        residentName,
        residentUid,
        houseNo,
        description,
        reason: description,
        photos: photoKeys,
        photoDataUrl: primaryPhoto,
        status: 'pending',
        reply: '',
        repliedAt: null,
        repliedBy: null
      };
      await docRef.set({
        validationStatus: VALIDATION_STATUS.DISPUTED,
        dispute,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      writeLog({
        action: 'submit_dispute', recordId, communityId,
        disputeId: dispute.id, resident: dispute.residentName,
        reasonLen: description.length, hasPhoto: !!primaryPhoto || photoKeys.length > 0
      });
      try { console.log('[meter-reading] submitDispute success:', dispute.id, 'record=', recordId); } catch {}
      cacheClear();
      return { ok: true, dispute };
    } catch (e) {
      const msg = String(e && e.message || e) || '未知錯誤';
      try { console.error('[meter-reading] submitDispute error:', msg, e); } catch {}
      writeLog({
        action: 'submit_dispute_error', recordId, communityId,
        error: msg, stack: e && e.stack ? String(e.stack).slice(0, 500) : ''
      });
      return { ok: false, errors: ['提交失敗：' + msg] };
    }
  }

  async function resolveDispute(db, communityId, recordId, resolution) {
    if (!db || !communityId || !recordId) return { ok: false, errors: ['參數錯誤'] };
    try {
      const docRef = db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings').doc(String(recordId));
      const docSnap = await docRef.get();
      if (!docSnap.exists) return { ok: false, errors: ['查無此筆紀錄'] };
      const oldData = docSnap.data() || {};
      const oldDispute = oldData.dispute || {};
      const newStatus = String(resolution.newStatus || VALIDATION_STATUS.RESOLVED).trim();
      const updateData = {
        'dispute.status': oldDispute.status === 'pending' ? 'resolved' : oldDispute.status,
        'dispute.reply': String(resolution.reply || '').trim(),
        'dispute.repliedAt': Date.now(),
        'dispute.repliedBy': resolution.repliedBy || {},
        validationStatus: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (resolution.newValue !== undefined && !isNaN(safeParseNumber(resolution.newValue))) {
        const newVal = safeParseNumber(resolution.newValue);
        const prev = safeParseNumber(oldData.previousValue);
        const newUsage = calcUsage(prev, newVal, oldData.meterType);
        const newFee = calcFee(newUsage, oldData.meterType);
        updateData.currentValue = newVal;
        updateData.usage = isNaN(newUsage) ? 0 : newUsage;
        updateData.fee = newFee;
      }
      await docRef.set(updateData, { merge: true });
      writeLog({
        action: 'resolve_dispute', recordId, communityId,
        resolution, operator: resolution.repliedBy
      });
      cacheClear();
      return { ok: true };
    } catch (e) {
      return { ok: false, errors: ['處理失敗：' + (e && e.message || e)] };
    }
  }

  async function listPendingDisputes(db, communityId) {
    if (!db || !communityId) return [];
    try {
      const snap = await db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings')
        .where('validationStatus', '==', VALIDATION_STATUS.DISPUTED)
        .orderBy('updatedAt', 'desc')
        .limit(100)
        .get();
      const out = [];
      snap.docs.forEach(d => out.push({ id: d.id, ...d.data() }));
      return out;
    } catch { return []; }
  }

  async function listAbnormalRecords(db, communityId) {
    if (!db || !communityId) return [];
    try {
      const snap = await db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings')
        .where('validationStatus', '==', VALIDATION_STATUS.ABNORMAL)
        .orderBy('readingDate', 'desc')
        .limit(100)
        .get();
      const out = [];
      snap.docs.forEach(d => out.push({ id: d.id, ...d.data() }));
      return out;
    } catch { return []; }
  }

  async function listPendingRecords(db, communityId) {
    if (!db || !communityId) return [];
    try {
      const snap = await db
        .collection('communities').doc(String(communityId))
        .collection('meterReadings')
        .where('validationStatus', '==', VALIDATION_STATUS.PENDING)
        .orderBy('createdAtMs', 'desc')
        .limit(200)
        .get();
      const out = [];
      snap.docs.forEach(d => out.push({ id: d.id, ...d.data() }));
      return out;
    } catch {
      try {
        const all = await listRecordsByCommunity(db, communityId, { limit: 500 });
        return all.filter(r => String(r.validationStatus || VALIDATION_STATUS.PENDING) === VALIDATION_STATUS.PENDING);
      } catch { return []; }
    }
  }

  function computeStatistics(records) {
    const byType = {};
    const byHouse = {};
    const byPeriod = {};
    const totalRecords = records.length;
    let validCount = 0, abnormalCount = 0, disputedCount = 0, pendingCount = 0;

    records.forEach(r => {
      const t = String(r.meterType || '');
      const h = String(r.houseNo || '');
      const rd = toDateValue(r.readingDate);
      const p = rd ? formatDateYYYYMM(rd) : String(r.period || '');
      const usage = safeParseNumber(r.usage) || 0;
      const fee = safeParseNumber(r.fee) || 0;
      const st = String(r.validationStatus || '');

      if (st === VALIDATION_STATUS.VALID || st === VALIDATION_STATUS.RESOLVED) validCount++;
      if (st === VALIDATION_STATUS.ABNORMAL) abnormalCount++;
      if (st === VALIDATION_STATUS.DISPUTED) disputedCount++;
      if (st === VALIDATION_STATUS.PENDING) pendingCount++;

      if (!byType[t]) byType[t] = { totalUsage: 0, totalFee: 0, count: 0, name: (getMeterType(t) || {}).name || t };
      byType[t].totalUsage += usage;
      byType[t].totalFee += fee;
      byType[t].count += 1;

      if (!byHouse[h]) byHouse[h] = { totalUsage: 0, totalFee: 0, count: 0 };
      byHouse[h].totalUsage += usage;
      byHouse[h].totalFee += fee;
      byHouse[h].count += 1;

      if (!byPeriod[p]) byPeriod[p] = { totalUsage: 0, totalFee: 0, count: 0 };
      byPeriod[p].totalUsage += usage;
      byPeriod[p].totalFee += fee;
      byPeriod[p].count += 1;
    });

    const houseCount = Object.keys(byHouse).length || 1;
    Object.keys(byType).forEach(t => {
      const tt = byType[t];
      tt.avgPerHouse = Math.round((tt.totalUsage / houseCount) * 100) / 100;
      tt.avgPerRecord = tt.count ? Math.round((tt.totalUsage / tt.count) * 100) / 100 : 0;
    });

    return {
      totalRecords,
      validCount,
      abnormalCount,
      disputedCount,
      pendingCount,
      byType,
      byHouse,
      byPeriod,
      houseCount,
      totalFee: Object.values(byType).reduce((s, t) => s + t.totalFee, 0)
    };
  }

  function exportCSV(records, stats) {
    const headers = ['紀錄編號', '儀表編號', '門牌號', '儀表類型', '上期數值', '本期數值', '用量', '費用(NT$)', '抄表日期', '繳費週期', '抄表員', '狀態', '備註'];
    const rows = records.map(r => {
      const t = getMeterType(r.meterType);
      const st = r.validationStatus;
      const statusMap = { pending: '待審核', valid: '正常', abnormal: '異常', disputed: '核異中', resolved: '已處理' };
      const rd = toDateValue(r.readingDate);
      return [
        String(r.id || ''),
        String(r.meterId || ''),
        String(r.houseNo || ''),
        t ? t.name : String(r.meterType || ''),
        String(r.previousValue ?? ''),
        String(r.currentValue ?? ''),
        String(r.usage ?? ''),
        String(r.fee ?? ''),
        rd ? formatDateFull(rd) : '',
        String(r.period || ''),
        String(r.operatorId || ''),
        statusMap[st] || st,
        Array.isArray(r.abnormalReasons) ? r.abnormalReasons.join('; ') : ''
      ];
    });
    const esc = (v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    let csv = '\uFEFF' + headers.map(esc).join(',') + '\n';
    rows.forEach(r => { csv += r.map(esc).join(',') + '\n'; });
    if (stats) {
      csv += '\n';
      csv += '統計彙總\n';
      csv += `總筆數,${stats.totalRecords},正常,${stats.validCount},異常,${stats.abnormalCount},核異中,${stats.disputedCount},總費用(NT$),${stats.totalFee.toFixed(2)}\n`;
      Object.keys(stats.byType).forEach(t => {
        const tt = stats.byType[t];
        csv += `${tt.name},總用量,${tt.totalUsage.toFixed(2)},總費用,${tt.totalFee.toFixed(2)},戶均用量,${tt.avgPerHouse.toFixed(2)},筆數,${tt.count}\n`;
      });
    }
    return csv;
  }

  function parseExcelCSV(text) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { ok: false, errors: ['檔案為空'] };
    const headers = splitCSVLine(lines[0]).map(h => h.trim());
    const fieldMap = {
      '儀表編號': 'meterId', 'meterId': 'meterId', 'meter_id': 'meterId',
      '門牌號': 'houseNo', '戶號': 'houseNo', 'houseNo': 'houseNo', 'house_no': 'houseNo',
      '儀表類型': 'meterType', '類型': 'meterType', 'meterType': 'meterType', 'meter_type': 'meterType',
      '上期數值': 'previousValue', '上次抄表': 'previousValue', 'previousValue': 'previousValue',
      '本期數值': 'currentValue', '本次抄表': 'currentValue', '抄表數字': 'currentValue', 'currentValue': 'currentValue',
      '抄表日期': 'readingDate', '日期': 'readingDate', 'readingDate': 'readingDate',
      '抄表員': 'operatorId', '抄表人員': 'operatorId', 'operatorId': 'operatorId',
      '繳費週期': 'period', 'period': 'period'
    };
    const typeNameMap = { '電': 'electric', '電錶': 'electric', 'water': 'water', '水': 'water', '自來水': 'water', '自來水錶': 'water', 'gas': 'gas', '瓦斯': 'gas', '天然氣': 'gas', '天然氣瓦斯錶': 'gas' };
    const results = [];
    const errors = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCSVLine(lines[i]);
      if (!cols.some(c => c && c.trim())) continue;
      const row = {};
      headers.forEach((h, idx) => {
        const key = fieldMap[h] || fieldMap[h.toLowerCase()];
        if (key) row[key] = (cols[idx] || '').trim();
      });
      if (!row.meterType) {
        errors.push(`第${i + 1}行：缺少儀表類型`);
        continue;
      }
      const tm = typeNameMap[row.meterType] || typeNameMap[String(row.meterType).toLowerCase()];
      if (!tm && !getMeterType(row.meterType)) {
        errors.push(`第${i + 1}行：未知的儀表類型「${row.meterType}」`);
        continue;
      }
      row.meterType = tm || row.meterType;
      row.currentValue = safeParseNumber(row.currentValue);
      row.previousValue = safeParseNumber(row.previousValue);
      if (row.readingDate) {
        const d = toDateValue(row.readingDate);
        if (d) row.readingDate = d;
      }
      results.push(row);
    }
    return { ok: errors.length === 0 || results.length > 0, data: results, errors };
  }

  function splitCSVLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  async function batchImportRecords(db, communityId, rows, operatorInfo) {
    const summary = { total: rows.length, success: 0, failed: 0, results: [] };
    for (let i = 0; i < rows.length; i++) {
      const res = await createRecord(db, communityId, rows[i], operatorInfo);
      if (res.ok) {
        summary.success++;
        summary.results.push({ index: i, ok: true, id: res.id });
      } else {
        summary.failed++;
        summary.results.push({ index: i, ok: false, errors: res.errors });
      }
    }
    writeLog({
      action: 'batch_import', communityId,
      total: summary.total, success: summary.success, failed: summary.failed,
      operator: operatorInfo
    });
    return summary;
  }

  function checkPermission(userRole, action) {
    const role = String(userRole || '').toLowerCase();
    switch (action) {
      case 'create':
      case 'import':
        return role === 'community' || role === 'admin' || role === 'meter_reader';
      case 'review':
      case 'update':
      case 'resolve_dispute':
      case 'export':
      case 'statistics':
        return role === 'community' || role === 'admin';
      case 'view_community_all':
        return role === 'community' || role === 'admin' || role === 'meter_reader';
      case 'view_own_house':
        return role === 'resident' || role === 'community' || role === 'admin';
      case 'submit_dispute':
        return role === 'resident';
      default:
        return false;
    }
  }

  const UI = (() => {
    function esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
    }
    function statusBadge(status) {
      const map = {
        pending: { cls: 'yellow', label: '待審核' },
        valid: { cls: 'green', label: '正常' },
        abnormal: { cls: 'red', label: '異常' },
        disputed: { cls: 'yellow', label: '核異中' },
        resolved: { cls: 'green', label: '已處理' }
      };
      const m = map[String(status || '').trim()] || map.pending;
      return `<div class="tag ${m.cls}">${m.label}</div>`;
    }
    function meterTag(typeId) {
      const t = getMeterType(typeId);
      if (!t) return '';
      const colorMap = { electric: '#2563eb', water: '#0891b2', gas: '#ea580c' };
      const c = colorMap[t.id] || 'var(--brand)';
      return `<div class="tag" style="background:${c}12;color:${c};border-color:${c}26;">${t.icon} ${t.name}</div>`;
    }
    function recordCard(r, opts) {
      const options = opts || {};
      const t = getMeterType(r.meterType);
      const unit = t ? t.unit : '度';
      const rd = toDateValue(r.readingDate);
      const rdStr = rd ? formatDateFull(rd) : '—';
      const periodStr = String(r.period || (rd ? formatDateYYYYMM(rd) : ''));
      const usage = safeParseNumber(r.usage) || 0;
      const fee = safeParseNumber(r.fee) || 0;
      const abnormalReasons = Array.isArray(r.abnormalReasons) ? r.abnormalReasons : [];
      const dispute = r.dispute || null;
      return `
        <div class="parcel-item" data-id="${esc(r.id)}" style="display:grid;gap:10px;padding:14px;border-radius:var(--radius,18px);background:#fff;border:1px solid rgba(17,24,39,0.10);box-shadow:0 8px 22px rgba(17,24,39,0.06);">
          <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px;">
            <div style="display:flex;gap:10px;align-items:flex-start;min-width:0;">
              ${meterTag(r.meterType)}
              <div style="min-width:0;">
                <div style="font-weight:800;font-size:14px;">戶號 ${esc(r.houseNo || '—')}</div>
                <div class="muted" style="font-size:12px;margin-top:2px;">儀表編號 ${esc(r.meterId || '—')} · 週期 ${esc(periodStr || '—')}</div>
              </div>
            </div>
            ${statusBadge(r.validationStatus)}
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 12px;">
            <div class="field" style="gap:2px;margin:0;">
              <label style="font-size:11px;">上期數值</label>
              <div style="font-size:13px;font-weight:700;">${esc(r.previousValue ?? '—')}</div>
            </div>
            <div class="field" style="gap:2px;margin:0;">
              <label style="font-size:11px;">本期數值</label>
              <div style="font-size:13px;font-weight:900;">${esc(r.currentValue ?? '—')}</div>
            </div>
            <div class="field" style="gap:2px;margin:0;">
              <label style="font-size:11px;">本期用量</label>
              <div style="font-size:13px;font-weight:700;${usage < 0 ? 'color:#dc2626;' : ''}">${usage.toFixed(2)} ${unit}</div>
            </div>
            <div class="field" style="gap:2px;margin:0;">
              <label style="font-size:11px;">應繳費用</label>
              <div style="font-size:13px;font-weight:900;color:var(--brand,#d32f2f);">NT$ ${fee.toFixed(2)}</div>
            </div>
            <div class="field" style="gap:2px;margin:0;">
              <label style="font-size:11px;">抄表日期</label>
              <div style="font-size:13px;">${rdStr}</div>
            </div>
            <div class="field" style="gap:2px;margin:0;">
              <label style="font-size:11px;">抄表員</label>
              <div style="font-size:13px;">${esc(r.operatorId || r.source || '—')}</div>
            </div>
          </div>
          ${abnormalReasons.length || dispute ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${abnormalReasons.map(rr => `<div class="tag red" style="font-size:11px;">⚠ ${esc(rr)}</div>`).join('')}
            ${dispute && dispute.status === 'pending' ? `<div class="tag yellow" style="font-size:11px;background:rgba(139,92,246,0.1);color:#8b5cf6;border-color:rgba(139,92,246,0.2);">✉ 住戶已提核異</div>` : ''}
            ${dispute && dispute.reply ? `<div class="tag" style="font-size:11px;background:rgba(99,102,241,0.1);color:#6366f1;border-color:rgba(99,102,241,0.2);">↩ ${esc(dispute.reply)}</div>` : ''}
          </div>` : ''}
          <div class="row" style="justify-content:flex-end;gap:6px;margin-top:2px;">
            ${options.showDetail ? `<button class="btn btn-sm btn-ghost" data-action="detail">明細</button>` : ''}
            ${options.showDispute ? `<button class="btn btn-sm" data-action="dispute">核異申請</button>` : ''}
            ${options.showFee ? `<button class="btn btn-sm btn-primary" data-action="fee">繳費通知</button>` : ''}
            ${options.showEdit ? `<button class="btn btn-sm" data-action="edit">修正</button>` : ''}
            ${options.showResolve ? `<button class="btn btn-sm btn-primary" data-action="resolve">處理核異</button>` : ''}
          </div>
        </div>
      `;
    }
    function emptyState(title, subtitle, emoji) {
      return `
        <div class="mr-empty">
          <div class="emoji">${emoji || '📋'}</div>
          <div class="title">${esc(title || '尚無資料')}</div>
          <div class="sub">${esc(subtitle || '')}</div>
        </div>
      `;
    }
    function openModal(title, bodyHtml, opts) {
      const o = opts || {};
      const backdrop = document.createElement('div');
      backdrop.className = 'mr-modal-backdrop';
      backdrop.innerHTML = `
        <div class="mr-modal" role="dialog" aria-modal="true">
          <div class="mr-modal-hd">
            <div class="title">${esc(title || '')}</div>
            <button class="mr-modal-close" type="button" aria-label="關閉">×</button>
          </div>
          <div class="mr-modal-bd">${bodyHtml}</div>
          <div class="mr-modal-ft">
            ${o.footerHtml || ''}
          </div>
        </div>
      `;
      document.body.appendChild(backdrop);
      const modal = backdrop.querySelector('.mr-modal');
      const close = () => {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (typeof o.onClose === 'function') o.onClose();
      };
      backdrop.querySelector('.mr-modal-close').onclick = close;
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
      });
      return { el: backdrop, modal, close };
    }

    async function renderResidentPage(container, userCtx) {
      const ctx = userCtx || {};
      const services = ensureServices();
      const db = services.db;
      if (!db) {
        container.innerHTML = `<div class="mr-alert danger"><div class="ico">⚠</div><div class="msg">系統初始化失敗，請重新整理頁面</div></div>`;
        return;
      }
      const communityId = String(ctx.communityId || '').trim();
      const houseNo = String(ctx.houseNo || '').trim();
      const uid = String(ctx.uid || '').trim();
      if (!communityId || !houseNo) {
        container.innerHTML = `<div class="mr-alert warning"><div class="ico">ℹ</div><div class="msg">缺少社區或戶號資訊，請重新登入後再試</div></div>`;
        return;
      }

      const state = {
        filterType: '',
        dateFrom: '',
        dateTo: '',
        records: [],
        loading: true
      };

      const __resEnabledFilter = (arr) => {
        const out = [];
        for (const it of arr) {
          if (!it) continue;
          const id = typeof it === 'string' ? it : (it.id || it.v || '');
          const t = getMeterType(id);
          if (!t) continue;
          if (t.enabled === false) continue;
          out.push(it);
        }
        return out;
      };

      const __reload = reload;
      reload = async () => {
        try { await loadCommunityMeterSettings(db, communityId, !!state.loading); } catch(e) { console.warn(e); }
        return __reload();
      };

      const renderLayout = () => {
        const baseTypes = [
          { id: '', label: '全部' },
          { id: 'electric', label: '⚡ 電錶' },
          { id: 'water', label: '💧 自來水' },
          { id: 'gas', label: '🔥 瓦斯' }
        ];
        const types = __resEnabledFilter(baseTypes);
        if (state.filterType) {
          const t = getMeterType(state.filterType);
          if (!t || t.enabled === false) state.filterType = '';
        }
        const stats = computeStatistics(state.records);
        const baseCards = [
          { cls: 'total', label: '本期總筆數', value: String(stats.totalRecords), sub: '已登記的抄表紀錄', keep: true },
          { cls: 'electric', label: '電費累計', value: 'NT$ ' + (stats.byType.electric ? stats.byType.electric.totalFee.toFixed(2) : '0.00'), sub: stats.byType.electric ? `${stats.byType.electric.totalUsage.toFixed(0)} 度` : '0 度', mid: 'electric' },
          { cls: 'water', label: '水費累計', value: 'NT$ ' + (stats.byType.water ? stats.byType.water.totalFee.toFixed(2) : '0.00'), sub: stats.byType.water ? `${stats.byType.water.totalUsage.toFixed(0)} 度` : '0 度', mid: 'water' },
          { cls: 'gas', label: '瓦斯費累計', value: 'NT$ ' + (stats.byType.gas ? stats.byType.gas.totalFee.toFixed(2) : '0.00'), sub: stats.byType.gas ? `${stats.byType.gas.totalUsage.toFixed(0)} 度` : '0 度', mid: 'gas' }
        ];
        const cards = baseCards.filter(c => (!!c.keep) || !(c.mid) || ((() => { const t = getMeterType(c.mid); return !(!t || t.enabled === false); })()));
        const filterRecords = (recs) => {
          if (!Array.isArray(recs)) return [];
          return recs.filter(r => {
            const t = getMeterType(r.meterType);
            if (!t) return false;
            return t.enabled !== false;
          });
        };
        container.innerHTML = `
          <div class="mr-page">
            <div class="mr-stat-grid">
              ${cards.map(c => `
                <div class="mr-stat-card ${c.cls}">
                  <div class="label">${esc(c.label)}</div>
                  <div class="value">${esc(c.value)}</div>
                  <div class="sub">${esc(c.sub)}</div>
                </div>
              `).join('')}
            </div>

            <div class="mr-filter-bar">
              <div class="mr-type-chips">
                ${types.map(t => `<button class="mr-chip ${t.id} ${state.filterType === t.id ? 'active' : ''}" data-type="${esc(t.id)}">${esc(t.label)}</button>`).join('')}
              </div>
              <label for="mrDateFrom" style="font-size:12px;">起始月</label>
              <input type="month" id="mrDateFrom" value="${esc(state.dateFrom)}" />
              <label for="mrDateTo" style="font-size:12px;">結束月</label>
              <input type="month" id="mrDateTo" value="${esc(state.dateTo)}" />
              <button class="mr-btn small ghost" id="mrResetFilter">重置</button>
            </div>

            ${state.loading ? `<div class="mr-alert info"><div class="ico">⏳</div><div class="msg">載入中，請稍候...</div></div>` : ''}
            ${!state.loading && state.records.length === 0 ? emptyState('尚無抄錶紀錄', '管理員完成抄錶登記後，資料會顯示於此', '📝') : ''}
            ${!state.loading && state.records.length > 0 ? `<div class="mr-record-list">${filterRecords(state.records).map(r => recordCard(r, { showDetail: true, showDispute: r.validationStatus !== 'disputed', showFee: true })).join('')}</div>` : ''}
          </div>
        `;
        bindResidentEvents();
      };

      const bindResidentEvents = () => {
        container.querySelectorAll('.mr-type-chips [data-type]').forEach(btn => {
          btn.onclick = () => { state.filterType = btn.getAttribute('data-type'); reload(); };
        });
        const df = container.querySelector('#mrDateFrom');
        const dt = container.querySelector('#mrDateTo');
        if (df) df.onchange = () => { state.dateFrom = df.value; reload(); };
        if (dt) dt.onchange = () => { state.dateTo = dt.value; reload(); };
        const rst = container.querySelector('#mrResetFilter');
        if (rst) rst.onclick = () => { state.filterType = ''; state.dateFrom = ''; state.dateTo = ''; reload(); };

        container.querySelectorAll('[data-action]').forEach(btn => {
          btn.onclick = (e) => {
            e.preventDefault();
            const card = btn.closest('[data-id]');
            const id = card ? card.getAttribute('data-id') : '';
            const rec = state.records.find(x => x.id === id);
            if (!rec) return;
            const action = btn.getAttribute('data-action');
            if (action === 'detail') showDetailModal(rec);
            else if (action === 'fee') showFeeModal(rec);
            else if (action === 'dispute') showDisputeModal(rec, ctx);
          };
        });
      };

      const showDetailModal = (r) => {
        const t = getMeterType(r.meterType);
        const unit = t ? t.unit : '度';
        const rd = toDateValue(r.readingDate);
        const modifyHistory = Array.isArray(r.modifyHistory) ? r.modifyHistory : [];
        const tiersHtml = (() => {
          const tiers = FEE_TIERS[r.meterType] || [];
          const usage = safeParseNumber(r.usage) || 0;
          let remain = usage;
          let prev = 0;
          const items = [];
          for (const tier of tiers) {
            if (remain <= 0) break;
            const range = tier.limit === Infinity ? '以上' : `≤${tier.limit}`;
            const inTier = tier.limit === Infinity ? remain : Math.min(remain, tier.limit - prev);
            if (inTier > 0) {
              items.push(`<div class="bd-item"><div class="lbl">${range}${unit} × $${tier.rate}</div><div class="v">${inTier.toFixed(2)}${unit}  NT$ ${(inTier * tier.rate).toFixed(2)}</div></div>`);
            }
            remain = Math.max(0, remain - (tier.limit === Infinity ? remain : (tier.limit - prev)));
            prev = tier.limit;
            if (tier.limit === Infinity) break;
          }
          return items.join('');
        })();
        const body = `
          <div style="display:flex;flex-direction:column;gap:18px;">
            <div class="mr-fee-preview">
              <div class="title">本期應繳總計</div>
              <div class="amount">NT$ ${(safeParseNumber(r.fee) || 0).toFixed(2)}</div>
              <div class="breakdown">
                <div class="bd-item"><div class="lbl">儀表類型</div><div class="v">${t ? t.name + ' ' + t.icon : '—'}</div></div>
                <div class="bd-item"><div class="lbl">繳費週期</div><div class="v">${esc(r.period || (rd ? formatDateYYYYMM(rd) : '—'))}</div></div>
                <div class="bd-item"><div class="lbl">上期數值</div><div class="v">${esc(r.previousValue ?? '—')}</div></div>
                <div class="bd-item"><div class="lbl">本期數值</div><div class="v">${esc(r.currentValue ?? '—')}</div></div>
                <div class="bd-item"><div class="lbl">本期用量</div><div class="v">${(safeParseNumber(r.usage) || 0).toFixed(2)} ${unit}</div></div>
                <div class="bd-item"><div class="lbl">抄表日期</div><div class="v">${rd ? formatDateFull(rd) : '—'}</div></div>
              </div>
            </div>
            ${tiersHtml ? `<div class="mr-chart-wrap"><div class="chart-title">費用階梯明細</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">${tiersHtml}</div></div>` : ''}
            ${modifyHistory.length ? `
              <div class="mr-chart-wrap">
                <div class="chart-title">修改紀錄（共 ${modifyHistory.length} 筆）</div>
                <div style="overflow-x:auto;">
                  <table class="mr-history-table">
                    <thead><tr><th>時間</th><th>操作人</th><th>原因</th><th>變更內容</th></tr></thead>
                    <tbody>
                      ${modifyHistory.slice().reverse().map(mh => `
                        <tr>
                          <td>${new Date(mh.at).toLocaleString('zh-TW')}</td>
                          <td>${esc((mh.by && mh.by.name) ? mh.by.name : (mh.by && mh.by.id ? mh.by.id : '系統'))}</td>
                          <td>${esc(mh.reason || '—')}</td>
                          <td style="font-size:12px;">${Object.keys(mh.after || {}).map(k => `${k}: ${JSON.stringify(mh.before[k])} → ${JSON.stringify(mh.after[k])}`).join('<br/>')}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}
          </div>
        `;
        openModal('繳費通知／抄表明細', body, {
          footerHtml: `<button class="mr-btn ghost" data-close>關閉</button>`,
          onReady: (inst) => {
            inst.modal.querySelector('[data-close]').onclick = () => inst.close();
          }
        });
        setTimeout(() => {
          const m = document.querySelector('.mr-modal:last-of-type');
          if (m) {
            const c = m.querySelector('[data-close]');
            const backdrop = m.parentElement;
            if (c) c.onclick = () => { if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); };
          }
        }, 0);
      };

      const showFeeModal = (r) => showDetailModal(r);

      const showDisputeModal = (r, uctx) => {
        let photoDataUrl = '';
        const body = `
          <form class="mr-form" id="disputeForm" style="padding:0;background:transparent;border:0;box-shadow:none;">
            <div class="mr-alert info"><div class="ico">ℹ</div><div class="msg">若對抄錶數字有疑義，請說明原因並上傳現場儀表照片，管理員會盡快核實處理。</div></div>
            <div class="mr-form-row">
              <div>
                <div class="mr-label">儀表資訊</div>
                <div style="padding:12px 14px;border-radius:12px;background:var(--mr-panel-2);border:1px solid var(--mr-border);font-weight:700;">
                  ${meterTag(r.meterType)} 戶號 ${esc(r.houseNo)} · 本期 ${esc(r.currentValue ?? '—')}
                </div>
              </div>
            </div>
            <div class="mr-field-full">
              <div class="mr-label">核異說明 *</div>
              <textarea class="mr-textarea" id="disputeDesc" placeholder="請描述您發現的問題（例如：數字跳動、數值不合理、尚未用氣...）" required></textarea>
            </div>
            <div class="mr-field-full">
              <div class="mr-label">現場儀表照片</div>
              <div id="photoUploader" class="mr-photo-uploader">
                <div class="icon">📷</div>
                <div class="text">點擊上傳儀表照片（可選，建議提供以利核實）</div>
                <input type="file" id="photoInput" accept="image/*" hidden />
              </div>
              <div id="photoPreview" class="mr-photo-preview" style="margin-top:12px;display:none;"></div>
            </div>
          </form>
        `;
        const m = openModal('核異申請', body, {
          footerHtml: `
            <button class="mr-btn ghost" data-cancel>取消</button>
            <button class="mr-btn primary" id="submitDisputeBtn">送出申請</button>
          `
        });
        const modal = m.modal;
        modal.querySelector('[data-cancel]').onclick = () => m.close();
        const uploader = modal.querySelector('#photoUploader');
        const input = modal.querySelector('#photoInput');
        const preview = modal.querySelector('#photoPreview');
        uploader.onclick = () => input.click();
        input.onchange = (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            photoDataUrl = String(ev.target.result || '');
            preview.style.display = 'block';
            preview.innerHTML = `<img src="${photoDataUrl}" alt="現場照片"/><button type="button" class="remove-btn" aria-label="移除">×</button>`;
            preview.querySelector('.remove-btn').onclick = () => { photoDataUrl = ''; preview.style.display = 'none'; input.value = ''; };
          };
          reader.readAsDataURL(file);
        };
        modal.querySelector('#submitDisputeBtn').onclick = async (e) => {
          e.preventDefault();
          const btn = e.currentTarget;
          const descEl = modal.querySelector('#disputeDesc');
          const description = String(descEl.value || '').trim();
          if (!description) {
            descEl.classList.add('error');
            return;
          }
          btn.disabled = true;
          const payload = {
            submittedBy: { uid: uctx.uid || '', name: uctx.name || '' },
            residentName: uctx.name || '',
            residentUid: uctx.uid || '',
            description,
            photoDataUrl
          };
          const res = await submitDispute(db, communityId, r.id, payload);
          if (res.ok) {
            m.close();
            const n = openModal('申請已送出', `<div class="mr-alert success"><div class="ico">✓</div><div class="msg">您的核異申請已提交，管理員會於 3 個工作日內核實並回覆。</div></div>`, {
              footerHtml: `<button class="mr-btn primary" data-ok>確定</button>`
            });
            n.modal.querySelector('[data-ok]').onclick = () => { n.close(); reload(); };
          } else {
            alert('提交失敗：' + (res.errors || []).join('；'));
            btn.disabled = false;
          }
        };
      };

      reload();
    }

    async function renderAdminPage(container, adminCtx) {
      const ctx = adminCtx || {};
      const services = ensureServices();
      const db = services.db;
      const subnavEl = document.getElementById('subnav');
      const iconSvgFn = (typeof window !== 'undefined' && window.iconSvg) || function (name) {
        const icons = {
          'meter-reading': '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true"><path d="M7 20h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" stroke-width="1.7"/><path d="M12 10l1.6-1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M8.5 16.5h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
          settings: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
          'qr-scan': '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14h1v3h-1zM14 20h3v1h-3zM20 20h1v1h-1z"/></svg>'
        };
        return icons[name] || icons.settings;
      };
      if (!db) {
        container.innerHTML = `<section class="card"><div class="card-bd"><div class="tag red">⚠ 系統初始化失敗，請重新整理頁面</div></div></section>`;
        return;
      }
      const communityId = String(ctx.communityId || '').trim();
      if (!communityId) {
        container.innerHTML = `<section class="card"><div class="card-bd"><div class="tag yellow">ℹ 請先選擇社區</div></div></section>`;
        return;
      }
      const role = String(ctx.role || '').toLowerCase();
      const state = {
        tab: 'records',
        filterType: '',
        filterPeriod: '',
        filterStatus: '',
        filterHouse: '',
        records: [],
        disputes: [],
        abnormalRecords: [],
        pendingRecords: [],
        stats: null,
        loading: true
      };

      const canCreate = checkPermission(role, 'create');
      const canImport = checkPermission(role, 'import');
      const canReview = checkPermission(role, 'review');
      const canExport = checkPermission(role, 'export');
      const canStats = checkPermission(role, 'statistics');
      const communities = (ctx.state && Array.isArray(ctx.state.communities)) ? ctx.state.communities : (window.NwApp && window.NwApp.state && Array.isArray(window.NwApp.state.communities) ? window.NwApp.state.communities : []);
      const communityName = (communities.find(c => c.id === communityId) || {}).name || '';

      const __filterEnabled = (arr) => {
        const out = [];
        for (const it of arr) {
          if (!it) continue;
          const id = typeof it === 'string' ? it : (it.id || it.v || '');
          const t = getMeterType(id);
          if (!t) continue;
          if (t.enabled === false) continue;
          out.push(it);
        }
        return out;
      };
      const __filterRecords = (rs) => (Array.isArray(rs) ? rs : []).filter(r => {
        const t = getMeterType(r && (r.type || r.meterType));
        return !t || t.enabled !== false;
      });

      let reload;

      const renderSubnav = () => {
        if (!subnavEl) return;
        const tabs = [
          { id: 'records', label: '抄表紀錄', badge: __filterRecords(state.records).length },
          { id: 'pending', label: '待處理', badge: (__filterRecords(state.pendingRecords).length + __filterRecords(state.disputes).length + __filterRecords(state.abnormalRecords).length), hidden: !canReview },
          { id: 'create', label: '手動登記', hidden: !canCreate },
          { id: 'import', label: '匯入/匯出', hidden: !canImport && !canExport },
          { id: 'stats', label: '統計分析', hidden: !canStats }
        ].filter(t => !t.hidden);
        subnavEl.innerHTML = tabs.map(t => `
          <button class="btn btn-sm ${state.tab === t.id ? 'btn-primary' : ''}" data-tab="${esc(t.id)}">
            ${t.badge != null && t.badge > 0 ? `<span class="badge-inline" style="display:inline-block;">${t.badge}</span>` : ''}
            ${esc(t.label)}
          </button>
        `).join('');
        subnavEl.querySelectorAll('[data-tab]').forEach(btn => {
          btn.onclick = () => {
            subnavEl.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('btn-primary'));
            btn.classList.add('btn-primary');
            state.tab = btn.getAttribute('data-tab');
            renderLayout();
          };
        });
      };

      const __baseReload = async () => {
        state.loading = true;
        renderLayout();
        try {
          const opts = { meterType: state.filterType, period: state.filterPeriod, status: state.filterStatus, limit: 500 };
          if (state.filterHouse) opts.houseNo = state.filterHouse;
          state.records = await listRecordsByCommunity(db, communityId, opts);
          if (canReview) {
            state.pendingRecords = await listPendingRecords(db, communityId);
            state.disputes = await listPendingDisputes(db, communityId);
            state.abnormalRecords = await listAbnormalRecords(db, communityId);
          }
          state.stats = computeStatistics(state.records);
        } catch (e) { console.warn(e); }
        state.loading = false;
        renderLayout();
      };

      reload = async () => {
        try { await loadCommunityMeterSettings(db, communityId, !!state.loading); } catch(e){ console.warn(e); }
        return __baseReload();
      };

      (function bindStorageSync(){
        try {
          if (window.__nwMeterAdminStorageBound) return;
          window.__nwMeterAdminStorageBound = true;
        } catch {}
        let lastSyncAt = 0;
        window.addEventListener('storage', (ev) => {
          try {
            if (!ev || ev.key !== 'nwapp:meterSettingsChanged') return;
            const raw = ev && ev.newValue;
            if (!raw) return;
            const d = JSON.parse(raw);
            if (!d || !d.communityId) return;
            if (String(d.communityId) !== String(communityId)) return;
            const at = Number(d.at) || 0;
            if (at && at <= lastSyncAt) return;
            lastSyncAt = at;
            try {
              loadCommunityMeterSettings(db, communityId, true).then(() => { try { reload(); } catch {} }).catch(() => {});
            } catch {}
          } catch {}
        });
      })();

      const renderLayout = () => {
        renderSubnav();
        container.innerHTML = `
          <section class="card meter-page">
            <div class="card-hd">
              <div class="left">
                <div class="chip" aria-hidden="true">${iconSvgFn('meter-reading')}</div>
                <div style="min-width:0;">
                  <h2>抄表紀錄${communityName ? `｜${esc(communityName)}` : ''}</h2>
                  <p>抄錶登記、數據審核、用量統計、費用計算</p>
                </div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                <div class="tag red" title="總筆數">${__filterRecords(state.records).length}</div>
                <button class="btn btn-sm btn-ghost" id="mrBtnOpenSettings" title="抄錶顯示與費率設定" aria-label="抄錶設定">${iconSvgFn('settings')}</button>
                ${canCreate ? `<button class="btn btn-sm btn-ghost" id="mrBtnGotoCreate" title="手動登記" aria-label="手動登記"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>` : ''}
              </div>
            </div>
            <div class="card-bd">
              ${state.tab === 'records' ? renderRecordsTab() : ''}
              ${state.tab === 'pending' ? renderPendingTab() : ''}
              ${state.tab === 'create' ? renderCreateTab() : ''}
              ${state.tab === 'import' ? renderImportTab() : ''}
              ${state.tab === 'stats' ? renderStatsTab() : ''}
            </div>
          </section>
        `;
        bindAdminEvents();
      };

      const renderRecordsTab = () => {
        const chips = __filterEnabled([
          { id: '', label: '全部' },
          { id: 'electric', label: '⚡ 電錶' },
          { id: 'water', label: '💧 自來水' },
          { id: 'gas', label: '🔥 瓦斯' }
        ]);
        const statusOptions = [
          { v: '', l: '全部狀態' },
          { v: 'valid', l: '正常' },
          { v: 'abnormal', l: '異常' },
          { v: 'disputed', l: '核異中' },
          { v: 'resolved', l: '已處理' },
          { v: 'pending', l: '待審核' }
        ];
        const filterTypeValid = state.filterType ? (getMeterType(state.filterType) && (getMeterType(state.filterType).enabled!==false)) : true;
        if (!filterTypeValid) state.filterType = '';
        return `
          <div style="display:flex;flex-direction:column;gap:14px;">
            <div class="parcel-filter-bar" id="mrFilterBar" style="flex-wrap:wrap;">
              ${chips.map(c => `<button class="btn btn-sm ${state.filterType === c.id ? 'btn-primary' : ''}" data-type="${esc(c.id)}" style="margin-right:4px;">${esc(c.label)}</button>`).join('')}
              <div class="field">
                <label for="fPeriod">週期</label>
                <input type="month" id="fPeriod" value="${esc(state.filterPeriod)}" />
              </div>
              <div class="field">
                <label for="fStatus">狀態</label>
                <select id="fStatus">
                  ${statusOptions.map(o => `<option value="${esc(o.v)}" ${state.filterStatus === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="fHouse">戶號</label>
                <input type="text" id="fHouse" placeholder="例如 A1-10F" value="${esc(state.filterHouse)}" style="min-width:120px;" autocomplete="off" />
              </div>
              <button class="btn btn-sm" type="button" id="fReset">清除</button>
              ${canCreate ? `<button class="btn btn-sm danger" type="button" id="fGotoCreate">登記抄表</button>` : ''}
            </div>
            ${state.loading ? `<div class="muted" style="padding:14px;">⏳ 載入中，請稍候...</div>` : ''}
            ${!state.loading && __filterRecords(state.records).length === 0 ? emptyState('尚無抄錶資料', '切換至「手動登記」或「匯入/匯出」分頁開始建立資料', '📝') : ''}
            ${!state.loading && __filterRecords(state.records).length > 0 ? `<div style="display:grid;gap:12px;">${__filterRecords(state.records).map(r => recordCard(r, { showDetail: true, showEdit: canReview, showResolve: canReview && r.validationStatus === 'disputed' })).join('')}</div>` : ''}
          </div>
        `;
      };

      const renderPendingTab = () => {
        return `
          <div style="display:grid;gap:16px;">
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
              <div class="card-hd" style="padding:12px 14px;">
                <div class="left">
                  <div class="chip" style="width:36px;height:36px;">📝</div>
                  <div style="min-width:0;"><h2 style="font-size:15px;margin:0;">住戶申報待審核</h2><p style="margin:0;">共 ${__filterRecords(state.pendingRecords).length} 筆新申報待管理員審核</p></div>
                </div>
                <div class="tag yellow">${__filterRecords(state.pendingRecords).length}</div>
              </div>
              <div class="card-bd" style="padding-top:0;">
                ${__filterRecords(state.pendingRecords).length === 0 ? `<div class="muted" style="padding:18px;text-align:center;">目前沒有待審核的新申報 🎉</div>` : `<div style="display:grid;gap:12px;">${__filterRecords(state.pendingRecords).map(r => recordCard(r, { showDetail: true, showEdit: true, showResolve: false })).join('')}</div>`}
              </div>
            </section>
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
              <div class="card-hd" style="padding:12px 14px;">
                <div class="left">
                  <div class="chip" style="width:36px;height:36px;">🔔</div>
                  <div style="min-width:0;"><h2 style="font-size:15px;margin:0;">住戶核異申請</h2><p style="margin:0;">共 ${__filterRecords(state.disputes).length} 筆待處理</p></div>
                </div>
                <div class="tag yellow">${__filterRecords(state.disputes).length}</div>
              </div>
              <div class="card-bd" style="padding-top:0;">
                ${__filterRecords(state.disputes).length === 0 ? `<div class="muted" style="padding:18px;text-align:center;">目前沒有待處理的核異申請 🎉</div>` : `<div style="display:grid;gap:12px;">${__filterRecords(state.disputes).map(r => recordCard(r, { showDetail: true, showResolve: true, showEdit: true })).join('')}</div>`}
              </div>
            </section>
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
              <div class="card-hd" style="padding:12px 14px;">
                <div class="left">
                  <div class="chip" style="width:36px;height:36px;">⚠</div>
                  <div style="min-width:0;"><h2 style="font-size:15px;margin:0;">系統偵測異常</h2><p style="margin:0;">共 ${__filterRecords(state.abnormalRecords).length} 筆</p></div>
                </div>
                <div class="tag red">${__filterRecords(state.abnormalRecords).length}</div>
              </div>
              <div class="card-bd" style="padding-top:0;">
                ${__filterRecords(state.abnormalRecords).length === 0 ? `<div class="muted" style="padding:18px;text-align:center;">目前沒有偵測到異常資料 🎉</div>` : `<div style="display:grid;gap:12px;">${__filterRecords(state.abnormalRecords).map(r => recordCard(r, { showDetail: true, showEdit: true })).join('')}</div>`}
              </div>
            </section>
          </div>
        `;
      };

      const renderCreateTab = () => {
        const baseTypes = Object.values(METER_TYPES).map(t => ({ v: t.id, l: `${t.icon} ${t.name}` }));
        const typeOptions = __filterEnabled(baseTypes);
        return `
          <form id="createForm" style="display:grid;gap:14px;">
            <section class="card" style="box-shadow:none;border:1px dashed rgba(211,47,47,0.25);background:rgba(211,47,47,0.03);">
              <div class="card-bd">
                <div class="row" style="gap:10px;align-items:flex-start;">
                  <div class="tag" style="background:rgba(37,99,235,0.1);color:#2563eb;border-color:rgba(37,99,235,0.2);">ℹ</div>
                  <div style="flex:1;font-size:13px;">單筆抄表登記：系統會自動帶入上期數值、計算用量與費用，並偵測是否有異常。每個位數獨立輸入框，便於抄表員核對。</div>
                </div>
              </div>
            </section>
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
              <div class="card-bd" style="display:grid;gap:12px;">
                <div class="row" style="gap:12px;flex-wrap:wrap;">
                  <div class="field" style="flex:1;min-width:180px;">
                    <label for="crType">儀表類型 *</label>
                    <select id="crType" required>
                      <option value="">— 請選擇 —</option>
                      ${typeOptions.map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}
                    </select>
                  </div>
                  <div class="field" style="flex:1;min-width:180px;">
                    <label for="crMeterId">儀表編號 *</label>
                    <input id="crMeterId" type="text" placeholder="例如: E-A1-10F-01" required autocomplete="off" />
                  </div>
                  <div class="field" style="flex:1;min-width:180px;">
                    <label for="crHouse">住戶門牌號 *</label>
                    <input id="crHouse" type="text" placeholder="例如: A1-10F" required autocomplete="off" />
                  </div>
                </div>
                <div class="row" style="gap:12px;flex-wrap:wrap;align-items:end;">
                  <div class="field" style="flex:1;min-width:160px;">
                    <label for="crPrev">上期數值（可選）</label>
                    <input id="crPrev" type="number" min="0" step="1" placeholder="留空自動查詢上期" />
                  </div>
                  <div class="field" style="flex:1.5;min-width:260px;">
                    <label>本期抄錶數字 *<span class="muted" style="font-weight:500;font-size:11px;margin-left:6px;">（每位數單獨輸入，自動跳轉）</span></label>
                    <div style="display:flex;flex-direction:column;gap:8px;">
                      <div id="crCurrDigitBoxes" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;"></div>
                      <input id="crCurr" type="hidden" />
                      <div id="crCurrHint" class="muted" style="font-size:12px;">請先選擇儀表類型，位數會自動帶入社區設定。</div>
                    </div>
                  </div>
                  <div class="field" style="flex:1;min-width:160px;">
                    <label for="crDate">抄表日期</label>
                    <input id="crDate" type="date" value="${new Date().toISOString().slice(0, 10)}" />
                  </div>
                  <div class="field" style="flex:1;min-width:160px;">
                    <label for="crPeriod">繳費週期</label>
                    <input id="crPeriod" type="month" value="${formatDateYYYYMM(new Date())}" />
                  </div>
                  <div class="field" style="flex:1;min-width:160px;">
                    <label for="crOp">抄表人員編號</label>
                    <input id="crOp" type="text" placeholder="例如: MR001" value="${esc(ctx.opId || '')}" autocomplete="off" />
                  </div>
                </div>
                <div id="crFeePreview" style="display:none;"></div>
                <div id="crErrors" style="display:none;padding:10px 12px;border-radius:12px;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.18);color:#b91c1c;font-size:13px;"></div>
                <div id="crWarnings" style="display:none;padding:10px 12px;border-radius:12px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);color:#a16207;font-size:13px;"></div>
                <div class="row" style="justify-content:flex-end;gap:8px;margin-top:4px;">
                  <button type="button" class="btn btn-ghost" id="crPreviewBtn">預覽計算</button>
                  <button type="submit" class="btn btn-primary">建立紀錄</button>
                </div>
              </div>
            </section>
          </form>
        `;
      };

      const renderImportTab = () => {
        return `
          <div style="display:grid;gap:16px;">
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
              <div class="card-hd" style="padding:12px 14px;">
                <div class="left">
                  <div class="chip" style="width:36px;height:36px;">📤</div>
                  <div style="min-width:0;"><h2 style="font-size:15px;margin:0;">匯入抄錶資料</h2><p style="margin:0;">支援 CSV 或 Excel 格式</p></div>
                </div>
              </div>
              <div class="card-bd" style="display:grid;gap:12px;">
                <div class="row" style="gap:10px;align-items:flex-start;">
                  <div class="tag" style="background:rgba(37,99,235,0.1);color:#2563eb;border-color:rgba(37,99,235,0.2);">ℹ</div>
                  <div style="flex:1;font-size:13px;">欄位格式：<strong>儀表編號,門牌號,儀表類型,上期數值,本期數值,抄表日期,抄表員,繳費週期</strong>。儀表類型請填「電/電錶/electric」、「水/自來水/water」或「瓦斯/天然氣/gas」。</div>
                </div>
                <div id="importUploader" style="padding:36px;border:2px dashed var(--brand,#d32f2f);border-radius:var(--radius,18px);background:rgba(211,47,47,0.03);text-align:center;cursor:pointer;transition:all 0.15s;">
                  <div style="font-size:36px;margin-bottom:6px;">📂</div>
                  <div style="font-size:14px;font-weight:700;">點擊選擇 .csv / .xlsx / .xls 檔案</div>
                  <div class="muted" style="font-size:12px;margin-top:4px;">或直接拖曳檔案到這裡</div>
                  <input type="file" id="importInput" accept=".csv,.xlsx,.xls" hidden />
                </div>
                <div id="importPreview"></div>
                <div class="row" style="justify-content:flex-end;gap:8px;">
                  <a class="btn btn-ghost" id="dlTemplateBtn" href="javascript:void(0)">下載範本 CSV</a>
                  <button class="btn btn-primary" id="importConfirmBtn" disabled>開始匯入</button>
                </div>
              </div>
            </section>
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
              <div class="card-hd" style="padding:12px 14px;">
                <div class="left">
                  <div class="chip" style="width:36px;height:36px;">📥</div>
                  <div style="min-width:0;"><h2 style="font-size:15px;margin:0;">匯出抄錶報表</h2><p style="margin:0;">依目前篩選條件匯出</p></div>
                </div>
              </div>
              <div class="card-bd">
                <div class="row" style="gap:10px;flex-wrap:wrap;">
                  <button class="btn" id="exportCsvBtn">匯出 CSV（含統計）</button>
                  <button class="btn btn-ghost" id="exportSummaryBtn">僅統計摘要</button>
                </div>
              </div>
            </section>
          </div>
        `;
      };

      const renderStatsTab = () => {
        const s = state.stats || { byType: {}, byPeriod: {}, houseCount: 0, totalRecords: 0, totalFee: 0, validCount: 0, abnormalCount: 0, disputedCount: 0 };
        const typeCards = __filterEnabled([
          { id: 'electric', name: '電錶' },
          { id: 'water', name: '自來水錶' },
          { id: 'gas', name: '瓦斯錶' }
        ]);
        const periodKeys = Object.keys(s.byPeriod || {}).sort().slice(-12);
        const maxPeriodUsage = Math.max(1, ...periodKeys.map(k => safeParseNumber(s.byPeriod[k].totalUsage) || 0));
        const summaryCards = [
          { label: '登記總筆數', value: String(s.totalRecords), sub: `戶數 ${s.houseCount}`, tag: '' },
          { label: '正常', value: String(s.validCount || 0), sub: '通過驗證', tag: 'green' },
          { label: '異常', value: String(s.abnormalCount || 0), sub: '需優先核實', tag: 'red' },
          { label: '核異中', value: String(s.disputedCount || 0), sub: '待管理員回覆', tag: 'yellow' }
        ];
        return `
          <div style="display:grid;gap:16px;">
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
              ${summaryCards.map(c => `
                <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);margin:0;">
                  <div class="card-bd" style="display:grid;gap:4px;">
                    <div class="row" style="justify-content:space-between;align-items:center;">
                      <div class="muted" style="font-size:12px;">${c.label}</div>
                      ${c.tag ? `<div class="tag ${c.tag}" style="font-size:11px;">${c.tag === 'green' ? '正常' : c.tag === 'red' ? '異常' : '處理中'}</div>` : ''}
                    </div>
                    <div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;${c.tag === 'red' ? 'color:#dc2626;' : c.tag === 'yellow' ? 'color:#a16207;' : ''}">${esc(c.value)}</div>
                    <div class="muted" style="font-size:11px;">${c.sub}</div>
                  </div>
                </section>
              `).join('')}
            </div>
            ${typeCards.map(tc => {
              const t = s.byType[tc.id] || { totalUsage: 0, totalFee: 0, count: 0, avgPerHouse: 0 };
              const meta = METER_TYPES[tc.id.toUpperCase()] || (Object.values(METER_TYPES).find(x => x.id === tc.id) || {});
              const maxUsageForBar = Math.max(1, t.totalUsage);
              return `
                <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
                  <div class="card-hd" style="padding:12px 14px;">
                    <div class="left">
                      <div class="chip" style="width:36px;height:36px;">${meta.icon || '📊'}</div>
                      <div style="min-width:0;"><h2 style="font-size:15px;margin:0;">${tc.name} 統計</h2><p style="margin:0;">共 ${t.count || 0} 筆</p></div>
                    </div>
                  </div>
                  <div class="card-bd" style="display:grid;gap:10px;">
                    <div class="row" style="align-items:center;gap:12px;">
                      <div style="width:70px;flex-shrink:0;font-size:12px;" class="muted">總用量</div>
                      <div style="flex:1;height:10px;border-radius:999px;background:rgba(17,24,39,0.06);overflow:hidden;">
                        <div style="height:100%;width:${Math.min(100, (t.totalUsage / maxUsageForBar) * 100).toFixed(1)}%;background:#2563eb;border-radius:999px;"></div>
                      </div>
                      <div style="width:90px;text-align:right;font-size:13px;font-weight:800;">${t.totalUsage.toFixed(0)}${meta.unit || ''}</div>
                    </div>
                    <div class="row" style="align-items:center;gap:12px;">
                      <div style="width:70px;flex-shrink:0;font-size:12px;" class="muted">戶均用量</div>
                      <div style="flex:1;height:10px;border-radius:999px;background:rgba(17,24,39,0.06);overflow:hidden;">
                        <div style="height:100%;width:${Math.min(100, (t.avgPerHouse / Math.max(1, (t.totalUsage / Math.max(1, s.houseCount || 1)))) * 100).toFixed(1)}%;background:#0891b2;border-radius:999px;opacity:0.85;"></div>
                      </div>
                      <div style="width:90px;text-align:right;font-size:13px;font-weight:700;">${t.avgPerHouse.toFixed(2)}${meta.unit || ''}</div>
                    </div>
                    <div class="row" style="align-items:center;gap:12px;">
                      <div style="width:70px;flex-shrink:0;font-size:12px;" class="muted">總費用</div>
                      <div style="flex:1;height:10px;border-radius:999px;background:rgba(17,24,39,0.06);overflow:hidden;">
                        <div style="height:100%;width:100%;background:linear-gradient(90deg,#d32f2f,#f97316);border-radius:999px;opacity:0.75;"></div>
                      </div>
                      <div style="width:90px;text-align:right;font-size:13px;font-weight:900;color:var(--brand,#d32f2f);">NT$ ${t.totalFee.toFixed(2)}</div>
                    </div>
                  </div>
                </section>
              `;
            }).join('')}
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);">
              <div class="card-hd" style="padding:12px 14px;">
                <div class="left">
                  <div class="chip" style="width:36px;height:36px;">📅</div>
                  <div style="min-width:0;"><h2 style="font-size:15px;margin:0;">最近 12 期用量趨勢</h2><p style="margin:0;">總用量走勢</p></div>
                </div>
              </div>
              <div class="card-bd" style="display:grid;gap:8px;">
                ${periodKeys.length === 0 ? `<div class="muted" style="padding:16px;text-align:center;">尚無足夠的歷史資料</div>` : periodKeys.map(k => {
                  const v = safeParseNumber(s.byPeriod[k].totalUsage) || 0;
                  return `
                    <div class="row" style="align-items:center;gap:12px;">
                      <div style="width:70px;flex-shrink:0;font-size:12px;font-weight:700;">${esc(k)}</div>
                      <div style="flex:1;height:14px;border-radius:999px;background:rgba(17,24,39,0.06);overflow:hidden;">
                        <div style="height:100%;width:${(v / maxPeriodUsage * 100).toFixed(1)}%;background:linear-gradient(90deg,var(--brand,#d32f2f),#f97316);border-radius:999px;"></div>
                      </div>
                      <div style="width:60px;text-align:right;font-size:13px;font-weight:800;">${v.toFixed(0)}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            </section>
            <section class="card" style="box-shadow:none;border:1px solid rgba(211,47,47,0.18);background:linear-gradient(135deg,rgba(211,47,47,0.06),rgba(249,115,22,0.04));">
              <div class="card-bd">
                <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                  <div>
                    <div class="muted" style="font-size:12px;">整體費用合計</div>
                    <div style="font-size:13px;margin-top:2px;">目前篩選條件內全部紀錄應收總額</div>
                  </div>
                  <div class="tag red" style="font-size:28px;font-weight:900;padding:10px 18px;border-radius:14px;letter-spacing:-0.5px;">NT$ ${(s.totalFee || 0).toFixed(2)}</div>
                </div>
              </div>
            </section>
          </div>
        `;
      };

      const bindAdminEvents = () => {
        const cTab = state.tab;
        if (cTab === 'records') bindRecordsEvents();
        else if (cTab === 'pending') bindRecordsEvents();
        else if (cTab === 'create') bindCreateEvents();
        else if (cTab === 'import') bindImportEvents();
        const gotoCreate = container.querySelector('#mrBtnGotoCreate, #fGotoCreate');
        if (gotoCreate) gotoCreate.onclick = () => {
          state.tab = 'create';
          renderSubnav();
          renderLayout();
        };
        const openSettings = container.querySelector('#mrBtnOpenSettings');
        if (openSettings) openSettings.onclick = () => {
          const url = 'meter-settings.html?c=' + encodeURIComponent(communityId) + '&ref=admin-meter';
          const backdrop = document.createElement('div');
          backdrop.className = 'mr-modal-backdrop';
          backdrop.setAttribute('role', 'presentation');
          backdrop.style.setProperty('padding', '0', 'important');
          backdrop.style.setProperty('z-index', '10001', 'important');
          backdrop.innerHTML = `
            <div class="mr-modal" role="dialog" aria-modal="true" aria-labelledby="__nwMeterSettingsTitle" style="width:80vw;max-width:80vw;height:80vh;max-height:80vh;padding:0;border-radius:18px;">
              <div class="mr-modal-hd" style="padding:12px 18px;">
                <div class="title" id="__nwMeterSettingsTitle" style="display:flex;align-items:center;gap:10px;">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;background:rgba(211,47,47,.1);color:var(--brand,#d32f2f);">⚙</span>
                  <span>抄錶顯示與費率設定</span>
                  <span class="pill" id="__nwMeterSettingsStatus" style="margin-left:6px;">載入中…</span>
                </div>
                <button class="mr-modal-close" type="button" id="__nwMeterSettingsClose" aria-label="關閉">×</button>
              </div>
              <div class="mr-modal-bd" style="padding:0;overflow:hidden;position:relative;flex:1;">
                <iframe id="__nwMeterSettingsIframe" src="${esc(url)}" title="抄錶設定" style="width:100%;height:100%;border:0;display:block;background:#f8fafc;"></iframe>
              </div>
            </div>
          `;
          document.body.appendChild(backdrop);
          const iframe = backdrop.querySelector('#__nwMeterSettingsIframe');
          const statusPill = backdrop.querySelector('#__nwMeterSettingsStatus');
          const closeBtn = backdrop.querySelector('#__nwMeterSettingsClose');
          const close = () => {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            window.removeEventListener('keydown', onEsc);
            window.removeEventListener('message', onSaved);
          };
          const onEsc = (e) => { if (e.key === 'Escape') close(); };
          const onSaved = (ev) => {
            try {
              const p = ev && ev.data;
              if (!p || typeof p !== 'object') return;
              if (p.type === 'nwapp:meterSettingsIframeReady') {
                if (statusPill) statusPill.textContent = '就緒';
                return;
              }
              if (p.type === 'nwapp:meterSettingsRequestClose') {
                close();
                return;
              }
              if (p.type !== 'nwapp:meterSettingsSaved') return;
              if (p.communityId && String(p.communityId) !== String(communityId)) return;
              if (statusPill) {
                statusPill.textContent = '已儲存 · 同步中';
                statusPill.style.setProperty('background', 'rgba(22,163,74,.1)');
                statusPill.style.setProperty('color', '#166534');
              }
              try {
                loadCommunityMeterSettings(db, communityId, true).then(() => reload()).catch(() => {});
              } catch {}
              setTimeout(() => { if (statusPill) { statusPill.textContent = '已套用'; } }, 1600);
            } catch {}
          };
          if (iframe) {
            iframe.onload = () => {
              try {
                iframe.contentWindow.postMessage({ type: 'nwapp:meterSettingsIframeParentHello' }, '*');
              } catch {}
              if (statusPill) {
                statusPill.textContent = '可編輯';
                statusPill.style.setProperty('background', 'rgba(37,99,235,.1)');
                statusPill.style.setProperty('color', '#1d4ed8');
              }
            };
          }
          closeBtn.onclick = close;
          backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
          window.addEventListener('keydown', onEsc);
          window.addEventListener('message', onSaved);
        };
      };

      const bindRecordsEvents = () => {
        container.querySelectorAll('[data-type]').forEach(btn => {
          btn.onclick = () => {
            state.filterType = btn.getAttribute('data-type');
            reload();
          };
        });
        const fp = container.querySelector('#fPeriod');
        const fs = container.querySelector('#fStatus');
        const fh = container.querySelector('#fHouse');
        const fr = container.querySelector('#fReset');
        if (fp) fp.onchange = () => { state.filterPeriod = fp.value; reload(); };
        if (fs) fs.onchange = () => { state.filterStatus = fs.value; reload(); };
        if (fh) fh.addEventListener('change', () => { state.filterHouse = fh.value.trim(); reload(); });
        if (fr) fr.onclick = () => { state.filterType='';state.filterPeriod='';state.filterStatus='';state.filterHouse=''; reload(); };

        container.querySelectorAll('[data-action]').forEach(btn => {
          btn.onclick = (e) => {
            e.preventDefault();
            const card = btn.closest('[data-id]');
            const id = card ? card.getAttribute('data-id') : '';
            const rec = state.records.concat(state.disputes, state.abnormalRecords).find(x => x.id === id);
            if (!rec) return;
            const action = btn.getAttribute('data-action');
            if (action === 'detail') showDetailAdminModal(rec);
            else if (action === 'edit' && canReview) showEditModal(rec);
            else if (action === 'resolve' && canReview) showResolveModal(rec);
          };
        });
      };

      const showDetailAdminModal = (r) => {
        const t = getMeterType(r.meterType);
        const rd = toDateValue(r.readingDate);
        const mHist = Array.isArray(r.modifyHistory) ? r.modifyHistory : [];
        const d = r.dispute || null;
        const feeStyle = 'padding:14px;border-radius:14px;background:linear-gradient(135deg,rgba(37,99,235,0.08),rgba(211,47,47,0.05));border:1px solid rgba(37,99,235,0.15);';
        const gridStyle = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px 14px;margin-top:10px;';
        const itemStyle = 'display:grid;gap:2px;';
        const lblStyle = 'font-size:11px;color:#6b7280;';
        const valStyle = 'font-size:13px;font-weight:700;';
        let body = `
          <div style="${feeStyle}">
            <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
              <div style="font-weight:800;font-size:14px;">費用資訊</div>
              <div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;color:var(--brand,#d32f2f);">NT$ ${(safeParseNumber(r.fee) || 0).toFixed(2)}</div>
            </div>
            <div style="${gridStyle}">
              <div style="${itemStyle}"><div style="${lblStyle}">類型</div><div style="${valStyle}">${t ? t.icon + ' ' + t.name : '—'}</div></div>
              <div style="${itemStyle}"><div style="${lblStyle}">戶號</div><div style="${valStyle}">${esc(r.houseNo || '—')}</div></div>
              <div style="${itemStyle}"><div style="${lblStyle}">儀表編號</div><div style="${valStyle}">${esc(r.meterId || '—')}</div></div>
              <div style="${itemStyle}"><div style="${lblStyle}">週期</div><div style="${valStyle}">${esc(r.period || (rd ? formatDateYYYYMM(rd) : '—'))}</div></div>
              <div style="${itemStyle}"><div style="${lblStyle}">上期</div><div style="${valStyle}">${esc(r.previousValue ?? '—')}</div></div>
              <div style="${itemStyle}"><div style="${lblStyle}">本期</div><div style="${valStyle}">${esc(r.currentValue ?? '—')}</div></div>
              <div style="${itemStyle}"><div style="${lblStyle}">用量</div><div style="${valStyle}">${(safeParseNumber(r.usage) || 0).toFixed(2)} ${t ? t.unit : ''}</div></div>
              <div style="${itemStyle}"><div style="${lblStyle}">抄表員</div><div style="${valStyle}">${esc(r.operatorId || r.source || '—')}</div></div>
              <div style="${itemStyle};grid-column:span 2;"><div style="${lblStyle}">抄表日</div><div style="${valStyle}">${rd ? formatDateFull(rd) : '—'}</div></div>
            </div>
          </div>
        `;
        if (d) {
          body += `
            <section class="card" style="box-shadow:none;border:1px solid rgba(139,92,246,0.18);background:rgba(139,92,246,0.04);margin-top:14px;">
              <div class="card-hd" style="padding:10px 14px;">
                <div class="left">
                  <div class="chip" style="width:32px;height:32px;">📩</div>
                  <div style="min-width:0;"><h2 style="font-size:14px;margin:0;">核異資訊</h2><p style="margin:0;font-size:12px;">狀態：${esc(d.status || '')}</p></div>
                </div>
              </div>
              <div class="card-bd" style="display:grid;gap:8px;font-size:13px;">
                <div><strong>申請人：</strong>${esc(d.residentName || '—')} · ${new Date(d.submittedAt || 0).toLocaleString('zh-TW')}</div>
                <div><strong>說明：</strong>${esc(d.description || '')}</div>
                ${d.photoDataUrl ? `<div style="margin-top:4px;"><img src="${esc(d.photoDataUrl)}" style="max-width:100%;border-radius:12px;border:1px solid rgba(17,24,39,0.1);max-height:240px;object-fit:cover;" alt="核異照片"/></div>` : ''}
                ${d.reply ? `<div style="padding:8px 10px;border-radius:10px;background:rgba(99,102,241,0.06);border-left:3px solid #6366f1;"><strong>管理員回覆：</strong>${esc(d.reply)} · ${new Date(d.repliedAt || 0).toLocaleString('zh-TW')}</div>` : ''}
              </div>
            </section>
          `;
        }
        if (mHist.length) {
          const thStyle = 'padding:8px 10px;text-align:left;font-size:12px;font-weight:700;background:rgba(17,24,39,0.04);border-bottom:1px solid rgba(17,24,39,0.08);';
          const tdStyle = 'padding:8px 10px;font-size:12px;border-bottom:1px solid rgba(17,24,39,0.06);vertical-align:top;';
          body += `
            <section class="card" style="box-shadow:none;border:1px solid rgba(17,24,39,0.08);margin-top:14px;">
              <div class="card-hd" style="padding:10px 14px;">
                <div class="left">
                  <div class="chip" style="width:32px;height:32px;">📜</div>
                  <div style="min-width:0;"><h2 style="font-size:14px;margin:0;">修改紀錄</h2><p style="margin:0;font-size:12px;">共 ${mHist.length} 筆</p></div>
                </div>
              </div>
              <div class="card-bd" style="padding:0;">
                <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
                  <thead><tr><th style="${thStyle}">時間</th><th style="${thStyle}">操作人</th><th style="${thStyle}">原因</th><th style="${thStyle}">變更</th></tr></thead>
                  <tbody>${mHist.slice().reverse().map(mh => `<tr>
                    <td style="${tdStyle}">${new Date(mh.at).toLocaleString('zh-TW')}</td>
                    <td style="${tdStyle}">${esc(((mh.by || {}).name) || ((mh.by || {}).id) || '系統')}</td>
                    <td style="${tdStyle}">${esc(mh.reason || '—')}</td>
                    <td style="${tdStyle}">${Object.keys(mh.after || {}).map(k => `${k}: ${JSON.stringify(mh.before[k])} → ${JSON.stringify(mh.after[k])}`).join('<br/>') || '—'}</td>
                  </tr>`).join('')}</tbody>
                </table></div>
              </div>
            </section>
          `;
        }
        const m = openModal('抄表紀錄／明細', body, {
          footerHtml: `<button class="btn btn-ghost" data-close>關閉</button>${canReview ? `<button class="btn" data-edit>修正資料</button>` : ''}`
        });
        m.modal.querySelector('[data-close]').onclick = () => m.close();
        const ed = m.modal.querySelector('[data-edit]');
        if (ed) ed.onclick = () => { m.close(); setTimeout(() => showEditModal(r), 30); };
      };

      const showEditModal = (r) => {
        const body = `
          <form id="editForm" style="display:grid;gap:12px;padding:0;background:transparent;border:0;box-shadow:none;">
            <div class="row" style="gap:10px;align-items:flex-start;padding:10px 12px;border-radius:12px;background:rgba(37,99,235,0.06);border:1px solid rgba(37,99,235,0.15);">
              <div class="tag" style="background:rgba(37,99,235,0.12);color:#2563eb;border-color:rgba(37,99,235,0.2);">ℹ</div>
              <div style="flex:1;font-size:13px;">修正資料需填寫原因，所有修改會留痕。</div>
            </div>
            <div class="row" style="gap:12px;flex-wrap:wrap;">
              <div class="field" style="flex:1;min-width:160px;">
                <label for="edCurr">本期數值 *</label>
                <input type="number" id="edCurr" step="1" min="0" value="${esc(r.currentValue ?? '')}" required />
              </div>
              <div class="field" style="flex:1;min-width:160px;">
                <label for="edDate">抄表日期</label>
                <input type="date" id="edDate" value="${(toDateValue(r.readingDate) || new Date()).toISOString().slice(0, 10)}" />
              </div>
              <div class="field" style="flex:1;min-width:160px;">
                <label for="edPeriod">繳費週期</label>
                <input type="month" id="edPeriod" value="${esc(r.period || formatDateYYYYMM(new Date()))}" />
              </div>
            </div>
            <div class="field">
              <label for="edStatus">新狀態</label>
              <select id="edStatus">
                <option value="valid" ${r.validationStatus === 'valid' ? 'selected' : ''}>正常</option>
                <option value="abnormal" ${r.validationStatus === 'abnormal' ? 'selected' : ''}>異常</option>
                <option value="resolved" ${r.validationStatus === 'resolved' ? 'selected' : ''}>已處理</option>
              </select>
            </div>
            <div class="field">
              <label for="edReason">修正原因 *</label>
              <textarea id="edReason" placeholder="例如：住戶核異後確認、抄表員回報更正..." required style="min-height:72px;"></textarea>
            </div>
            <div id="edPreview"></div>
          </form>
        `;
        const m = openModal('修正抄錶資料', body, {
          footerHtml: `<button class="btn btn-ghost" data-cancel>取消</button><button class="btn btn-primary" id="edSubmit">確認修正</button>`
        });
        m.modal.querySelector('[data-cancel]').onclick = () => m.close();
        const compute = () => {
          const newCurr = safeParseNumber(m.modal.querySelector('#edCurr').value);
          const prev = safeParseNumber(r.previousValue) || 0;
          const usage = calcUsage(prev, newCurr, r.meterType);
          const fee = calcFee(usage, r.meterType);
          const pv = m.modal.querySelector('#edPreview');
          if (pv) pv.innerHTML = `
            <div style="padding:12px;border-radius:12px;background:rgba(22,163,74,0.06);border:1px solid rgba(22,163,74,0.15);display:grid;gap:4px;">
              <div class="muted" style="font-size:12px;">更新後</div>
              <div style="font-size:22px;font-weight:900;color:#16a34a;">NT$ ${fee.toFixed(2)}</div>
              <div class="muted" style="font-size:12px;">用量：${usage.toFixed(2)}</div>
            </div>
          `;
        };
        m.modal.querySelector('#edCurr').oninput = compute;
        compute();
        m.modal.querySelector('#edSubmit').onclick = async (e) => {
          e.preventDefault();
          const btn = e.currentTarget;
          const reason = m.modal.querySelector('#edReason').value.trim();
          if (!reason) return;
          const newCurr = safeParseNumber(m.modal.querySelector('#edCurr').value);
          const prev = safeParseNumber(r.previousValue) || 0;
          const newUsage = calcUsage(prev, newCurr, r.meterType);
          const newFee = calcFee(newUsage, r.meterType);
          const newDate = new Date(m.modal.querySelector('#edDate').value);
          const patch = {
            currentValue: newCurr,
            usage: newUsage,
            fee: newFee,
            readingDate: newDate,
            period: m.modal.querySelector('#edPeriod').value,
            validationStatus: m.modal.querySelector('#edStatus').value
          };
          btn.disabled = true;
          const res = await updateRecord(db, communityId, r.id, patch, { id: ctx.uid || '', name: ctx.name || '', role }, reason);
          if (res.ok) {
            m.close();
            const n = openModal('修正完成', `<div style="padding:14px;border-radius:14px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);display:flex;gap:10px;align-items:flex-start;"><div style="font-size:22px;">✓</div><div style="flex:1;font-size:14px;font-weight:700;">資料已更新，系統已留存修改紀錄。</div></div>`, {
              footerHtml: `<button class="btn btn-primary" data-ok>確定</button>`
            });
            n.modal.querySelector('[data-ok]').onclick = () => { n.close(); reload(); };
          } else {
            alert('失敗：' + (res.errors || []).join('；'));
            btn.disabled = false;
          }
        };
      };

      const showResolveModal = (r) => {
        const dispute = r.dispute || {};
        const body = `
          <form id="resolveForm" style="display:grid;gap:12px;padding:0;background:transparent;border:0;box-shadow:none;">
            <section class="card" style="box-shadow:none;border:1px solid rgba(139,92,246,0.18);background:rgba(139,92,246,0.04);">
              <div class="card-hd" style="padding:10px 14px;">
                <div class="left">
                  <div class="chip" style="width:32px;height:32px;">📩</div>
                  <div style="min-width:0;"><h2 style="font-size:14px;margin:0;">核異內容</h2></div>
                </div>
              </div>
              <div class="card-bd" style="display:grid;gap:6px;font-size:13px;">
                <div><strong>申請人：</strong>${esc(dispute.residentName || '—')}</div>
                <div><strong>說明：</strong>${esc(dispute.description || '')}</div>
                ${dispute.photoDataUrl ? `<img src="${esc(dispute.photoDataUrl)}" style="max-width:100%;border-radius:12px;border:1px solid rgba(17,24,39,0.1);max-height:240px;object-fit:cover;margin-top:4px;"/>` : ''}
              </div>
            </section>
            <div class="row" style="gap:12px;flex-wrap:wrap;">
              <div class="field" style="flex:1;min-width:180px;">
                <label for="rsNewVal">更正後本期數值（可選）</label>
                <input type="number" step="1" id="rsNewVal" placeholder="如不需更正數值請留空" />
              </div>
              <div class="field" style="flex:1;min-width:180px;">
                <label for="rsStatus">處理後狀態</label>
                <select id="rsStatus">
                  <option value="resolved">已處理（關閉）</option>
                  <option value="valid">確認正常</option>
                  <option value="abnormal">標記持續異常</option>
                </select>
              </div>
            </div>
            <div class="field">
              <label for="rsReply">回覆說明 *</label>
              <textarea id="rsReply" placeholder="例如：已確認抄表有誤，已修正數字；或已核實數字正確，請檢測是否有漏關電器..." required style="min-height:80px;"></textarea>
            </div>
          </form>
        `;
        const m = openModal('處理核異申請', body, {
          footerHtml: `<button class="btn btn-ghost" data-cancel>暫緩</button><button class="btn btn-primary" id="rsSubmit">送出處理</button>`
        });
        m.modal.querySelector('[data-cancel]').onclick = () => m.close();
        m.modal.querySelector('#rsSubmit').onclick = async (e) => {
          e.preventDefault();
          const btn = e.currentTarget;
          const reply = m.modal.querySelector('#rsReply').value.trim();
          if (!reply) return;
          const nv = m.modal.querySelector('#rsNewVal').value.trim();
          const resolution = {
            reply,
            newStatus: m.modal.querySelector('#rsStatus').value,
            newValue: nv === '' ? undefined : safeParseNumber(nv),
            repliedBy: { id: ctx.uid || '', name: ctx.name || '', role }
          };
          btn.disabled = true;
          const res = await resolveDispute(db, communityId, r.id, resolution);
          if (res.ok) {
            m.close();
            const n = openModal('已處理', `<div style="padding:14px;border-radius:14px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);display:flex;gap:10px;align-items:flex-start;"><div style="font-size:22px;">✓</div><div style="flex:1;font-size:14px;font-weight:700;">已回覆住戶並更新紀錄狀態。</div></div>`, {
              footerHtml: `<button class="btn btn-primary" data-ok>確定</button>`
            });
            n.modal.querySelector('[data-ok]').onclick = () => { n.close(); reload(); };
          } else {
            alert('失敗：' + (res.errors || []).join('；'));
            btn.disabled = false;
          }
        };
      };

      const bindCreateEvents = () => {
        const form = container.querySelector('#createForm');
        if (!form) return;
        const feePrev = container.querySelector('#crFeePreview');
        const errsEl = container.querySelector('#crErrors');
        const warnEl = container.querySelector('#crWarnings');
        const typeSelect = form.querySelector('#crType');
        const digitWrap = form.querySelector('#crCurrDigitBoxes');
        const crCurrHidden = form.querySelector('#crCurr');
        const crCurrHint = form.querySelector('#crCurrHint');
        const rebuildDigitBoxes = (typeId, initialNum) => {
          if (!digitWrap || !crCurrHint) return;
          const t = getMeterType(typeId);
          if (!t) {
            digitWrap.innerHTML = '';
            if (crCurrHint) crCurrHint.textContent = '請先選擇儀表類型，位數會自動帶入社區設定。';
            if (crCurrHidden) crCurrHidden.value = '';
            return;
          }
          const digits = Math.max(2, Math.min(8, Number.isFinite(Number(t.digits)) ? Math.floor(Number(t.digits)) : 4));
          const raw = String(Math.max(0, Math.min(Math.pow(10,digits)-1, Number.isFinite(Number(initialNum)) ? Math.floor(Number(initialNum)) : 0))).padStart(digits,'0');
          const chars = raw.split('');
          const color = t.color || '#1f2937';
          digitWrap.innerHTML = chars.map((ch,i)=>`
            <div class="digit-box mr-digit-box" data-i="${i}" style="width:56px;height:74px;border-radius:14px;border:1.5px solid ${color}55;background:linear-gradient(180deg,#fff,#fafafa);box-shadow:inset 0 -2px 0 rgba(17,24,39,.05);">
              <input inputmode="numeric" pattern="[0-9]*" maxlength="1" value="${esc(ch)}" data-digidx="${i}" aria-label="第${i+1}位" style="width:100%;height:100%;background:transparent;border:0;outline:none;text-align:center;font:900 34px/1 'SF Mono',Consolas,monospace;color:${color};letter-spacing:0;padding:0;"/>
            </div>`).join('') + `<span class="pill" style="margin-left:4px;">${digits}位</span>`;
          if (crCurrHint) crCurrHint.textContent = `已選擇 ${t.name}，共 ${digits} 位；左鍵可由左向右輸入，Backspace 可回到前一格。`;
          digitWrap.querySelectorAll('input[data-digidx]').forEach((inp, idx, arr) => {
            const digitIdx = Number(inp.getAttribute('data-digidx'));
            inp.addEventListener('input', () => {
              const v = (inp.value || '').replace(/[^0-9]/g,'');
              const fst = v.slice(0,1);
              const remain = v.slice(1);
              inp.value = fst || '';
              if (remain) {
                for (let j = 0; j < remain.length; j++) {
                  const next = idx + 1 + j;
                  if (next >= arr.length) break;
                  const nextEl = arr[next];
                  if (nextEl) nextEl.value = remain.charAt(j);
                }
                const lastFocus = Math.min(arr.length-1, idx + remain.length);
                arr[lastFocus] && arr[lastFocus].focus();
                arr[lastFocus] && arr[lastFocus].setSelectionRange && arr[lastFocus].setSelectionRange((arr[lastFocus].value||'').length,(arr[lastFocus].value||'').length);
              } else if (fst && idx + 1 < arr.length) {
                arr[idx+1].focus();
                try { arr[idx+1].setSelectionRange((arr[idx+1].value||'').length,(arr[idx+1].value||'').length); } catch {}
              }
              syncFromBoxes();
            });
            inp.addEventListener('keydown', (e) => {
              const k = e.key;
              if (k === 'Backspace' && (!inp.value) && idx > 0) {
                const prev = arr[idx-1];
                if (prev) { prev.value=''; prev.focus(); e.preventDefault(); }
                syncFromBoxes();
              } else if (k === 'ArrowLeft' && idx > 0) {
                e.preventDefault(); arr[idx-1].focus();
              } else if (k === 'ArrowRight' && idx < arr.length-1) {
                e.preventDefault(); arr[idx+1].focus();
              }
            });
            inp.addEventListener('paste', (e) => {
              e.preventDefault();
              const txt = ((e.clipboardData || window.clipboardData) || {}).getData ? (e.clipboardData || window.clipboardData).getData('text') : '';
              if (!txt) return;
              const digits = txt.replace(/[^0-9]/g,'').slice(0, arr.length - idx);
              for (let j = 0; j < digits.length; j++) { arr[idx + j] && (arr[idx + j].value = digits.charAt(j)); }
              const next = Math.min(arr.length-1, idx + Math.max(0, digits.length || 1) - 1);
              arr[next] && arr[next].focus();
              syncFromBoxes();
            });
          });
          syncFromBoxes();
        };
        const syncFromBoxes = () => {
          if (!digitWrap || !crCurrHidden) return;
          const v = Array.from(digitWrap.querySelectorAll('input[data-digidx]')).map(i => (i.value || '').slice(-1)).join('').trim();
          crCurrHidden.value = v || '';
        };
        const setNumericBoxesFromString = (s) => {
          if (!digitWrap) return;
          const t = getMeterType(typeSelect && typeSelect.value);
          if (!t) return;
          const digits = Math.max(2, Math.min(8, Number.isFinite(Number(t.digits)) ? Math.floor(Number(t.digits)) : 4));
          const n = Number.isFinite(Number(s)) ? Math.max(0, Math.min(Math.pow(10,digits)-1, Math.floor(Number(s)))) : 0;
          rebuildDigitBoxes(typeSelect.value, n);
        };
        if (typeSelect) {
          typeSelect.addEventListener('change', () => {
            rebuildDigitBoxes(typeSelect.value);
            runValidate().catch(() => {});
          });
          setTimeout(() => { if (typeSelect.value) rebuildDigitBoxes(typeSelect.value); else { digitWrap && (digitWrap.innerHTML = ''); } }, 0);
        }
        const showErrors = (list) => {
          if (!errsEl) return;
          if (!list || !list.length) { errsEl.style.display = 'none'; return; }
          errsEl.innerHTML = list.map(esc).join('<br/>');
          errsEl.style.display = 'block';
        };
        const showWarnings = (list) => {
          if (!warnEl) return;
          if (!list || !list.length) { warnEl.style.display = 'none'; return; }
          warnEl.innerHTML = list.map(esc).join('<br/>');
          warnEl.style.display = 'block';
        };
        const runValidate = async () => {
          syncFromBoxes();
          const raw = {
            meterType: form.querySelector('#crType').value,
            meterId: form.querySelector('#crMeterId').value.trim(),
            houseNo: form.querySelector('#crHouse').value.trim(),
            previousValue: form.querySelector('#crPrev').value.trim(),
            currentValue: form.querySelector('#crCurr').value.trim(),
            readingDate: form.querySelector('#crDate').value,
            period: form.querySelector('#crPeriod').value,
            operatorId: form.querySelector('#crOp').value.trim()
          };
          const v = await validateRecord(db, communityId, raw);
          showErrors(v.errors);
          showWarnings(v.warnings);
          if (v.valid && feePrev) {
            feePrev.style.display = 'block';
            feePrev.innerHTML = `
              <section class="card" style="box-shadow:none;border:1px solid rgba(22,163,74,0.18);background:linear-gradient(135deg,rgba(22,163,74,0.06),rgba(37,99,235,0.04);">
                <div class="card-bd">
                  <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                    <div style="font-weight:800;font-size:14px;">預計應繳</div>
                    <div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;color:#16a34a;">NT$ ${v.data.fee.toFixed(2)}</div>
                  </div>
                  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 14px;margin-top:8px;">
                    <div class="row" style="justify-content:space-between;"><span class="muted" style="font-size:12px;">上期</span><strong>${v.data.previousValue}</strong></div>
                    <div class="row" style="justify-content:space-between;"><span class="muted" style="font-size:12px;">本期</span><strong>${v.data.currentValue}</strong></div>
                    <div class="row" style="justify-content:space-between;"><span class="muted" style="font-size:12px;">用量</span><strong>${v.data.usage.toFixed(2)}</strong></div>
                    <div class="row" style="justify-content:space-between;"><span class="muted" style="font-size:12px;">狀態</span><strong style="color:${v.status === 'valid' ? '#16a34a' : '#b45309'};">${v.status === 'valid' ? '✓ 正常' : '⚠ ' + v.status}</strong></div>
                  </div>
                </div>
              </section>
            `;
          } else if (feePrev) {
            feePrev.style.display = 'none';
          }
          return v;
        };
        form.querySelector('#crPreviewBtn').onclick = (e) => { e.preventDefault(); runValidate(); };
        ['crType', 'crMeterId', 'crHouse', 'crPrev', 'crDate', 'crPeriod'].forEach(id => {
          const el = form.querySelector('#' + id);
          if (!el) return;
          if (id === 'crPrev') el.addEventListener('change', () => runValidate().catch(() => {}));
          else el.addEventListener('change', () => runValidate().catch(() => {}));
        });
        form.onsubmit = async (e) => {
          e.preventDefault();
          syncFromBoxes();
          const v = await runValidate();
          if (!v.valid) return;
          const confirmed = v.warnings && v.warnings.length ? window.confirm(`存在 ${v.warnings.length} 項警示：\n${v.warnings.join('\n')}\n\n仍要繼續建立嗎？`) : true;
          if (!confirmed) return;
          const res = await createRecord(db, communityId, v.data, { id: ctx.uid || '', name: ctx.name || '', role });
          if (res.ok) {
            form.reset();
            const today = new Date().toISOString().slice(0, 10);
            form.querySelector('#crDate').value = today;
            form.querySelector('#crPeriod').value = formatDateYYYYMM(new Date());
            digitWrap && (digitWrap.innerHTML = '');
            crCurrHidden && (crCurrHidden.value = '');
            if (feePrev) feePrev.style.display = 'none';
            showErrors([]);
            showWarnings([]);
            const n = openModal('建立成功', `<div style="padding:14px;border-radius:14px;background:rgba(22,163,74,0.08);border:1px solid rgba(22,163,74,0.2);display:flex;gap:10px;align-items:flex-start;"><div style="font-size:22px;">✓</div><div style="flex:1;font-size:14px;font-weight:700;">抄表紀錄已建立。${res.warnings && res.warnings.length ? `<div style="margin-top:6px;font-weight:500;font-size:13px;color:#b45309;">注意事項：${res.warnings.map(esc).join('<br/>')}</div>` : ''}</div></div>`, {
              footerHtml: `<button class="btn btn-ghost" data-stay>繼續登記</button><button class="btn btn-primary" data-golist>查看清單</button>`
            });
            n.modal.querySelector('[data-stay]').onclick = () => n.close();
            n.modal.querySelector('[data-golist]').onclick = () => { n.close(); state.tab = 'records'; reload(); };
          } else {
            showErrors(res.errors);
          }
        };
      };

      const bindImportEvents = () => {
        let pendingRows = [];
        const uploader = container.querySelector('#importUploader');
        const fileInput = container.querySelector('#importInput');
        const dlBtn = container.querySelector('#dlTemplateBtn');
        const confirmBtn = container.querySelector('#importConfirmBtn');
        const preview = container.querySelector('#importPreview');
        if (dlBtn) {
          dlBtn.onclick = (e) => {
            e.preventDefault();
            const header = ['儀表編號', '門牌號', '儀表類型', '上期數值', '本期數值', '抄表日期', '抄表員', '繳費週期'];
            const sample = [
              ['E-A1-10F-01', 'A1-10F', '電錶', '12340', '12480', new Date().toISOString().slice(0, 10), 'MR001', formatDateYYYYMM(new Date())],
              ['W-A1-10F-01', 'A1-10F', '自來水錶', '230', '252', new Date().toISOString().slice(0, 10), 'MR001', formatDateYYYYMM(new Date())],
              ['G-A1-10F-01', 'A1-10F', '瓦斯', '1020', '1085', new Date().toISOString().slice(0, 10), 'MR001', formatDateYYYYMM(new Date())]
            ];
            const escCsv = (v) => {
              const s = String(v ?? '');
              if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
              return s;
            };
            const csv = '\uFEFF' + [header, ...sample].map(r => r.map(escCsv).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'meter-reading-template.csv';
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 500);
          };
        }
        if (uploader && fileInput) {
          uploader.onclick = () => fileInput.click();
          uploader.ondragover = (e) => { e.preventDefault(); uploader.style.borderColor = 'var(--brand,#d32f2f)'; uploader.style.background = 'rgba(211,47,47,0.06)'; };
          uploader.ondragleave = () => { uploader.style.borderColor = ''; uploader.style.background = ''; };
          uploader.ondrop = (e) => {
            e.preventDefault(); uploader.style.borderColor = ''; uploader.style.background = '';
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) handleFile(f);
          };
          fileInput.onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) handleFile(f); };
        }
        const handleFile = async (file) => {
          pendingRows = [];
          if (!confirmBtn) return;
          confirmBtn.disabled = true;
          const name = String(file.name || '').toLowerCase();
          try {
            if (name.endsWith('.csv')) {
              const text = await file.text();
              const parsed = parseExcelCSV(text);
              pendingRows = parsed.data || [];
              if (preview) {
                preview.innerHTML = `
                  <div class="mr-alert ${parsed.errors && parsed.errors.length ? 'warning' : 'success'}">
                    <div class="ico">ℹ</div>
                    <div class="msg">
                      解析完成，共 ${pendingRows.length} 筆有效資料。
                      ${parsed.errors && parsed.errors.length ? `<br/><strong style="color:#b91c1c;">錯誤：</strong>${parsed.errors.slice(0, 10).map(esc).join('；')}${parsed.errors.length > 10 ? ` ...等 ${parsed.errors.length} 項` : ''}` : ''}
                    </div>
                  </div>
                  ${pendingRows.length ? `<div style="overflow-x:auto;margin-top:10px;"><table class="mr-history-table">
                    <thead><tr><th>#</th><th>儀表</th><th>戶號</th><th>類型</th><th>上期</th><th>本期</th><th>日期</th></tr></thead>
                    <tbody>${pendingRows.slice(0, 30).map((r, i) => `<tr>
                      <td>${i + 1}</td>
                      <td>${esc(r.meterId || '')}</td>
                      <td>${esc(r.houseNo || '')}</td>
                      <td>${esc(r.meterType || '')}</td>
                      <td>${esc(r.previousValue ?? '')}</td>
                      <td>${esc(r.currentValue ?? '')}</td>
                      <td>${r.readingDate ? (r.readingDate instanceof Date ? formatDateFull(r.readingDate) : r.readingDate) : ''}</td>
                    </tr>`).join('')}</tbody>
                  </table></div>
                  ${pendingRows.length > 30 ? `<div style="margin-top:8px;font-size:12px;color:var(--mr-muted);">僅顯示前 30 筆，其餘 ${pendingRows.length - 30} 筆將於匯入時處理。</div>` : ''}` : ''}
                `;
              }
            } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
              if (typeof window.XLSX === 'undefined') {
                alert('此瀏覽器環境未載入 Excel 解析套件，請另存為 CSV 後再試，或使用後台頁面（admin.html）進行匯入。');
                return;
              }
              const buf = await file.arrayBuffer();
              const wb = window.XLSX.read(buf, { type: 'array' });
              const ws = wb.Sheets[wb.SheetNames[0]];
              const csvText = window.XLSX.utils.sheet_to_csv(ws);
              const parsed = parseExcelCSV(csvText);
              pendingRows = parsed.data || [];
              if (preview) preview.innerHTML = `<div class="mr-alert info"><div class="ico">ℹ</div><div class="msg">Excel 已轉換，共 ${pendingRows.length} 筆。${parsed.errors && parsed.errors.length ? `<br/>問題：${parsed.errors.slice(0, 10).map(esc).join('；')}` : ''}</div></div>`;
            } else {
              alert('不支援的檔案格式，請使用 .csv / .xlsx / .xls');
              return;
            }
            confirmBtn.disabled = pendingRows.length === 0;
          } catch (e) {
            console.error(e);
            alert('讀取檔案失敗：' + (e.message || e));
          }
        };
        if (confirmBtn) {
          confirmBtn.onclick = async () => {
            if (!pendingRows.length) return;
            if (!window.confirm(`確認匯入 ${pendingRows.length} 筆資料？`)) return;
            confirmBtn.disabled = true;
            const summary = await batchImportRecords(db, communityId, pendingRows, { id: ctx.uid || '', name: ctx.name || '', role });
            const n = openModal('匯入完成', `
              <div class="mr-alert ${summary.failed === 0 ? 'success' : 'warning'}">
                <div class="ico">${summary.failed === 0 ? '✓' : '⚠'}</div>
                <div class="msg">
                  總計 ${summary.total} 筆：成功 <strong style="color:var(--mr-valid);">${summary.success}</strong>，失敗 <strong style="color:var(--mr-gas);">${summary.failed}</strong>。
                </div>
              </div>
              ${summary.results && summary.results.some(r => !r.ok) ? `
                <div style="max-height:260px;overflow:auto;margin-top:12px;border:1px solid var(--mr-border);border-radius:12px;">
                  <table class="mr-history-table">
                    <thead><tr><th>#</th><th>結果</th><th>錯誤原因</th></tr></thead>
                    <tbody>${summary.results.filter(r => !r.ok).map(r => `<tr><td>${r.index + 1}</td><td>失敗</td><td style="color:var(--mr-gas);font-size:12px;">${(r.errors || []).map(esc).join('<br/>')}</td></tr>`).join('')}</tbody>
                  </table>
                </div>
              ` : ''}
            `, { footerHtml: `<button class="mr-btn primary" data-ok>確定</button>` });
            n.modal.querySelector('[data-ok]').onclick = () => { n.close(); state.tab = 'records'; reload(); };
          };
        }
        const expCsv = container.querySelector('#exportCsvBtn');
        if (expCsv) expCsv.onclick = () => downloadExport(false);
        const expSum = container.querySelector('#exportSummaryBtn');
        if (expSum) expSum.onclick = () => downloadExport(true);
        const downloadExport = (summaryOnly) => {
          const s = state.stats || computeStatistics(state.records);
          const csv = exportCSV(summaryOnly ? [] : state.records, s);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const ts = new Date();
          const name = `meter-${summaryOnly ? 'summary' : 'records'}-${communityId}-${ts.getFullYear()}${pad2(ts.getMonth() + 1)}${pad2(ts.getDate())}-${pad2(ts.getHours())}${pad2(ts.getMinutes())}.csv`;
          a.href = url; a.download = name;
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 500);
        };
      };

      reload();
    }

    return {
      renderResidentPage,
      renderAdminPage,
      openModal,
      recordCard,
      statusBadge,
      meterTag,
      esc
    };
  })();

  window.NwMeterReading = {
    METER_TYPES_DEFAULT,
    get METER_TYPES(){ return getActiveMeterTypesMap(); },
    set METER_TYPES(v){ if (v && typeof v==='object') { const r = normalizeMeterTypeFromRaw(v); METER_TYPES = r.map; window.__nwMeterOrder = r.order; } },
    VALIDATION_STATUS,
    FEE_TIERS,
    ABNORMAL_THRESHOLDS,
    pad2,
    genId,
    formatDateYYYYMM,
    formatDateFull,
    toDateValue,
    getMeterType,
    getActiveMeterTypeIds,
    getActiveMeterTypesMap,
    normalizeMeterTypeFromRaw,
    loadCommunityMeterSettings,
    safeParseNumber,
    isValidMeterNumber,
    calcUsage,
    calcFee,
    digitBoxesStringify,
    detectAbnormal,
    ensureServices,
    cacheGet,
    cacheSet,
    cacheClear,
    writeLog,
    readLogs,
    getLastRecord,
    getHistoryAvg,
    listRecordsByHouse,
    listRecordsByCommunity,
    validateRecord,
    createRecord,
    updateRecord,
    submitDispute,
    resolveDispute,
    listPendingDisputes,
    listAbnormalRecords,
    listPendingRecords,
    computeStatistics,
    exportCSV,
    parseExcelCSV,
    batchImportRecords,
    checkPermission,
    UI
  };
})();
