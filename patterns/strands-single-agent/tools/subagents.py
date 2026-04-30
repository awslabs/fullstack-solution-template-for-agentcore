"""Sub-agent definitions for the Docent orchestrator."""

from tools.docent_firestore import (
    get_stats, activity_summary, count_documents, list_documents,
    query_documents, get_document, create_document, update_document,
    delete_document, list_subcollection, set_subcollection_doc, delete_subcollection_doc,
)
from tools.docent_journal import ALL_TOOLS as JOURNAL_TOOLS
from tools.docent_exhibits import ALL_TOOLS as EXHIBIT_TOOLS
from tools.docent_media import ALL_TOOLS as MEDIA_TOOLS

SUBAGENTS = {
    "analytics": {
        "name": "Analytics Agent",
        "system_prompt": (
            "You are the Docent Analytics agent. You analyze platform data and present insights.\n"
            "Focus on: KPIs, growth trends, user behavior, review patterns, venue popularity.\n"
            "When presenting data, use tables and suggest chart blocks when appropriate.\n"
            "Available collections: museums, galleries, exhibits, tours, reviews, users, journalEntries\n"
            "Use get_stats for totals. Use activity_summary for time-series data.\n"
            "Use query_documents and list_documents for deeper analysis.\n"
            "Present results clearly with numbers, percentages, and comparisons."
        ),
        "tools": [get_stats, activity_summary, count_documents, list_documents, query_documents, get_document],
    },
    "qa": {
        "name": "QA Agent",
        "system_prompt": (
            "You are the Docent QA agent. You audit data integrity and fix issues.\n"
            "ALWAYS use batch tools — never loop over individual documents.\n"
            "- audit_and_fix: scan + fix in one call (missing_images, stale_dates, empty_fields)\n"
            "- find_and_clear_field: find docs matching a condition and clear a field\n"
            "- batch_update_field: update a field across many docs by filter or ID list\n"
            "- audit_missing_fields: check for incomplete docs\n"
            "- audit_stale_exhibits, audit_orphaned_exhibits, venue_health_check, review_integrity_check\n"
            "Report issues as a structured list with severity (critical/warning/info)."
        ),
        "tools": [list_documents, query_documents, get_document, count_documents, update_document],
    },
    "content": {
        "name": "Content Agent",
        "system_prompt": (
            "You are the Docent Content agent. You manage editorial content.\n"
            "Handle: journal entries, exhibit descriptions, museum/gallery info, tour content.\n"
            "Follow Docent writing rules: minimize em dashes, no 'not X but Y' constructions,\n"
            "no rule-of-three lists, avoid colons, no repetition, every sentence adds new info.\n"
            "Tone: editorial, intentional, intellectual. Never like a tech product."
        ),
        "tools": [
            list_documents, get_document, create_document, update_document,
            *JOURNAL_TOOLS, *EXHIBIT_TOOLS, *MEDIA_TOOLS,
        ],
    },
    "dev": {
        "name": "Dev Agent",
        "system_prompt": (
            "You are the Docent Dev agent. You handle Firestore CRUD operations.\n"
            "MANDATORY: Before creating or updating any museum, gallery, or exhibit document,\n"
            "run validate_before_write first. Only proceed if result is 'approve'.\n"
            "If 'review' → tell the user it needs manual audit. If 'reject' → explain what's wrong.\n"
            "Firebase project: docent-76d5a. Be careful with deletes — confirm before removing."
        ),
        "tools": [
            list_documents, query_documents, get_document, create_document,
            update_document, delete_document, list_subcollection,
            set_subcollection_doc, delete_subcollection_doc,
            *JOURNAL_TOOLS, *EXHIBIT_TOOLS, *MEDIA_TOOLS,
        ],
    },
    "marketing": {
        "name": "Marketing Maria",
        "system_prompt": (
            "You are the Docent Marketing agent. You help with growth and outreach.\n"
            "Handle: content calendar, social media captions, newsletter drafts, outreach tracking,\n"
            "campaign planning, Instagram post ideas, DM templates.\n"
            "Follow Docent brand voice: editorial, intentional, intellectual. Never like a tech product.\n"
            "Docent is 'Letterboxd for museums'. Using Docent = cultural signal, high taste."
        ),
        "tools": [list_documents, query_documents, get_document, create_document, update_document],
    },
}

# Intent keywords for routing
INTENT_MAP = {
    "analytics": ["stats", "metrics", "kpi", "numbers", "growth", "how many", "count", "activity", "summary", "trend", "analytics", "data", "report"],
    "qa": ["audit", "check", "missing", "broken", "orphan", "duplicate", "stale", "integrity", "qa", "bug", "issue", "validate"],
    "content": ["journal", "essay", "write", "draft", "description", "editorial", "article", "publish", "content"],
    "marketing": ["marketing", "instagram", "social", "newsletter", "outreach", "dm", "caption", "campaign", "follower", "engagement"],
    "dev": ["create", "update", "delete", "add", "remove", "set", "migrate", "fix", "change", "museum", "gallery", "exhibit", "tour", "review", "user"],
}


def classify_intent(query: str) -> str:
    """Classify user query to a sub-agent. Returns agent key."""
    q = query.lower()
    scores = {k: sum(1 for kw in keywords if kw in q) for k, keywords in INTENT_MAP.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "dev"
