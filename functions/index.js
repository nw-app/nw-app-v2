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
  const title = toRole === "resident" ? "生活網｜社區後台來電" : "生活網｜住戶來電";
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
