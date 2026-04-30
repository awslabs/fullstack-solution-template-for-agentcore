"""User report triage — agent reads /reports, proposes edits, writes to /reportTriage.

The Docent iOS app writes raw reports to /reports when users notice incorrect
information (wrong hours, closed venue, wrong exhibit dates, etc). A Cloud
Function stamps them with triageStatus="pending".

This module provides tools for the agent to:
  1. Pull pending reports
  2. Read the current venue/exhibit data so the LLM has context
  3. Write a structured edit proposal to /reportTriage for human review
  4. Mark the source report as processed

The agent itself does the interpretation using its built-in Claude access (no
separate API key). Humans review /reportTriage in Notion and approve via the
admin portal, which calls the publishDraft Cloud Function to apply changes.
"""

import json
import logging
from typing import Optional

from strands import tool
from tools.firebase_init import get_firestore_client

logger = logging.getLogger(__name__)

TARGET_COLLECTIONS = {
    "museum": "museums",
    "gallery": "galleries",
    "exhibit": "exhibits",
}


@tool
def list_pending_reports(limit: int = 20) -> str:
    """List user reports that need triage. Returns reports with triageStatus='pending'.

    Each report has: reporterId, targetType (museum/gallery/exhibit), targetId,
    category (wrong-hours, wrong-admission, closed, wrong-exhibit-dates,
    wrong-description, wrong-image, other), text (user's description), createdAt.

    Use get_report_context(reportId) to see the current venue/exhibit data
    alongside the report before writing a triage proposal.
    """
    db = get_firestore_client()
    docs = (
        db.collection("reports")
        .where("triageStatus", "==", "pending")
        .limit(limit)
        .stream()
    )
    results = []
    for d in docs:
        data = d.to_dict()
        data["id"] = d.id
        results.append(data)
    return json.dumps(results, default=str)


@tool
def get_report_context(report_id: str) -> str:
    """Fetch a user report along with the current data for the venue/exhibit
    it refers to. Use this before writing a triage proposal so you can compare
    the user's claim against the current state.

    Returns: { report: {...}, current: {...} } where `current` is the full
    venue or exhibit document.
    """
    db = get_firestore_client()
    report_ref = db.collection("reports").document(report_id)
    report_snap = report_ref.get()
    if not report_snap.exists:
        return json.dumps({"error": f"Report {report_id} not found"})

    report = report_snap.to_dict()
    report["id"] = report_snap.id

    target_type = report.get("targetType")
    target_id = report.get("targetId")
    collection = TARGET_COLLECTIONS.get(target_type)
    if not collection or not target_id:
        return json.dumps({"report": report, "current": None, "error": "invalid target"})

    target_snap = db.collection(collection).document(target_id).get()
    if not target_snap.exists:
        return json.dumps({"report": report, "current": None, "error": "target not found"})

    current = target_snap.to_dict()
    current["id"] = target_snap.id
    return json.dumps({"report": report, "current": current}, default=str)


@tool
def write_triage_proposal(
    report_id: str,
    proposed_edits_json: str,
    reasoning: str,
    confidence: str,
) -> str:
    """Write a structured edit proposal to /reportTriage for human review.
    Marks the source report as processed so it won't be triaged twice.

    Args:
      report_id: The /reports document ID
      proposed_edits_json: JSON string of the fields to change on the target doc.
                           Example: '{"hours": "Tue-Sat 11am-6pm"}' or
                           '{"hidden": true}' for closed venues. Pass '{}' if
                           no edit is appropriate (e.g. report is vague).
      reasoning: Short explanation of why these edits are correct (or why no
                 edit is appropriate)
      confidence: "high" | "medium" | "low"

    Rules the agent should follow:
    - Only propose edits when confident the report is accurate
    - Preserve existing data formats (e.g. hours string style)
    - Never propose edits to imageUrl (copyright)
    - For "closed" category reports, propose {"hidden": true}
    - For uncertain reports, pass empty edits {} and explain in reasoning

    Returns the triage document ID.
    """
    db = get_firestore_client()

    # Load the report for context
    report_ref = db.collection("reports").document(report_id)
    report_snap = report_ref.get()
    if not report_snap.exists:
        return json.dumps({"error": f"Report {report_id} not found"})
    report = report_snap.to_dict()

    # Resolve target name for display
    target_type = report.get("targetType")
    target_id = report.get("targetId")
    collection = TARGET_COLLECTIONS.get(target_type)
    target_name = ""
    if collection and target_id:
        target_snap = db.collection(collection).document(target_id).get()
        if target_snap.exists:
            td = target_snap.to_dict()
            target_name = td.get("name") or td.get("title") or ""

    # Parse edits
    try:
        proposed_edits = json.loads(proposed_edits_json) if proposed_edits_json else {}
    except json.JSONDecodeError as e:
        return json.dumps({"error": f"Invalid proposed_edits_json: {e}"})

    # Safety rule: never propose imageUrl changes
    if "imageUrl" in proposed_edits:
        del proposed_edits["imageUrl"]
        reasoning += " [Dropped imageUrl edit — copyright policy.]"

    if confidence not in ("high", "medium", "low"):
        confidence = "low"

    import time
    now = int(time.time())

    payload = {
        "reportId": report_id,
        "targetType": target_type,
        "targetId": target_id,
        "targetName": target_name,
        "category": report.get("category", "other"),
        "reporterId": report.get("reporterId"),
        "reportText": report.get("text", ""),
        "proposedEdits": proposed_edits,
        "llmReasoning": reasoning or "",
        "llmConfidence": confidence,
        "status": "pending",
        "createdAt": now,
    }

    # Idempotency: check for existing proposal for this reportId
    existing = list(
        db.collection("reportTriage").where("reportId", "==", report_id).limit(1).stream()
    )
    if existing:
        triage_ref = existing[0].reference
        payload["updatedAt"] = now
        triage_ref.update(payload)
        triage_id = existing[0].id
    else:
        triage_ref = db.collection("reportTriage").document()
        triage_ref.set(payload)
        triage_id = triage_ref.id

    # Mark source report as processed
    try:
        report_ref.update({"triageStatus": "processed", "triageId": triage_id})
    except Exception as e:
        logger.warning("Could not mark report %s processed: %s", report_id, e)

    return json.dumps({"triageId": triage_id, "ok": True})


@tool
def count_pending_work() -> str:
    """Show what's in each review queue. Returns counts for pending reports,
    pending scrape drafts, open audit flags, and pending triage proposals.
    Useful for the agent to answer 'what needs my attention?'.
    """
    db = get_firestore_client()
    counts = {}
    for col, field, val in [
        ("reports", "triageStatus", "pending"),
        ("scrapeDrafts", "status", "pending"),
        ("venueAuditFlags", "status", "open"),
        ("reportTriage", "status", "pending"),
    ]:
        docs = list(db.collection(col).where(field, "==", val).limit(500).stream())
        counts[col] = len(docs)
    return json.dumps(counts)


ALL_TOOLS = [
    list_pending_reports,
    get_report_context,
    write_triage_proposal,
    count_pending_work,
]
