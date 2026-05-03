import { getDb } from "../firebase.js";

// Generic CRUD helpers for top-level collections

export async function listCollection(collection: string, limit = 100, filters?: Record<string, string>) {
  let query: FirebaseFirestore.Query = getDb().collection(collection);
  if (filters) {
    for (const [field, value] of Object.entries(filters)) {
      query = query.where(field, "==", value);
    }
  }
  const snap = await query.limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getDocument(collection: string, id: string) {
  const doc = await getDb().collection(collection).doc(id).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

const SLUG_COLLECTIONS = new Set(["museums", "galleries"]);

export async function createDocument(collection: string, data: Record<string, unknown>) {
  if (SLUG_COLLECTIONS.has(collection) && typeof data.name === "string") {
    const id = slugify(data.name);
    await getDb().collection(collection).doc(id).set(data);
    return { id };
  }
  const ref = await getDb().collection(collection).add(data);
  return { id: ref.id };
}

export async function updateDocument(collection: string, id: string, data: Record<string, unknown>) {
  await getDb().collection(collection).doc(id).update(data);
  return { id, updated: true };
}

export async function deleteDocument(collection: string, id: string) {
  await getDb().collection(collection).doc(id).delete();
  return { id, deleted: true };
}

// Subcollection helpers

export async function listSubcollection(parent: string, parentId: string, sub: string, limit = 100) {
  const snap = await getDb().collection(parent).doc(parentId).collection(sub).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getSubdocument(parent: string, parentId: string, sub: string, docId: string) {
  const doc = await getDb().collection(parent).doc(parentId).collection(sub).doc(docId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function setSubdocument(parent: string, parentId: string, sub: string, docId: string, data: Record<string, unknown>) {
  await getDb().collection(parent).doc(parentId).collection(sub).doc(docId).set(data, { merge: true });
  return { id: docId, updated: true };
}

export async function deleteSubdocument(parent: string, parentId: string, sub: string, docId: string) {
  await getDb().collection(parent).doc(parentId).collection(sub).doc(docId).delete();
  return { id: docId, deleted: true };
}
