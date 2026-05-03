const admin = require("firebase-admin");
const serviceAccount = require("../docent-seed/serviceAccountKey.json");
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function run() {
  const all = await db.collection("users").get();
  let count = 0;
  const batch = db.batch();
  for (const doc of all.docs) {
    if (!doc.data().role) {
      batch.update(doc.ref, { role: "user" });
      count++;
    }
  }
  if (count > 0) await batch.commit();
  console.log(`Set role: "user" on ${count} users`);
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
