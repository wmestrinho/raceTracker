#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / "raceTracker"
VERSION = ROOT / "VERSION"

errors = []

required_files = [
    ROOT / "AGENTS.md",
    ROOT / "README.md",
    VERSION,
    CANON / "index.html",
    CANON / "telemetry.html",
    CANON / "workshop.html",
    CANON / "inventory.html",
    CANON / "schedule.html",
    CANON / "team.html",
    CANON / "settings.html",
    CANON / "assets/css/style.css",
    CANON / "assets/js/main.js",
    CANON / "assets/data/telemetry.json",
    CANON / "assets/images/racetracker-logo.png",
]
for f in required_files:
    if not f.exists():
        errors.append(f"Missing required canonical file: {f.relative_to(ROOT)}")

# Prevent parallel site roots
for forbidden in [ROOT / "docs"]:
    if forbidden.exists():
        errors.append(f"Forbidden duplicate site root exists: {forbidden.relative_to(ROOT)}")

# Prevent duplicate root assets tree for site files
dup_assets = ROOT / "assets"
if dup_assets.exists():
    errors.append("Forbidden duplicate assets root exists: assets/")

version = ""
if VERSION.exists():
    version = VERSION.read_text(errors="replace").strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?: (?:alpha|beta|rc))?", version):
        errors.append(f"VERSION has invalid format: {version!r}")

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
