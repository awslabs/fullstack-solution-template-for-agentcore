// One-off script to compute and stamp status on all existing exhibits
// Run once: cp this to functions/ and run from there (needs firebase-admin)
// After this, the weekly `exhibitLifecycle` Cloud Function takes over.

const admin = require("firebase-admin");
const serviceAccount = require("../Docent/Docent/service-key.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

function computeStatus(d, today) {
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

  if (!startLocal && !endLocal) return "current";
  if (startLocal && startLocal > today) return "upcoming";
  if (endLocal && endLocal < today) return "past";
  return "current";
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`Stamping status for today = ${today}`);
  const snap = await db.collection("exhibits").get();

  const counts = { current: 0, upcoming: 0, past: 0 };
  const batchSize = 400;
  let batch = db.batch();
  let batchCount = 0;
  let totalWrites = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    const newStatus = computeStatus(d, today);
    counts[newStatus]++;

    if (d.status === newStatus) continue;

    batch.update(doc.ref, { status: newStatus, statusUpdatedAt: Math.floor(Date.now() / 1000) });
    batchCount++;
    totalWrites++;

    if (batchCount >= batchSize) {
      await batch.commit();
      console.log(`Committed batch (${batchCount} writes)`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
    console.log(`Committed final batch (${batchCount} writes)`);
  }

  console.log(`\nTotal exhibits: ${snap.size}`);
  console.log(`Total writes: ${totalWrites}`);
  console.log(`Breakdown:`, counts);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
