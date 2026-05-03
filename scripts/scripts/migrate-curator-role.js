// Migration: isCurator (boolean) → role: "curator"
// Run once: node scripts/migrate-curator-role.js

const admin = require("firebase-admin");
const serviceAccount = require("../docent-seed/serviceAccountKey.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function migrate() {
  const snap = await db.collection("users").where("isCurator", "==", true).get();
  console.log(`Found ${snap.size} users with isCurator=true`);

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.role === "curator") {
      console.log(`  ${doc.id} (${data.displayName}) — already migrated, skipping`);
      continue;
    }
    const targetRole = doc.id === "Y4GgWYr3pzcmsK8LcAutDc4jhOr2" ? "admin" : "curator";
    await doc.ref.update({
      role: targetRole,
      curatorSince: data.createdAt || Math.floor(Date.now() / 1000),
      curatorApprovedBy: "manual",
    });
    console.log(`  ${doc.id} (${data.displayName}) — migrated to role: "${targetRole}"`);
  }

  // Set role: "user" on all users without a role (backfill)
  const noRole = await db.collection("users").where("role", "==", null).get();
  // Firestore can't query for missing fields, so we check all users
  const all = await db.collection("users").get();
  let backfilled = 0;
  const batch = db.batch();
  for (const doc of all.docs) {
    if (!doc.data().role) {
      batch.update(doc.ref, { role: "user" });
      backfilled++;
    }
  }
  if (backfilled > 0) {
    await batch.commit();
    console.log(`Backfilled role: "user" on ${backfilled} users`);
  }

  console.log("Done.");
  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
