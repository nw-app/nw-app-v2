const functions = require("firebase-functions");
const admin = require("firebase-admin");

try {
  admin.initializeApp();
} catch {}

const db = admin.firestore();

function toStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function uniqueTokensFromUserDoc(doc) {
  const data = doc && doc.exists ? (doc.data() || {}) : {};
  const raw = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
  return raw.map((t) => toStr(t)).filter(Boolean);
}

exports.onCallCreated = functions.firestore.document("calls/{callId}").onCreate(async (snap, context) => {
  const callId = String((context && context.params && context.params.callId) || "").trim();
  const call = snap && snap.exists ? (snap.data() || {}) : {};
  const status = toStr(call.status);
  if (status !== "ringing") return null;

  const community = toStr(call.community);
  const toRole = toStr(call.toRole);
  const toUid = toStr(call.toUid);

  const tokens = new Set();

  if (toRole === "resident" && toUid) {
    try {
      const udoc = await db.collection("users").doc(toUid).get();
      uniqueTokensFromUserDoc(udoc).forEach((t) => tokens.add(t));
    } catch {}
  }

  if (toRole === "admin" && community) {
    const roleList = ["admin", "系統管理員", "系統管理者", "系統", "community", "社區"];
    const usersById = new Map();

    try {
      const q1 = await db.collection("users").where("role", "in", roleList).where("community", "==", community).get();
      q1.forEach((doc) => usersById.set(doc.id, doc));
    } catch {}

    try {
      const q2 = await db.collection("users").where("role", "in", roleList).where("communityIds", "array-contains", community).get();
      q2.forEach((doc) => usersById.set(doc.id, doc));
    } catch {}

    usersById.forEach((doc) => {
      uniqueTokensFromUserDoc(doc).forEach((t) => tokens.add(t));
    });
  }

  const tokenList = Array.from(tokens);
  if (!tokenList.length) return null;

  const fromName = toStr(call.fromName) || (toRole === "resident" ? "社區後台" : "住戶");
  const fromHouseNo = toStr(call.fromHouseNo);
  const title = toRole === "resident" ? "QAi生活網｜社區後台來電" : "QAi生活網｜住戶來電";
  const body = toRole === "resident"
    ? (fromName || "社區後台")
    : ([fromName, fromHouseNo].filter(Boolean).join("｜") || "住戶來電");

  const q = new URLSearchParams();
  if (community) q.set("c", community);
  if (callId) q.set("call", callId);
  if (toRole) q.set("toRole", toRole);
  const base = toRole === "resident" ? "member.html" : (toRole === "admin" ? "admin.html" : "callrecord.html");
  const url = q.toString() ? `${base}?${q.toString()}` : base;

  const message = {
    tokens: tokenList,
    data: {
      type: "intercom",
      callId,
      community,
      toRole,
      title,
      body,
      url,
      autoOpen: "1",
    },
    android: {
      priority: "high",
    },
    webpush: {
      headers: {
        Urgency: "high",
      },
      fcmOptions: {
        link: url,
      },
    },
  };

  try {
    await admin.messaging().sendEachForMulticast(message);
  } catch {}

  return null;
});

/* ===================== 住戶端推播通知（一般模組） ===================== */

// 各模組的通知顯示設定（模組名稱、住戶端對應頁面）
const NOTIFY_MODULE_META = {
  parcel: { module: "包裹郵件", url: "parcel.html" },
  visitor: { module: "訪客登記", url: "visitor-resident.html" },
  community: { module: "社區園地", url: "bulletin-community.html" },
  finance: { module: "財務報表", url: "bulletin-finance.html" },
  meeting: { module: "會議紀錄", url: "bulletin-meeting.html" },
  repair: { module: "修繕報告", url: "bulletin-repair.html" },
  clean: { module: "清潔通報", url: "bulletin-clean.html" },
  activity: { module: "社區活動", url: "bulletin-activity.html" },
  facility: { module: "公設預約", url: "facility.html" },
  cleanreport: { module: "清潔通報", url: "clean-report.html" },
  system: { module: "系統通知", url: "member.html" },
};

function normUnitKey(v) {
  return toStr(v).replace(/[－–—]/g, "-").replace(/\s+/g, "");
}

function isResidentRole(data) {
  const role = toStr(data && data.role);
  return !role || role === "住戶" || role === "resident";
}

// 取得社區內所有使用者（含以 communityIds 加入的管理人員）
async function getCommunityUserMap(cid) {
  const map = new Map();
  try {
    const q1 = await db.collection("users").where("community", "==", cid).get();
    q1.forEach((doc) => map.set(doc.id, doc.data() || {}));
  } catch {}
  try {
    const q2 = await db.collection("users").where("communityIds", "array-contains", cid).get();
    q2.forEach((doc) => map.set(doc.id, doc.data() || {}));
  } catch {}
  return map;
}

function userUnitKeys(data) {
  const base = normUnitKey(data && (data.houseNo || data.unit));
  const sub = normUnitKey(data && (data.subHouseNo || data.subUnit || data.sub));
  const keys = new Set();
  if (base) keys.add(base);
  if (base && sub) keys.add(`${base}-${sub}`);
  return keys;
}

function userMatchesUnit(data, unitKey) {
  const target = normUnitKey(unitKey);
  if (!target) return false;
  const keys = userUnitKeys(data);
  if (keys.has(target)) return true;
  const targetBase = target.split("-")[0];
  return Boolean(targetBase) && keys.has(targetBase);
}

// 依戶號取出該戶住戶的 uid 清單
async function residentUidsByUnit(cid, unitKey) {
  if (!toStr(unitKey)) return [];
  const users = await getCommunityUserMap(cid);
  const out = [];
  users.forEach((data, uid) => {
    if (!isResidentRole(data)) return;
    if (userMatchesUnit(data, unitKey)) out.push(uid);
  });
  return out;
}

// 取出社區內所有住戶的 uid 清單
async function allResidentUids(cid) {
  const users = await getCommunityUserMap(cid);
  const out = [];
  users.forEach((data, uid) => {
    if (isResidentRole(data)) out.push(uid);
  });
  return out;
}

// 依 uid 清單收集 FCM token
async function tokensForUids(uids) {
  const tokens = new Set();
  const list = Array.from(new Set((uids || []).map((x) => toStr(x)).filter(Boolean)));
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    try {
      const docs = await db.getAll(...chunk.map((uid) => db.collection("users").doc(uid)));
      docs.forEach((doc) => uniqueTokensFromUserDoc(doc).forEach((t) => tokens.add(t)));
    } catch {}
  }
  return Array.from(tokens);
}

// 送出資料型 FCM 推播（由 Service Worker 顯示通知）
async function sendPushData(tokens, data) {
  const list = Array.from(new Set((tokens || []).map((t) => toStr(t)).filter(Boolean)));
  if (!list.length) return;
  const payload = {};
  Object.keys(data || {}).forEach((k) => {
    const v = data[k];
    payload[k] = v === null || v === undefined ? "" : String(v);
  });
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    try {
      await admin.messaging().sendEachForMulticast({
        tokens: chunk,
        data: payload,
        android: { priority: "high" },
        webpush: {
          headers: { Urgency: "high" },
          fcmOptions: { link: payload.url ? payload.url : undefined },
        },
      });
    } catch {}
  }
}

// 建立單筆通知文件（供多位指定住戶各自一份，利於個別已讀狀態）
async function notifyUsers(cid, uids, payload) {
  const communityId = toStr(cid);
  const uidList = Array.from(new Set((uids || []).map((x) => toStr(x)).filter(Boolean)));
  if (!communityId || !uidList.length) return;
  const meta = NOTIFY_MODULE_META[toStr(payload && payload.type)] || NOTIFY_MODULE_META.system;
  const nowMs = Date.now();
  const url = `${meta.url}?c=${encodeURIComponent(communityId)}`;
  const base = {
    community: communityId,
    audience: "user",
    type: toStr(payload.type) || "system",
    module: meta.module,
    title: toStr(payload.title) || meta.module,
    body: toStr(payload.body),
    senderName: toStr(payload.senderName),
    refId: toStr(payload.refId),
    url,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
  };
  const col = db.collection("communities").doc(communityId).collection("notifications");
  const batch = db.batch();
  uidList.slice(0, 400).forEach((uid) => {
    batch.set(col.doc(), { ...base, toUid: uid });
  });
  try {
    await batch.commit();
  } catch {}
  const tokens = await tokensForUids(uidList);
  await sendPushData(tokens, {
    type: base.type,
    module: base.module,
    title: base.title,
    body: base.body,
    url,
    refId: base.refId,
  });
}

// 建立全社區共用通知（單一文件，所有住戶皆可讀取）
async function notifyCommunity(cid, payload) {
  const communityId = toStr(cid);
  if (!communityId) return;
  const meta = NOTIFY_MODULE_META[toStr(payload && payload.type)] || NOTIFY_MODULE_META.system;
  const nowMs = Date.now();
  const url = `${meta.url}?c=${encodeURIComponent(communityId)}`;
  const doc = {
    community: communityId,
    audience: "all",
    type: toStr(payload.type) || "system",
    module: meta.module,
    title: toStr(payload.title) || meta.module,
    body: toStr(payload.body),
    senderName: toStr(payload.senderName),
    refId: toStr(payload.refId),
    url,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
  };
  try {
    await db.collection("communities").doc(communityId).collection("notifications").add(doc);
  } catch {}
  const uids = await allResidentUids(communityId);
  const tokens = await tokensForUids(uids);
  await sendPushData(tokens, {
    type: doc.type,
    module: doc.module,
    title: doc.title,
    body: doc.body,
    url,
    refId: doc.refId,
  });
}

// 包裹到件 / 暫寄物到件
async function handleItemArrived(collectionName, snap, context) {
  const cid = toStr(context.params.cid);
  const data = snap.data() || {};
  const unit = toStr(data.unit) || toStr(data.houseNo);
  if (!unit) return null;
  const uids = await residentUidsByUnit(cid, unit);
  const company = toStr(data.company);
  const trackNo = toStr(data.trackNo) || toStr(data.internalSerial);
  const parts = [];
  if (company) parts.push(company);
  if (trackNo) parts.push(`單號 ${trackNo}`);
  const body = `您有一件新包裹已到達管理室${parts.length ? `（${parts.join("／")}）` : ""}，請盡速前往領取。`;
  await notifyUsers(cid, uids, { type: "parcel", title: "包裹郵件｜到件通知", body, refId: snap.id });
  return null;
}

exports.onParcelCreated = functions.firestore
  .document("communities/{cid}/parcels/{parcelId}")
  .onCreate((snap, context) => handleItemArrived("parcels", snap, context));

exports.onTempItemCreated = functions.firestore
  .document("communities/{cid}/tempItems/{itemId}")
  .onCreate((snap, context) => handleItemArrived("tempItems", snap, context));

// 訪客登記
exports.onVisitorCreated = functions.firestore
  .document("communities/{cid}/visitors/{visitorId}")
  .onCreate(async (snap, context) => {
    const cid = toStr(context.params.cid);
    const v = snap.data() || {};
    const unit = toStr(v.unit);
    if (!unit) return null;
    const uids = await residentUidsByUnit(cid, unit);
    const name = toStr(v.name) || "訪客";
    const plate = toStr(v.plate);
    const body = `${name} 已登記拜訪 ${unit}${plate ? `（車牌 ${plate}）` : ""}，請留意來訪。`;
    await notifyUsers(cid, uids, { type: "visitor", title: "訪客登記｜來訪通知", body, refId: snap.id });
    return null;
  });

// 各類公告（社區園地／財務報表／會議紀錄／修繕報告／清潔通報／社區活動）
exports.onBulletinCreated = functions.firestore
  .document("communities/{cid}/bulletins/{bulletinId}")
  .onCreate(async (snap, context) => {
    const cid = toStr(context.params.cid);
    const b = snap.data() || {};
    const type = toStr(b.type) || "community";
    const meta = NOTIFY_MODULE_META[type];
    if (!meta) return null;
    const title = toStr(b.title) || meta.module;
    const subtitle = toStr(b.subtitle);
    const body = subtitle || String(b.content || "").replace(/\s+/g, " ").trim().slice(0, 60)
      || `社區發布了新的${meta.module}公告。`;
    await notifyCommunity(cid, { type, title: `${meta.module}｜${title}`, body, refId: snap.id });
    return null;
  });

// 公設預約（送出／核准／取消）
exports.onReservationWritten = functions.firestore
  .document("communities/{cid}/reservations/{reservationId}")
  .onWrite(async (change, context) => {
    const cid = toStr(context.params.cid);
    const afterSnap = change.after;
    if (!afterSnap || !afterSnap.exists) return null;
    const after = afterSnap.data() || {};
    const before = change.before && change.before.exists ? (change.before.data() || {}) : {};
    const uid = toStr(after.createdBy) || toStr(after.residentId);
    if (!uid) return null;
    const facilityName = toStr(after.facilityName) || "設施";
    const dateKey = toStr(after.dateKey);
    const start = toStr(after.startTime);
    const end = toStr(after.endTime);
    const slot = [dateKey, start && end ? `${start}-${end}` : start].filter(Boolean).join(" ");
    const refId = afterSnap.id;
    if (!change.before.exists) {
      await notifyUsers(cid, [uid], {
        type: "facility",
        title: "公設預約｜已送出",
        body: `${facilityName} ${slot} 預約已送出，待管理室確認。`,
        refId,
      });
      return null;
    }
    const stAfter = toStr(after.status);
    const stBefore = toStr(before.status);
    if (stAfter === stBefore) return null;
    if (stAfter === "approved") {
      await notifyUsers(cid, [uid], {
        type: "facility",
        title: "公設預約｜已核准",
        body: `${facilityName} ${slot} 預約已核准，請準時使用。`,
        refId,
      });
    } else if (stAfter === "canceled" || stAfter === "cancelled") {
      await notifyUsers(cid, [uid], {
        type: "facility",
        title: "公設預約｜已取消",
        body: `${facilityName} ${slot} 預約已被取消。`,
        refId,
      });
    }
    return null;
  });

// 清潔通報進度更新（通知通報住戶）
exports.onCleanReportWritten = functions.firestore
  .document("communities/{cid}/clean_reports/{reportId}")
  .onWrite(async (change, context) => {
    const cid = toStr(context.params.cid);
    const afterSnap = change.after;
    if (!afterSnap || !afterSnap.exists) return null;
    const after = afterSnap.data() || {};
    const before = change.before && change.before.exists ? (change.before.data() || {}) : {};
    const uid = toStr(after.reporterUid);
    if (!uid) return null;
    const stAfter = toStr(after.status);
    const stBefore = toStr(before.status);
    if (change.before.exists && stAfter === stBefore) return null;
    const labelMap = {
      pending: "待處理",
      processing: "處理中",
      doing: "處理中",
      done: "已完成",
      completed: "已完成",
      rejected: "已退回",
    };
    const label = labelMap[stAfter] || stAfter || "已更新";
    await notifyUsers(cid, [uid], {
      type: "cleanreport",
      title: "清潔通報｜進度更新",
      body: `您的清潔通報狀態已更新為「${label}」。`,
      refId: afterSnap.id,
    });
    return null;
  });

// 刪除住戶時同步移除 Firebase Auth 帳號（限系統管理員或該社區管理方呼叫）
exports.deleteResidentAuth = functions.https.onCall(async (data, context) => {
  const callerUid = context && context.auth && context.auth.uid ? String(context.auth.uid) : "";
  if (!callerUid) {
    throw new functions.https.HttpsError("unauthenticated", "請先登入。");
  }

  const targetUid = toStr(data && data.uid);
  if (!targetUid) {
    throw new functions.https.HttpsError("invalid-argument", "缺少 uid。");
  }

  const callerSnap = await db.collection("users").doc(callerUid).get();
  const caller = callerSnap.exists ? (callerSnap.data() || {}) : {};
  const callerRole = toStr(caller.role);
  const callerEmail = toStr(context.auth.token && context.auth.token.email);
  const isAdmin =
    callerEmail === "nwapp.eason@gmail.com" ||
    ["admin", "系統管理員", "系統管理者", "系統"].includes(callerRole);

  if (!isAdmin) {
    const targetSnap = await db.collection("users").doc(targetUid).get();
    const target = targetSnap.exists ? (targetSnap.data() || {}) : {};
    const targetCommunity = toStr(target.community);
    const callerCommunities = [
      toStr(caller.community),
      ...(Array.isArray(caller.communityIds) ? caller.communityIds.map(toStr) : []),
    ].filter(Boolean);
    const isStaff = callerRole && !["住戶", "resident", "停用"].includes(callerRole);
    if (!isStaff || !targetCommunity || !callerCommunities.includes(targetCommunity)) {
      throw new functions.https.HttpsError("permission-denied", "沒有權限刪除此帳號。");
    }
  }

  try {
    await admin.auth().deleteUser(targetUid);
    return { deleted: true };
  } catch (err) {
    if (err && err.code === "auth/user-not-found") return { deleted: false };
    throw new functions.https.HttpsError("internal", String((err && err.message) || "刪除失敗"));
  }
});
