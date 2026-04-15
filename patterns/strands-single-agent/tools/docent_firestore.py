"""Docent Firestore tools for the Strands agent."""

import json
import logging
from typing import Optional
from strands import tool
from tools.firebase_init import get_firestore_client

logger = logging.getLogger(__name__)

COLLECTIONS = ["museums", "galleries", "exhibits", "tours", "reviews", "users", "journalEntries"]


def _serialize(doc_snapshot) -> dict:
    d = doc_snapshot.to_dict()
    d["id"] = doc_snapshot.id
    return d


# ── List / Query ──

@tool
def list_documents(collection: str, limit: int = 50) -> str:
    """List documents from a Firestore collection. Collections: museums, galleries, exhibits, tours, reviews, users, journalEntries."""
    db = get_firestore_client()
    docs = db.collection(collection).limit(limit).stream()
    return json.dumps([_serialize(d) for d in docs], default=str)


@tool
def query_documents(collection: str, field: str, op: str, value: str, limit: int = 50) -> str:
    """Query a Firestore collection with a where clause. Ops: ==, !=, <, <=, >, >=, array-contains, in."""
    db = get_firestore_client()
    # Parse value for numeric/bool
    parsed = value
    if value.isdigit():
        parsed = int(value)
    elif value.replace(".", "", 1).isdigit():
        parsed = float(value)
    elif value.lower() in ("true", "false"):
        parsed = value.lower() == "true"
    docs = db.collection(collection).where(field, op, parsed).limit(limit).stream()
    return json.dumps([_serialize(d) for d in docs], default=str)


# ── Get ──

@tool
def get_document(collection: str, doc_id: str) -> str:
    """Get a single document by ID from a Firestore collection."""
    db = get_firestore_client()
    doc = db.collection(collection).document(doc_id).get()
    if doc.exists:
        return json.dumps(_serialize(doc), default=str)
    return json.dumps({"error": f"Document {doc_id} not found in {collection}"})


# ── Create ──

@tool
def create_document(collection: str, data: str, doc_id: Optional[str] = None) -> str:
    """Create a new document in a Firestore collection. data is a JSON string of fields. Optionally specify doc_id."""
    db = get_firestore_client()
    parsed = json.loads(data)
    if doc_id:
        db.collection(collection).document(doc_id).set(parsed)
        return json.dumps({"id": doc_id, "created": True})
    else:
        ref = db.collection(collection).add(parsed)
        return json.dumps({"id": ref[1].id, "created": True})


# ── Update ──

@tool
def update_document(collection: str, doc_id: str, data: str) -> str:
    """Update fields on an existing Firestore document. data is a JSON string of fields to update."""
    db = get_firestore_client()
    parsed = json.loads(data)
    db.collection(collection).document(doc_id).update(parsed)
    return json.dumps({"id": doc_id, "updated": True})


# ── Delete ──

@tool
def delete_document(collection: str, doc_id: str) -> str:
    """Delete a document from a Firestore collection."""
    db = get_firestore_client()
    db.collection(collection).document(doc_id).delete()
    return json.dumps({"id": doc_id, "deleted": True})


# ── Subcollections ──

@tool
def list_subcollection(collection: str, doc_id: str, subcollection: str, limit: int = 50) -> str:
    """List documents from a subcollection (e.g. tours/{id}/stops, users/{id}/savedMuseums)."""
    db = get_firestore_client()
    docs = db.collection(collection).document(doc_id).collection(subcollection).limit(limit).stream()
    return json.dumps([_serialize(d) for d in docs], default=str)


@tool
def set_subcollection_doc(collection: str, doc_id: str, subcollection: str, sub_doc_id: str, data: str) -> str:
    """Create or update a document in a subcollection."""
    db = get_firestore_client()
    parsed = json.loads(data)
    db.collection(collection).document(doc_id).collection(subcollection).document(sub_doc_id).set(parsed, merge=True)
    return json.dumps({"id": sub_doc_id, "set": True})


@tool
def delete_subcollection_doc(collection: str, doc_id: str, subcollection: str, sub_doc_id: str) -> str:
    """Delete a document from a subcollection."""
    db = get_firestore_client()
    db.collection(collection).document(doc_id).collection(subcollection).document(sub_doc_id).delete()
    return json.dumps({"id": sub_doc_id, "deleted": True})


# ── Analytics / Aggregation ──

@tool
def count_documents(collection: str) -> str:
    """Count total documents in a collection."""
    db = get_firestore_client()
    docs = db.collection(collection).stream()
    count = sum(1 for _ in docs)
    return json.dumps({"collection": collection, "count": count})


@tool
def get_stats() -> str:
    """Get Docent platform stats: total users, reviews, tours, museums, galleries, exhibits."""
    db = get_firestore_client()
    stats = {}
    for col in ["users", "reviews", "tours", "museums", "galleries", "exhibits"]:
        stats[col] = sum(1 for _ in db.collection(col).stream())
    return json.dumps(stats)


@tool
def activity_summary(days: int = 1) -> str:
    """Get activity summary for the last N days (default 1 = today). Returns new users and reviews per day. Use days=7 for a weekly summary. Single efficient query."""
    import datetime
    now = datetime.date.today()
    start = now - datetime.timedelta(days=days - 1)
    start_ts = int(datetime.datetime.combine(start, datetime.time.min).timestamp())

    db = get_firestore_client()
    users = [d.to_dict() for d in db.collection("users").where("createdAt", ">=", start_ts).stream()]
    reviews = [d.to_dict() for d in db.collection("reviews").where("createdAt", ">=", start_ts).stream()]

    daily = {}
    for i in range(days):
        day = start + datetime.timedelta(days=i)
        day_start = int(datetime.datetime.combine(day, datetime.time.min).timestamp())
        day_end = int(datetime.datetime.combine(day, datetime.time.max).timestamp())
        daily[str(day)] = {
            "new_users": sum(1 for u in users if day_start <= u.get("createdAt", 0) <= day_end),
            "new_reviews": sum(1 for r in reviews if day_start <= r.get("createdAt", 0) <= day_end),
        }
    return json.dumps({"period": f"{start} to {now}", "days": days, "daily": daily, "totals": {"new_users": len(users), "new_reviews": len(reviews)}}, default=str)


# Export all tools as a list for the agent
ALL_TOOLS = [
    list_documents,
    query_documents,
    get_document,
    create_document,
    update_document,
    delete_document,
    list_subcollection,
    set_subcollection_doc,
    delete_subcollection_doc,
    count_documents,
    get_stats,
    activity_summary,
]
