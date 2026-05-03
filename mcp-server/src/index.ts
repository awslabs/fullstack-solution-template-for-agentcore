#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listCollection, getDocument, createDocument, updateDocument, deleteDocument,
  listSubcollection, getSubdocument, setSubdocument, deleteSubdocument,
} from "./tools/firestore.js";
import { getBucket, getDb as getDbDirect } from "./firebase.js";
import { readFileSync } from "fs";
import { resolve, extname } from "path";

const server = new McpServer({
  name: "docent",
  version: "1.0.0",
});

// ── Top-level collections ──────────────────────────────────────────

const TOP_COLLECTIONS = ["museums", "galleries", "exhibits", "reviews", "tours", "users"] as const;

for (const col of TOP_COLLECTIONS) {
  const singular = col.replace(/ies$/, "y").replace(/(?<!i)s$/, "");

  server.tool(`list_${col}`, `List documents from the ${col} collection`, {
    limit: z.number().optional().describe("Max results (default 100)"),
    filters: z.record(z.string(), z.string()).optional().describe("Field=value equality filters"),
  }, async ({ limit, filters }) => ({
    content: [{ type: "text", text: JSON.stringify(await listCollection(col, limit ?? undefined, filters ?? undefined), null, 2) }],
  }));

  server.tool(`get_${singular}`, `Get a single ${singular} by ID`, {
    id: z.string().describe("Document ID"),
  }, async ({ id }) => {
    const doc = await getDocument(col, id);
    return { content: [{ type: "text", text: doc ? JSON.stringify(doc, null, 2) : `Not found: ${id}` }] };
  });

  server.tool(`create_${singular}`, `Create a new ${singular}`, {
    data: z.string().describe("JSON string of document fields"),
  }, async ({ data }) => ({
    content: [{ type: "text", text: JSON.stringify(await createDocument(col, JSON.parse(data)), null, 2) }],
  }));

  server.tool(`update_${singular}`, `Update a ${singular} by ID`, {
    id: z.string().describe("Document ID"),
    data: z.string().describe("JSON string of fields to update"),
  }, async ({ id, data }) => ({
    content: [{ type: "text", text: JSON.stringify(await updateDocument(col, id, JSON.parse(data)), null, 2) }],
  }));

  server.tool(`delete_${singular}`, `Delete a ${singular} by ID`, {
    id: z.string().describe("Document ID"),
  }, async ({ id }) => ({
    content: [{ type: "text", text: JSON.stringify(await deleteDocument(col, id), null, 2) }],
  }));
}

// ── User subcollections ────────────────────────────────────────────

const USER_SUBS = ["completedTours", "savedTours", "savedMuseums", "savedGalleries", "following", "stopUploads"] as const;

for (const sub of USER_SUBS) {
  server.tool(`list_user_${sub}`, `List a user's ${sub}`, {
    userId: z.string().describe("User ID"),
    limit: z.number().optional().describe("Max results (default 100)"),
  }, async ({ userId, limit }) => ({
    content: [{ type: "text", text: JSON.stringify(await listSubcollection("users", userId, sub, limit ?? undefined), null, 2) }],
  }));

  server.tool(`set_user_${sub}_item`, `Create or update an item in a user's ${sub}`, {
    userId: z.string().describe("User ID"),
    docId: z.string().describe("Document ID"),
    data: z.string().describe("JSON string of document fields"),
  }, async ({ userId, docId, data }) => ({
    content: [{ type: "text", text: JSON.stringify(await setSubdocument("users", userId, sub, docId, JSON.parse(data)), null, 2) }],
  }));

  server.tool(`delete_user_${sub}_item`, `Delete an item from a user's ${sub}`, {
    userId: z.string().describe("User ID"),
    docId: z.string().describe("Document ID"),
  }, async ({ userId, docId }) => ({
    content: [{ type: "text", text: JSON.stringify(await deleteSubdocument("users", userId, sub, docId), null, 2) }],
  }));
}

// ── Tour stops ─────────────────────────────────────────────────────

server.tool("list_tour_stops", "List stops for a tour", {
  tourId: z.string().describe("Tour ID"),
  limit: z.number().optional(),
}, async ({ tourId, limit }) => ({
  content: [{ type: "text", text: JSON.stringify(await listSubcollection("tours", tourId, "stops", limit ?? undefined), null, 2) }],
}));

server.tool("get_tour_stop", "Get a single tour stop", {
  tourId: z.string().describe("Tour ID"),
  stopId: z.string().describe("Stop ID"),
}, async ({ tourId, stopId }) => {
  const doc = await getSubdocument("tours", tourId, "stops", stopId);
  return { content: [{ type: "text", text: doc ? JSON.stringify(doc, null, 2) : "Not found" }] };
});

server.tool("set_tour_stop", "Create or update a tour stop", {
  tourId: z.string().describe("Tour ID"),
  stopId: z.string().describe("Stop ID"),
  data: z.string().describe("JSON string of stop fields"),
}, async ({ tourId, stopId, data }) => ({
  content: [{ type: "text", text: JSON.stringify(await setSubdocument("tours", tourId, "stops", stopId, JSON.parse(data)), null, 2) }],
}));

server.tool("delete_tour_stop", "Delete a tour stop", {
  tourId: z.string().describe("Tour ID"),
  stopId: z.string().describe("Stop ID"),
}, async ({ tourId, stopId }) => ({
  content: [{ type: "text", text: JSON.stringify(await deleteSubdocument("tours", tourId, "stops", stopId), null, 2) }],
}));

// ── Image upload ───────────────────────────────────────────────────

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

server.tool("upload_image", "Upload a local image file to Firebase Storage and return its public URL", {
  filePath: z.string().describe("Absolute path to the image file"),
  storagePath: z.string().optional().describe("Storage path (default: images/<filename>)"),
}, async ({ filePath, storagePath }) => {
  const resolved = resolve(filePath);
  const ext = extname(resolved).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const dest = storagePath || `images/${Date.now()}${ext}`;
  const file = getBucket().file(dest);
  await file.save(readFileSync(resolved), { metadata: { contentType } });
  await file.makePublic();
  const url = `https://storage.googleapis.com/${getBucket().name}/${dest}`;
  return { content: [{ type: "text", text: JSON.stringify({ url, storagePath: dest }, null, 2) }] };
});

server.tool("update_image", "Upload a local image and set it as imageUrl on a document", {
  collection: z.enum(["museums", "galleries", "exhibits", "tours", "users"]).describe("Collection name"),
  id: z.string().describe("Document ID"),
  filePath: z.string().describe("Absolute path to the image file"),
}, async ({ collection, id, filePath }) => {
  const resolved = resolve(filePath);
  const ext = extname(resolved).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const dest = `${collection}/${id}${ext}`;
  const file = getBucket().file(dest);
  await file.save(readFileSync(resolved), { metadata: { contentType } });
  await file.makePublic();
  const url = `https://storage.googleapis.com/${getBucket().name}/${dest}`;
  const field = collection === "users" ? "photoUrl" : "imageUrl";
  await getDbDirect().collection(collection).doc(id).update({ [field]: url });
  return { content: [{ type: "text", text: JSON.stringify({ id, [field]: url }, null, 2) }] };
});

// ── Quick-add venues ───────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

server.tool("add_museum", "Quickly add a new museum with name, location, and optional description/image", {
  name: z.string().describe("Museum name"),
  location: z.string().describe("City, State or address"),
  description: z.string().optional().describe("About text"),
  imageUrl: z.string().optional().describe("Image URL (or use update_image after)"),
  lat: z.number().optional(),
  lng: z.number().optional(),
}, async (args) => {
  const id = slugify(args.name);
  const data: Record<string, unknown> = { name: args.name, location: args.location, description: args.description || "", avgRating: 0, reviewCount: 0 };
  if (args.imageUrl) data.imageUrl = args.imageUrl;
  if (args.lat != null) data.lat = args.lat;
  if (args.lng != null) data.lng = args.lng;
  await getDbDirect().collection("museums").doc(id).set(data);
  return { content: [{ type: "text", text: JSON.stringify({ id, ...data }, null, 2) }] };
});

server.tool("add_gallery", "Quickly add a new gallery with name, location, and optional description/image", {
  name: z.string().describe("Gallery name"),
  location: z.string().describe("City, State or address"),
  description: z.string().optional().describe("About text"),
  imageUrl: z.string().optional().describe("Image URL (or use update_image after)"),
  lat: z.number().optional(),
  lng: z.number().optional(),
}, async (args) => {
  const id = slugify(args.name);
  const data: Record<string, unknown> = { name: args.name, location: args.location, description: args.description || "", avgRating: 0, reviewCount: 0 };
  if (args.imageUrl) data.imageUrl = args.imageUrl;
  if (args.lat != null) data.lat = args.lat;
  if (args.lng != null) data.lng = args.lng;
  await getDbDirect().collection("galleries").doc(id).set(data);
  return { content: [{ type: "text", text: JSON.stringify({ id, ...data }, null, 2) }] };
});

server.tool("add_exhibit", "Quickly add a new exhibit to a venue", {
  venueId: z.string().describe("Museum or gallery ID"),
  venueType: z.enum(["museum", "gallery"]).describe("Venue type"),
  title: z.string().describe("Exhibit title"),
  description: z.string().optional(),
  artist: z.string().optional(),
  imageUrl: z.string().optional(),
  startDate: z.number().optional().describe("Start date as Unix timestamp"),
  endDate: z.number().optional().describe("End date as Unix timestamp"),
}, async (args) => {
  const data: Record<string, unknown> = {
    venueId: args.venueId, venueType: args.venueType, title: args.title,
    description: args.description || "", avgRating: 0, reviewCount: 0,
  };
  if (args.artist) data.artist = args.artist;
  if (args.imageUrl) data.imageUrl = args.imageUrl;
  if (args.startDate != null) data.startDate = args.startDate;
  if (args.endDate != null) data.endDate = args.endDate;
  const ref = await getDbDirect().collection("exhibits").add(data);
  return { content: [{ type: "text", text: JSON.stringify({ id: ref.id, ...data }, null, 2) }] };
});

server.tool("update_about", "Update the description/about text on a museum, gallery, or exhibit", {
  collection: z.enum(["museums", "galleries", "exhibits"]).describe("Collection name"),
  id: z.string().describe("Document ID"),
  description: z.string().describe("New about/description text"),
}, async ({ collection, id, description }) => {
  await getDbDirect().collection(collection).doc(id).update({ description });
  return { content: [{ type: "text", text: JSON.stringify({ id, description, updated: true }, null, 2) }] };
});

// ── Journal entries ────────────────────────────────────────────────

server.tool("list_journal_entries", "List journal entries", {
  limit: z.number().optional().describe("Max results (default 100)"),
}, async ({ limit }) => ({
  content: [{ type: "text", text: JSON.stringify(await listCollection("journalEntries", limit ?? undefined), null, 2) }],
}));

server.tool("get_journal_entry", "Get a journal entry by ID", {
  id: z.string().describe("Document ID"),
}, async ({ id }) => {
  const doc = await getDocument("journalEntries", id);
  return { content: [{ type: "text", text: doc ? JSON.stringify(doc, null, 2) : `Not found: ${id}` }] };
});

server.tool("create_journal_entry", "Create a new journal entry", {
  data: z.string().describe("JSON string with: title, author, slug, category, body (HTML), imageUrl (optional), subtitle (optional)"),
}, async ({ data }) => {
  const parsed = JSON.parse(data);
  const now = Math.floor(Date.now() / 1000);
  if (!parsed.slug) parsed.slug = slugify(parsed.title || "untitled");
  if (!parsed.createdAt) parsed.createdAt = now;
  if (!parsed.publishedAt) parsed.publishedAt = now;
  return { content: [{ type: "text", text: JSON.stringify(await createDocument("journalEntries", parsed), null, 2) }] };
});

server.tool("update_journal_entry", "Update a journal entry by ID", {
  id: z.string().describe("Document ID"),
  data: z.string().describe("JSON string of fields to update"),
}, async ({ id, data }) => ({
  content: [{ type: "text", text: JSON.stringify(await updateDocument("journalEntries", id, JSON.parse(data)), null, 2) }],
}));

server.tool("delete_journal_entry", "Delete a journal entry by ID", {
  id: z.string().describe("Document ID"),
}, async ({ id }) => ({
  content: [{ type: "text", text: JSON.stringify(await deleteDocument("journalEntries", id), null, 2) }],
}));

// ── Flexible query tool ────────────────────────────────────────────

server.tool("query_collection", "Run a flexible query on any collection with where/orderBy/limit", {
  collection: z.string().describe("Collection path, e.g. 'reviews' or 'users/abc123/savedMuseums'"),
  where: z.array(z.object({
    field: z.string(),
    op: z.enum(["==", "!=", "<", "<=", ">", ">=", "array-contains", "in", "array-contains-any"]),
    value: z.unknown(),
  })).optional().describe("Where clauses"),
  orderBy: z.string().optional().describe("Field to order by"),
  orderDirection: z.enum(["asc", "desc"]).optional(),
  limit: z.number().optional(),
}, async ({ collection, where: clauses, orderBy, orderDirection, limit }) => {
  const { getDb } = await import("./firebase.js");
  let query: FirebaseFirestore.Query = getDbDirect().collection(collection);
  if (clauses) {
    for (const c of clauses) query = query.where(c.field, c.op as FirebaseFirestore.WhereFilterOp, c.value);
  }
  if (orderBy) query = query.orderBy(orderBy, orderDirection || "asc");
  query = query.limit(limit || 100);
  const snap = await query.get();
  const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});

// ── Wikipedia lookup ───────────────────────────────────────────────

server.tool("lookup_wikipedia", "Fetch a short summary from Wikipedia for a topic (e.g. artist name)", {
  topic: z.string().describe("Topic to look up, e.g. 'Gustav Klimt'"),
  sentences: z.number().optional().describe("Number of sentences (default 2)"),
}, async ({ topic, sentences }) => {
  const n = sentences ?? 2;
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
  const res = await fetch(url);
  if (!res.ok) return { content: [{ type: "text", text: `Not found: ${topic}` }] };
  const json = await res.json() as { extract?: string; title?: string; description?: string; content_urls?: { desktop?: { page?: string } } };
  // Trim to requested sentence count
  const full = json.extract || "";
  const trimmed = full.split(". ").slice(0, n).join(". ").replace(/\.?$/, ".");
  return { content: [{ type: "text", text: JSON.stringify({ title: json.title, summary: trimmed, description: json.description, url: json.content_urls?.desktop?.page }, null, 2) }] };
});

// ── Start ──────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Docent MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
