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
    CANON / "team.html",
    CANON / "settings.html",
    CANON / "assets/css/style.css",
    CANON / "assets/js/main.js",
    CANON / "assets/data/telemetry.json",
    CANON / "assets/data/mechanics.json",
    CANON / "assets/data/workshop-tasks.json",
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
        if cfg.get("pages_build_output_dir") != "raceTracker":
            errors.append("wrangler.jsonc pages_build_output_dir must be raceTracker")
        domains = cfg.get("custom_domain", [])
        if CANONICAL_DOMAIN not in domains:
            errors.append(f"wrangler.jsonc custom_domain must include {CANONICAL_DOMAIN}")
    except json.JSONDecodeError as exc:
        errors.append(f"wrangler.jsonc is not valid JSON/JSONC subset: {exc}")

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
