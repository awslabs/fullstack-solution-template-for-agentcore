"""Data validation pipeline — runs on every venue/exhibit write to prevent bad data."""

import json
import logging
import re
import urllib.request
from strands import tool
from tools.firebase_init import get_firestore_client

logger = logging.getLogger(__name__)

VENUE_REQUIRED = ["name", "location", "description", "imageUrl"]
EXHIBIT_REQUIRED = ["title", "venueId", "venueType", "description", "imageUrl"]
MIN_DESCRIPTION_LENGTH = 200


def _check_url(url: str, timeout: int = 5) -> bool:
    """Return True if URL is reachable."""
    if not url or not url.startswith("http"):
        return False
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Docent/1.0"})
        resp = urllib.request.urlopen(req, timeout=timeout)
        return resp.status < 400
    except Exception:
        return False


def _check_plagiarism_signals(text: str) -> list[str]:
    """Basic heuristic checks for directly copied text."""
    warnings = []
    if not text:
        return ["empty description"]
    # Common museum website boilerplate patterns
    boilerplate = ["all rights reserved", "©", "click here", "visit our website", "buy tickets", "learn more at"]
    for phrase in boilerplate:
        if phrase.lower() in text.lower():
            warnings.append(f"contains boilerplate: '{phrase}'")
    # Check for excessive capitalization (press release style)
    caps_ratio = sum(1 for c in text if c.isupper()) / max(len(text), 1)
    if caps_ratio > 0.3:
        warnings.append("excessive capitalization (possible press release copy)")
    return warnings


def _validate_document(data: dict, doc_type: str) -> dict:
    """Run the 8-step validation pipeline on a single document."""
    required = EXHIBIT_REQUIRED if doc_type == "exhibit" else VENUE_REQUIRED
    issues = []
    warnings = []
    passed = []

    # Step 1: Core properties
    missing = [f for f in required if not data.get(f)]
    if missing:
        issues.append({"step": 1, "check": "core_properties", "severity": "critical", "detail": f"Missing: {', '.join(missing)}"})
    else:
        passed.append("core_properties")

    # Step 2: Cross-verify official links
    for link_field in ["website", "exhibitionsUrl", "ticketUrl"]:
        url = data.get(link_field)
        if url and not url.startswith("http"):
            warnings.append({"step": 2, "check": "official_links", "severity": "warning", "detail": f"{link_field} is not a valid URL: {url}"})

    # Step 3: Description quality
    desc = data.get("description", "")
    if len(desc) < MIN_DESCRIPTION_LENGTH:
        issues.append({"step": 3, "check": "description_length", "severity": "warning", "detail": f"Description too short ({len(desc)} chars, min {MIN_DESCRIPTION_LENGTH})"})
    plag = _check_plagiarism_signals(desc)
    for p in plag:
        warnings.append({"step": 3, "check": "plagiarism_signal", "severity": "warning", "detail": p})
    if not plag and len(desc) >= MIN_DESCRIPTION_LENGTH:
        passed.append("description_quality")

    # Step 4: Image copyright (flag if from known stock/copyrighted domains)
    img = data.get("imageUrl", "")
    copyright_domains = ["gettyimages.com", "shutterstock.com", "alamy.com", "corbis.com", "ap.org"]
    if any(d in img.lower() for d in copyright_domains):
        issues.append({"step": 4, "check": "image_copyright", "severity": "critical", "detail": f"Image URL contains copyrighted domain: {img[:100]}"})
    elif img:
        passed.append("image_copyright")

    # Step 5: Keywords
    if not data.get("keywords"):
        warnings.append({"step": 5, "check": "keywords", "severity": "info", "detail": "No keywords defined"})
    else:
        passed.append("keywords")

    # Step 6: Image URL reachable
    if img:
        if not _check_url(img):
            issues.append({"step": 6, "check": "image_broken", "severity": "critical", "detail": f"Image URL unreachable: {img[:100]}"})
        else:
            passed.append("image_reachable")

    # Step 7: Links reachable
    for link_field in ["website", "exhibitionsUrl", "ticketUrl"]:
        url = data.get(link_field)
        if url:
            if not _check_url(url):
                warnings.append({"step": 7, "check": "link_broken", "severity": "warning", "detail": f"{link_field} unreachable: {url[:100]}"})
            else:
                passed.append(f"{link_field}_reachable")

    # Step 8: Confidence assessment
    critical_count = sum(1 for i in issues if i["severity"] == "critical")
    warning_count = len(warnings)
    if critical_count > 0:
        confidence = "low"
    elif warning_count > 2:
        confidence = "medium"
    else:
        confidence = "high"

    return {
        "name": data.get("name") or data.get("title") or "unknown",
        "confidence": confidence,
        "passed": passed,
        "issues": issues,
        "warnings": warnings,
        "recommendation": "reject" if critical_count > 0 else "review" if warning_count > 1 else "approve",
    }


@tool
def validate_before_write(collection: str, data: str) -> str:
    """Run the 8-step data validation pipeline on venue/exhibit data BEFORE writing to Firestore.
    collection: 'museums', 'galleries', or 'exhibits'
    data: JSON string of the document fields.
    Returns validation result with confidence level and recommendation (approve/review/reject).
    If rejected, the data should NOT be written. If review, track in Notion for manual audit."""
    parsed = json.loads(data)
    doc_type = "exhibit" if collection == "exhibits" else "venue"
    result = _validate_document(parsed, doc_type)
    return json.dumps(result, default=str)


@tool
def validate_existing_docs(collection: str, limit: int = 20) -> str:
    """Run the validation pipeline on existing documents in a collection.
    Returns a summary with per-document confidence and issues.
    Use for batch auditing existing data."""
    db = get_firestore_client()
    doc_type = "exhibit" if collection == "exhibits" else "venue"
    docs = list(db.collection(collection).limit(limit).stream())
    results = []
    for d in docs:
        data = d.to_dict()
        data["id"] = d.id
        v = _validate_document(data, doc_type)
        v["id"] = d.id
        results.append(v)

    summary = {
        "collection": collection,
        "checked": len(results),
        "approved": sum(1 for r in results if r["recommendation"] == "approve"),
        "needs_review": sum(1 for r in results if r["recommendation"] == "review"),
        "rejected": sum(1 for r in results if r["recommendation"] == "reject"),
        "documents": results,
    }
    return json.dumps(summary, default=str)


@tool
def find_venue_image(venue_name: str) -> str:
    """Find a working, copyright-free image for a venue from Wikimedia Commons.
    Returns the first image URL that returns HTTP 200. Use for museums and galleries only, NEVER for exhibits.
    Also returns attribution text."""
    import urllib.parse
    query = urllib.parse.quote(venue_name)
    # Search Wikimedia Commons
    search_url = f"https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch={query}&srnamespace=6&srlimit=5&format=json"
    try:
        req = urllib.request.Request(search_url, headers={"User-Agent": "Docent/1.0"})
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        titles = [r["title"].replace(" ", "_") for r in data.get("query", {}).get("search", [])]
        if not titles:
            return json.dumps({"error": "No images found on Wikimedia Commons", "venue": venue_name})

        # Get direct URLs
        titles_param = "|".join(titles[:3])
        info_url = f"https://commons.wikimedia.org/w/api.php?action=query&titles={urllib.parse.quote(titles_param)}&prop=imageinfo&iiprop=url|extmetadata&format=json"
        req2 = urllib.request.Request(info_url, headers={"User-Agent": "Docent/1.0"})
        resp2 = urllib.request.urlopen(req2, timeout=10)
        data2 = json.loads(resp2.read())

        for page in data2.get("query", {}).get("pages", {}).values():
            for ii in page.get("imageinfo", []):
                url = ii.get("url", "")
                if not url or not url.endswith((".jpg", ".jpeg", ".png", ".webp")):
                    continue
                # Verify URL works
                if _check_url(url):
                    meta = ii.get("extmetadata", {})
                    license_short = meta.get("LicenseShortName", {}).get("value", "")
                    artist = meta.get("Artist", {}).get("value", "")
                    attribution = f"Photo: {artist} via Wikimedia Commons" if artist else "Photo via Wikimedia Commons"
                    if license_short:
                        attribution += f", {license_short}"
                    return json.dumps({"url": url, "attribution": attribution, "license": license_short, "venue": venue_name})

        return json.dumps({"error": "All image URLs were broken", "venue": venue_name})
    except Exception as e:
        return json.dumps({"error": str(e), "venue": venue_name})


ALL_TOOLS = [validate_before_write, validate_existing_docs, find_venue_image]
