"""Automation tools — scheduled checks, data audits, health monitoring."""

import json
import logging
import datetime
from strands import tool
from tools.firebase_init import get_firestore_client

logger = logging.getLogger(__name__)


@tool
def audit_missing_fields(collection: str, required_fields: str) -> str:
    """Audit a collection for documents missing required fields.
    required_fields is a comma-separated list like 'name,imageUrl,description'.
    Returns documents with missing fields and severity."""
    db = get_firestore_client()
    fields = [f.strip() for f in required_fields.split(",")]
    docs = db.collection(collection).stream()
    issues = []
    for d in docs:
        data = d.to_dict()
        missing = [f for f in fields if not data.get(f)]
        if missing:
            issues.append({
                "id": d.id,
                "name": data.get("name") or data.get("title") or d.id,
                "missing": missing,
                "severity": "critical" if "name" in missing or "title" in missing else "warning",
            })
    return json.dumps({"collection": collection, "total_docs_checked": sum(1 for _ in db.collection(collection).stream()), "issues_found": len(issues), "issues": issues}, default=str)


@tool
def audit_stale_exhibits() -> str:
    """Find exhibits with past endDates that may need cleanup. Also finds exhibits missing dates."""
    db = get_firestore_client()
    now_ts = int(datetime.datetime.now().timestamp())
    docs = db.collection("exhibits").stream()
    stale, no_dates, upcoming = [], [], []
    for d in docs:
        data = d.to_dict()
        data["id"] = d.id
        end = data.get("endDate")
        start = data.get("startDate")
        permanent = data.get("permanent", False)
        if permanent:
            continue
        if end and end < now_ts:
            stale.append({"id": d.id, "title": data.get("title"), "venueId": data.get("venueId"), "endDate": end})
        elif not start and not end:
            no_dates.append({"id": d.id, "title": data.get("title"), "venueId": data.get("venueId")})
        elif start and start > now_ts:
            upcoming.append({"id": d.id, "title": data.get("title"), "venueId": data.get("venueId"), "startDate": start})
    return json.dumps({"stale_past_end": stale, "missing_dates": no_dates, "upcoming": upcoming}, default=str)


@tool
def audit_orphaned_exhibits() -> str:
    """Find exhibits whose venueId doesn't match any museum or gallery."""
    db = get_firestore_client()
    museum_ids = {d.id for d in db.collection("museums").stream()}
    gallery_ids = {d.id for d in db.collection("galleries").stream()}
    all_venue_ids = museum_ids | gallery_ids

    docs = db.collection("exhibits").stream()
    orphans = []
    for d in docs:
        data = d.to_dict()
        vid = data.get("venueId")
        if vid and vid not in all_venue_ids:
            orphans.append({"id": d.id, "title": data.get("title"), "venueId": vid, "venueType": data.get("venueType")})
    return json.dumps({"orphaned_exhibits": orphans, "count": len(orphans)}, default=str)


@tool
def venue_health_check() -> str:
    """Check all museums and galleries for completeness: imageUrl, description, location, hours."""
    db = get_firestore_client()
    results = []
    for col in ["museums", "galleries"]:
        for d in db.collection(col).stream():
            data = d.to_dict()
            issues = []
            if not data.get("imageUrl"): issues.append("missing imageUrl")
            if not data.get("description"): issues.append("missing description")
            if not data.get("location"): issues.append("missing location")
            if col == "museums" and not data.get("hours"): issues.append("missing hours")
            if issues:
                results.append({"id": d.id, "name": data.get("name"), "type": col, "issues": issues})
    return json.dumps({"venues_with_issues": results, "count": len(results)}, default=str)


@tool
def review_integrity_check() -> str:
    """Check reviews for data integrity: missing ratings, orphaned targetIds, missing user info."""
    db = get_firestore_client()
    museum_ids = {d.id for d in db.collection("museums").stream()}
    gallery_ids = {d.id for d in db.collection("galleries").stream()}
    exhibit_ids = {d.id for d in db.collection("exhibits").stream()}
    tour_ids = {d.id for d in db.collection("tours").stream()}
    all_targets = museum_ids | gallery_ids | exhibit_ids | tour_ids

    issues = []
    for d in db.collection("reviews").stream():
        data = d.to_dict()
        problems = []
        if not data.get("rating"): problems.append("missing rating")
        if not data.get("userId"): problems.append("missing userId")
        if not data.get("displayName"): problems.append("missing displayName")
        tid = data.get("targetId")
        if tid and tid not in all_targets: problems.append(f"orphaned targetId: {tid}")
        if problems:
            issues.append({"id": d.id, "targetName": data.get("targetName"), "problems": problems})
    return json.dumps({"issues": issues, "count": len(issues)}, default=str)


@tool
def batch_update_field(collection: str, field: str, value: str, filter_field: str = "", filter_op: str = "==", filter_value: str = "", doc_ids: str = "") -> str:
    """Batch update a single field across multiple documents in one call.
    Either provide doc_ids (comma-separated) OR a filter (filter_field, filter_op, filter_value).
    value is auto-parsed: 'true'/'false' → bool, digits → int, 'null' → delete field.
    Example: batch_update_field('exhibits', 'imageUrl', 'null', doc_ids='id1,id2,id3')"""
    db = get_firestore_client()
    from google.cloud.firestore_v1 import DELETE_FIELD

    # Parse value
    parsed = value
    if value == "null":
        parsed = DELETE_FIELD
    elif value.lower() in ("true", "false"):
        parsed = value.lower() == "true"
    elif value.isdigit():
        parsed = int(value)

    # Get target docs
    if doc_ids:
        ids = [i.strip() for i in doc_ids.split(",") if i.strip()]
    elif filter_field:
        fv = filter_value
        if fv.isdigit(): fv = int(fv)
        elif fv.lower() in ("true", "false"): fv = fv.lower() == "true"
        ids = [d.id for d in db.collection(collection).where(filter_field, filter_op, fv).stream()]
    else:
        return json.dumps({"error": "Provide doc_ids or filter_field"})

    # Batch write (Firestore limit: 500 per batch)
    updated = 0
    batch = db.batch()
    for i, doc_id in enumerate(ids):
        batch.update(db.collection(collection).document(doc_id), {field: parsed})
        updated += 1
        if (i + 1) % 500 == 0:
            batch.commit()
            batch = db.batch()
    if updated % 500 != 0:
        batch.commit()

    return json.dumps({"collection": collection, "field": field, "updated": updated, "doc_ids": ids})


@tool
def find_and_clear_field(collection: str, field: str, condition: str = "exists") -> str:
    """Find all docs where a field matches a condition and clear/delete that field.
    Conditions: 'exists' (field is set), 'contains:X' (field contains substring X),
    'starts_with:X', 'equals:X'. Clears the field from matching docs in one batch.
    Use for: removing copyrighted images, clearing stale URLs, wiping deprecated fields."""
    db = get_firestore_client()
    from google.cloud.firestore_v1 import DELETE_FIELD

    docs = list(db.collection(collection).stream())
    matches = []
    for d in docs:
        data = d.to_dict()
        val = data.get(field)
        if val is None:
            continue
        val_str = str(val)
        if condition == "exists":
            matches.append(d)
        elif condition.startswith("contains:") and condition[9:] in val_str:
            matches.append(d)
        elif condition.startswith("starts_with:") and val_str.startswith(condition[12:]):
            matches.append(d)
        elif condition.startswith("equals:") and val_str == condition[7:]:
            matches.append(d)

    # Batch clear
    batch = db.batch()
    cleared = []
    for i, d in enumerate(matches):
        batch.update(db.collection(collection).document(d.id), {field: DELETE_FIELD})
        cleared.append({"id": d.id, "name": d.to_dict().get("name") or d.to_dict().get("title") or d.id, "old_value": str(d.to_dict().get(field, ""))[:100]})
        if (i + 1) % 500 == 0:
            batch.commit()
            batch = db.batch()
    if cleared and len(cleared) % 500 != 0:
        batch.commit()

    return json.dumps({"collection": collection, "field": field, "condition": condition, "cleared": len(cleared), "docs": cleared}, default=str)


@tool
def audit_and_fix(collection: str, check: str, fix: str = "report") -> str:
    """All-in-one audit + optional fix in a single tool call. Scans entire collection once.
    check options: 'missing_images', 'missing_descriptions', 'stale_dates', 'empty_fields:field1,field2'
    fix options: 'report' (just list issues), 'clear' (remove bad fields), 'flag' (add _needsReview=true)
    Example: audit_and_fix('exhibits', 'missing_images', 'flag')"""
    db = get_firestore_client()
    from google.cloud.firestore_v1 import DELETE_FIELD
    now_ts = int(datetime.datetime.now().timestamp())

    docs = list(db.collection(collection).stream())
    issues = []

    for d in docs:
        data = d.to_dict()
        problem = None

        if check == "missing_images":
            if not data.get("imageUrl"):
                problem = "missing imageUrl"
        elif check == "missing_descriptions":
            if not data.get("description"):
                problem = "missing description"
        elif check == "stale_dates":
            end = data.get("endDate")
            if end and end < now_ts and not data.get("permanent"):
                problem = f"endDate {end} is in the past"
        elif check.startswith("empty_fields:"):
            fields = check.split(":")[1].split(",")
            missing = [f for f in fields if not data.get(f.strip())]
            if missing:
                problem = f"missing: {', '.join(missing)}"

        if problem:
            issues.append({"id": d.id, "name": data.get("name") or data.get("title") or d.id, "problem": problem})

    # Apply fix if requested
    fixed = 0
    if fix != "report" and issues:
        batch = db.batch()
        for i, issue in enumerate(issues):
            ref = db.collection(collection).document(issue["id"])
            if fix == "clear":
                if check == "missing_images":
                    batch.update(ref, {"imageUrl": DELETE_FIELD})
                elif check == "stale_dates":
                    batch.update(ref, {"endDate": DELETE_FIELD})
            elif fix == "flag":
                batch.update(ref, {"_needsReview": True})
            fixed += 1
            if (i + 1) % 500 == 0:
                batch.commit()
                batch = db.batch()
        if fixed % 500 != 0:
            batch.commit()

    return json.dumps({"collection": collection, "check": check, "fix": fix, "issues_found": len(issues), "fixed": fixed, "issues": issues}, default=str)


ALL_TOOLS = [
    audit_missing_fields, audit_stale_exhibits, audit_orphaned_exhibits,
    venue_health_check, review_integrity_check,
    batch_update_field, find_and_clear_field, audit_and_fix,
]
