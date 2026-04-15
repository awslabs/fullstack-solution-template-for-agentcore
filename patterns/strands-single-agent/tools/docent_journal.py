"""Docent Journal tools for the Strands agent."""

import json
import math
import time
from strands import tool
from tools.firebase_init import get_firestore_client


@tool
def create_journal_entry(title: str, author: str, slug: str, category: str, body: str, image_url: str = "", subtitle: str = "") -> str:
    """Create a new journal entry. body should be HTML."""
    db = get_firestore_client()
    now = math.floor(time.time())
    data = {
        "title": title, "author": author, "slug": slug, "category": category,
        "body": body, "imageUrl": image_url, "subtitle": subtitle,
        "createdAt": now, "publishedAt": now,
    }
    ref = db.collection("journalEntries").add(data)
    return json.dumps({"id": ref[1].id, "created": True})


@tool
def update_journal_body(entry_id: str, body: str) -> str:
    """Update the HTML body of a journal entry."""
    db = get_firestore_client()
    db.collection("journalEntries").document(entry_id).update({"body": body})
    return json.dumps({"id": entry_id, "updated": True})


ALL_TOOLS = [create_journal_entry, update_journal_body]
