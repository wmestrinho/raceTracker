#!/usr/bin/env python3
"""Report divergence between Emerson's calendar prototype and TKD Events.

There is exactly one operational calendar: the feed at
events.thekartdepot.com/events.json, owned by kart-depot-shopify. raceTracker
reads it and never writes to it.

But that feed was seeded by a **one-time hand copy** on 2026-09-04 from
Emerson's own prototype at calenderrace.netlify.app (a static page with a
hardcoded `EVENTS` array). Nothing propagates. If Emerson adds a date to his
page, it silently never reaches the app.

This script closes that gap the only way raceTracker legitimately can: by
noticing. It reports, it does not apply. Applying belongs to the repo that owns
events.json.

Rounds Emerson marks "local a confirmar" (venue not yet set) were deliberately
excluded from the feed, so they are not drift and are reported separately.

Exit status is 0 even when drift is found: raceTracker does not own this
calendar and must not fail its own build on a sibling's content. Use
--fail-on-drift if a caller genuinely wants a non-zero status.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

ORIGIN_URL = "https://calenderrace.netlify.app/"
FEED_URL = "https://events.thekartdepot.com/events.json"
UNCONFIRMED_MARKERS = ("local a confirmar", "a confirmar")
TIMEOUT = 20


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "raceTracker-drift-check/1.0"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.read().decode("utf-8", errors="replace")


def parse_origin_events(html: str) -> list[dict]:
    """Pull the hardcoded `const EVENTS = [...]` array out of the prototype page.

    The page is hand-maintained JS, not a data feed, so this is a parser of
    someone else's source. It is deliberately strict: a shape it does not
    recognise is reported as unreadable rather than quietly treated as empty,
    because "no drift" and "could not read the page" must never look alike.
    """
    match = re.search(r"const\s+EVENTS\s*=\s*\[", html)
    if not match:
        raise ValueError("could not find the EVENTS array on the origin page")

    start = match.end() - 1
    depth = 0
    end = None
    for i in range(start, len(html)):
        if html[i] == "[":
            depth += 1
        elif html[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise ValueError("the EVENTS array on the origin page is unterminated")

    body = html[start:end]
    # Object keys are bare identifiers in the source; quote them, drop trailing
    # commas, and the remainder is JSON.
    body = re.sub(r"//[^\n]*", "", body)
    body = re.sub(r"(?m)^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', body)
    body = re.sub(r",(\s*[}\]])", r"\1", body)

    events = json.loads(body)
    if not isinstance(events, list) or not events:
        raise ValueError("the EVENTS array parsed to no events")
    return events


def origin_key(event: dict) -> tuple[str, str]:
    return (str(event.get("date_start", "")).strip(), str(event.get("series", "")).strip())


def feed_key(event: dict) -> tuple[str, str]:
    days = [d.get("id", "") for d in event.get("days", []) if isinstance(d, dict)]
    start = min(days) if days else ""
    return (start, str(event.get("series", "")).strip())


def is_unconfirmed(event: dict) -> bool:
    haystack = f"{event.get('title', '')} {event.get('location', '')}".lower()
    return any(marker in haystack for marker in UNCONFIRMED_MARKERS)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin-file", help="read the origin page from a local file instead of the network")
    parser.add_argument("--feed-file", help="read the feed from a local file instead of the network")
    parser.add_argument("--fail-on-drift", action="store_true",
                        help="exit non-zero when drift is found (off by default: raceTracker does not own this calendar)")
    args = parser.parse_args()

    try:
        origin_html = open(args.origin_file, encoding="utf-8").read() if args.origin_file else fetch(ORIGIN_URL)
        feed_raw = open(args.feed_file, encoding="utf-8").read() if args.feed_file else fetch(FEED_URL)
    except (urllib.error.URLError, OSError) as exc:
        # Unreachable is not "in sync". Say which, and do not fail the build.
        print(f"SKIPPED  could not reach a calendar source: {exc}")
        return 0

    try:
        origin_events = parse_origin_events(origin_html)
        feed_events = json.loads(feed_raw).get("events", [])
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"UNREADABLE  {exc}")
        print("            The origin page's shape may have changed. Re-read it by hand"
              " before trusting this check again.")
        return 1 if args.fail_on_drift else 0

    confirmed = {origin_key(e): e for e in origin_events if not is_unconfirmed(e)}
    unconfirmed = [e for e in origin_events if is_unconfirmed(e)]
    published = {feed_key(e): e for e in feed_events}

    missing = sorted(k for k in confirmed if k not in published)
    extra = sorted(k for k in published if k not in confirmed)

    # Titles legitimately differ: the feed was translated to English during the
    # 2026-09-04 copy ("Dirt, Sprint e Enduro" -> "Dirt, Sprint and Enduro"),
    # so comparing them would be permanent noise. Venue is a real operational
    # fact, so a venue that moved is worth saying out loud.
    moved = []
    for key in sorted(set(confirmed) & set(published)):
        origin_venue = str(confirmed[key].get("location", "")).strip()
        feed_venue = str(published[key].get("venue", "")).strip()
        if not origin_venue or not feed_venue:
            continue
        # Compare the track name only — the segment before the first comma.
        # Both sides spell the location detail differently for the same track
        # ("Las Vegas Motor Speedway, NV" vs "…, Las Vegas, NV"), and flagging
        # that would train us to ignore this whole section. A genuinely
        # different track still has a different name.
        left = origin_venue.split(",")[0].strip().lower()
        right = feed_venue.split(",")[0].strip().lower()
        if left == right:
            continue
        moved.append((key, origin_venue, feed_venue))

    print(f"Origin  {ORIGIN_URL}  {len(origin_events)} events"
          f" ({len(confirmed)} with a confirmed venue, {len(unconfirmed)} awaiting one)")
    print(f"Feed    {FEED_URL}  {len(feed_events)} events")
    print()

    print("Matched on date + series. Titles are not compared: the feed was translated")
    print("to English during the one-time copy, so title differences are expected.")
    print()

    if not missing and not extra and not moved:
        print("IN SYNC  every confirmed round on Emerson's page is published, and nothing extra.")
    if missing:
        print(f"DRIFT  {len(missing)} confirmed round(s) on Emerson's page are NOT in the published feed:")
        for key in missing:
            event = confirmed[key]
            print(f"  + {key[0]}  {key[1]} — {event.get('title', '')}  [{event.get('location', '')}]")
        print("       kart-depot-shopify owns events.json — these need adding there, not here.")
        print("       Some may have been excluded on purpose; confirm before treating as missed.")
    if extra:
        print(f"NOTE   {len(extra)} published event(s) are not on Emerson's page:")
        for key in extra:
            print(f"  - {key[0]}  {key[1]} — {published[key].get('name', '')}")
        print("       Expected for anything added directly to the feed; check nothing was dropped.")
    if moved:
        print(f"VENUE  {len(moved)} round(s) name a different venue on each side:")
        for key, origin_venue, feed_venue in moved:
            print(f"  ! {key[0]}  {key[1]}")
            print(f"      Emerson: {origin_venue}")
            print(f"      Feed:    {feed_venue}")

    if unconfirmed:
        print()
        print(f"HELD   {len(unconfirmed)} round(s) still marked \"a confirmar\" — excluded by design:")
        for event in unconfirmed[:5]:
            print(f"  · {event.get('date_start', '')}  {event.get('title', '')}")
        if len(unconfirmed) > 5:
            print(f"  · … and {len(unconfirmed) - 5} more")

    if (missing or moved) and args.fail_on_drift:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
