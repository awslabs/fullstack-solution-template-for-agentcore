"""Self-learning tools — the agent remembers corrections and lessons."""

import json
import logging
import datetime
from strands import tool
from tools.firebase_init import get_firestore_client

logger = logging.getLogger(__name__)

COLLECTION = "agentLessons"


@tool
def log_lesson(lesson: str, category: str = "general", source: str = "user_correction") -> str:
    """Log a lesson the agent learned. Use when corrected by the user or when discovering a new pattern.
    Categories: general, data_model, writing, operations, bug.
    Sources: user_correction, auto_detected, decision_outcome."""
    db = get_firestore_client()
    doc = {
        "lesson": lesson,
        "category": category,
        "source": source,
        "timestamp": int(datetime.datetime.now().timestamp()),
        "date": str(datetime.date.today()),
    }
    ref = db.collection(COLLECTION).add(doc)
    logger.info(f"Logged lesson: {lesson[:80]}")
    return json.dumps({"id": ref[1].id, "logged": True, "lesson": lesson})


@tool
def get_lessons(category: str = "", limit: int = 20) -> str:
    """Retrieve recent lessons. Optionally filter by category. Use at session start to load context."""
    db = get_firestore_client()
    query = db.collection(COLLECTION).order_by("timestamp", direction="DESCENDING").limit(limit)
    if category:
        query = db.collection(COLLECTION).where("category", "==", category).order_by("timestamp", direction="DESCENDING").limit(limit)
    docs = query.stream()
    lessons = []
    for d in docs:
        data = d.to_dict()
        data["id"] = d.id
        lessons.append(data)
    return json.dumps(lessons, default=str)


@tool
def search_lessons(keyword: str) -> str:
    """Search lessons containing a keyword. Useful for checking if something was already learned."""
    db = get_firestore_client()
    docs = db.collection(COLLECTION).order_by("timestamp", direction="DESCENDING").limit(100).stream()
    matches = []
    kw = keyword.lower()
    for d in docs:
        data = d.to_dict()
        if kw in data.get("lesson", "").lower():
            data["id"] = d.id
            matches.append(data)
    return json.dumps(matches[:20], default=str)


ALL_TOOLS = [log_lesson, get_lessons, search_lessons]
