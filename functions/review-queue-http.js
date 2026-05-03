// Review Queue HTTP Endpoints
//
// All endpoints verify a Cognito Access Token from the admin frontend.
// They expose read + approve/reject actions for /scrapeDrafts,
// /venueAuditFlags, and /reportTriage.
//
// Auth model:
//   Frontend sends `Authorization: Bearer <cognito-access-token>`.
//   We verify the token against the Cognito pool (us-east-1_0pnwGeJBH).
//   Admin check: user's email must be in ADMIN_EMAILS env var (or wildcard for dev).
//
// Writes to production /exhibits only happen through publishDraft() in data-pipeline.js.

const { onRequest } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");
const { CognitoJwtVerifier } = require("aws-jwt-verify");
const { publishDraft } = require("./data-pipeline");

// ─── Cognito verifier (cached across invocations) ───────
const verifier = CognitoJwtVerifier.create({
  userPoolId: "us-east-1_0pnwGeJBH",
  tokenUse: "access",
  clientId: "63b7i8nomk6er6iugc626t4tkq",
});

/**
 * Verify caller's Cognito access token and check admin status.
 * Returns { uid, email } if admin, throws HttpError otherwise.
 */
async function requireAdmin(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    throw new HttpError(401, "Missing Authorization header");
  }

  let payload;
  try {
    payload = await verifier.verify(token);
  } catch (e) {
    throw new HttpError(401, "Invalid token: " + e.message);
  }

  const uid = payload.sub;
  const username = payload.username || "";

  // Admin check: username in allow-list.
  // Fallback: if ADMIN_USERNAMES is not set, treat all authenticated users as admin
  // (dev-mode; log a warning). In production set ADMIN_USERNAMES env var.
  const adminList = (process.env.ADMIN_USERNAMES || "").split(",").map(s => s.trim()).filter(Boolean);
  if (adminList.length > 0 && !adminList.includes(username) && !adminList.includes(uid)) {
    throw new HttpError(403, "Not an admin");
  }

  return { uid, username };
}

// ─── Helper: tiny HTTP error with status ────────────────
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ─── CORS helper ────────────────────────────────────────
function setCors(res) {
  res.set("Access-Control-Allow-Origin", "*"); // TODO: tighten to amplifyapp.com + localhost
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.status(204).send("");
    return true;
  }
  setCors(res);
  return false;
}

function handleError(res, e) {
  if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message });
  } else {
    console.error("Unexpected error:", e);
    res.status(500).json({ error: e.message || "Internal error" });
  }
}

// ─── GET /listScrapeDrafts ──────────────────────────────
// Query params: venue (optional), status (default: pending), limit (default: 100)
// Returns: { drafts: [...], total: number }
exports.listScrapeDrafts = onRequest({ invoker: "public", timeoutSeconds: 60 }, async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    await requireAdmin(req);
    const db = getFirestore();

    const status = (req.query.status || "pending").toString();
    const venue = req.query.venue ? req.query.venue.toString() : null;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);

    let q = db.collection("scrapeDrafts").where("status", "==", status);
    if (venue) q = q.where("scraperVenue", "==", venue);
    const snap = await q.orderBy("createdAt", "desc").limit(limit).get();

    const drafts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Count total for this filter (separate query — Firestore doesn't do count+data in one call cheaply)
    const countSnap = await q.count().get();
    const total = countSnap.data().count;

    res.json({ drafts, total });
  } catch (e) {
    handleError(res, e);
  }
});

// ─── GET /listAuditFlags ────────────────────────────────
exports.listAuditFlags = onRequest({ invoker: "public", timeoutSeconds: 60 }, async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    await requireAdmin(req);
    const db = getFirestore();

    const status = (req.query.status || "open").toString();
    const severity = req.query.severity ? req.query.severity.toString() : null;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);

    let q = db.collection("venueAuditFlags").where("status", "==", status);
    if (severity) q = q.where("severity", "==", severity);
    const snap = await q.orderBy("createdAt", "desc").limit(limit).get();

    const flags = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ flags });
  } catch (e) {
    handleError(res, e);
  }
});

// ─── POST /approveScrapeDraft ───────────────────────────
// Body: { draftId, edits? }
// Calls publishDraft internally — writes to /exhibits.
exports.approveScrapeDraft = onRequest({ invoker: "public", timeoutSeconds: 60 }, async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const admin = await requireAdmin(req);
    if (req.method !== "POST") throw new HttpError(405, "POST required");

    const { draftId, edits } = req.body || {};
    if (!draftId) throw new HttpError(400, "draftId required");

    const db = getFirestore();
    const draft = await db.collection("scrapeDrafts").doc(draftId).get();
    if (!draft.exists) throw new HttpError(404, "Draft not found");

    console.log(`Admin ${admin.username} approving draft ${draftId}`);
    const result = await publishDraft("scrapeDraft", draftId, { edits });
    res.json({ ok: true, result });
  } catch (e) {
    handleError(res, e);
  }
});

// ─── POST /rejectScrapeDraft ────────────────────────────
// Body: { draftId, reason? }
exports.rejectScrapeDraft = onRequest({ invoker: "public", timeoutSeconds: 30 }, async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const admin = await requireAdmin(req);
    if (req.method !== "POST") throw new HttpError(405, "POST required");

    const { draftId, reason } = req.body || {};
    if (!draftId) throw new HttpError(400, "draftId required");

    const db = getFirestore();
    const ref = db.collection("scrapeDrafts").doc(draftId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, "Draft not found");

    console.log(`Admin ${admin.username} rejecting draft ${draftId}${reason ? ` — ${reason}` : ""}`);
    await ref.update({
      status: "rejected",
      rejectedAt: Math.floor(Date.now() / 1000),
      rejectedBy: admin.username,
      rejectionReason: reason || "",
    });
    res.json({ ok: true });
  } catch (e) {
    handleError(res, e);
  }
});

// ─── POST /bulkApproveScrapeDrafts ──────────────────────
// Body: { draftIds: [...], maxCount? (safety cap, default 50) }
// Approves multiple drafts serially. Returns per-id results.
exports.bulkApproveScrapeDrafts = onRequest({ invoker: "public", timeoutSeconds: 540, memory: "512MiB" }, async (req, res) => {
  if (handleOptions(req, res)) return;
  try {
    const admin = await requireAdmin(req);
    if (req.method !== "POST") throw new HttpError(405, "POST required");

    const { draftIds, maxCount = 50 } = req.body || {};
    if (!Array.isArray(draftIds) || draftIds.length === 0) {
      throw new HttpError(400, "draftIds[] required");
    }
    if (draftIds.length > maxCount) {
      throw new HttpError(400, `Too many drafts (${draftIds.length} > ${maxCount})`);
    }

    console.log(`Admin ${admin.username} bulk-approving ${draftIds.length} drafts`);
    const results = [];
    for (const draftId of draftIds) {
      try {
        const result = await publishDraft("scrapeDraft", draftId);
        results.push({ draftId, ok: true, result });
      } catch (e) {
        results.push({ draftId, ok: false, error: e.message });
      }
    }
    const okCount = results.filter(r => r.ok).length;
    res.json({ ok: true, total: results.length, succeeded: okCount, results });
  } catch (e) {
    handleError(res, e);
  }
});
