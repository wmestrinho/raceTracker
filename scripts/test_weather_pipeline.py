#!/usr/bin/env python3
"""Offline tests for the race-weekend weather pipeline.

Runs the whole pipeline against a synthetic forecast fixture — no network, no
API key — so CI can prove the calendar/track join, the metric maths and the
trigger ruleset behave before a live run touches a real provider.
"""
from __future__ import annotations

import json
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_weather_forecast as pipeline  # noqa: E402

DATA = ROOT / "raceTracker/assets/data"


def build_fixture(track_ids: list[str], start: date, days: int, profile: str) -> dict:
    """Synthesise an Open-Meteo shaped payload for each track."""
    payload = {}
    for track_id in track_ids:
        dates = [(start + timedelta(days=offset)).isoformat() for offset in range(days)]
        if profile == "wet":
            temp_max = [78.0] * days
            precip_prob = [90] * days
            precip_sum = [0.55] * days
        elif profile == "cold-snap":
            # Alternating 85°F / 60°F, so every second day is a 25°F collapse
            # regardless of where the event lands inside the window.
            temp_max = [85.0 if offset % 2 == 0 else 60.0 for offset in range(days)]
            precip_prob = [5] * days
            precip_sum = [0.0] * days
        else:  # "clear"
            temp_max = [76.0] * days
            precip_prob = [5] * days
            precip_sum = [0.0] * days

        hourly_times, hourly_temp, hourly_rh, hourly_pressure = [], [], [], []
        for index, day in enumerate(dates):
            for hour in range(24):
                hourly_times.append(f"{day}T{hour:02d}:00")
                hourly_temp.append(temp_max[index] - 6.0)
                hourly_rh.append(80.0 if profile == "wet" else 45.0)
                hourly_pressure.append(1013.0)

        payload[track_id] = {
            "daily": {
                "time": dates,
                "temperature_2m_max": temp_max,
                "temperature_2m_min": [value - 18.0 for value in temp_max],
                "apparent_temperature_max": [value + 2.0 for value in temp_max],
                "precipitation_sum": precip_sum,
                "precipitation_probability_max": precip_prob,
                "wind_speed_10m_max": [9.0] * days,
                "wind_gusts_10m_max": [15.0] * days,
                "weather_code": [61 if profile == "wet" else 1] * days,
            },
            "hourly": {
                "time": hourly_times,
                "temperature_2m": hourly_temp,
                "relative_humidity_2m": hourly_rh,
                "surface_pressure": hourly_pressure,
            },
        }
    return payload


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_physics() -> None:
    """Air density and density altitude must be sane at known reference points."""
    sea_level = pipeline.air_density_kg_m3(15.0, 0.0, 1013.25)
    check(1.220 < sea_level < 1.230, f"ISA sea-level density off: {sea_level}")
    check(abs(pipeline.density_altitude_ft(sea_level)) < 120,
          f"ISA density altitude should be near zero: {pipeline.density_altitude_ft(sea_level)}")

    hot_thin = pipeline.air_density_kg_m3(38.0, 20.0, 900.0)
    check(hot_thin < sea_level, "Hot low-pressure air must be less dense than ISA")
    check(pipeline.density_altitude_ft(hot_thin) > 4000,
          "Hot air at 900 hPa should read as high density altitude")

    humid = pipeline.air_density_kg_m3(30.0, 95.0, 1013.25)
    dry = pipeline.air_density_kg_m3(30.0, 5.0, 1013.25)
    check(humid < dry, "Humid air must be less dense than dry air at the same temperature")


def test_rule_grammar() -> None:
    ruleset = pipeline.load_json(DATA / "weather-alert-rules.json")
    rule_ids = [rule["id"] for rule in ruleset["rules"]]
    check(len(rule_ids) == len(set(rule_ids)), "Duplicate rule ids in weather-alert-rules.json")

    metric_ids = {metric["id"] for metric in ruleset["metrics"]}
    for rule in ruleset["rules"]:
        for group in ("all", "any"):
            for condition in (rule.get("when") or {}).get(group, []):
                check(condition["metric"] in metric_ids,
                      f"Rule {rule['id']} references undeclared metric {condition['metric']}")
                check(condition["op"] in pipeline.OPS,
                      f"Rule {rule['id']} uses unsupported operator {condition['op']}")
        check(rule["severity"] in ruleset["severityOrder"],
              f"Rule {rule['id']} has severity outside severityOrder")
        for slot in ("tire", "engine", "chassis", "crew"):
            check(rule["actions"].get(slot), f"Rule {rule['id']} is missing a {slot} action")

    fallbacks = [rule for rule in ruleset["rules"] if not (rule.get("when") or {})]
    check(len(fallbacks) == 1, "Expected exactly one catch-all fallback rule")

    wet = pipeline.evaluate_day({"precipProbMaxPct": 80, "tempMaxF": 78, "tempDropF": 0}, ruleset)
    check(wet[0]["id"] == "wet-race-day", f"Rain should fire wet-race-day, got {wet[0]['id']}")

    drop = pipeline.evaluate_day({"precipProbMaxPct": 5, "tempMaxF": 60, "tempDropF": 25}, ruleset)
    check("severe-temp-drop" in [rule["id"] for rule in drop], "A 25°F drop must fire severe-temp-drop")

    calm = pipeline.evaluate_day({"precipProbMaxPct": 5, "tempMaxF": 76, "tempDropF": 0,
                                  "gustMaxMph": 10, "windMaxMph": 6, "densityAltitudeFt": 500}, ruleset)
    check(calm[0]["severity"] == "ok", "A benign day should fall through to the ok fallback")

    # A missing metric must never crash or silently fire a rule.
    empty = pipeline.evaluate_day({}, ruleset)
    check(empty[0]["severity"] == "ok", "Missing metrics should fall through to the ok fallback")


def test_calendar_join() -> None:
    calendars = pipeline.load_json(DATA / "series-calendars.json")
    tracks = pipeline.load_json(DATA / "track-context.json")
    track_ids = {track["id"] for track in tracks["tracks"]}

    pro_rounds = [rnd for series in calendars["series"] for rnd in series["rounds"]
                  if rnd.get("nationalTier") == "pro-2stroke"]
    check(len(pro_rounds) == 10, f"Expected 10 national pro 2-stroke rounds, found {len(pro_rounds)}")
    for rnd in pro_rounds:
        check(rnd.get("trackId") in track_ids,
              f"Pro 2-stroke round '{rnd['name']}' has no resolvable trackId")

    for series in calendars["series"]:
        for rnd in series["rounds"]:
            if rnd.get("trackId"):
                check(rnd["trackId"] in track_ids,
                      f"Round '{rnd['name']}' points at unknown track '{rnd['trackId']}'")

    for track in tracks["tracks"]:
        check(isinstance(track.get("latitude"), (int, float)), f"{track['id']} has no latitude")
        check(isinstance(track.get("longitude"), (int, float)), f"{track['id']} has no longitude")
        check(-90 <= track["latitude"] <= 90 and -180 <= track["longitude"] <= 180,
              f"{track['id']} coordinates are out of range")
        check(track.get("timezone"), f"{track['id']} has no timezone")

    # Every event the pipeline selects must carry coordinates.
    events, _ = pipeline.select_events(calendars, tracks, date(2026, 1, 1), 400)
    check(len(events) > 20, f"Expected the full season in a 400-day window, got {len(events)}")
    for event in events:
        check(event["_track"]["latitude"] is not None, f"{event['id']} lost its coordinates")


def run_pipeline(profile: str, today: date, event_start: date, tmp: Path, notify_env=None) -> dict:
    calendars = pipeline.load_json(DATA / "series-calendars.json")
    tracks = pipeline.load_json(DATA / "track-context.json")
    events, skipped = pipeline.select_events(calendars, tracks, today, 16)
    track_ids = sorted({event["trackId"] for event in events})
    fixture_path = tmp / f"fixture-{profile}.json"
    fixture_path.write_text(json.dumps(build_fixture(track_ids, event_start, 16, profile)))

    output = tmp / f"race-weather-{profile}.json"
    argv = sys.argv
    sys.argv = ["build_weather_forecast.py", "--fixture", str(fixture_path),
                "--output", str(output), "--today", today.isoformat()]
    try:
        code = pipeline.main()
    finally:
        sys.argv = argv
    check(code == 0, f"Pipeline exited {code} for profile {profile}")
    return json.loads(output.read_text())


def test_end_to_end(tmp: Path) -> None:
    # Anchor on a real race weekend so the test exercises the shipped calendar.
    today = date(2026, 7, 20)
    event_start = today

    wet = run_pipeline("wet", today, event_start, tmp)
    check(wet["events"], "Expected at least one event in the July window (SKUSA SummerNationals)")
    summer = next((event for event in wet["events"] if event["id"] == "skusa:pt-3"), None)
    check(summer is not None, "SKUSA Pro Tour SummerNationals should be inside a 16-day July window")
    check(summer["severity"] == "alert", f"A 90% rain fixture must read as alert, got {summer['severity']}")
    check(summer["notify"], "A wet weekend 4 days out must be inside the notify window")
    check("wet-race-day" in summer["notifyRules"], "wet-race-day should be a notifying rule")
    check(len(summer["days"]) == 3, f"SummerNationals is a 3-day event, got {len(summer['days'])} days")
    check(summer["coordinates"]["latitude"] is not None, "Event payload must carry coordinates")
    for day in summer["days"]:
        check(day["rules"][0]["actions"]["tire"], "A firing rule must carry tire guidance")
        check(day["metrics"]["densityAltitudeFt"] is not None, "Density altitude should be computed")

    clear = run_pipeline("clear", today, event_start, tmp)
    calm = next(event for event in clear["events"] if event["id"] == "skusa:pt-3")
    check(calm["severity"] == "ok", f"A benign fixture should read ok, got {calm['severity']}")
    check(not calm["notify"], "A benign weekend must not trigger a notification")
    check(calm["days"][0]["metrics"]["tempDropF"] == 0.0, "Flat temperatures mean no day-over-day drop")

    cold = run_pipeline("cold-snap", today, event_start, tmp)
    snap = next(event for event in cold["events"] if event["id"] == "skusa:pt-3")
    check("severe-temp-drop" in snap["notifyRules"],
          f"A 25°F overnight collapse must alert, got {snap['notifyRules']}")

    check(wet["alertDigest"] != clear["alertDigest"], "Different alert sets must produce different digests")
    rerun = run_pipeline("wet", today, event_start, tmp)
    check(rerun["alertDigest"] == wet["alertDigest"], "An unchanged forecast must produce a stable digest")

    # Change detection: the same payload must not rewrite the file.
    check(pipeline.payload_body(wet) == pipeline.payload_body(rerun),
          "Identical forecasts must compare equal ignoring the run timestamp")


def test_webhook_shapes() -> None:
    message = "line one\nline two"
    slack = json.loads(pipeline.webhook_body("https://hooks.slack.com/services/x", message, "auto"))
    check("text" in slack, "Slack webhooks expect a 'text' field")
    discord = json.loads(pipeline.webhook_body("https://discord.com/api/webhooks/x", message, "auto"))
    check("content" in discord, "Discord webhooks expect a 'content' field")
    forced = json.loads(pipeline.webhook_body("https://example.com/hook", message, "discord"))
    check("content" in forced, "--webhook-style discord must override URL inference")


def main() -> int:
    with tempfile.TemporaryDirectory() as raw_tmp:
        tmp = Path(raw_tmp)
        test_physics()
        test_rule_grammar()
        test_calendar_join()
        test_end_to_end(tmp)
        test_webhook_shapes()
    print("WEATHER PIPELINE TESTS OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
