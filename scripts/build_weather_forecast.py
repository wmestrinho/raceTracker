#!/usr/bin/env python3
"""Build the race-weekend weather feed for raceTracker.

Joins the 2026 series calendars against track coordinates, pulls a forecast for
every track with a race weekend inside the lead-time window, evaluates the
trigger ruleset, and writes a static JSON feed the site (and any desk display)
can read.

Inputs
  raceTracker/assets/data/series-calendars.json   race weekends, trackId per round
  raceTracker/assets/data/track-context.json      latitude/longitude/timezone per track
  raceTracker/assets/data/weather-alert-rules.json thresholds -> tire/engine actions

Output
  raceTracker/assets/data/race-weather.json

Usage
  python3 scripts/build_weather_forecast.py                  # refresh the feed
  python3 scripts/build_weather_forecast.py --notify         # and push webhook alerts
  python3 scripts/build_weather_forecast.py --check          # offline join validation
  python3 scripts/build_weather_forecast.py --fixture t.json # offline, canned forecasts

Provider note
  Open-Meteo is the default because it needs no API key, which keeps the feed
  inside the repo's live-data guardrail (no credentials in static JS or in Git)
  and still returns 16 forecast days. Keyed providers can be registered in
  PROVIDERS; their keys belong in GitHub Actions secrets, never in this repo.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "raceTracker/assets/data"
CALENDARS = DATA / "series-calendars.json"
TRACKS = DATA / "track-context.json"
RULES = DATA / "weather-alert-rules.json"
OUTPUT = DATA / "race-weather.json"

USER_AGENT = "raceTracker weather pipeline (https://tracker.absolutelyplausible.com)"
OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast"

SERIES_SHORT = {
    "ckna": "CKNA",
    "cup-karts-canada": "CKC",
    "rok-cup-usa": "ROK",
    "skusa": "SKUSA",
    "stars": "STARS",
    "uspks": "USPKS",
    "tsrs": "TSRS",
}


# ── helpers ──────────────────────────────────────────────────────────────────

def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def f_to_c(f: float) -> float:
    return (f - 32.0) * 5.0 / 9.0


def air_density_kg_m3(temp_c: float, humidity_pct: float, pressure_hpa: float) -> float:
    """Moist-air density from temperature, relative humidity and station pressure."""
    saturation_hpa = 6.1078 * 10 ** (7.5 * temp_c / (temp_c + 237.3))
    vapour_pa = saturation_hpa * (humidity_pct / 100.0) * 100.0
    total_pa = pressure_hpa * 100.0
    dry_pa = total_pa - vapour_pa
    kelvin = temp_c + 273.15
    return dry_pa / (287.058 * kelvin) + vapour_pa / (461.495 * kelvin)


def density_altitude_ft(density: float) -> float:
    """Air density expressed as an altitude — the jetting proxy crews actually use."""
    return 145442.16 * (1 - (density / 1.225) ** 0.234969)


def date_range(start: str, end: str) -> list[str]:
    first = date.fromisoformat(start)
    last = date.fromisoformat(end or start)
    if last < first:
        last = first
    span = (last - first).days
    return [(first + timedelta(days=offset)).isoformat() for offset in range(span + 1)]


def round_or_none(value, digits: int = 1):
    return None if value is None else round(float(value), digits)


# ── calendar / track join ────────────────────────────────────────────────────

def select_events(calendars: dict, tracks: dict, today: date, lead_days: int) -> tuple[list[dict], list[dict]]:
    """Return (events needing a forecast, events skipped with a reason)."""
    track_by_id = {track["id"]: track for track in tracks.get("tracks", [])}
    horizon = today + timedelta(days=lead_days)
    selected: list[dict] = []
    skipped: list[dict] = []

    for series in calendars.get("series", []):
        for rnd in series.get("rounds", []):
            start_raw = rnd.get("dateStart")
            if not start_raw:
                continue
            start = date.fromisoformat(start_raw)
            end = date.fromisoformat(rnd.get("dateEnd") or start_raw)
            if end < today or start > horizon:
                continue

            label = f"{SERIES_SHORT.get(series['id'], series['id'])} · {rnd.get('name', 'Round')}"
            track_id = rnd.get("trackId")
            track = track_by_id.get(track_id) if track_id else None
            if track is None:
                skipped.append({
                    "event": label,
                    "dateStart": start_raw,
                    "reason": "no trackId in series-calendars.json" if not track_id
                              else f"trackId '{track_id}' not found in track-context.json",
                    "nationalTier": rnd.get("nationalTier"),
                })
                continue
            if track.get("latitude") is None or track.get("longitude") is None:
                skipped.append({
                    "event": label,
                    "dateStart": start_raw,
                    "reason": f"track '{track_id}' has no coordinates",
                    "nationalTier": rnd.get("nationalTier"),
                })
                continue

            selected.append({
                "id": f"{series['id']}:{rnd.get('round')}",
                "seriesId": series["id"],
                "series": SERIES_SHORT.get(series["id"], series["id"]),
                "seriesName": series.get("name", series["id"]),
                "name": rnd.get("name", "Round"),
                "nationalTier": rnd.get("nationalTier"),
                "trackId": track["id"],
                "track": track.get("name", rnd.get("track", "")),
                "trackCity": rnd.get("trackCity", ""),
                "dateStart": start_raw,
                "dateEnd": rnd.get("dateEnd") or start_raw,
                "daysOut": (start - today).days,
                "_track": track,
            })

    selected.sort(key=lambda event: (event["dateStart"], event["seriesId"]))
    skipped.sort(key=lambda item: item["dateStart"])
    return selected, skipped


# ── forecast providers ───────────────────────────────────────────────────────

def fetch_open_meteo(track: dict, forecast_days: int, timeout: int = 30) -> dict:
    params = {
        "latitude": str(track["latitude"]),
        "longitude": str(track["longitude"]),
        "daily": ",".join([
            "temperature_2m_max", "temperature_2m_min", "apparent_temperature_max",
            "precipitation_sum", "precipitation_probability_max",
            "wind_speed_10m_max", "wind_gusts_10m_max", "weather_code",
        ]),
        "hourly": "temperature_2m,relative_humidity_2m,surface_pressure",
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": track.get("timezone") or "auto",
        "forecast_days": str(forecast_days),
    }
    url = f"{OPEN_METEO_ENDPOINT}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


PROVIDERS = {
    # id: (label, fetch callable)
    # Add a keyed provider (OpenWeatherMap One Call, Tomorrow.io) here and
    # normalise its payload in normalise_open_meteo()'s sibling function. Read
    # the key from os.environ — never from a checked-in file.
    "openmeteo": ("Open-Meteo", fetch_open_meteo),
}


def normalise_open_meteo(payload: dict, race_hours: dict) -> dict[str, dict]:
    """Turn one Open-Meteo response into {date: metrics}."""
    daily = payload.get("daily") or {}
    days = daily.get("time") or []
    if not days:
        return {}

    hourly_means = hourly_race_window_means(payload.get("hourly") or {}, race_hours)
    metrics_by_date: dict[str, dict] = {}
    previous_max = None

    for index, day in enumerate(days):
        def at(key):
            values = daily.get(key) or []
            return values[index] if index < len(values) else None

        temp_max = at("temperature_2m_max")
        temp_min = at("temperature_2m_min")
        window = hourly_means.get(day, {})
        density = window.get("airDensityKgM3")

        metrics = {
            "tempMaxF": round_or_none(temp_max),
            "tempMinF": round_or_none(temp_min),
            "feelsMaxF": round_or_none(at("apparent_temperature_max")),
            "tempSwingF": round_or_none(temp_max - temp_min) if temp_max is not None and temp_min is not None else None,
            "tempDropF": round_or_none(max(0.0, previous_max - temp_max)) if previous_max is not None and temp_max is not None else 0.0,
            "precipSumIn": round_or_none(at("precipitation_sum"), 2),
            "precipProbMaxPct": round_or_none(at("precipitation_probability_max"), 0),
            "windMaxMph": round_or_none(at("wind_speed_10m_max")),
            "gustMaxMph": round_or_none(at("wind_gusts_10m_max")),
            "humidityMeanPct": round_or_none(window.get("humidityMeanPct"), 0),
            "airDensityKgM3": round_or_none(density, 4),
            "densityAltitudeFt": round_or_none(density_altitude_ft(density), 0) if density else None,
            "weatherCode": at("weather_code"),
        }
        metrics_by_date[day] = metrics
        if temp_max is not None:
            previous_max = temp_max

    return metrics_by_date


def hourly_race_window_means(hourly: dict, race_hours: dict) -> dict[str, dict]:
    """Mean humidity and air density across the local race-hours window, per day."""
    times = hourly.get("time") or []
    temps = hourly.get("temperature_2m") or []
    humidity = hourly.get("relative_humidity_2m") or []
    pressure = hourly.get("surface_pressure") or []
    start_hour = int(race_hours.get("start", 9))
    end_hour = int(race_hours.get("end", 17))

    buckets: dict[str, list[tuple[float, float]]] = {}
    for index, stamp in enumerate(times):
        if index >= min(len(temps), len(humidity), len(pressure)):
            break
        day, _, clock = stamp.partition("T")
        try:
            hour = int(clock[:2])
        except ValueError:
            continue
        if not start_hour <= hour <= end_hour:
            continue
        temp_f, rh, hpa = temps[index], humidity[index], pressure[index]
        if temp_f is None or rh is None or hpa is None:
            continue
        buckets.setdefault(day, []).append((rh, air_density_kg_m3(f_to_c(temp_f), rh, hpa)))

    means = {}
    for day, samples in buckets.items():
        if not samples:
            continue
        means[day] = {
            "humidityMeanPct": sum(rh for rh, _ in samples) / len(samples),
            "airDensityKgM3": sum(rho for _, rho in samples) / len(samples),
        }
    return means


# ── rule evaluation ──────────────────────────────────────────────────────────

OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    "<": lambda a, b: a < b,
    "==": lambda a, b: a == b,
}


def condition_holds(condition: dict, metrics: dict) -> bool:
    value = metrics.get(condition.get("metric"))
    if value is None:
        return False
    op = OPS.get(condition.get("op"))
    if op is None:
        raise ValueError(f"Unsupported operator in ruleset: {condition.get('op')!r}")
    return op(float(value), float(condition.get("value")))


def rule_matches(rule: dict, metrics: dict) -> bool:
    when = rule.get("when") or {}
    all_conditions = when.get("all") or []
    any_conditions = when.get("any") or []
    if all_conditions and not all(condition_holds(c, metrics) for c in all_conditions):
        return False
    if any_conditions and not any(condition_holds(c, metrics) for c in any_conditions):
        return False
    return True


def evaluate_day(metrics: dict, ruleset: dict) -> list[dict]:
    matched = [rule for rule in ruleset.get("rules", []) if rule_matches(rule, metrics)]
    matched.sort(key=lambda rule: rule.get("priority", 0), reverse=True)
    # The catch-all "ok" rule is a fallback, not an addition to real findings.
    significant = [rule for rule in matched if rule.get("severity") != "ok"]
    return significant or matched[:1]


def worst_severity(severities: list[str], order: list[str]) -> str:
    ranked = [s for s in severities if s in order]
    if not ranked:
        return "ok"
    return max(ranked, key=order.index)


# ── payload ──────────────────────────────────────────────────────────────────

def build_payload(events: list[dict], skipped: list[dict], forecasts: dict[str, dict],
                  ruleset: dict, provider_label: str, today: date, lead_days: int) -> dict:
    order = ruleset.get("severityOrder", ["ok", "warn", "alert"])
    windows = ruleset.get("windows", {})
    notify_window = int(windows.get("notifyWindowDays", 7))

    event_rows = []
    for event in events:
        metrics_by_date = forecasts.get(event["trackId"]) or {}
        days = []
        for day in date_range(event["dateStart"], event["dateEnd"]):
            metrics = metrics_by_date.get(day)
            if metrics is None:
                continue  # beyond the provider's forecast horizon
            rules = evaluate_day(metrics, ruleset)
            days.append({
                "date": day,
                "severity": worst_severity([rule["severity"] for rule in rules], order),
                "metrics": metrics,
                "rules": [{
                    "id": rule["id"],
                    "label": rule["label"],
                    "severity": rule["severity"],
                    "notify": bool(rule.get("notify")),
                    "actions": rule.get("actions", {}),
                } for rule in rules],
            })

        severity = worst_severity([day["severity"] for day in days], order)
        notify_rules = sorted({
            rule["id"] for day in days for rule in day["rules"] if rule["notify"]
        })
        event_rows.append({
            "id": event["id"],
            "series": event["series"],
            "seriesId": event["seriesId"],
            "seriesName": event["seriesName"],
            "name": event["name"],
            "nationalTier": event["nationalTier"],
            "trackId": event["trackId"],
            "track": event["track"],
            "trackCity": event["trackCity"],
            "coordinates": {
                "latitude": event["_track"]["latitude"],
                "longitude": event["_track"]["longitude"],
                "confidence": event["_track"].get("coordinateConfidence", "verified"),
            },
            "timezone": event["_track"].get("timezone"),
            "dateStart": event["dateStart"],
            "dateEnd": event["dateEnd"],
            "daysOut": event["daysOut"],
            "forecastAvailable": bool(days),
            "severity": severity,
            "notify": bool(notify_rules) and event["daysOut"] <= notify_window,
            "notifyRules": notify_rules,
            "days": days,
        })

    return {
        "updatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "generatedFor": today.isoformat(),
        "generator": "scripts/build_weather_forecast.py",
        "provider": provider_label,
        "rulesSchemaVersion": ruleset.get("schemaVersion"),
        "rulesUpdatedAt": ruleset.get("updatedAt"),
        "leadDays": lead_days,
        "notifyWindowDays": notify_window,
        "status": "ok" if events else "no-events-in-window",
        "eventCount": len(event_rows),
        "alertDigest": alert_digest(event_rows),
        "events": event_rows,
        "skipped": skipped,
    }


def alert_digest(event_rows: list[dict]) -> str:
    """Stable fingerprint of what would be alerted on, so repeat runs stay quiet."""
    parts = []
    for event in event_rows:
        if not event["notify"]:
            continue
        for day in event["days"]:
            firing = [rule["id"] for rule in day["rules"] if rule["notify"]]
            if firing:
                parts.append(f"{event['id']}|{day['date']}|{','.join(sorted(firing))}")
    return hashlib.sha256("\n".join(sorted(parts)).encode("utf-8")).hexdigest()[:16]


def payload_body(payload: dict) -> str:
    """Payload without the run timestamp, for change detection."""
    body = {key: value for key, value in payload.items() if key not in {"updatedAt", "generatedFor"}}
    return json.dumps(body, sort_keys=True)


# ── notifications ────────────────────────────────────────────────────────────

def build_alert_message(payload: dict) -> str:
    lines = ["*raceTracker weather alert* — race weekends inside the "
             f"{payload['notifyWindowDays']}-day window"]
    for event in payload["events"]:
        if not event["notify"]:
            continue
        lines.append("")
        lines.append(f"{event['series']} · {event['name']} — {event['track']}"
                     f" ({event['trackCity']}) · in {event['daysOut']} day(s)")
        for day in event["days"]:
            firing = [rule for rule in day["rules"] if rule["notify"]]
            if not firing:
                continue
            metrics = day["metrics"]
            lines.append(
                f"  {day['date']}: {', '.join(rule['label'] for rule in firing)}"
                f" — {metrics.get('tempMaxF')}°F max, {metrics.get('precipProbMaxPct')}% rain,"
                f" gusts {metrics.get('gustMaxMph')} mph, DA {metrics.get('densityAltitudeFt')} ft"
            )
            for rule in firing:
                actions = rule.get("actions", {})
                if actions.get("tire"):
                    lines.append(f"    tire · {actions['tire']}")
                if actions.get("engine"):
                    lines.append(f"    engine · {actions['engine']}")
    lines.append("")
    lines.append("https://tracker.absolutelyplausible.com/weather.html")
    return "\n".join(lines)


def webhook_body(url: str, message: str, style: str) -> bytes:
    if style == "auto":
        host = urllib.parse.urlparse(url).netloc
        style = "discord" if "discord" in host else "slack"
    if style == "discord":
        return json.dumps({"content": message[:1900]}).encode("utf-8")
    return json.dumps({"text": message}).encode("utf-8")


def post_webhook(url: str, message: str, style: str, timeout: int = 20) -> None:
    request = urllib.request.Request(
        url,
        data=webhook_body(url, message, style),
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        response.read()


# ── main ─────────────────────────────────────────────────────────────────────

def run_check(events: list[dict], skipped: list[dict]) -> int:
    print(f"{len(events)} race weekend(s) in the lead-time window with resolvable coordinates.")
    for event in events:
        print(f"  ok    {event['dateStart']}  {event['series']:<6} {event['name']} → {event['trackId']}")
    blocking = [item for item in skipped if item.get("nationalTier") == "pro-2stroke"]
    for item in skipped:
        marker = "FAIL " if item in blocking else "warn "
        print(f"  {marker} {item['dateStart']}  {item['event']}: {item['reason']}")
    if blocking:
        print(f"\nFAILED: {len(blocking)} national pro 2-stroke round(s) cannot be forecast.", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the raceTracker race-weekend weather feed.")
    parser.add_argument("--lead-days", type=int, default=None,
                        help="How far ahead to pull forecasts (default: ruleset forecastDays).")
    parser.add_argument("--provider", default="openmeteo", choices=sorted(PROVIDERS),
                        help="Forecast provider (default: openmeteo, no API key required).")
    parser.add_argument("--output", default=str(OUTPUT), help="Feed output path.")
    parser.add_argument("--check", action="store_true",
                        help="Validate the calendar/track join offline and exit.")
    parser.add_argument("--fixture", help="Offline JSON of {trackId: providerPayload} instead of live calls.")
    parser.add_argument("--notify", action="store_true", help="Post webhook alerts for the notify window.")
    parser.add_argument("--force-notify", action="store_true",
                        help="Post alerts even when nothing changed since the last run.")
    parser.add_argument("--webhook-style", default="auto", choices=["auto", "slack", "discord"],
                        help="Webhook payload shape (default: inferred from the URL).")
    parser.add_argument("--today", help="Override today's date (YYYY-MM-DD) for testing.")
    args = parser.parse_args()

    calendars = load_json(CALENDARS)
    tracks = load_json(TRACKS)
    ruleset = load_json(RULES)
    windows = ruleset.get("windows", {})
    lead_days = args.lead_days if args.lead_days is not None else int(windows.get("forecastDays", 16))
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()

    events, skipped = select_events(calendars, tracks, today, lead_days)
    if args.check:
        return run_check(events, skipped)

    provider_label, fetch = PROVIDERS[args.provider]
    fixture = load_json(Path(args.fixture)) if args.fixture else None

    forecasts: dict[str, dict] = {}
    failures: list[str] = []
    for track_id in sorted({event["trackId"] for event in events}):
        track = next(event["_track"] for event in events if event["trackId"] == track_id)
        try:
            raw = fixture[track_id] if fixture is not None else fetch(track, lead_days)
        except KeyError:
            failures.append(f"{track_id}: no fixture entry")
            continue
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            failures.append(f"{track_id}: {exc}")
            continue
        forecasts[track_id] = normalise_open_meteo(raw, windows.get("raceHoursLocal", {}))

    payload = build_payload(events, skipped, forecasts, ruleset, provider_label, today, lead_days)
    if failures:
        payload["status"] = "partial"
        payload["fetchErrors"] = failures

    output = Path(args.output)
    if not output.is_absolute():
        output = ROOT / output

    label = output.relative_to(ROOT) if output.is_relative_to(ROOT) else output
    previous = load_json(output) if output.exists() else None
    unchanged = previous is not None and payload_body(previous) == payload_body(payload)
    if unchanged:
        print(f"No forecast change for {payload['eventCount']} event(s); {label} left as-is.")
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {payload['eventCount']} event(s) to {label} (status: {payload['status']}).")

    alerting = [event for event in payload["events"] if event["notify"]]
    if alerting:
        print(f"{len(alerting)} event(s) inside the {payload['notifyWindowDays']}-day alert window.")

    if args.notify:
        webhook = os.environ.get("RACETRACKER_WEATHER_WEBHOOK_URL", "").strip()
        if not webhook:
            print("--notify given but RACETRACKER_WEATHER_WEBHOOK_URL is unset; skipping alerts.", file=sys.stderr)
        elif not alerting:
            print("Nothing inside the alert window; no webhook sent.")
        elif previous and previous.get("alertDigest") == payload["alertDigest"] and not args.force_notify:
            print("Alert set unchanged since the last run; no webhook sent (use --force-notify to override).")
        else:
            post_webhook(webhook, build_alert_message(payload), args.webhook_style)
            print(f"Posted weather alert for {len(alerting)} event(s).")

    return 1 if failures and not forecasts else 0


if __name__ == "__main__":
    raise SystemExit(main())
