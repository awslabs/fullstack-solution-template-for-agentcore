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
def today_activity(date_str: str = "") -> str:
    """Get today's activity: new users and reviews created today (or a given date YYYY-MM-DD). Fast single-query summary."""
    import datetime
    if date_str:
        day = datetime.date.fromisoformat(date_str)
    else:
        day = datetime.date.today()
    start_ts = int(datetime.datetime.combine(day, datetime.time.min).timestamp())
    end_ts = int(datetime.datetime.combine(day, datetime.time.max).timestamp())

    db = get_firestore_client()
    new_users = [_serialize(d) for d in db.collection("users").where("createdAt", ">=", start_ts).where("createdAt", "<=", end_ts).stream()]
    new_reviews = [_serialize(d) for d in db.collection("reviews").where("createdAt", ">=", start_ts).where("createdAt", "<=", end_ts).stream()]
    return json.dumps({"date": str(day), "new_users": len(new_users), "new_reviews": len(new_reviews), "users": new_users, "reviews": new_reviews}, default=str)


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
    today_activity,
]
