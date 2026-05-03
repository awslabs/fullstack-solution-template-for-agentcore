const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getMessaging } = require("firebase-admin/messaging");
const sharp = require("sharp");
const path = require("path");

initializeApp();
const db = getFirestore();
const bucket = getStorage().bucket();

// ─── Helpers ────────────────────────────────────────────

async function sendToUser(uid, title, body, data = {}) {
  const userDoc = await db.collection("users").doc(uid).get();
  const token = userDoc.data()?.fcmToken;
  if (!token) return;
  try {
    await getMessaging().send({
      token,
      notification: { title, body },
      data,
      apns: { payload: { aps: { sound: "default" } } },
    });
  } catch (e) {
    if (e.code === "messaging/registration-token-not-registered") {
      await db.collection("users").doc(uid).update({ fcmToken: "" });
    }
  }
}

function targetCollection(targetType) {
  const map = { museum: "museums", gallery: "galleries", exhibit: "exhibits", tour: "tours" };
  return map[targetType] || null;
}

async function recalcStats(targetId, targetType) {
  const col = targetCollection(targetType);
  if (!col) return;
  const snap = await db.collection("reviews").where("targetId", "==", targetId).get();
  let sum = 0, count = 0;
  snap.forEach(d => { sum += d.data().rating || 0; count++; });
  await db.collection(col).doc(targetId).update({
    avgRating: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
    reviewCount: count,
  });
}

// Fan out a feed item to all followers of a user
async function fanOutToFollowers(uid, feedItem) {
  const followersSnap = await db.collection("users").doc(uid).collection("followers").get();
  if (followersSnap.empty) return;
  const batch = db.batch();
  for (const followerDoc of followersSnap.docs) {
    batch.set(db.collection("users").doc(followerDoc.id).collection("feedItems").doc(feedItem.reviewId), feedItem);
  }
  await batch.commit();
}

async function removeFeedItem(uid, reviewId) {
  const followersSnap = await db.collection("users").doc(uid).collection("followers").get();
  if (followersSnap.empty) return;
  const batch = db.batch();
  for (const followerDoc of followersSnap.docs) {
    batch.delete(db.collection("users").doc(followerDoc.id).collection("feedItems").doc(reviewId));
  }
  await batch.commit();
}

// ─── Review API (single callable for web + mobile) ──────

exports.submitReview = onCall({ invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");

  const uid = request.auth.uid;
  const { action, targetId, targetType, targetName, text, rating, photoUrls, photoCaptions, videoUrls, videoCaptions, reviewId: clientReviewId, visitedAt } = request.data;

  // Use client-provided reviewId (for legacy reviews) or deterministic ID
  const reviewId = clientReviewId || `${uid}_${targetId}`;
  const ref = db.collection("reviews").doc(reviewId);

  if (action === "delete") {
    let snap = await ref.get();
    if (!snap.exists) {
      // Legacy review — find by userId + targetId query
      const q = await db.collection("reviews").where("userId", "==", uid).where("targetId", "==", targetId).limit(1).get();
      if (q.empty) throw new HttpsError("not-found", "Review not found");
      const legacyDoc = q.docs[0];
      if (legacyDoc.data().userId !== uid) throw new HttpsError("permission-denied", "Not your review");
      const { targetId: tid, targetType: tt } = legacyDoc.data();
      await legacyDoc.ref.delete();
      await recalcStats(tid, tt);
      await removeFeedItem(uid, legacyDoc.id);
      return { deleted: true };
    }
    if (snap.data().userId !== uid) throw new HttpsError("permission-denied", "Not your review");
    const { targetId: tid, targetType: tt } = snap.data();
    await ref.delete();
    await recalcStats(tid, tt);
    await removeFeedItem(uid, reviewId);
    return { deleted: true };
  }

  // Validate
  if (!targetId || !targetType) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }
  if (!["museum", "gallery", "exhibit", "tour"].includes(targetType)) {
    throw new HttpsError("invalid-argument", "Invalid targetType");
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpsError("invalid-argument", "Rating must be 1-5");
  }

  // Get trusted user data from their profile
  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.data() || {};

  const existing = await ref.get();

  if (existing.exists) {
    // Update — text, rating, photos, targetName
    const updates = { text: text?.trim() || "", rating };
    if (targetName) updates.targetName = targetName;
    if (photoUrls) updates.photoUrls = photoUrls;
    if (photoCaptions) updates.photoCaptions = photoCaptions;
    if (videoUrls) updates.videoUrls = videoUrls;
    if (videoCaptions) updates.videoCaptions = videoCaptions;
    if (visitedAt != null) updates.visitedAt = visitedAt;
    await ref.update(updates);

    // Update existing feed items (don't create new ones)
    const followersSnap = await db.collection("users").doc(uid).collection("followers").get();
    if (!followersSnap.empty) {
      const batch = db.batch();
      for (const followerDoc of followersSnap.docs) {
        const feedRef = db.collection("users").doc(followerDoc.id).collection("feedItems").doc(reviewId);
        const feedSnap = await feedRef.get();
        if (feedSnap.exists) {
          batch.update(feedRef, { text: text?.trim() || "", rating, targetName: targetName || feedSnap.data().targetName || "" });
        }
      }
      await batch.commit();
    }
  } else {
    // Check for legacy review (non-deterministic ID)
    const legacyQ = await db.collection("reviews").where("userId", "==", uid).where("targetId", "==", targetId).limit(1).get();
    if (!legacyQ.empty) {
      // Update legacy review in place
      const legacyRef = legacyQ.docs[0].ref;
      const updates = { text: (text || "").trim(), rating };
      if (targetName) updates.targetName = targetName;
      if (photoUrls) updates.photoUrls = photoUrls;
      if (photoCaptions) updates.photoCaptions = photoCaptions;
      if (videoUrls) updates.videoUrls = videoUrls;
      if (videoCaptions) updates.videoCaptions = videoCaptions;
      if (visitedAt != null) updates.visitedAt = visitedAt;
      await legacyRef.update(updates);
    } else {
    // Create
    const doc = {
      targetId, targetName: targetName || "", targetType,
      text: (text || "").trim(), rating,
      userId: uid,
      displayName: userData.displayName || request.auth.token.name || "Anonymous",
      photoUrl: userData.photoUrl || "",
      username: userData.username || "",
      createdAt: Date.now() / 1000,
      photoUrls: photoUrls || [],
    };
    if (photoCaptions) doc.photoCaptions = photoCaptions;
    if (videoUrls && videoUrls.length) doc.videoUrls = videoUrls;
    if (videoCaptions && videoCaptions.length) doc.videoCaptions = videoCaptions;
    if (visitedAt != null) doc.visitedAt = visitedAt;
    await ref.set(doc);
    }
  }

  await recalcStats(targetId, targetType);

  // Fan out to followers only on truly new reviews
  if (!existing.exists && !clientReviewId) {
    await fanOutToFollowers(uid, {
      reviewId,
      userId: uid,
      displayName: userData.displayName || request.auth.token.name || "Anonymous",
      photoUrl: userData.photoUrl || "",
      targetId, targetName: targetName || "", targetType,
      text: (text || "").trim(), rating,
      createdAt: Date.now() / 1000,
    });
  }

  // Check curator eligibility (fire-and-forget, don't block response)
  const eligibilityCheck = async () => {
    const uDoc = await db.collection("users").doc(uid).get();
    const d = uDoc.data() || {};
    if (d.role === "curator" || d.role === "admin" || d.curatorEligible) return;
    const cnt = await db.collection("reviews").where("userId", "==", uid).count().get();
    if (cnt.data().count >= 5) {
      await db.collection("users").doc(uid).update({ curatorEligible: true });
    }
  };
  eligibilityCheck().catch(e => console.error("Curator eligibility check failed:", e));

  return { reviewId, updated: existing.exists };
});

// ─── Like/unlike a review ───────────────────────────────

exports.toggleLike = onCall({ invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
  const uid = request.auth.uid;
  const { reviewId } = request.data;
  if (!reviewId) throw new HttpsError("invalid-argument", "reviewId required");

  const ref = db.collection("reviews").doc(reviewId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Review not found");

  const likedBy = snap.data().likedBy || [];
  const alreadyLiked = likedBy.includes(uid);

  if (alreadyLiked) {
    const updated = likedBy.filter(id => id !== uid);
    await ref.update({ likedBy: updated, likes: updated.length });
    return { liked: false, likes: updated.length };
  } else {
    likedBy.push(uid);
    await ref.update({ likedBy, likes: likedBy.length });
    // Notify review author
    const reviewData = snap.data();
    if (reviewData.userId !== uid) {
      const likerDoc = await db.collection("users").doc(uid).get();
      const likerName = likerDoc.data()?.displayName || "Someone";
      const venueName = reviewData.targetName || "";
      await sendToUser(reviewData.userId, "New Like", `${likerName} liked your review${venueName ? " of " + venueName : ""}`, {
        type: "like", reviewId, targetId: reviewData.targetId || "", targetType: reviewData.targetType || "",
      });
    }
    return { liked: true, likes: likedBy.length };
  }
});

// ─── Reply notification ─────────────────────────────────

exports.onReplyCreated = onDocumentCreated("reviews/{reviewId}/replies/{replyId}", async (event) => {
  const reply = event.data.data();
  const reviewId = event.params.reviewId;
  const reviewSnap = await db.collection("reviews").doc(reviewId).get();
  if (!reviewSnap.exists) return;
  const review = reviewSnap.data();
  if (review.userId === reply.userId) return; // don't notify self
  const replierDoc = await db.collection("users").doc(reply.userId).get();
  const replierName = replierDoc.data()?.displayName || "Someone";
  const venueName = review.targetName || "";
  await sendToUser(review.userId, "New Reply", `${replierName} replied to your review${venueName ? " of " + venueName : ""}`, {
    type: "reply", reviewId, targetId: review.targetId || "", targetType: review.targetType || "",
  });
});

// ─── Push notifications ─────────────────────────────────

exports.onNewFollower = onDocumentCreated(
  "users/{userId}/followers/{followerId}",
  async (event) => {
    const { userId, followerId } = event.params;
    const followerDoc = await db.collection("users").doc(followerId).get();
    const name = followerDoc.data()?.displayName || "Someone";
    await sendToUser(userId, "New Follower", `${name} started following you`, {
      type: "follower", followerId,
    });
  }
);

// ─── Group Notifications ────────────────────────────────

exports.onGroupMemberAdded = onDocumentCreated(
  "users/{userId}/groups/{groupId}",
  async (event) => {
    const { userId, groupId } = event.params;
    const membership = event.data.data();
    if (!membership || membership.role === "host") return;

    const addedBy = membership.addedBy;
    const groupDoc = await db.collection("groups").doc(groupId).get();
    if (!groupDoc.exists) return;
    const group = groupDoc.data();
    const groupTitle = group.title || "a group";
    const venueName = group.venueName || "";

    if (addedBy && addedBy !== userId) {
      // Invited: notify the invitee
      const inviterDoc = await db.collection("users").doc(addedBy).get();
      const inviterName = inviterDoc.data()?.displayName || "Someone";
      await sendToUser(userId, "Group Invite",
        `${inviterName} invited you to "${groupTitle}" at ${venueName}`,
        { type: "group_invite", groupId });
    } else {
      // Self-joined: notify the host
      const joinerDoc = await db.collection("users").doc(userId).get();
      const joinerName = joinerDoc.data()?.displayName || "Someone";
      await sendToUser(group.hostId, "New Group Member",
        `${joinerName} joined your group "${groupTitle}"`,
        { type: "group_join", groupId });
    }
  }
);

exports.onGroupInvite = onDocumentCreated(
  "users/{userId}/groupInvites/{groupId}",
  async (event) => {
    const { userId, groupId } = event.params;
    const invite = event.data.data();
    if (!invite) return;
    const inviterId = invite.inviterId;
    const groupDoc = await db.collection("groups").doc(groupId).get();
    if (!groupDoc.exists) return;
    const group = groupDoc.data();
    const inviterDoc = await db.collection("users").doc(inviterId).get();
    const inviterName = inviterDoc.data()?.displayName || "Someone";
    // Push notification only (activity written client-side)
    await sendToUser(userId, "Group Invite",
      `${inviterName} invited you to "${group.title || "a group"}" at ${group.venueName || ""}`,
      { type: "group_invite", groupId });
  }
);

exports.onGroupUpdated = onDocumentUpdated("groups/{groupId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!before || !after) return;
  // Only notify on detail changes by host, not on member joins
  const changed = before.title !== after.title || before.dateLocal !== after.dateLocal ||
    before.time !== after.time || before.meetingSpot !== after.meetingSpot;
  if (!changed) return;
  const hostName = after.hostDisplayName || "Host";
  const memberIds = after.memberIds || [];
  for (const uid of memberIds) {
    if (uid === after.hostId) continue;
    await sendToUser(uid, "Group Updated",
      `${hostName} updated "${after.title || "the group"}"`,
      { type: "group_updated", groupId: event.params.groupId });
  }
});

// Notify host when someone declines a group invite
exports.onGroupInviteDeclined = onDocumentUpdated("groups/{groupId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;
  const prevInvites = before.pendingInvites || [];
  const currInvites = after.pendingInvites || [];
  if (currInvites.length >= prevInvites.length) return; // not a decline
  // Also skip if they joined (memberIds grew)
  if ((after.memberIds || []).length > (before.memberIds || []).length) return;
  const declined = prevInvites.filter(id => !currInvites.includes(id) && !(after.memberIds || []).includes(id));
  for (const uid of declined) {
    const userDoc = await db.collection("users").doc(uid).get();
    const name = userDoc.data()?.displayName || "Someone";
    await sendToUser(after.hostId, "Invite Declined",
      `${name} declined the invite to "${after.title || "your group"}"`,
      { type: "group_invite_declined", groupId: event.params.groupId });
  }
});

exports.onGroupMessage = onDocumentCreated(
  "groups/{groupId}/messages/{messageId}",
  async (event) => {
    const { groupId } = event.params;
    const msg = event.data.data();
    if (!msg || !msg.text || !msg.text.startsWith("📢")) return;
    const senderId = msg.userId;
    const groupDoc = await db.collection("groups").doc(groupId).get();
    if (!groupDoc.exists) return;
    const group = groupDoc.data();
    const memberIds = group.memberIds || [];
    const senderName = msg.displayName || "Host";
    const body = msg.text.replace("📢 ", "");
    for (const uid of memberIds) {
      if (uid === senderId) continue;
      await sendToUser(uid, `Update: ${group.title || "Group"}`,
        `${senderName}: ${body}`, { type: "group_blast", groupId });
    }
  }
);

exports.onGroupPhotoAdded = onDocumentCreated(
  "groups/{groupId}/photos/{photoId}",
  async (event) => {
    const { groupId } = event.params;
    const photo = event.data.data();
    if (!photo) return;
    const uploaderId = photo.uploadedBy;
    const uploaderName = photo.displayName || "Someone";
    // Debounce: skip if a photo was added by same user in last 30s
    const recent = await db.collection("groups").doc(groupId).collection("photos")
      .where("uploadedBy", "==", uploaderId)
      .where("createdAt", ">", (photo.createdAt || 0) - 30)
      .where("createdAt", "<", photo.createdAt || 0)
      .limit(1).get();
    if (!recent.empty) return; // already notified for this batch
    const groupDoc = await db.collection("groups").doc(groupId).get();
    if (!groupDoc.exists) return;
    const group = groupDoc.data();
    const memberIds = group.memberIds || [];
    for (const uid of memberIds) {
      if (uid === uploaderId) continue;
      await sendToUser(uid, "New Group Photos",
        `${uploaderName} added photos to "${group.title || "the group"}"`,
        { type: "group_photo", groupId });
    }
  }
);

exports.onNewTour = onDocumentCreated("tours/{tourId}", async (event) => {
  const tour = event.data.data();
  if (!tour.museumId) return;
  const savedSnap = await db.collectionGroup("savedMuseums").where("museumId", "==", tour.museumId).get();
  const notified = new Set();
  for (const doc of savedSnap.docs) {
    const uid = doc.ref.parent.parent.id;
    if (notified.has(uid)) continue;
    notified.add(uid);
    await sendToUser(uid, "New Tour", `"${tour.title}" is now available`, {
      type: "tour", tourId: event.params.tourId,
    });
  }
});

exports.exhibitExpiringSoon = onSchedule("every day 09:00", async () => {
  const now = Date.now() / 1000;
  const threeDays = now + 3 * 86400;
  const today = new Date().toISOString().slice(0, 10);
  const threeDaysLocal = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);

  // Query exhibits using local dates when available, fall back to timestamps
  const [localSnap, tsSnap] = await Promise.all([
    db.collection("exhibits").where("endDateLocal", ">=", today).where("endDateLocal", "<=", threeDaysLocal).get(),
    db.collection("exhibits").where("endDate", ">", now).where("endDate", "<", threeDays).get(),
  ]);
  const seen = new Set();
  const exhibits = [];
  for (const s of [localSnap, tsSnap]) {
    for (const d of s.docs) {
      if (!seen.has(d.id)) { seen.add(d.id); exhibits.push(d); }
    }
  }
  if (exhibits.length === 0) return;

  for (const exhibit of exhibits) {
    const { title, venueId, venueType } = exhibit.data();
    const exhibitTitle = title || "An exhibit";

    // Find users who enabled notifications for this venue
    const notifySnap = await db.collectionGroup("venueNotifications")
      .where("venueId", "==", venueId).where("enabled", "==", true).get();

    const notifiedUids = new Set();
    for (const doc of notifySnap.docs) {
      const uid = doc.ref.parent.parent.id;
      if (notifiedUids.has(uid)) continue;
      notifiedUids.add(uid);
      await sendToUser(uid, "Ending Soon", `"${exhibitTitle}" is closing in a few days`, {
        type: "exhibit", exhibitId: exhibit.id,
      });
    }
  }
});

// ─── Image pipeline ─────────────────────────────────────

// Thumbnail sizes: small for lists, medium for detail views
const THUMB_SIZES = [
  { suffix: "_200x200", width: 200, height: 200, fit: "cover" },
  { suffix: "_800x800", width: 800, height: 800, fit: "inside" },
];

// Generate thumbnails for any image uploaded to user-content paths
exports.generateThumbnails = onObjectFinalized(
  { memory: "512MiB" },
  async (event) => {
    const filePath = event.data.name;
    const contentType = event.data.contentType || "";

    // Only process images in user-content directories
    if (!contentType.startsWith("image/")) return;
    const userPaths = ["reviewPhotos/", "userUploads/", "profilePhotos/"];
    if (!userPaths.some(p => filePath.startsWith(p))) return;

    // Skip if this is already a thumbnail
    if (filePath.includes("_thumb/")) return;

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const file = bucket.file(filePath);

    const [buffer] = await file.download();

    await Promise.all(THUMB_SIZES.map(async ({ suffix, width, height, fit }) => {
      const thumbBuffer = await sharp(buffer)
        .resize(width, height, { fit, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      const thumbPath = `${dir}_thumb/${base}${suffix}.jpg`;
      const thumbFile = bucket.file(thumbPath);
      await thumbFile.save(thumbBuffer, { metadata: { contentType: "image/jpeg" } });
      await thumbFile.makePublic();
    }));
  }
);

// Cache an external image into Firebase Storage (callable by admin/scripts)
exports.cacheExternalImage = onCall({ invoker: "public" }, async (request) => {
  const { url, storagePath } = request.data;
  if (!url || !storagePath) throw new HttpsError("invalid-argument", "url and storagePath required");

  // Fetch the external image
  const response = await fetch(url);
  if (!response.ok) throw new HttpsError("not-found", `Failed to fetch: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Optimize and save
  const optimized = await sharp(buffer)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const file = bucket.file(storagePath);
  await file.save(optimized, { metadata: { contentType: "image/jpeg" } });
  await file.makePublic();

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  return { publicUrl };
});

// Nightly job: check for exhibits/museums/galleries with external imageUrls and cache them
exports.cacheVenueImages = onSchedule("every day 03:00", async () => {
  const collections = ["museums", "galleries"];
  for (const col of collections) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      const { imageUrl } = doc.data();
      if (!imageUrl || imageUrl.includes(bucket.name)) continue; // already cached or empty

      try {
        const storagePath = `cachedImages/${col}/${doc.id}.jpg`;
        const response = await fetch(imageUrl);
        if (!response.ok) continue;

        const arrayBuffer = await response.arrayBuffer();
        const optimized = await sharp(Buffer.from(arrayBuffer))
          .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        const file = bucket.file(storagePath);
        await file.save(optimized, { metadata: { contentType: "image/jpeg" } });
        await file.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        await db.collection(col).doc(doc.id).update({ imageUrl: publicUrl });
      } catch (e) {
        console.error(`Failed to cache image for ${col}/${doc.id}:`, e.message);
      }
    }
  }
});

// ─── DCP Application ────────────────────────────────────

const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const functionsV1 = require("firebase-functions/v1");

exports.submitDCPApplication = functionsV1.runWith({
  secrets: ["SMTP_PASS", "DCP_SHEET_ID"],
}).https.onCall(async (data) => {
  const { name, email, username, city, favoriteMuseums = '', experience = '', socialLinks = '', whyJoin, howHeard = '' } = data;
  if (!name || !email || !username || !city || !whyJoin) {
    throw new functionsV1.https.HttpsError("invalid-argument", "Missing required fields");
  }

  const deadline = new Date("2026-05-06T23:59:59-07:00").getTime();
  if (Date.now() > deadline) {
    throw new functionsV1.https.HttpsError("failed-precondition", "Applications are closed");
  }

  const timestamp = new Date().toISOString();

  // 1. Save to Firestore
  await db.collection("dcpApplications").add({
    name, email, username, city, favoriteMuseums, experience, socialLinks, whyJoin, howHeard,
    status: "pending", createdAt: timestamp,
  });

  // 2. Append to Google Sheet
  try {
    const sheetsAuth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth: await sheetsAuth.getClient() });
    await sheets.spreadsheets.values.append({
      spreadsheetId: (process.env.DCP_SHEET_ID || '').trim(),
      range: "Applications!A:J",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[timestamp, name, email, username, city, favoriteMuseums, experience, socialLinks, whyJoin, howHeard]],
      },
    });
  } catch (e) {
    console.error("Sheets append failed:", e.message);
  }

  // 3. Send confirmation email
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "contact@docentofficial.com", pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: '"Docent" <contact@docentofficial.com>',
      to: email,
      subject: "We received your Docent Curators Program application",
      text: `Hi ${name},\n\nThank you for applying to the Docent Curators Program. We've received your application and will review it carefully.\n\nResults will be shared by May 20, 2026. If you're selected, you'll receive onboarding instructions by email.\n\nIn the meantime, keep exploring — and feel free to reach out if you have any questions.\n\nBest,\nThe Docent Team\ncontact@docentofficial.com`,
      html: `<div style="font-family: Georgia, serif; max-width: 560px; color: #3D3833; line-height: 1.7;">
        <p>Hi ${name},</p>
        <p>Thank you for applying to the <strong>Docent Curators Program</strong>. We've received your application and will review it carefully.</p>
        <p>Results will be shared by <strong>May 20, 2026</strong>. If you're selected, you'll receive onboarding instructions by email.</p>
        <p>In the meantime, keep exploring — and feel free to reach out if you have any questions.</p>
        <p style="margin-top: 32px;">Best,<br/>The Docent Team<br/><a href="mailto:contact@docentofficial.com" style="color: #A0522D;">contact@docentofficial.com</a></p>
      </div>`,
    });
  } catch (e) {
    console.error("Email send failed:", e.message);
  }

  return { success: true };
});

// ── Submit Tour (DCP) ──
exports.submitTourDraft = functionsV1.runWith({
  secrets: ["DCP_SHEET_ID"],
}).https.onCall(async (data) => {
  const { username, tourTitle, museum, city, theme, stops } = data;
  if (!username || !tourTitle || !museum) throw new functionsV1.https.HttpsError("invalid-argument", "Missing required fields");
  const timestamp = new Date().toISOString();
  await db.collection("tourSubmissions").add({ ...data, submittedAt: timestamp });
  try {
    const sheetsAuth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth: await sheetsAuth.getClient() });
    await sheets.spreadsheets.values.append({
      spreadsheetId: (process.env.DCP_SHEET_ID || '').trim(),
      range: "Tour Submissions!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[timestamp, username, tourTitle, museum, city || '', theme || '', (stops || []).length]] },
    });
  } catch (e) { console.error("Sheets append failed:", e.message); }
  return { success: true };
});

// ── Submit Reimbursement (DCP) ──
exports.submitReimbursement = functionsV1.runWith({
  secrets: ["DCP_SHEET_ID"],
}).https.onCall(async (data) => {
  const { username, paymentMethod, paymentHandle, museumReceipt, transportReceipt, reviewLink, notes } = data;
  if (!username || !paymentMethod || !paymentHandle) throw new functionsV1.https.HttpsError("invalid-argument", "Missing required fields");
  const timestamp = new Date().toISOString();
  await db.collection("dcpReimbursements").add({ ...data, status: "pending", createdAt: timestamp });
  try {
    const sheetsAuth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth: await sheetsAuth.getClient() });
    await sheets.spreadsheets.values.append({
      spreadsheetId: (process.env.DCP_SHEET_ID || '').trim(),
      range: "Reimbursements!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[timestamp, username, paymentMethod, paymentHandle, museumReceipt || '', transportReceipt || '', reviewLink || '', notes || '']] },
    });
  } catch (e) { console.error("Sheets append failed:", e.message); }
  return { success: true };
});

// ── Submit Feedback (DCP) ──
exports.submitFeedback = functionsV1.runWith({
  secrets: ["DCP_SHEET_ID"],
}).https.onCall(async (data) => {
  const { username, type, message, venue } = data;
  if (!username || !message) throw new functionsV1.https.HttpsError("invalid-argument", "Missing required fields");
  const timestamp = new Date().toISOString();
  await db.collection("dcpFeedback").add({ username, type, message, venue: venue || '', createdAt: timestamp });
  try {
    const sheetsAuth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    const sheets = google.sheets({ version: "v4", auth: await sheetsAuth.getClient() });
    await sheets.spreadsheets.values.append({
      spreadsheetId: (process.env.DCP_SHEET_ID || '').trim(),
      range: "Feedback!A:E",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[timestamp, username, type, venue || '', message]] },
    });
  } catch (e) { console.error("Sheets append failed:", e.message); }
  return { success: true };
});


// ─── Friend Activity Digest (every other day, alternating 8am/5pm PT) ───

async function sendFriendDigest() {
  const twoDaysAgo = Date.now() / 1000 - 86400;
  const usersSnap = await db.collection("users").where("fcmToken", "!=", "").get();

  for (const userDoc of usersSnap.docs) {
    try {
      const uid = userDoc.id;
      const token = userDoc.data().fcmToken;
      if (!token) continue;

      // Get who this user follows
      const followingSnap = await db.collection("users").doc(uid).collection("following").get();
      const followingIds = followingSnap.docs.map(d => d.id);
      if (followingIds.length === 0) continue;

      // Find recent reviews from followed users (batch in chunks of 30)
      const recentNames = new Set();
      for (let i = 0; i < followingIds.length; i += 30) {
        const batch = followingIds.slice(i, i + 30);
        const revSnap = await db.collection("reviews")
          .where("userId", "in", batch)
          .where("createdAt", ">", twoDaysAgo)
          .limit(10)
          .get();
        revSnap.docs.forEach(d => recentNames.add(d.data().displayName));
      }

      if (recentNames.size === 0) continue;

      const names = [...recentNames];
      let body;
      if (names.length === 1) body = `${names[0]} posted a new review`;
      else if (names.length === 2) body = `${names[0]} and ${names[1]} posted new reviews`;
      else body = `${names[0]}, ${names[1]}, and ${names.length - 2} other${names.length - 2 > 1 ? "s" : ""} posted new reviews`;

      await getMessaging().send({
        token,
        notification: { title: "Friends Activity", body },
        data: { type: "friend_digest" },
        apns: { payload: { aps: { sound: "default" } } },
      }).catch(() => {});
    } catch (e) {
      console.error(`Digest failed for ${userDoc.id}:`, e.message);
    }
  }
}

// Morning digest: every other day at 8am PT (Mon/Wed/Fri/Sun)
exports.friendDigestMorning = onSchedule("0 8 * * 0,1,3,5", async () => {
  await sendFriendDigest();
});

// Evening digest: every other day at 5pm PT (Tue/Thu/Sat)
exports.friendDigestEvening = onSchedule("0 17 * * 2,4,6", async () => {
  await sendFriendDigest();
});

// ─── Agent Tasks (Admin Portal) ─────────────────────────

exports.manageTask = onCall(async (request) => {
  const { action, taskId, data } = request.data;
  const col = db.collection("agentTasks");

  switch (action) {
    case "create": {
      const id = taskId || db.collection("agentTasks").doc().id;
      await col.doc(id).set({ ...data, id, createdAt: Math.floor(Date.now() / 1000) });
      return { id };
    }
    case "update": {
      if (!taskId) throw new HttpsError("invalid-argument", "taskId required");
      await col.doc(taskId).update(data);
      return { ok: true };
    }
    case "delete": {
      if (!taskId) throw new HttpsError("invalid-argument", "taskId required");
      await col.doc(taskId).delete();
      return { ok: true };
    }
    case "list": {
      const snap = await col.orderBy("createdAt", "desc").limit(50).get();
      return { tasks: snap.docs.map(d => d.data()) };
    }
    default:
      throw new HttpsError("invalid-argument", "Unknown action: " + action);
  }
});

// ─── Exhibit Research Tool (Weekly) ──────────────────────

const { researchVenueExhibits } = require("./exhibit-scraper");
const { runVenueAudit, runExhibitDateCheck, publishDraft, queueScrapeDraft } = require("./data-pipeline");

// Venue configs — exhibition listing URLs and link selectors
const VENUE_CONFIGS = {
  "sfmoma": { listUrl: "https://www.sfmoma.org/exhibitions/", linkSelector: "a[href*='/exhibition/']" },
  "denver-art-museum": { listUrl: "https://www.denverartmuseum.org/en/exhibitions", linkSelector: "a[href*='/en/exhibitions/']" },
  "the-met": { listUrl: "https://www.metmuseum.org/exhibitions/current-exhibitions", linkSelector: "a[href*='/exhibitions/']" },
  "moma": { listUrl: "https://www.moma.org/calendar/exhibitions/current", linkSelector: "a[href*='/calendar/exhibitions/']" },
  "guggenheim-nyc": { listUrl: "https://www.guggenheim.org/exhibitions", linkSelector: "a[href*='/exhibition/']" },
  "brooklyn-museum": { listUrl: "https://www.brooklynmuseum.org/exhibitions", linkSelector: "a[href*='/exhibitions/']" },
};

/**
 * Research exhibits for a single venue using Puppeteer.
 * Deep-reads each page, assesses quality, queues ALL for manual review.
 * Never writes directly to exhibits collection.
 */
exports.scrapeExhibits = onCall({ memory: "1GiB", timeoutSeconds: 300 }, async (request) => {
  const { venueId } = request.data;
  const config = VENUE_CONFIGS[venueId];
  if (!config) throw new HttpsError("invalid-argument", `No config for: ${venueId}. Available: ${Object.keys(VENUE_CONFIGS).join(", ")}`);

  let browser;
  try {
    const chromium = require("@sparticuz/chromium");
    const puppeteer = require("puppeteer-core");
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");

    // Step 1: Get exhibit URLs from listing page
    await page.goto(config.listUrl, { waitUntil: "networkidle2", timeout: 30000 });
    const exhibitUrls = await page.$$eval(config.linkSelector, (els, base) =>
      [...new Set(els.map(el => new URL(el.href, base).href).filter(u => !u.includes("#") && !u.includes("past")))],
      config.listUrl
    );
    console.log(`Found ${exhibitUrls.length} exhibit URLs for ${venueId}`);

    // Step 2: Deep-read each page (cap at 15)
    const results = await researchVenueExhibits(venueId, exhibitUrls.slice(0, 15), page);
    console.log(`Research results for ${venueId}:`, results);
    return results;
  } finally {
    if (browser) await browser.close();
  }
});

/**
 * Weekly research run — checks all configured venues for new exhibits.
 * Queues findings for manual review. Runs Monday 6am PT.
 */
exports.weeklyExhibitScrape = onSchedule({ schedule: "0 6 * * 1", memory: "1GiB", timeoutSeconds: 540 }, async () => {
  const chromium = require("@sparticuz/chromium");
  const puppeteer = require("puppeteer-core");
  const allResults = {};

  for (const [venueId, config] of Object.entries(VENUE_CONFIGS)) {
    let browser;
    try {
      browser = await puppeteer.launch({
        args: chromium.args, defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(), headless: chromium.headless,
      });
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36");
      await page.goto(config.listUrl, { waitUntil: "networkidle2", timeout: 30000 });
      const urls = await page.$$eval(config.linkSelector, (els, base) =>
        [...new Set(els.map(el => new URL(el.href, base).href).filter(u => !u.includes("#")))], config.listUrl
      );
      allResults[venueId] = await researchVenueExhibits(venueId, urls.slice(0, 15), page);
    } catch (e) {
      allResults[venueId] = { error: e.message };
    } finally {
      if (browser) await browser.close();
    }
  }

  await db.collection("agentTasks").add({
    title: "Weekly Exhibit Research Results",
    agent: "qa",
    status: "done",
    createdAt: Math.floor(Date.now() / 1000),
    completedAt: Math.floor(Date.now() / 1000),
    result: JSON.stringify(allResults, null, 2),
  });
});

// ─── Postcard Email Delivery ────────────────────────────

// ─── Weekly Venue & Exhibit Audit ───────────────────────

// ─── Nightly Exhibit Lifecycle ──────────────────────────
// Transitions exhibits between "upcoming" → "current" → "past" based on dates.
// Runs every day at 2am PT. Status is computed, not manually set.

exports.exhibitLifecycle = onSchedule({ schedule: "0 2 * * *", timeoutSeconds: 300 }, async () => {
  const today = new Date().toISOString().slice(0, 10);
  const snap = await db.collection("exhibits").get();
  let transitions = { toUpcoming: 0, toCurrent: 0, toPast: 0, noChange: 0 };

  for (const doc of snap.docs) {
    const d = doc.data();
    let startLocal = d.startDateLocal || null;
    let endLocal = d.endDateLocal || null;
    if (!startLocal && typeof d.startDate === "number" && isFinite(d.startDate) && d.startDate > 0) {
      try { startLocal = new Date(d.startDate * 1000).toISOString().slice(0, 10); } catch (e) {}
    }
    if (!endLocal && typeof d.endDate === "number" && isFinite(d.endDate) && d.endDate > 0) {
      try { endLocal = new Date(d.endDate * 1000).toISOString().slice(0, 10); } catch (e) {}
    }
    if (startLocal === "") startLocal = null;
    if (endLocal === "") endLocal = null;

    let newStatus;
    if (!startLocal && !endLocal) {
      newStatus = "current"; // Permanent/undated
    } else if (startLocal && startLocal > today) {
      newStatus = "upcoming";
    } else if (endLocal && endLocal < today) {
      newStatus = "past";
    } else {
      newStatus = "current";
    }

    if (d.status !== newStatus) {
      await doc.ref.update({ status: newStatus, statusUpdatedAt: Math.floor(Date.now() / 1000) });
      if (newStatus === "upcoming") transitions.toUpcoming++;
      else if (newStatus === "current") transitions.toCurrent++;
      else if (newStatus === "past") transitions.toPast++;
    } else {
      transitions.noChange++;
    }
  }

  console.log("Exhibit lifecycle transitions:", transitions);
});

exports.weeklyVenueAudit = onSchedule({ schedule: "0 7 * * 1", timeoutSeconds: 540 }, async () => {
  const results = await runVenueAudit();
  console.log("Weekly venue audit complete:", results);
});

// Weekly exhibit date verification — runs Mondays 8am PT (after venue audit).
// Fetches each current/upcoming exhibit URL and compares dates shown on the
// live page with what's stored in Firestore. Mismatches get written to
// /venueAuditFlags with severity "high".
exports.weeklyExhibitDateCheck = onSchedule({
  schedule: "0 8 * * 1",
  timeZone: "America/Los_Angeles",
  timeoutSeconds: 540,
  memory: "512MiB",
}, async () => {
  const results = await runExhibitDateCheck();
  console.log("Weekly exhibit date check complete:", {
    checked: results.checked,
    mismatched: results.mismatched,
    skipped: results.skipped,
  });
  if (results.mismatches.length > 0) {
    console.log("Mismatches:", results.mismatches);
  }
});

// Admin callable — trigger the date check on demand
exports.runExhibitDateCheckNow = onCall({
  invoker: "public",
  timeoutSeconds: 540,
  memory: "512MiB",
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
  const ADMIN_UIDS = (process.env.ADMIN_UIDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  const isAdmin = ADMIN_UIDS.includes(request.auth.uid) || userDoc.data()?.isAdmin === true;
  if (!isAdmin) throw new HttpsError("permission-denied", "Admin only");

  return await runExhibitDateCheck();
});

// ─── Batch Update Tool ──────────────────────────────────

exports.batchUpdateDocs = onCall({ invoker: "public" }, async (request) => {
  const { collection, where: filters, updates } = request.data;
  if (!collection || !updates || typeof updates !== "object") {
    throw new HttpsError("invalid-argument", "collection and updates required");
  }

  let query = db.collection(collection);
  if (filters && Array.isArray(filters)) {
    for (const f of filters) {
      query = query.where(f.field, f.op || "==", f.value);
    }
  }

  const snap = await query.get();
  if (snap.empty) return { updated: 0, ids: [] };

  const ids = [];
  const batches = [];
  let batch = db.batch();
  let count = 0;

  for (const doc of snap.docs) {
    batch.update(doc.ref, updates);
    ids.push(doc.id);
    count++;
    if (count % 500 === 0) {
      batches.push(batch);
      batch = db.batch();
    }
  }
  batches.push(batch);

  for (const b of batches) {
    await b.commit();
  }

  return { updated: ids.length, ids };
});

exports.sendPostcardEmail = onDocumentCreated({
  document: "postcards/{postcardId}",
  secrets: ["SMTP_PASS"],
}, async (event) => {
  const data = event.data?.data();
  if (!data) return;

  // Resolve recipient email
  let toEmail = data.recipientEmail;
  if (!toEmail && data.recipientUserId) {
    const userDoc = await db.collection("users").doc(data.recipientUserId).get();
    toEmail = userDoc.data()?.email;
  }
  if (!toEmail) return;

  const url = `https://docentofficial.com/postcard/${data.slug}`;
  const from = data.senderName || "Someone";
  const venue = data.venueName ? ` from ${data.venueName}` : "";

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: "contact@docentofficial.com", pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: '"Docent" <contact@docentofficial.com>',
    to: toEmail,
    subject: `${from} sent you a postcard${venue}`,
    text: `${from} sent you a digital postcard${venue}.\n\nView it here: ${url}\n\nDocent — a museum and gallery guide\nhttps://docentofficial.com`,
    html: `<div style="font-family: Georgia, serif; max-width: 520px; color: #3D3833; line-height: 1.7; padding: 32px 0;">
      ${data.imageUrl ? `<img src="${data.imageUrl}" alt="" style="width: 100%; max-width: 520px; display: block; margin-bottom: 24px;" />` : ""}
      <p style="font-size: 18px; margin: 0 0 8px;">${from} sent you a postcard${venue}.</p>
      <p style="margin: 24px 0;"><a href="${url}" style="display: inline-block; padding: 10px 24px; background: #3A3838; color: #F9F8F6; text-decoration: none; font-family: sans-serif; font-size: 14px;">View Postcard</a></p>
      <p style="font-size: 13px; color: #8A847B; margin-top: 32px;">Docent — a museum and gallery guide<br/><a href="https://docentofficial.com" style="color: #8A847B;">docentofficial.com</a></p>
    </div>`,
  });
});

// ─── User Report → Agent Processing ─────────────────────
// When a user submits a report via the app, we just mark it ready for triage.
// The Docent Agent (deployed on AWS with Bedrock Claude access) picks these up
// and writes structured edit proposals to /reportTriage for manual review.
// Processing happens in the agent, not here — single source of LLM access.

exports.onUserReport = onDocumentCreated("reports/{reportId}", async (event) => {
  const report = event.data?.data();
  const reportId = event.params.reportId;
  if (!report) return;

  // Stamp the report with processing metadata. Agent queries for
  // `triageStatus: "pending"` to find work to do.
  await event.data.ref.update({
    triageStatus: "pending",
    receivedAt: Math.floor(Date.now() / 1000),
  });

  console.log(`Report ${reportId} received and queued for agent triage`);
});

// ─── Publish Draft (manual signoff) ─────────────────────
// Admin-only callable to apply an approved draft to production.
// Takes { draftType, draftId, edits? } and writes the final doc.
// Validates the caller is an admin via custom claim or allowlist.

exports.publishDraft = onCall({ invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");

  // Simple admin check — extend to custom claims once we have a proper admin role
  const ADMIN_UIDS = (process.env.ADMIN_UIDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const uid = request.auth.uid;
  const userDoc = await db.collection("users").doc(uid).get();
  const isAdmin = ADMIN_UIDS.includes(uid) || userDoc.data()?.isAdmin === true;
  if (!isAdmin) throw new HttpsError("permission-denied", "Admin only");

  const { draftType, draftId, edits } = request.data;
  if (!draftType || !draftId) throw new HttpsError("invalid-argument", "draftType and draftId required");

  try {
    const result = await publishDraft(draftType, draftId, { edits });
    return result;
  } catch (e) {
    throw new HttpsError("internal", e.message);
  }
});

// ─── Ad-hoc Draft Creation (for admin tooling) ──────────
// Allows the admin portal to manually create a scrape draft for review
// (e.g. "add this exhibit" from a user tip without needing to scrape).

exports.createScrapeDraft = onCall({ invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required");
  const ADMIN_UIDS = (process.env.ADMIN_UIDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  const isAdmin = ADMIN_UIDS.includes(request.auth.uid) || userDoc.data()?.isAdmin === true;
  if (!isAdmin) throw new HttpsError("permission-denied", "Admin only");

  try {
    return await queueScrapeDraft({ ...request.data, source: "manual-admin" });
  } catch (e) {
    throw new HttpsError("invalid-argument", e.message);
  }
});

// ─── Review Queue Digest (for admin dashboard) ──────────
// Returns counts + recent items across all three review queues so the dashboard
// can render a single-pane-of-glass view. Public callable — data is aggregate
// and summarized; no PII or full report text.

exports.getReviewQueueDigest = onCall({ invoker: "public" }, async (request) => {
  const now = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - 7 * 86400;

  // Counts
  const [
    pendingReportsSnap, pendingScrapeSnap, openFlagsSnap, pendingTriageSnap,
  ] = await Promise.all([
    db.collection("reports").where("triageStatus", "==", "pending").get(),
    db.collection("scrapeDrafts").where("status", "==", "pending").get(),
    db.collection("venueAuditFlags").where("status", "==", "open").get(),
    db.collection("reportTriage").where("status", "==", "pending").get(),
  ]);

  // Recent activity — last 7 days
  const [recentScrapeSnap, recentFlagsSnap, recentTriageSnap] = await Promise.all([
    db.collection("scrapeDrafts")
      .where("createdAt", ">=", sevenDaysAgo)
      .orderBy("createdAt", "desc")
      .limit(10).get(),
    db.collection("venueAuditFlags")
      .where("createdAt", ">=", sevenDaysAgo)
      .orderBy("createdAt", "desc")
      .limit(15).get(),
    db.collection("reportTriage")
      .where("createdAt", ">=", sevenDaysAgo)
      .orderBy("createdAt", "desc")
      .limit(10).get(),
  ]);

  // Severity breakdown for open audit flags
  const severityCounts = { high: 0, medium: 0, low: 0 };
  openFlagsSnap.docs.forEach(d => {
    const sev = d.data().severity || "low";
    if (severityCounts[sev] !== undefined) severityCounts[sev]++;
  });

  // Flag type breakdown (most common issues)
  const flagTypeCounts = {};
  openFlagsSnap.docs.forEach(d => {
    (d.data().flags || []).forEach(f => {
      flagTypeCounts[f] = (flagTypeCounts[f] || 0) + 1;
    });
  });

  return {
    counts: {
      pendingReports: pendingReportsSnap.size,
      pendingScrapeDrafts: pendingScrapeSnap.size,
      openAuditFlags: openFlagsSnap.size,
      pendingTriage: pendingTriageSnap.size,
    },
    severityBreakdown: severityCounts,
    topFlagTypes: Object.entries(flagTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([flag, count]) => ({ flag, count })),
    recentScrapeDrafts: recentScrapeSnap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title,
        venueId: data.venueId,
        quality: data.quality,
        proposedAction: data.proposedAction,
        createdAt: data.createdAt,
      };
    }),
    recentAuditFlags: recentFlagsSnap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        type: data.type,
        venueName: data.venueName || data.exhibitTitle || "",
        venueId: data.venueId || data.exhibitId || "",
        flags: data.flags || [],
        severity: data.severity,
        createdAt: data.createdAt,
      };
    }),
    recentTriage: recentTriageSnap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        targetType: data.targetType,
        targetName: data.targetName,
        category: data.category,
        confidence: data.llmConfidence,
        hasProposal: Object.keys(data.proposedEdits || {}).length > 0,
        createdAt: data.createdAt,
      };
    }),
    generatedAt: now,
  };
});

// ─── Curator Approval — Welcome Email ───────────────────
// Fires when a user doc is updated with role: "curator".
// Sends a welcome email to the new curator.

exports.onCuratorApproved = onDocumentUpdated("users/{userId}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  // Only fire when role changes TO "curator"
  const wasCurator = before.role === "curator" || before.isCurator === true;
  const isCurator = after.role === "curator";
  if (wasCurator || !isCurator) return;

  const userId = event.params.userId;
  const email = after.email;
  const name = after.displayName || "there";

  console.log(`Curator approved: ${userId} (${name})`);

  // Send welcome email if we have an email address
  if (email) {
    try {
      const smtpPass = process.env.SMTP_PASS || "";
      if (!smtpPass) { console.warn("SMTP_PASS not set, skipping welcome email"); return; }
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: "contact@docentofficial.com", pass: smtpPass },
      });
      await transporter.sendMail({
        from: '"Docent" <contact@docentofficial.com>',
        to: email,
        subject: "Welcome to Docent Curators",
        text: `Hi ${name},\n\nWelcome to Docent Curators. You now have access to create and publish tours on Docent.\n\nA few things to know:\n- Your Curator badge is now live on your profile\n- You can start creating tours from the app\n- Your first tour should be free — after that, you can set your own pricing\n\nWe're excited to see what you create.\n\n— Sky, Docent`,
        html: `<p>Hi ${name},</p><p>Welcome to Docent Curators. You now have access to create and publish tours on Docent.</p><p>A few things to know:</p><ul><li>Your <strong>Curator badge</strong> is now live on your profile</li><li>You can start creating tours from the app</li><li>Your first tour should be free — after that, you can set your own pricing</li></ul><p>We're excited to see what you create.</p><p>— Sky, Docent</p>`,
      });
      console.log(`Welcome email sent to ${email}`);
    } catch (e) {
      console.error("Failed to send curator welcome email:", e);
    }
  }
});


// ─── Review Queue HTTP Endpoints (Cognito-authed) ───────
// See review-queue-http.js. These are HTTP functions (not callables)
// so the admin dashboard (Cognito auth) can call them with a Bearer token.
const reviewQueueHttp = require("./review-queue-http");
exports.listScrapeDrafts = reviewQueueHttp.listScrapeDrafts;
exports.listAuditFlags = reviewQueueHttp.listAuditFlags;
exports.approveScrapeDraft = reviewQueueHttp.approveScrapeDraft;
exports.rejectScrapeDraft = reviewQueueHttp.rejectScrapeDraft;
exports.bulkApproveScrapeDrafts = reviewQueueHttp.bulkApproveScrapeDrafts;
