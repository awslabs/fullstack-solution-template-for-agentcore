"""Docent image tools for Firebase Storage."""

import json
from strands import tool
from tools.firebase_init import get_firestore_client, get_storage_bucket


@tool
def update_image_url(collection: str, doc_id: str, image_url: str) -> str:
    """Set the imageUrl field on a Firestore document (museum, gallery, exhibit, tour, user)."""
    db = get_firestore_client()
    db.collection(collection).document(doc_id).update({"imageUrl": image_url})
    return json.dumps({"id": doc_id, "imageUrl": image_url, "updated": True})


@tool
def update_description(collection: str, doc_id: str, description: str) -> str:
    """Update the description/about text on a museum, gallery, or exhibit."""
    db = get_firestore_client()
    db.collection(collection).document(doc_id).update({"description": description})
    return json.dumps({"id": doc_id, "updated": True})


ALL_TOOLS = [update_image_url, update_description]
