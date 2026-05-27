#!/usr/bin/env python3
"""Convert a published Google Sheet CSV into raceTracker event-schedule JSON.

Expected CSV columns (case-insensitive; spaces/underscores ignored):
- track_id or track
- event_name or name
- date or date_label
- registration_status
- registration_url
- source
- source_url
- class_summary (optional)
- notes (optional)

Usage:
  RACETRACKER_EVENT_SHEET_CSV_URL="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv" \
    python3 scripts/ingest_google_sheet.py

Output defaults to raceTracker/assets/data/event-schedule.json.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "raceTracker/assets/data/event-schedule.json"
TRACK_ALIASES = {
    "new castle": "new-castle-motorsports-park",
    "new castle motorsports park": "new-castle-motorsports-park",
    "ncmp": "new-castle-motorsports-park",
    "trackhouse": "trackhouse-motorplex",
    "trackhouse motorplex": "trackhouse-motorplex",
    "mooresville": "trackhouse-motorplex",
}


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def pick(row: dict[str, str], *names: str) -> str:
    normalized = {normalize_key(key): value.strip() for key, value in row.items() if key is not None and value is not None}
    for name in names:
        value = normalized.get(normalize_key(name), "")
        if value:
            return value
    return ""


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "event"


def load_csv(url: str) -> list[dict[str, str]]:
    req = urllib.request.Request(url, headers={"User-Agent": "raceTracker Google Sheets ingest"})
    with urllib.request.urlopen(req, timeout=30) as response:
        text = response.read().decode("utf-8-sig")
    return list(csv.DictReader(text.splitlines()))


def map_track(value: str) -> str:
    raw = value.strip()
    if raw in {"new-castle-motorsports-park", "trackhouse-motorplex"}:
        return raw
    lowered = raw.lower()
    return TRACK_ALIASES.get(lowered, slugify(raw))


def build_event(row: dict[str, str], index: int) -> dict[str, str]:
    track_value = pick(row, "track_id", "track", "venue")
    track_id = map_track(track_value or "source-needed")
    name = pick(row, "event_name", "name", "event") or "Unnamed event"
    date = pick(row, "date", "date_label", "starts_at", "start") or "Date needed"
    source = pick(row, "source", "provider") or "Google Sheets"
    source_url = pick(row, "source_url", "url")
    registration_url = pick(row, "registration_url", "registration", "register_url")
    event_id = pick(row, "id", "event_id") or f"{track_id}-{slugify(name)}-{index + 1}"
    event = {
        "id": event_id,
        "trackId": track_id,
        "track": track_value or track_id,
        "name": name,
        "date": date,
        "registrationStatus": pick(row, "registration_status", "status") or ("Link available" if registration_url else "Provider needed"),
        "registrationUrl": registration_url,
        "source": source,
    }
    if source_url:
        event["sourceUrl"] = source_url
    for optional in ["class_summary", "notes"]:
        value = pick(row, optional)
        if value:
            event[optional.replace("_", "")] = value
    return event


def main() -> int:
    url = os.environ.get("RACETRACKER_EVENT_SHEET_CSV_URL", "").strip()
    if not url:
        print("Set RACETRACKER_EVENT_SHEET_CSV_URL to a published Google Sheets CSV URL.", file=sys.stderr)
        return 2

    output = Path(os.environ.get("RACETRACKER_EVENT_SHEET_OUTPUT", str(DEFAULT_OUTPUT)))
    if not output.is_absolute():
        output = ROOT / output

    rows = load_csv(url)
    events = [build_event(row, idx) for idx, row in enumerate(rows) if any((value or "").strip() for value in row.values())]
    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceStatus": "google-sheets-bridge",
        "notes": "Generated from the temporary Google Sheets bridge. Supabase is the durable target backend.",
        "events": events,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Wrote {len(events)} event(s) to {output.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
