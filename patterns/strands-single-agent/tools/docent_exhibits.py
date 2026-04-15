"""Docent Exhibit tools for the Strands agent."""

import json
import math
import time
from typing import Optional
from strands import tool
from tools.firebase_init import get_firestore_client


@tool
def add_exhibit(venue_id: str, venue_type: str, title: str, artist: str = "", description: str = "",
                start_date: Optional[int] = None, end_date: Optional[int] = None, image_url: str = "") -> str:
    """Add a new exhibit to a museum or gallery. venue_type: 'museum' or 'gallery'. Dates are Unix timestamps."""
    db = get_firestore_client()
    now = math.floor(time.time())
    data = {
        "title": title, "venueId": venue_id, "venueType": venue_type,
        "artist": artist, "description": description, "imageUrl": image_url,
        "addedAt": now,
    }
    if start_date:
        data["startDate"] = start_date
    if end_date:
        data["endDate"] = end_date
    ref = db.collection("exhibits").add(data)
    return json.dumps({"id": ref[1].id, "created": True})


@tool
def list_venue_exhibits(venue_id: str) -> str:
    """List all exhibits for a specific museum or gallery."""
    db = get_firestore_client()
    docs = db.collection("exhibits").where("venueId", "==", venue_id).stream()
    results = []
    for d in docs:
        item = d.to_dict()
        item["id"] = d.id
        results.append(item)
    return json.dumps(results, default=str)


ALL_TOOLS = [add_exhibit, list_venue_exhibits]
