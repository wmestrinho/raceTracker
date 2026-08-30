#!/usr/bin/env python3
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / "raceTracker"
VERSION = ROOT / "VERSION"
README = ROOT / "README.md"
WRANGLER = ROOT / "wrangler.jsonc"
CANONICAL_DOMAIN = "tracker.absolutelyplausible.com"
CANONICAL_LOGO = CANON / "assets/images/racetracker-logo.png"

errors = []

required_files = [
    ROOT / "AGENTS.md",
    README,
    VERSION,
    WRANGLER,
    CANON / "index.html",
    CANON / "telemetry.html",
    CANON / "workshop.html",
    CANON / "inventory.html",
    CANON / "schedule.html",
    CANON / "weather.html",
    CANON / "team.html",
    CANON / "settings.html",
    CANON / "registrations.html",
    CANON / "billing.html",
    CANON / "assets/css/style.css",
    CANON / "assets/js/main.js",
    CANON / "assets/data/telemetry.json",
    CANON / "assets/data/mechanics.json",
    CANON / "assets/data/workshop-tasks.json",
    CANON / "assets/data/track-context.json",
    CANON / "assets/data/event-schedule.json",
    CANON / "assets/data/billing.json",
    CANON / "assets/data/series-calendars.json",
    CANON / "assets/data/weather-alert-rules.json",
    CANON / "assets/data/race-weather.json",
    ROOT / "scripts/build_weather_forecast.py",
    CANONICAL_LOGO,
]
for f in required_files:
    if not f.exists():
        errors.append(f"Missing required canonical file: {f.relative_to(ROOT)}")

# Prevent parallel site roots and path aliases that confuse future agents.
root_entries = {p.name for p in ROOT.iterdir()}
for forbidden in ["docs", "site", "public", "dist", "build", "assets"]:
    if forbidden in root_entries:
        errors.append(f"Forbidden duplicate site/root asset directory exists: {forbidden}/")
for entry in root_entries:
    if entry.lower() == "racetracker" and entry != "raceTracker":
        errors.append(f"Forbidden case-variant frontend directory exists: {entry}/; use raceTracker/ only")

# Prevent disposable macOS metadata from being committed anywhere in the repo.
for ds_store in ROOT.rglob(".DS_Store"):
    if ".git" not in ds_store.parts:
        errors.append(f"Remove macOS metadata file: {ds_store.relative_to(ROOT)}")

# Prevent ambiguous logo variants. Canonical deployed logo is racetracker-logo.png.
images_dir = CANON / "assets/images"
if images_dir.exists():
    for logo in images_dir.glob("*logo*"):
        if logo != CANONICAL_LOGO:
            errors.append(f"Unexpected logo variant: {logo.relative_to(ROOT)}; keep canonical {CANONICAL_LOGO.relative_to(ROOT)}")

version = ""
if VERSION.exists():
    version = VERSION.read_text(errors="replace").strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?: (?:alpha|beta|rc))?", version):
        errors.append(f"VERSION has invalid format: {version!r}")

if README.exists() and version:
    readme = README.read_text(errors="replace")
    stale_versions = sorted(set(re.findall(r"v\d+\.\d+\.\d+(?: (?:alpha|beta|rc))?", readme)) - {version})
    if stale_versions:
        errors.append("README.md contains stale version reference(s): " + ", ".join(stale_versions))
    if version not in readme:
        errors.append(f"README.md does not mention current VERSION: {version}")

if WRANGLER.exists():
    try:
        cfg = json.loads(WRANGLER.read_text(errors="replace"))
        # Accept either Pages pattern (pages_build_output_dir) or Worker+Assets pattern (assets.directory)
        pages_dir = cfg.get("pages_build_output_dir")
        assets_dir = (cfg.get("assets") or {}).get("directory")
        if pages_dir != "raceTracker" and assets_dir != "raceTracker":
            errors.append("wrangler.jsonc must set pages_build_output_dir or assets.directory to raceTracker")
        # custom_domain is optional in Worker+Assets mode (managed via dashboard)
        domains = cfg.get("custom_domain", [])
        if domains and CANONICAL_DOMAIN not in domains:
            errors.append(f"wrangler.jsonc custom_domain must include {CANONICAL_DOMAIN}")
    except json.JSONDecodeError as exc:
        errors.append(f"wrangler.jsonc is not valid JSON/JSONC subset: {exc}")

# Every data file must parse, and every calendar round that names a track must
# resolve to coordinates the weather pipeline can actually forecast against.
parsed = {}
for data_file in sorted((CANON / "assets/data").glob("*.json")):
    try:
        parsed[data_file.name] = json.loads(data_file.read_text(errors="replace"))
    except json.JSONDecodeError as exc:
        errors.append(f"{data_file.relative_to(ROOT)} is not valid JSON: {exc}")

calendars = parsed.get("series-calendars.json")
tracks = parsed.get("track-context.json")
if isinstance(tracks, dict):
    for track in tracks.get("tracks", []):
        if not isinstance(track.get("latitude"), (int, float)) or not isinstance(track.get("longitude"), (int, float)):
            errors.append(f"track-context.json track '{track.get('id')}' is missing usable coordinates")
if isinstance(calendars, dict) and isinstance(tracks, dict):
    track_ids = {track.get("id") for track in tracks.get("tracks", [])}
    for series in calendars.get("series", []):
        for rnd in series.get("rounds", []):
            track_id = rnd.get("trackId")
            if track_id and track_id not in track_ids:
                errors.append(f"series-calendars.json round '{rnd.get('name')}' references unknown trackId: {track_id}")
            if rnd.get("nationalTier") == "pro-2stroke" and not track_id:
                errors.append(f"National pro 2-stroke round '{rnd.get('name')}' has no trackId; the weather pipeline cannot forecast it")

html_files = sorted(CANON.glob("*.html")) if CANON.exists() else []
for html_file in html_files:
    html = html_file.read_text(errors="replace")

    # Detect control chars except common whitespace
    bad = [c for c in html if ord(c) < 32 and c not in "\n\r\t"]
    if bad:
        errors.append(f"{html_file.relative_to(ROOT)} contains control characters")

    # Detect accidental read_file line-number prefixes committed into source
    bad_lines = [i for i, line in enumerate(html.splitlines(), start=1) if re.match(r"^\s*\d+\|", line)]
    if bad_lines:
        errors.append(f"{html_file.relative_to(ROOT)} contains line-number prefixes at lines: {bad_lines[:5]}")

    if version and version not in html:
        errors.append(f"VERSION is not displayed in {html_file.relative_to(ROOT)} footer: {version}")

    # Internal anchor validation, only for same-page hash hrefs
    ids = set(re.findall(r'\sid="([^"]+)"', html))
    hrefs = re.findall(r'href="#([^"]*)"', html)
    missing = sorted({h for h in hrefs if h and h not in ids})
    if missing:
        errors.append(f"{html_file.relative_to(ROOT)} missing anchor targets: " + ", ".join(missing))

if errors:
    print("VALIDATION FAILED")
    for e in errors:
        print(f"- {e}")
    sys.exit(1)

print("VALIDATION OK")
