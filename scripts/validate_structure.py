#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / "raceTracker"
INDEX = CANON / "index.html"

errors = []

required_files = [
    CANON / "index.html",
    CANON / "assets/css/style.css",
    CANON / "assets/js/main.js",
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

if INDEX.exists():
    html = INDEX.read_text(errors="replace")

    # Detect control chars except common whitespace
    bad = [c for c in html if ord(c) < 32 and c not in "\n\r\t"]
    if bad:
        errors.append("index.html contains control characters")

    # Internal anchor validation
    ids = set(re.findall(r'\sid="([^"]+)"', html))
    hrefs = re.findall(r'href="#([^"]*)"', html)
    missing = sorted({h for h in hrefs if h and h not in ids})
    if missing:
        errors.append("Missing anchor targets: " + ", ".join(missing))

if errors:
    print("VALIDATION FAILED")
    for e in errors:
        print(f"- {e}")
    sys.exit(1)

print("VALIDATION OK")
