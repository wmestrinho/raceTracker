#!/usr/bin/env python3
"""Generate raceTracker/assets/data/race-weather.json — per-race-weekend weather.

Joins every round in series-calendars.json to its venue coordinates in
track-context.json, then fills in weather for each race weekend from Open-Meteo
(public, credential-free — no API key, per the live-data guardrails in AGENTS.md).

Open-Meteo's forecast only reaches 16 days, but a season calendar spans a year,
so each weekend lands in one of four modes:

    actual        weekend already ran  -> recorded conditions (ERA5 archive)
    forecast      within 16 days       -> real forecast
    climate       further out          -> climate normals from past seasons
    unavailable   no venue, multi-month event, non-race, or a failed fetch

Usage
    python3 scripts/refresh_race_weather.py

Environment
    RACETRACKER_WEATHER_OUTPUT         output path (default: the canonical file)
    RACETRACKER_WEATHER_FORCE_CLIMATE  refetch climate normals, ignoring the cache
    RACETRACKER_WEATHER_OFFLINE        no network; validate the join and re-emit
                                       from the previous file (used by CI)
    RACETRACKER_WEATHER_GEOCODE        print paste-ready track-context entries for
                                       venues missing coordinates, then exit
    RACETRACKER_WEATHER_TIMEOUT        per-request seconds (default 45)
"""

from __future__ import annotations

import hashlib
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CALENDAR = ROOT / "raceTracker/assets/data/series-calendars.json"
TRACK_CONTEXT = ROOT / "raceTracker/assets/data/track-context.json"
DEFAULT_OUTPUT = ROOT / "raceTracker/assets/data/race-weather.json"

SCHEMA_VERSION = 1
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"

FORECAST_HORIZON_DAYS = 16
FORECAST_PAST_DAYS = 7
# ERA5 trails real time by roughly five days; anything more recent is forecast.
ARCHIVE_LAG_DAYS = 5
CLIMATE_YEARS = (2016, 2025)
CLIMATE_WINDOW_DAYS = 3
CLIMATE_CACHE_DAYS = 30
MAX_WEEKEND_SPAN_DAYS = 14  # mirrors CONFLICT_MAX_SPAN_DAYS in main.js
CALENDAR_STALE_DAYS = 60

MIN_REQUEST_INTERVAL_S = 1.1
USER_AGENT = "raceTracker weather refresh (tracker.absolutelyplausible.com)"

DAILY_FORECAST_VARS = (
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
    "precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max"
)
DAILY_ARCHIVE_VARS = (
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
    "wind_speed_10m_max,wind_gusts_10m_max"
)

# Mirrors WEATHER_THRESHOLDS in raceTracker/assets/js/main.js.
# scripts/validate_structure.py fails the build if the two drift apart.
RISK_THRESHOLDS = {
    "rainyCodes": [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99],
    "currentRainIn": 0.03,
    "dailyRainIn": 0.10,
    "dailyRainProbPct": 60,
    "climateWetDayPct": 50,
    "alertGustMph": 28,
    "warnWindMph": 14,
    "warnGustMph": 20,
    "hotF": 92,
    "coldF": 50,
}

RISK_COPY = {
    "alert": {
        "label": "Weather risk high",
        "guidance": (
            "Track conditions can move quickly. Prioritize rain setup, visor prep, "
            "tire pressure notes, and extra brake/fuel checks before release."
        ),
    },
    "warn": {
        "label": "Watch conditions",
        "guidance": (
            "Flag the session for setup review. Re-check pressures, gearing/jetting "
            "assumptions, and driver feedback after the first run."
        ),
    },
    "ok": {
        "label": "Good track window",
        "guidance": (
            "Conditions look stable. Keep normal pressure logs and compare telemetry "
            "against the current weather stamp."
        ),
    },
}

WET_DAY_INCHES = 0.01
_last_request_at = 0.0


# ── small helpers ─────────────────────────────────────────────────────────

def log(message: str) -> None:
    print(message, file=sys.stderr)


def iso(day: date) -> str:
    return day.isoformat()


def parse_iso(value):
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def round_or_none(value, digits):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:  # NaN
        return None
    return round(number, digits)


def int_or_none(value):
    if value is None:
        return None
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def weekend_key(series_id, division, round_id) -> str:
    """Must match calRoundKey() in raceTracker/assets/js/main.js."""
    return f"{series_id}:{division or 'main'}:{round_id}"


def http_get_json(url, timeout, attempts=3):
    """GET with polite pacing and exponential backoff on 429/5xx."""
    global _last_request_at
    delay = 2
    last_error = None
    for attempt in range(1, attempts + 1):
        wait = MIN_REQUEST_INTERVAL_S - (time.monotonic() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                _last_request_at = time.monotonic()
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            _last_request_at = time.monotonic()
            last_error = f"HTTP {exc.code}"
            if exc.code not in (429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            _last_request_at = time.monotonic()
            last_error = str(exc)
        if attempt < attempts:
            time.sleep(delay)
            delay *= 3
    raise RuntimeError(last_error or "request failed")


# ── risk ──────────────────────────────────────────────────────────────────

def classify_race_day_risk(day, mode):
    """Mirrors classifyRaceDayRisk() in main.js.

    Deliberate divergence from the browser's current-conditions classifier: its
    0.03 in rain trigger is an inch-in-the-current-hour test. As a daily total
    0.03 in is a trace, so daily data uses dailyRainIn, the forecast rain
    probability, or — for climate normals, which carry no probability — the
    historical wet-day frequency.
    """
    t = RISK_THRESHOLDS
    high = day.get("tempMaxF")
    low = day.get("tempMinF")
    wind = day.get("windMaxMph") or 0
    gust = day.get("gustMaxMph")
    gust = wind if gust is None else gust
    rain = day.get("precipInches") or 0

    wet_forecast = mode == "forecast" and (day.get("precipProbabilityMaxPct") or 0) >= t["dailyRainProbPct"]
    wet_climate = mode == "climate" and (day.get("wetDayFrequencyPct") or 0) >= t["climateWetDayPct"]
    rainy_code = day.get("weatherCode") in t["rainyCodes"]

    if rain >= t["dailyRainIn"] or wet_forecast or wet_climate or rainy_code or gust >= t["alertGustMph"]:
        return {"state": "alert", **RISK_COPY["alert"]}
    if (wind >= t["warnWindMph"] or gust >= t["warnGustMph"]
            or (high is not None and high >= t["hotF"])
            or (low is not None and low <= t["coldF"])):
        return {"state": "warn", **RISK_COPY["warn"]}
    return {"state": "ok", **RISK_COPY["ok"]}


RISK_ORDER = {"ok": 0, "warn": 1, "alert": 2}


def worst_risk(days):
    worst = "ok"
    for day in days:
        state = (day.get("risk") or {}).get("state", "ok")
        if RISK_ORDER.get(state, 0) > RISK_ORDER[worst]:
            worst = state
    return worst


def build_prep(days, summary, mode):
    """Short, actionable prep lines — what a mechanic would load in the trailer."""
    prep = []
    t = RISK_THRESHOLDS
    wet = [d for d in days if (d.get("precipInches") or 0) >= t["dailyRainIn"]
           or (d.get("precipProbabilityMaxPct") or 0) >= t["dailyRainProbPct"]
           or (d.get("wetDayFrequencyPct") or 0) >= t["climateWetDayPct"]
           or d.get("weatherCode") in t["rainyCodes"]]
    if wet:
        labels = ", ".join(f"{d['weekdayLabel']}" for d in wet)
        prep.append(f"Rain tires and wet setup — wet risk on {labels}")
    gust = summary.get("gustMaxMph") or 0
    if gust >= t["alertGustMph"]:
        prep.append(f"Gusts to {gust:.0f} mph: recheck ride height and front-end toe after run 1")
    elif gust >= t["warnGustMph"]:
        prep.append(f"Breezy — gusts near {gust:.0f} mph; expect a loose entry down the straight")
    high = summary.get("tempMaxF")
    low = summary.get("tempMinF")
    if high is not None and high >= t["hotF"]:
        prep.append(f"Heat: {high:.0f}°F peak — drop tire pressures, plan driver cooling and hydration")
    if low is not None and low <= t["coldF"]:
        prep.append(f"Cold start: {low:.0f}°F low — warmers, richer jetting, longer out-laps")
    if not prep:
        prep.append("Nothing unusual forecast — run the standard pressure and jetting baseline")
    if mode == "climate":
        prep.append("Based on past seasons, not a forecast — recheck inside 16 days")
    return prep


# ── data loading ──────────────────────────────────────────────────────────

def load_json(path):
    return json.loads(path.read_text())


def build_weekends(calendar, tracks, today):
    """Flatten every round into a weekend record joined to its venue."""
    venues = {t["id"]: t for t in tracks.get("tracks", [])}
    weekends = []
    for series in calendar.get("series", []):
        sid = series.get("id")
        for rnd in series.get("rounds", []):
            division = rnd.get("division", "main")
            start = parse_iso(rnd.get("dateStart"))
            end = parse_iso(rnd.get("dateEnd")) or start
            track = venues.get(rnd.get("trackId"))
            entry = {
                "key": weekend_key(sid, division, rnd.get("round")),
                "seriesId": sid,
                "seriesName": series.get("name"),
                "round": rnd.get("round"),
                "division": division,
                "name": rnd.get("name"),
                "engineType": rnd.get("engineType") or series.get("engineType") or "unknown",
                "country": rnd.get("country") or series.get("country") or "US",
                "trackId": rnd.get("trackId"),
                "track": rnd.get("track"),
                "trackCity": rnd.get("trackCity"),
                "dateStart": iso(start) if start else None,
                "dateEnd": iso(end) if end else None,
                "status": rnd.get("status", "confirmed"),
                "latitude": track.get("latitude") if track else None,
                "longitude": track.get("longitude") if track else None,
                "timezone": track.get("timezone") if track else None,
            }
            entry["spanDays"] = (end - start).days + 1 if start and end else None
            entry["leadDays"] = (start - today).days if start else None

            note = (rnd.get("note") or "").lower()
            if not start:
                entry["_reason"] = "venue-tba"
            elif "no racing" in note:
                entry["_reason"] = "non-race"
            elif rnd.get("status") == "cancelled":
                entry["_reason"] = "cancelled"
            elif entry["spanDays"] and entry["spanDays"] > MAX_WEEKEND_SPAN_DAYS:
                entry["_reason"] = "span-too-long"
            elif not rnd.get("trackId"):
                entry["_reason"] = "venue-tba"
            elif not track:
                entry["_reason"] = "no-coordinates"
            elif track.get("latitude") is None or track.get("longitude") is None:
                entry["_reason"] = "no-coordinates"
            else:
                entry["_reason"] = None
            weekends.append(entry)
    return weekends


UNAVAILABLE_LABELS = {
    "venue-tba": "Venue or date TBA",
    "non-race": "Not a race weekend",
    "cancelled": "Event cancelled",
    "span-too-long": "Multi-month event — no single weekend",
    "no-coordinates": "Venue coordinates missing",
    "fetch-failed": "Weather lookup failed",
}


def mark_unavailable(entry, reason):
    entry = dict(entry)
    entry["mode"] = "unavailable"
    entry["modeLabel"] = UNAVAILABLE_LABELS.get(reason, "Unavailable")
    entry["unavailableReason"] = reason
    entry["confidence"] = "none"
    for field in ("days", "summary", "prep", "modeSource", "climateComputedAt"):
        entry.pop(field, None)
    return entry


def target_mode(entry, today):
    start = parse_iso(entry["dateStart"])
    end = parse_iso(entry["dateEnd"]) or start
    archive_cutoff = today - timedelta(days=ARCHIVE_LAG_DAYS)
    if end < archive_cutoff:
        return "actual"
    if start <= today + timedelta(days=FORECAST_HORIZON_DAYS):
        return "forecast"
    return "climate"


# ── Open-Meteo series parsing ─────────────────────────────────────────────

def daily_rows(payload):
    """Turn an Open-Meteo `daily` block into {date: {var: value}}."""
    daily = (payload or {}).get("daily") or {}
    times = daily.get("time") or []
    rows = {}
    for index, stamp in enumerate(times):
        row = {}
        for name, values in daily.items():
            if name == "time":
                continue
            row[name] = values[index] if index < len(values) else None
        rows[stamp] = row
    return rows


def day_record(stamp, row, day_index, mode):
    day = parse_iso(stamp)
    record = {
        "date": stamp,
        "weekdayLabel": day.strftime("%a") if day else stamp,
        "dayIndex": day_index,
        "tempMaxF": round_or_none(row.get("temperature_2m_max"), 1),
        "tempMinF": round_or_none(row.get("temperature_2m_min"), 1),
        "windMaxMph": round_or_none(row.get("wind_speed_10m_max"), 1),
        "gustMaxMph": round_or_none(row.get("wind_gusts_10m_max"), 1),
        "precipInches": round_or_none(row.get("precipitation_sum"), 2),
        "weatherCode": int_or_none(row.get("weather_code")),
    }
    if mode == "forecast":
        record["precipProbabilityMaxPct"] = int_or_none(row.get("precipitation_probability_max"))
    record["risk"] = classify_race_day_risk(record, mode)
    return record


def summarize(days, mode):
    def collect(field):
        return [d[field] for d in days if d.get(field) is not None]

    highs, lows = collect("tempMaxF"), collect("tempMinF")
    winds, gusts = collect("windMaxMph"), collect("gustMaxMph")
    rains = collect("precipInches")
    probs = collect("precipProbabilityMaxPct")
    wet_days = collect("wetDayFrequencyPct")

    wettest = None
    if rains:
        wettest = max(days, key=lambda d: d.get("precipInches") or 0)

    summary = {
        "tempMaxF": round(max(highs), 1) if highs else None,
        "tempMinF": round(min(lows), 1) if lows else None,
        "windMaxMph": round(max(winds), 1) if winds else None,
        "gustMaxMph": round(max(gusts), 1) if gusts else None,
        "precipInches": round(sum(rains), 2) if rains else None,
        "wettestDate": wettest["date"] if wettest else None,
        "weatherCode": (wettest or {}).get("weatherCode"),
    }
    if probs:
        summary["precipProbabilityMaxPct"] = max(probs)
    if wet_days:
        summary["wetDayFrequencyPct"] = max(wet_days)

    state = worst_risk(days)
    summary["risk"] = {"state": state, **RISK_COPY[state]}

    bits = []
    if summary["tempMaxF"] is not None:
        bits.append(f"{summary['tempMaxF']:.0f}°F")
    if summary["gustMaxMph"] is not None:
        bits.append(f"{summary['gustMaxMph']:.0f} mph gusts")
    if summary["precipInches"] is not None:
        bits.append(f"{summary['precipInches']:.2f} in")
    summary["headline"] = " · ".join(bits) if bits else "No data"
    return summary


def finish(entry, days, mode, source, confidence, extra=None):
    entry = dict(entry)
    entry["mode"] = mode
    entry["modeSource"] = source
    entry["confidence"] = confidence
    entry["days"] = days
    entry["summary"] = summarize(days, mode)
    entry["prep"] = build_prep(days, entry["summary"], mode)
    if extra:
        entry.update(extra)
    return entry


# ── climate normals ───────────────────────────────────────────────────────

def climate_days(entry, rows):
    """Average past seasons around each race date to build a normal outlook."""
    start = parse_iso(entry["dateStart"])
    end = parse_iso(entry["dateEnd"]) or start
    first_year, last_year = CLIMATE_YEARS
    days = []
    index = 0
    cursor = start
    while cursor <= end:
        samples = []
        for year in range(first_year, last_year + 1):
            for offset in range(-CLIMATE_WINDOW_DAYS, CLIMATE_WINDOW_DAYS + 1):
                try:
                    anchor = date(year, cursor.month, cursor.day)
                except ValueError:  # Feb 29 in a non-leap year
                    continue
                row = rows.get(iso(anchor + timedelta(days=offset)))
                if row:
                    samples.append(row)
        if samples:
            days.append(climate_day(cursor, samples, index))
        index += 1
        cursor += timedelta(days=1)
    return days


def climate_day(day, samples, index):
    def values(field):
        return [float(s[field]) for s in samples if s.get(field) is not None]

    highs, lows = values("temperature_2m_max"), values("temperature_2m_min")
    winds, gusts = values("wind_speed_10m_max"), values("wind_gusts_10m_max")
    rains = values("precipitation_sum")
    codes = [int(s["weather_code"]) for s in samples if s.get("weather_code") is not None]

    def p75(numbers):
        if not numbers:
            return None
        ordered = sorted(numbers)
        # Normal-of-maxima: the mean is washed out by calm years.
        return ordered[min(len(ordered) - 1, int(len(ordered) * 0.75))]

    wet = sum(1 for value in rains if value >= WET_DAY_INCHES)
    record = {
        "date": iso(day),
        "weekdayLabel": day.strftime("%a"),
        "dayIndex": index,
        "tempMaxF": round(statistics.fmean(highs), 1) if highs else None,
        "tempMinF": round(statistics.fmean(lows), 1) if lows else None,
        "windMaxMph": round(p75(winds), 1) if winds else None,
        "gustMaxMph": round(p75(gusts), 1) if gusts else None,
        "precipInches": round(statistics.fmean(rains), 2) if rains else None,
        "weatherCode": statistics.mode(codes) if codes else None,
        "sampleYears": CLIMATE_YEARS[1] - CLIMATE_YEARS[0] + 1,
        "sampleCount": len(samples),
        "wetDayFrequencyPct": round(100 * wet / len(rains)) if rains else None,
    }
    record["risk"] = classify_race_day_risk(record, "climate")
    return record


# ── geocode helper mode ───────────────────────────────────────────────────

def run_geocode(calendar, tracks, timeout):
    known = {t["id"] for t in tracks.get("tracks", [])}
    wanted = {}
    for series in calendar.get("series", []):
        for rnd in series.get("rounds", []):
            tid = rnd.get("trackId")
            if tid and tid not in known and tid not in wanted:
                wanted[tid] = (rnd.get("track"), rnd.get("trackCity"))
    if not wanted:
        print("Every trackId on the calendar already resolves in track-context.json.")
        return 0
    print("Paste these into raceTracker/assets/data/track-context.json:\n")
    for tid, (name, city) in sorted(wanted.items()):
        query = (city or name or "").split(",")[0].strip()
        params = urllib.parse.urlencode({"name": query, "count": 1, "language": "en"})
        try:
            payload = http_get_json(f"{GEOCODE_URL}?{params}", timeout)
            hit = (payload.get("results") or [None])[0]
        except RuntimeError as exc:
            log(f"  geocode failed for {tid} ({query}): {exc}")
            continue
        if not hit:
            log(f"  no geocode match for {tid} ({query})")
            continue
        print(json.dumps({
            "id": tid,
            "name": name,
            "shortName": f"{name} — {city}",
            "category": "karting",
            "priority": "series",
            "latitude": round(hit["latitude"], 4),
            "longitude": round(hit["longitude"], 4),
            "timezone": hit.get("timezone"),
            "weatherProvider": "Open-Meteo",
            "coordsPrecision": "city",
        }, indent=2, ensure_ascii=False) + ",")
    return 0


# ── calendar health ───────────────────────────────────────────────────────

def calendar_health(calendar, weekends, today):
    updated = parse_iso(calendar.get("updatedAt"))
    age = (today - updated).days if updated else None
    warnings = []
    if age is not None and age > CALENDAR_STALE_DAYS:
        warnings.append(f"series-calendars.json has not been updated in {age} days")
    elif age is None:
        warnings.append("series-calendars.json has no parseable updatedAt")

    per_series = []
    for series in calendar.get("series", []):
        sid = series["id"]
        future = sum(
            1 for w in weekends
            if w["seriesId"] == sid and w["dateStart"] and parse_iso(w["dateStart"]) >= today
            and w["status"] not in ("cancelled",)
        )
        per_series.append({"seriesId": sid, "name": series.get("name"), "futureRoundCount": future})
        if future == 0:
            warnings.append(f"{sid}: no future rounds on the calendar — next season not published yet?")

    unverified = sorted({
        f"{series['id']}:{rnd.get('division', 'main')}:{rnd['round']}"
        for series in calendar.get("series", [])
        for rnd in series.get("rounds", [])
        if rnd.get("sourceConfidence") == "unverified"
    })
    if unverified:
        warnings.append(
            f"{len(unverified)} round(s) came from a single source — verify against "
            "each series' scheduleUrl before committing travel"
        )

    return {
        "seriesCalendarUpdatedAt": calendar.get("updatedAt"),
        "seriesCalendarAgeDays": age,
        "staleAfterDays": CALENDAR_STALE_DAYS,
        "series": per_series,
        "unverifiedRounds": unverified,
        "warnings": warnings,
    }


# ── output ────────────────────────────────────────────────────────────────

def content_hash(payload):
    stripped = {k: v for k, v in payload.items() if k not in ("updatedAt", "contentHash")}
    blob = json.dumps(stripped, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()


def display_path(path):
    """Repo-relative when possible — the output path is configurable."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def write_output(path, payload, previous):
    digest = content_hash(payload)
    if previous and previous.get("contentHash") == digest:
        print(f"unchanged — {display_path(path)} left untouched")
        return False
    payload["contentHash"] = digest
    ordered = {
        "schemaVersion": payload.pop("schemaVersion"),
        "updatedAt": payload.pop("updatedAt"),
        "contentHash": payload.pop("contentHash"),
        **payload,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    print(f"Wrote {len(ordered['weekends'])} race weekend(s) to {display_path(path)}")
    return True


# ── main ──────────────────────────────────────────────────────────────────

def main() -> int:
    timeout = int(os.environ.get("RACETRACKER_WEATHER_TIMEOUT", "45"))
    offline = bool(os.environ.get("RACETRACKER_WEATHER_OFFLINE"))
    force_climate = bool(os.environ.get("RACETRACKER_WEATHER_FORCE_CLIMATE"))
    output = Path(os.environ.get("RACETRACKER_WEATHER_OUTPUT") or DEFAULT_OUTPUT)
    if not output.is_absolute():
        output = ROOT / output

    for path in (CALENDAR, TRACK_CONTEXT):
        if not path.exists():
            log(f"Missing required input: {display_path(path)}")
            return 2

    calendar = load_json(CALENDAR)
    tracks = load_json(TRACK_CONTEXT)
    today = datetime.now(timezone.utc).date()

    if os.environ.get("RACETRACKER_WEATHER_GEOCODE"):
        return run_geocode(calendar, tracks, timeout)

    weekends = build_weekends(calendar, tracks, today)
    if not weekends:
        log("No rounds found in series-calendars.json — refusing to write.")
        return 1

    previous = load_json(output) if output.exists() else None
    prior = {w["key"]: w for w in (previous or {}).get("weekends", [])} if previous else {}

    issues = []
    resolved = {}
    needs_forecast = []
    needs_archive = {}   # trackId -> {"entry": ..., "keys": [...], "modes": set()}

    for entry in weekends:
        key = entry["key"]
        if entry["_reason"]:
            resolved[key] = mark_unavailable(entry, entry["_reason"])
            continue
        mode = target_mode(entry, today)
        cached = prior.get(key)

        # Recorded weather never changes; climate normals decay slowly.
        if cached and cached.get("mode") == mode and mode == "actual" and cached.get("days"):
            resolved[key] = {**entry, **{k: cached[k] for k in
                                         ("mode", "modeLabel", "modeSource", "confidence",
                                          "days", "summary", "prep") if k in cached}}
            continue
        if (cached and cached.get("mode") == "climate" and mode == "climate"
                and cached.get("days") and not force_climate):
            computed = parse_iso(cached.get("climateComputedAt"))
            if computed and (today - computed).days < CLIMATE_CACHE_DAYS:
                resolved[key] = {**entry, **{k: cached[k] for k in
                                             ("mode", "modeLabel", "modeSource", "confidence",
                                              "days", "summary", "prep", "climateComputedAt")
                                             if k in cached}}
                continue

        if offline:
            # No network: keep whatever the previous file had, else mark it pending.
            if cached and cached.get("days"):
                resolved[key] = {**entry, **{k: cached[k] for k in
                                             ("mode", "modeLabel", "modeSource", "confidence",
                                              "days", "summary", "prep", "climateComputedAt")
                                             if k in cached}}
            else:
                resolved[key] = mark_unavailable(entry, "fetch-failed")
            continue

        if mode == "forecast":
            needs_forecast.append(entry)
        else:
            slot = needs_archive.setdefault(entry["trackId"], {"entry": entry, "items": []})
            slot["items"].append((entry, mode))

    # ── batched forecast: one request covering every near-term venue ──────
    if needs_forecast:
        venues = []
        seen = {}
        for entry in needs_forecast:
            if entry["trackId"] not in seen:
                seen[entry["trackId"]] = len(venues)
                venues.append(entry)
        params = urllib.parse.urlencode({
            "latitude": ",".join(str(v["latitude"]) for v in venues),
            "longitude": ",".join(str(v["longitude"]) for v in venues),
            "daily": DAILY_FORECAST_VARS,
            "forecast_days": FORECAST_HORIZON_DAYS,
            "past_days": FORECAST_PAST_DAYS,
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "auto",
        })
        try:
            payload = http_get_json(f"{FORECAST_URL}?{params}", timeout)
            # Multi-location responses come back as a JSON array, not an object.
            blocks = payload if isinstance(payload, list) else [payload]
            rows_by_track = {v["trackId"]: daily_rows(blocks[i])
                             for v, i in ((v, seen[v["trackId"]]) for v in venues)
                             if i < len(blocks)}
        except RuntimeError as exc:
            issues.append({"stage": "forecast", "error": str(exc)})
            rows_by_track = {}

        for entry in needs_forecast:
            rows = rows_by_track.get(entry["trackId"])
            days = []
            if rows:
                cursor = parse_iso(entry["dateStart"])
                end = parse_iso(entry["dateEnd"]) or cursor
                index = 0
                while cursor <= end:
                    row = rows.get(iso(cursor))
                    if row:
                        days.append(day_record(iso(cursor), row, index, "forecast"))
                    index += 1
                    cursor += timedelta(days=1)
            if days:
                lead = entry["leadDays"] or 0
                resolved[entry["key"]] = finish(
                    entry, days, "forecast", "open-meteo-forecast",
                    "high" if lead <= 7 else "medium",
                    {"modeLabel": f"{FORECAST_HORIZON_DAYS}-day forecast"},
                )
            else:
                issues.append({"key": entry["key"], "stage": "forecast", "error": "no rows for weekend"})
                resolved[entry["key"]] = fallback_or_unavailable(entry, prior)

    # ── archive: at most one request per venue ────────────────────────────
    for track_id, slot in needs_archive.items():
        items = slot["items"]
        wants_climate = any(mode == "climate" for _, mode in items)
        starts = [parse_iso(e["dateStart"]) for e, _ in items]
        archive_start = date(CLIMATE_YEARS[0], 1, 1) if wants_climate else min(starts)
        archive_end = today - timedelta(days=ARCHIVE_LAG_DAYS)
        if not wants_climate:
            archive_end = min(archive_end, max(parse_iso(e["dateEnd"] or e["dateStart"]) for e, _ in items))
        if archive_start > archive_end:
            for entry, _ in items:
                resolved[entry["key"]] = fallback_or_unavailable(entry, prior)
            continue

        params = urllib.parse.urlencode({
            "latitude": slot["entry"]["latitude"],
            "longitude": slot["entry"]["longitude"],
            "start_date": iso(archive_start),
            "end_date": iso(archive_end),
            "daily": DAILY_ARCHIVE_VARS,
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "auto",
        })
        try:
            rows = daily_rows(http_get_json(f"{ARCHIVE_URL}?{params}", timeout))
        except RuntimeError as exc:
            issues.append({"trackId": track_id, "stage": "archive", "error": str(exc)})
            for entry, _ in items:
                resolved[entry["key"]] = fallback_or_unavailable(entry, prior)
            continue

        for entry, mode in items:
            if mode == "climate":
                days = climate_days(entry, rows)
                if days:
                    resolved[entry["key"]] = finish(
                        entry, days, "climate", "open-meteo-archive-normals", "low",
                        {"modeLabel": f"Climate normal ({CLIMATE_YEARS[0]}–{CLIMATE_YEARS[1]})",
                         "climateComputedAt": iso(today)},
                    )
                    continue
            else:
                days = []
                cursor = parse_iso(entry["dateStart"])
                end = parse_iso(entry["dateEnd"]) or cursor
                index = 0
                while cursor <= end:
                    row = rows.get(iso(cursor))
                    if row:
                        days.append(day_record(iso(cursor), row, index, "actual"))
                    index += 1
                    cursor += timedelta(days=1)
                if days:
                    resolved[entry["key"]] = finish(
                        entry, days, "actual", "open-meteo-archive", "high",
                        {"modeLabel": "Recorded conditions"},
                    )
                    continue
            issues.append({"key": entry["key"], "stage": mode, "error": "no rows for weekend"})
            resolved[entry["key"]] = fallback_or_unavailable(entry, prior)

    ordered = sorted(
        (resolved[w["key"]] for w in weekends),
        key=lambda w: (w.get("dateStart") or "9999-12-31", w["seriesId"], w["division"], str(w["round"])),
    )
    for entry in ordered:
        entry.pop("_reason", None)

    counts = {"total": len(ordered)}
    for mode in ("actual", "forecast", "climate", "unavailable"):
        counts[mode] = sum(1 for w in ordered if w.get("mode") == mode)

    failed = sum(1 for w in ordered if w.get("unavailableReason") == "fetch-failed")
    eligible = sum(1 for w in weekends if not w["_reason"]) or 1

    if offline:
        # Structural dry run for CI: exercise the join, key generation and schema
        # build with no network, and never touch the committed file.
        return report_offline(weekends, ordered, eligible)

    if failed and failed / eligible >= 0.5:
        log(f"{failed}/{eligible} weekends failed to fetch — refusing to overwrite "
            f"{display_path(output)}")
        for issue in issues[:10]:
            log(f"  {issue}")
        return 1

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "contentHash": None,
        "generator": "scripts/refresh_race_weather.py",
        "sourceStatus": "partial" if issues else ("stale-reuse" if offline else "ok"),
        "notes": (
            "Race-weekend weather. Weekends within "
            f"{FORECAST_HORIZON_DAYS} days use the Open-Meteo forecast; past weekends use "
            "the ERA5 archive; everything further out uses climate normals averaged from "
            f"{CLIMATE_YEARS[0]}-{CLIMATE_YEARS[1]}. Daily risk uses dailyRainIn rather than "
            "the hourly currentRainIn threshold — as a daily total 0.03 in is a trace."
        ),
        "providers": {"forecast": FORECAST_URL, "archive": ARCHIVE_URL},
        "forecastHorizonDays": FORECAST_HORIZON_DAYS,
        "climateBaselineYears": list(CLIMATE_YEARS),
        "climateWindowDays": CLIMATE_WINDOW_DAYS,
        "maxWeekendSpanDays": MAX_WEEKEND_SPAN_DAYS,
        "units": {"temperature": "F", "wind": "mph", "precipitation": "in"},
        "riskThresholds": RISK_THRESHOLDS,
        "counts": counts,
        "calendarHealth": calendar_health(calendar, weekends, today),
        "issues": issues,
        "weekends": ordered,
    }

    write_output(output, payload, previous)
    if issues:
        log(f"{len(issues)} issue(s) recorded; sourceStatus=partial")
    return 0


def report_offline(weekends, ordered, eligible):
    """Validate the calendar->venue join without touching the network or the file."""
    problems = []
    keys = [w["key"] for w in ordered]
    duplicates = {k for k in keys if keys.count(k) > 1}
    if duplicates:
        problems.append(f"duplicate weekend keys: {sorted(duplicates)}")

    for entry in ordered:
        if entry.get("mode") != "unavailable":
            days = entry.get("days") or []
            if not days:
                problems.append(f"{entry['key']}: mode={entry['mode']} but no days")
            start, end = entry.get("dateStart"), entry.get("dateEnd")
            for day in days:
                if not (start <= day["date"] <= (end or start)):
                    problems.append(f"{entry['key']}: day {day['date']} outside {start}..{end}")
        elif not entry.get("unavailableReason"):
            problems.append(f"{entry['key']}: unavailable with no reason")

    no_coords = [w["key"] for w in weekends if w["_reason"] == "no-coordinates"]
    if no_coords:
        problems.append(f"rounds with a trackId that has no coordinates: {no_coords}")

    print(f"offline check: {len(ordered)} weekend(s), {eligible} with a resolvable venue")
    if problems:
        for problem in problems:
            log(f"  {problem}")
        log(f"offline check FAILED with {len(problems)} problem(s)")
        return 1
    print("offline check OK — calendar/venue join and schema are sound")
    return 0


def fallback_or_unavailable(entry, prior):
    """Prefer stale-but-real data from the previous file over nothing at all."""
    cached = prior.get(entry["key"])
    if cached and cached.get("days"):
        merged = {**entry, **{k: cached[k] for k in
                              ("mode", "modeLabel", "modeSource", "days", "summary",
                               "prep", "climateComputedAt") if k in cached}}
        merged["confidence"] = "stale"
        return merged
    return mark_unavailable(entry, "fetch-failed")


if __name__ == "__main__":
    raise SystemExit(main())
