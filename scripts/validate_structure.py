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
BRAND_LOGOS = {
    CANON / "assets/images/evolution-kart-school.png",
    CANON / "assets/images/tkd-the-kart-depot.png",
}
LEGACY_LOGO = CANON / "assets/images/racetracker-logo.png"

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
    CANON / "assets/data/entities.json",
    *sorted(BRAND_LOGOS),
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

# The two client logos are the deployed identity. Keep the legacy raceTracker mark
# recoverable during the transition, but reject any other untracked logo variants.
images_dir = CANON / "assets/images"
if images_dir.exists():
    allowed_logos = BRAND_LOGOS | {LEGACY_LOGO}
    for logo in images_dir.glob("*logo*"):
        if logo not in allowed_logos:
            errors.append(
                f"Unexpected logo variant: {logo.relative_to(ROOT)}; allowed logos are "
                + ", ".join(str(path.relative_to(ROOT)) for path in sorted(allowed_logos))
            )

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

    # Workspace header/footer contract. Keep these structural checks close to the
    # HTML loop so a copied page cannot silently drift from the shared shell.
    headers = re.findall(r"<header\b[\s\S]*?</header>", html)
    if len(headers) != 1:
        errors.append(f"{html_file.relative_to(ROOT)} must contain exactly one <header>")
    else:
        header = headers[0]
        if not re.match(r'<header\b[^>]*>\s*<div class="header-inner">', header):
            errors.append(f"{html_file.relative_to(ROOT)} header must start with one .header-inner wrapper")
        if '<nav aria-label="Primary">' not in header:
            errors.append(f"{html_file.relative_to(ROOT)} primary nav must be inside the header")
        if not re.search(r'<a href="/" class="brand" aria-label="[^"]+ home"[^>]*>', header):
            errors.append(f"{html_file.relative_to(ROOT)} brand must link to / with a '<Brand> home' label")
        entity_logo = re.search(r'<img[^>]*data-entity-logo[^>]*>', header)
        if not entity_logo or 'alt=""' not in entity_logo.group(0):
            errors.append(f"{html_file.relative_to(ROOT)} header brand logo must be decorative (alt=\"\")")

    footers = re.findall(r"<footer\b[\s\S]*?</footer>", html)
    if len(footers) != 1:
        errors.append(f"{html_file.relative_to(ROOT)} must contain exactly one <footer>")
    else:
        footer = footers[0]
        if not re.match(r'<footer class="site-footer">\s*<div class="site-footer__inner">', footer):
            errors.append(f"{html_file.relative_to(ROOT)} footer must use the client-site wrapper")
        if 'Site by <a href="https://absolutelyplausible.com" target="_blank" rel="noopener">Absolutely Plausible</a>' not in footer:
            errors.append(f"{html_file.relative_to(ROOT)} footer must use canonical client attribution")
        if not re.search(r'<p class="footer-version">[^<]+</p>\s*</div>\s*</footer>$', footer):
            errors.append(f"{html_file.relative_to(ROOT)} version must be the final footer element")
        if '<span data-current-year>' not in footer:
            errors.append(f"{html_file.relative_to(ROOT)} footer copyright year must be JS-current")

    # Internal anchor validation, only for same-page hash hrefs
    ids = set(re.findall(r'\sid="([^"]+)"', html))
    hrefs = re.findall(r'href="#([^"]*)"', html)
    missing = sorted({h for h in hrefs if h and h not in ids})
    if missing:
        errors.append(f"{html_file.relative_to(ROOT)} missing anchor targets: " + ", ".join(missing))

# ── Brand palette drift ───────────────────────────────────────────────────
# <meta name="theme-color"> cannot reference a CSS variable, so it is the one
# place the brand colour must be repeated by hand. It is pinned to the
# Trackside Navy page ground of the *default* entity (Evolution Kart School)
# for the pre-JS/first-paint value; applyEntity() in main.js repaints it to
# --tkd-bg at runtime when The Kart Depot workspace is selected (see
# ENTITY_THEME_COLOR there) — that second mapping isn't statically checkable
# here, so keep the two in step by hand if either shell colour changes.
CSS_PATH = CANON / "assets/css/style.css"
try:
    css_text = CSS_PATH.read_text(errors="replace")
except OSError as exc:
    css_text = ""
    errors.append(f"Could not read {CSS_PATH.name}: {exc}")

if css_text:
    primary_match = re.search(r"--navy:\s*(#[0-9a-fA-F]{3,8})", css_text)
    if not primary_match:
        errors.append("Could not parse --navy from style.css — the theme-color guard is not running")
    else:
        primary = primary_match.group(1).lower()
        for html_file in sorted(CANON.glob("*.html")):
            found = re.search(r'name="theme-color"\s+content="(#[0-9a-fA-F]{3,8})"',
                              html_file.read_text(errors="replace"))
            if not found:
                errors.append(f"{html_file.relative_to(ROOT)} has no theme-color meta tag")
            elif found.group(1).lower() != primary:
                errors.append(
                    f"{html_file.relative_to(ROOT)} theme-color {found.group(1)} does not match "
                    f"--navy {primary} in style.css"
                )

    # A raw brand rgba()/rgb() literal would survive a palette swap. Channel tokens
    # exist precisely so it cannot; series badge colours are a documented exception.
    for line_no, line in enumerate(css_text.splitlines(), start=1):
        if "cal-sbadge--" in line:
            continue
        if re.search(r"rgba?\(\s*(?:0[ ,]+26[ ,]+82|10[ ,]+76[ ,]+255|254[ ,]+191[ ,]+0)", line):
            errors.append(
                f"style.css:{line_no} hardcodes a brand hue in rgba(); use "
                f"rgb(var(--primary-rgb) / a) or rgb(var(--accent-rgb) / a) instead"
            )

# ── Entity integrity ──────────────────────────────────────────────────────
# Evolution Kart School and The Kart Depot are separate legal entities. An
# expense pointing at an entity that does not exist would silently land in the
# wrong set of books.
ENTITIES_PATH = CANON / "assets/data/entities.json"
BILLING_PATH = CANON / "assets/data/billing.json"

entity_ids = set()
try:
    entities_doc = json.loads(ENTITIES_PATH.read_text(errors="replace"))
    entity_ids = {e.get("id") for e in entities_doc.get("entities", [])}
    if len(entity_ids) < 2:
        errors.append("entities.json must define both Evolution Kart School and The Kart Depot")
    for entity in entities_doc.get("entities", []):
        for field in ("id", "name", "shortName", "legalName", "badgeLabel", "logo", "accent", "accentContrast"):
            if not entity.get(field):
                errors.append(f"entities.json entry {entity.get('id', '?')}: missing {field}")
        if entity.get("accentPlaceholder"):
            errors.append(f"entities.json entry {entity.get('id', '?')}: brand accent is still marked as a placeholder")
        logo_path = str(entity.get("logo", ""))
        if logo_path.startswith("/assets/images/"):
            resolved_logo = CANON / logo_path.removeprefix("/")
            if resolved_logo not in BRAND_LOGOS or not resolved_logo.exists():
                errors.append(f"entities.json entry {entity.get('id', '?')}: unknown brand logo {logo_path!r}")
        else:
            errors.append(f"entities.json entry {entity.get('id', '?')}: logo must live under /assets/images/")
    if entities_doc.get("defaultEntityId") not in entity_ids:
        errors.append("entities.json defaultEntityId does not match any entity")
except (OSError, json.JSONDecodeError) as exc:
    errors.append(f"Could not parse entities.json: {exc}")

try:
    billing_doc = json.loads(BILLING_PATH.read_text(errors="replace"))
    for expense in billing_doc.get("expenses", []):
        owner = expense.get("entityId")
        if not owner:
            errors.append(f"billing.json {expense.get('id', '?')}: missing entityId")
        elif entity_ids and owner not in entity_ids:
            errors.append(f"billing.json {expense.get('id', '?')}: unknown entityId '{owner}'")
except (OSError, json.JSONDecodeError) as exc:
    errors.append(f"Could not parse billing.json: {exc}")

# ── Series calendar completeness ──────────────────────────────────────────
CAL_PATH = CANON / "assets/data/series-calendars.json"
TRACKS_PATH = CANON / "assets/data/track-context.json"
WEATHER_PATH = CANON / "assets/data/race-weather.json"

VALID_ENGINE_TYPES = {"2-stroke", "4-stroke", "mixed"}
VALID_WEATHER_MODES = {"actual", "forecast", "climate", "unavailable"}


def weekend_key(series_id, division, round_id):
    """Must match calRoundKey() in main.js and weekend_key() in the refresh script."""
    return f"{series_id}:{division or 'main'}:{round_id}"


calendar = tracks = None
calendar_keys = set()

try:
    calendar = json.loads(CAL_PATH.read_text())
    tracks = json.loads(TRACKS_PATH.read_text())
except (OSError, json.JSONDecodeError) as exc:
    errors.append(f"Could not parse calendar/track data: {exc}")

if calendar and tracks:
    track_ids = {t.get("id") for t in tracks.get("tracks", [])}
    geo_ok = {
        t["id"] for t in tracks.get("tracks", [])
        if t.get("latitude") is not None and t.get("longitude") is not None
    }

    for series in calendar.get("series", []):
        sid = series.get("id", "?")
        if series.get("engineType") not in VALID_ENGINE_TYPES:
            errors.append(f"series {sid}: engineType must be one of {sorted(VALID_ENGINE_TYPES)}")
        if not series.get("country"):
            errors.append(f"series {sid}: missing country")
        # Scope is US-only through roughly 2028. A non-US series or round is a
        # build failure rather than silent scope creep — see CLAUDE.md.
        elif series.get("country") != "US":
            errors.append(
                f"series {sid}: country '{series['country']}' is outside the US-only scope; "
                f"remove it or lift the scope rule in validate_structure.py and CLAUDE.md"
            )

        for rnd in series.get("rounds", []):
            key = weekend_key(sid, rnd.get("division"), rnd.get("round"))
            if rnd.get("country") and rnd["country"] != "US":
                errors.append(
                    f"round {key}: country '{rnd['country']}' is outside the US-only scope"
                )
            if key in calendar_keys:
                errors.append(f"duplicate round key: {key}")
            calendar_keys.add(key)

            if rnd.get("status") == "confirmed" and rnd.get("track") not in (None, "TBD"):
                tid = rnd.get("trackId")
                # Multi-venue entries legitimately have no single track.
                multi = str(rnd.get("track", "")).lower().startswith("multiple")
                if not tid and not multi:
                    errors.append(f"round {key}: confirmed but has no trackId")
                elif tid and tid not in track_ids:
                    errors.append(f"round {key}: trackId '{tid}' not in track-context.json")
                elif tid and tid not in geo_ok:
                    errors.append(f"round {key}: track '{tid}' has no coordinates")

# ── Generated race weather (optional until the refresh job first runs) ─────
if WEATHER_PATH.exists():
    try:
        weather = json.loads(WEATHER_PATH.read_text())
    except json.JSONDecodeError as exc:
        errors.append(f"race-weather.json is not valid JSON: {exc}")
        weather = None

    if weather is not None:
        if weather.get("schemaVersion") != 1:
            errors.append(f"race-weather.json schemaVersion must be 1, got {weather.get('schemaVersion')}")
        weekends = weather.get("weekends")
        if not isinstance(weekends, list):
            errors.append("race-weather.json weekends must be a list")
            weekends = []

        seen = set()
        for entry in weekends:
            key = entry.get("key", "?")
            if key in seen:
                errors.append(f"race-weather.json duplicate key: {key}")
            seen.add(key)

            mode = entry.get("mode")
            if mode not in VALID_WEATHER_MODES:
                errors.append(f"race-weather.json {key}: invalid mode '{mode}'")
            elif mode == "unavailable":
                if not entry.get("unavailableReason"):
                    errors.append(f"race-weather.json {key}: unavailable with no reason")
            else:
                days = entry.get("days")
                if not days:
                    errors.append(f"race-weather.json {key}: mode '{mode}' with no days")
                    days = []
                if not entry.get("summary"):
                    errors.append(f"race-weather.json {key}: mode '{mode}' with no summary")
                start, end = entry.get("dateStart"), entry.get("dateEnd") or entry.get("dateStart")
                dates = [d.get("date") for d in days]
                if dates != sorted(dates):
                    errors.append(f"race-weather.json {key}: days are not sorted")
                if len(set(dates)) != len(dates):
                    errors.append(f"race-weather.json {key}: duplicate day dates")
                for day_date in dates:
                    if start and day_date and not (start <= day_date <= end):
                        errors.append(f"race-weather.json {key}: day {day_date} outside {start}..{end}")

        # A stale generated file after a calendar edit is the likeliest breakage.
        if calendar_keys and seen:
            orphaned = sorted(seen - calendar_keys)
            missing = sorted(calendar_keys - seen)
            if orphaned:
                errors.append(f"race-weather.json has {len(orphaned)} key(s) not on the calendar: {orphaned[:5]}")
            if missing:
                errors.append(f"race-weather.json is missing {len(missing)} calendar round(s): {missing[:5]}")

# ── Risk thresholds must agree between the browser and the generator ───────
JS_PATH = CANON / "assets/js/main.js"
PY_PATH = ROOT / "scripts/refresh_race_weather.py"


def parse_threshold_block(text, marker, terminator):
    """Pull `name: value` pairs out of a threshold literal. Returns None if unparseable."""
    start = text.find(marker)
    if start == -1:
        return None
    end = text.find(terminator, start)
    if end == -1:
        return None
    block = text[start:end]
    found = {}
    for name, raw in re.findall(r'["\']?([A-Za-z]+)["\']?\s*:\s*(\[[^\]]*\]|[0-9.]+)', block):
        if name == marker.split()[-1]:
            continue
        if raw.startswith("["):
            found[name] = [int(v) for v in re.findall(r"\d+", raw)]
        else:
            found[name] = float(raw)
    return found or None


try:
    js_thresholds = parse_threshold_block(JS_PATH.read_text(), "const WEATHER_THRESHOLDS", "};")
    py_thresholds = parse_threshold_block(PY_PATH.read_text(), "RISK_THRESHOLDS = {", "\n}")
except OSError as exc:
    errors.append(f"Could not read threshold sources: {exc}")
    js_thresholds = py_thresholds = None

if js_thresholds is None:
    errors.append("Could not parse WEATHER_THRESHOLDS from main.js — the drift guard is not running")
elif py_thresholds is None:
    errors.append("Could not parse RISK_THRESHOLDS from refresh_race_weather.py — the drift guard is not running")
else:
    for name in sorted(set(js_thresholds) | set(py_thresholds)):
        js_value, py_value = js_thresholds.get(name), py_thresholds.get(name)
        if js_value != py_value:
            errors.append(
                f"risk threshold '{name}' differs: main.js={js_value} vs refresh_race_weather.py={py_value}"
            )

if errors:
    print("VALIDATION FAILED")
    for e in errors:
        print(f"- {e}")
    sys.exit(1)

print("VALIDATION OK")
