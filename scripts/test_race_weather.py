#!/usr/bin/env python3
"""Offline tests for scripts/refresh_race_weather.py.

Stubs Open-Meteo with synthetic responses shaped like the real API, so the
forecast / climate / actual code paths, the multi-location array response, the
content-hash short-circuit and the failure guards are all exercised without a
network call. Run: python3 scripts/test_race_weather.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import refresh_race_weather as rw  # noqa: E402

FAILURES = []


def check(label, condition, detail=""):
    if condition:
        print(f"  ok   {label}")
    else:
        print(f"  FAIL {label} {detail}")
        FAILURES.append(label)


def daily_block(start: date, days: int, **overrides):
    times = [(start + timedelta(days=i)).isoformat() for i in range(days)]
    block = {
        "time": times,
        "weather_code": [overrides.get("code", 1)] * days,
        "temperature_2m_max": [overrides.get("high", 78.0)] * days,
        "temperature_2m_min": [overrides.get("low", 60.0)] * days,
        "precipitation_sum": [overrides.get("rain", 0.0)] * days,
        "wind_speed_10m_max": [overrides.get("wind", 8.0)] * days,
        "wind_gusts_10m_max": [overrides.get("gust", 14.0)] * days,
    }
    if overrides.get("with_prob"):
        block["precipitation_probability_max"] = [overrides.get("prob", 10)] * days
    return {"daily": block}


# ── risk classifier ───────────────────────────────────────────────────────
def test_risk():
    print("risk classification")
    t = rw.RISK_THRESHOLDS
    check("trace rain is not an alert",
          rw.classify_race_day_risk({"precipInches": 0.03, "tempMaxF": 75, "tempMinF": 60,
                                     "windMaxMph": 5, "gustMaxMph": 8, "weatherCode": 1},
                                    "forecast")["state"] == "ok")
    check("daily rain over threshold alerts",
          rw.classify_race_day_risk({"precipInches": t["dailyRainIn"], "tempMaxF": 75,
                                     "tempMinF": 60, "windMaxMph": 5, "gustMaxMph": 8,
                                     "weatherCode": 1}, "forecast")["state"] == "alert")
    check("high rain probability alerts (forecast only)",
          rw.classify_race_day_risk({"precipInches": 0, "precipProbabilityMaxPct": 70,
                                     "tempMaxF": 75, "tempMinF": 60, "windMaxMph": 5,
                                     "gustMaxMph": 8, "weatherCode": 1}, "forecast")["state"] == "alert")
    check("rain probability ignored in climate mode",
          rw.classify_race_day_risk({"precipInches": 0, "precipProbabilityMaxPct": 70,
                                     "tempMaxF": 75, "tempMinF": 60, "windMaxMph": 5,
                                     "gustMaxMph": 8, "weatherCode": 1}, "climate")["state"] == "ok")
    check("wet-day frequency alerts in climate mode",
          rw.classify_race_day_risk({"precipInches": 0, "wetDayFrequencyPct": 60,
                                     "tempMaxF": 75, "tempMinF": 60, "windMaxMph": 5,
                                     "gustMaxMph": 8, "weatherCode": 1}, "climate")["state"] == "alert")
    check("rainy WMO code alerts",
          rw.classify_race_day_risk({"precipInches": 0, "tempMaxF": 75, "tempMinF": 60,
                                     "windMaxMph": 5, "gustMaxMph": 8, "weatherCode": 61},
                                    "forecast")["state"] == "alert")
    check("hot day warns",
          rw.classify_race_day_risk({"precipInches": 0, "tempMaxF": 95, "tempMinF": 70,
                                     "windMaxMph": 5, "gustMaxMph": 8, "weatherCode": 1},
                                    "forecast")["state"] == "warn")
    check("cold low warns",
          rw.classify_race_day_risk({"precipInches": 0, "tempMaxF": 60, "tempMinF": 45,
                                     "windMaxMph": 5, "gustMaxMph": 8, "weatherCode": 1},
                                    "forecast")["state"] == "warn")
    check("gust over alert threshold alerts",
          rw.classify_race_day_risk({"precipInches": 0, "tempMaxF": 75, "tempMinF": 60,
                                     "windMaxMph": 20, "gustMaxMph": 30, "weatherCode": 1},
                                    "forecast")["state"] == "alert")


def test_key_formula():
    print("weekend key formula (must match calRoundKey in main.js)")
    check("division included", rw.weekend_key("ckna", "south", 1) == "ckna:south:1")
    check("missing division becomes main", rw.weekend_key("uspks", None, 4) == "uspks:main:4")
    check("string rounds work", rw.weekend_key("skusa", "pro-tour", "pt-1") == "skusa:pro-tour:pt-1")
    check("CKNA divisions do not collide",
          rw.weekend_key("ckna", "south", 1) != rw.weekend_key("ckna", "north", 1))


def test_multi_location_parse():
    print("multi-location forecast response (array, not object)")
    blocks = [daily_block(date(2026, 7, 24), 3, high=90.0, with_prob=True),
              daily_block(date(2026, 7, 24), 3, high=70.0, with_prob=True)]
    rows0 = rw.daily_rows(blocks[0])
    rows1 = rw.daily_rows(blocks[1])
    check("array element 0 parsed", rows0["2026-07-24"]["temperature_2m_max"] == 90.0)
    check("array element 1 parsed", rows1["2026-07-24"]["temperature_2m_max"] == 70.0)
    check("row count matches", len(rows0) == 3)


def test_climate():
    print("climate normals")
    rows = {}
    for year in range(rw.CLIMATE_YEARS[0], rw.CLIMATE_YEARS[1] + 1):
        cursor = date(year, 1, 1)
        while cursor.year == year:
            rows[cursor.isoformat()] = {
                "temperature_2m_max": 80.0, "temperature_2m_min": 62.0,
                "precipitation_sum": 0.2 if cursor.month == 7 else 0.0,
                "wind_speed_10m_max": 10.0, "wind_gusts_10m_max": 18.0,
                "weather_code": 61 if cursor.month == 7 else 1,
            }
            cursor += timedelta(days=1)
    entry = {"dateStart": "2027-07-24", "dateEnd": "2027-07-26"}
    days = rw.climate_days(entry, rows)
    check("one record per race day", len(days) == 3)
    window = 2 * rw.CLIMATE_WINDOW_DAYS + 1
    years = rw.CLIMATE_YEARS[1] - rw.CLIMATE_YEARS[0] + 1
    check(f"samples widened to {window} days x {years} years",
          days[0]["sampleCount"] == window * years, f"got {days[0]['sampleCount']}")
    check("mean high computed", days[0]["tempMaxF"] == 80.0)
    check("wet-day frequency computed", days[0]["wetDayFrequencyPct"] == 100)
    check("no fabricated rain probability", "precipProbabilityMaxPct" not in days[0])
    check("climate risk uses wet-day frequency", days[0]["risk"]["state"] == "alert")

    leap = rw.climate_days({"dateStart": "2028-02-29", "dateEnd": "2028-02-29"}, rows)
    check("Feb 29 does not crash", len(leap) == 1)
    check("Feb 29 skips non-leap years", 0 < leap[0]["sampleCount"] < window * years)


def test_summary():
    print("weekend summary roll-up")
    days = [
        {"date": "2026-07-24", "weekdayLabel": "Fri", "tempMaxF": 80.0, "tempMinF": 60.0,
         "windMaxMph": 8.0, "gustMaxMph": 14.0, "precipInches": 0.0, "weatherCode": 1,
         "risk": {"state": "ok"}},
        {"date": "2026-07-25", "weekdayLabel": "Sat", "tempMaxF": 93.0, "tempMinF": 70.0,
         "windMaxMph": 12.0, "gustMaxMph": 30.0, "precipInches": 0.25, "weatherCode": 61,
         "risk": {"state": "alert"}},
    ]
    summary = rw.summarize(days, "forecast")
    check("max high", summary["tempMaxF"] == 93.0)
    check("min low", summary["tempMinF"] == 60.0)
    check("max gust", summary["gustMaxMph"] == 30.0)
    check("precip summed across the weekend", summary["precipInches"] == 0.25)
    check("wettest day identified", summary["wettestDate"] == "2026-07-25")
    check("worst risk wins", summary["risk"]["state"] == "alert")
    check("headline built", "93°F" in summary["headline"])

    prep = rw.build_prep(days, summary, "forecast")
    check("prep mentions rain tires", any("Rain tires" in p for p in prep))
    check("prep mentions gusts", any("Gusts" in p for p in prep))
    check("prep mentions heat", any("Heat" in p for p in prep))


def test_content_hash():
    print("content hash short-circuit")
    a = {"schemaVersion": 1, "updatedAt": "2026-01-01T00:00:00+00:00", "weekends": [{"key": "x"}]}
    b = {"schemaVersion": 1, "updatedAt": "2026-06-30T12:00:00+00:00", "weekends": [{"key": "x"}]}
    c = {"schemaVersion": 1, "updatedAt": "2026-01-01T00:00:00+00:00", "weekends": [{"key": "y"}]}
    check("timestamp alone does not change the hash", rw.content_hash(a) == rw.content_hash(b))
    check("content change does change the hash", rw.content_hash(a) != rw.content_hash(c))

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "race-weather.json"
        payload = dict(a)
        check("first write happens", rw.write_output(path, payload, None) is True)
        previous = json.loads(path.read_text())
        before = path.stat().st_mtime_ns
        payload2 = {"schemaVersion": 1, "updatedAt": "2026-09-09T00:00:00+00:00",
                    "weekends": [{"key": "x"}]}
        check("identical content is skipped", rw.write_output(path, payload2, previous) is False)
        check("file left untouched", path.stat().st_mtime_ns == before)


def test_mode_selection():
    print("mode selection by lead time")
    today = date(2026, 8, 30)
    def mode(start, end):
        return rw.target_mode({"dateStart": start, "dateEnd": end}, today)
    check("well past -> actual", mode("2026-07-24", "2026-07-26") == "actual")
    check("inside archive lag -> forecast", mode("2026-08-28", "2026-08-29") == "forecast")
    check("near future -> forecast", mode("2026-09-05", "2026-09-07") == "forecast")
    check("beyond 16 days -> climate", mode("2026-10-08", "2026-10-11") == "climate")
    check("next season -> climate", mode("2027-03-14", "2027-03-15") == "climate")


def test_unavailable_reasons():
    print("unavailable classification against the real calendar")
    calendar = json.loads(rw.CALENDAR.read_text())
    tracks = json.loads(rw.TRACK_CONTEXT.read_text())
    weekends = rw.build_weekends(calendar, tracks, date(2026, 8, 30))
    by_key = {w["key"]: w for w in weekends}

    check("STARS banquet is non-race",
          by_key["stars:main:banquet"]["_reason"] == "non-race")
    check("venue-tba round has no weather",
          by_key["stars:main:3"]["_reason"] == "venue-tba")
    check("cancelled Challenge round flagged",
          by_key["challenge-americas:main:2"]["_reason"] == "cancelled")
    check("no round has an unresolved trackId",
          not [w for w in weekends if w["_reason"] == "no-coordinates"])

    ckna_south = by_key["ckna:south:1"]
    ckna_north = by_key["ckna:north:1"]
    check("CKNA south/north round 1 are distinct entries",
          ckna_south["trackId"] != ckna_north["trackId"],
          f"{ckna_south['trackId']} vs {ckna_north['trackId']}")

    # A multi-month entry must never be given a weekend forecast. Built here rather
    # than borrowed from the calendar, so a scope change cannot silently delete the
    # only case exercising the rule.
    span_calendar = {"series": [{
        "id": "synthetic", "name": "Synthetic", "engineType": "2-stroke", "country": "US",
        "rounds": [{
            "round": "long", "name": "Season-long championship", "track": "Multiple venues",
            "trackId": "new-castle-motorsports-park", "trackCity": "Various",
            "dateStart": "2026-03-01", "dateEnd": "2026-09-30", "status": "confirmed",
        }],
    }]}
    span = rw.build_weekends(span_calendar, tracks, date(2026, 8, 30))[0]
    check(f"a {span['spanDays']}-day event is span-too-long",
          span["_reason"] == "span-too-long", f"got {span['_reason']}")

    two_stroke = [w for w in weekends if w["engineType"] == "2-stroke"]
    four_stroke = [w for w in weekends if w["engineType"] == "4-stroke"]
    check("2-stroke rounds tagged", len(two_stroke) > 30, f"got {len(two_stroke)}")
    check("4-stroke rounds tagged", len(four_stroke) > 10, f"got {len(four_stroke)}")
    check("every weekend has a country", all(w["country"] for w in weekends))
    non_us = {w["country"] for w in weekends} - {"US"}
    check("scope is US-only", non_us == set(), f"non-US rounds present: {non_us}")


def test_thresholds_match_js():
    print("threshold parity with main.js")
    js = (rw.ROOT / "raceTracker/assets/js/main.js").read_text()
    start = js.index("const WEATHER_THRESHOLDS")
    block = js[start:js.index("};", start)]
    for name, value in rw.RISK_THRESHOLDS.items():
        if name == "rainyCodes":
            codes = [int(c) for c in
                     block[block.index("rainyCodes"):block.index("]", block.index("rainyCodes"))]
                     .split("[")[1].split(",")]
            check("rainyCodes match", codes == value, f"{codes} vs {value}")
        else:
            check(f"{name} matches", f"{name}:" in block and str(value) in block)


def test_temp_drop():
    print("day-over-day temperature drop")
    t = rw.RISK_THRESHOLDS

    days = [{"date": "2026-07-24", "weekdayLabel": "Fri", "tempMaxF": 88.0, "tempMinF": 70.0,
             "windMaxMph": 6, "gustMaxMph": 10, "precipInches": 0.0, "weatherCode": 1},
            {"date": "2026-07-25", "weekdayLabel": "Sat", "tempMaxF": 62.0, "tempMinF": 55.0,
             "windMaxMph": 6, "gustMaxMph": 10, "precipInches": 0.0, "weatherCode": 1},
            {"date": "2026-07-26", "weekdayLabel": "Sun", "tempMaxF": 61.0, "tempMinF": 54.0,
             "windMaxMph": 6, "gustMaxMph": 10, "precipInches": 0.0, "weatherCode": 1}]
    rw.attach_temp_drops(days, "forecast")
    check("first day has no drop without a lead-in", days[0]["tempDropF"] == 0.0)
    check("26F collapse recorded", days[1]["tempDropF"] == 26.0, f"got {days[1]['tempDropF']}")
    check("collapse day alerts", days[1]["risk"]["state"] == "alert")
    check("a warm day either side of it stays ok", days[0]["risk"]["state"] == "ok")
    check("a mild 1F change does not alert", days[2]["tempDropF"] == 1.0
          and days[2]["risk"]["state"] == "ok")

    # A warming trend must never register as a drop.
    warming = [{"date": "2026-07-24", "weekdayLabel": "Fri", "tempMaxF": 60.0, "tempMinF": 55.0},
               {"date": "2026-07-25", "weekdayLabel": "Sat", "tempMaxF": 85.0, "tempMinF": 65.0}]
    rw.attach_temp_drops(warming, "forecast")
    check("warming is not a drop", warming[1]["tempDropF"] == 0.0)

    # The lead-in catches a collapse that lands on day one of the weekend.
    lead = [{"date": "2026-07-24", "weekdayLabel": "Fri", "tempMaxF": 60.0, "tempMinF": 50.0,
             "windMaxMph": 5, "gustMaxMph": 9, "precipInches": 0.0, "weatherCode": 1}]
    rw.attach_temp_drops(lead, "forecast", lead_in_high=85.0)
    check("lead-in catches a day-one collapse", lead[0]["tempDropF"] == 25.0)
    check("day-one collapse alerts", lead[0]["risk"]["state"] == "alert")

    summary = rw.summarize(days, "forecast")
    check("summary carries the worst drop", summary["tempDropF"] == 26.0)
    prep = rw.build_prep(days, summary, "forecast")
    check("prep names the collapse", any("falls 26" in line for line in prep), prep)
    check("prep is actionable", any("richen the main" in line for line in prep), prep)

    below = dict(days[1], tempDropF=t["severeTempDropF"] - 1)
    check("just under the threshold does not alert",
          rw.classify_race_day_risk(below, "forecast")["state"] == "ok")


def test_alerting():
    print("webhook alerting")
    def weekend(key, lead, state, mode="forecast"):
        return {"key": key, "seriesId": "skusa", "seriesName": "SKUSA", "name": key,
                "track": "New Castle", "trackCity": "New Castle, IN", "leadDays": lead,
                "mode": mode, "prep": ["Rain tires and wet setup"],
                "summary": {"headline": "64°F · 0.40 in", "risk": {"state": state}},
                "days": [{"date": "2026-07-24", "weekdayLabel": "Fri", "precipInches": 0.4,
                          "precipProbabilityMaxPct": 90, "gustMaxMph": 18, "tempDropF": 0,
                          "risk": {"state": state}}]}

    inside = weekend("skusa:pro-tour:pt-3", 4, "alert")
    outside = weekend("uspks:main:2", 20, "alert")
    calm = weekend("uspks:main:3", 3, "ok")
    normals = weekend("uspks:main:4", 5, "alert", mode="climate")

    hits = rw.alerting_weekends([inside, outside, calm, normals], rw.NOTIFY_WINDOW_DAYS)
    check("alerts inside the window", [h["key"] for h in hits] == ["skusa:pro-tour:pt-3"],
          [h["key"] for h in hits])
    check("a climate normal never pages", all(h["mode"] == "forecast" for h in hits))

    past = weekend("skusa:pro-tour:pt-2", -3, "alert")
    check("a finished weekend never pages",
          rw.alerting_weekends([past], rw.NOTIFY_WINDOW_DAYS) == [])

    digest = rw.alert_digest(hits)
    check("digest is stable", digest == rw.alert_digest(hits))
    check("empty alert set has an empty digest", rw.alert_digest([]) == "")
    changed = json.loads(json.dumps(inside))
    changed["days"][0]["risk"]["state"] = "warn"
    check("a changed alert set changes the digest",
          rw.alert_digest([changed]) != digest)

    message = rw.build_alert_message(hits, rw.NOTIFY_WINDOW_DAYS)
    check("message names the event", "skusa:pro-tour:pt-3" in message)
    check("message carries prep", "Rain tires" in message)

    slack = json.loads(rw.webhook_body("https://hooks.slack.com/services/x", "hi"))
    check("slack shape", "text" in slack)
    discord = json.loads(rw.webhook_body("https://discord.com/api/webhooks/x", "hi"))
    check("discord shape", "content" in discord)

    saved = os.environ.pop("RACETRACKER_WEATHER_WEBHOOK_URL", None)
    try:
        payload = {"weekends": [inside], "notifyWindowDays": rw.NOTIFY_WINDOW_DAYS,
                   "alertDigest": digest}
        status = rw.send_alerts(payload, None, 5)
        check("no webhook configured is not an error", "no webhook configured" in status, status)
    finally:
        if saved is not None:
            os.environ["RACETRACKER_WEATHER_WEBHOOK_URL"] = saved


def test_prep_copy_matches_js():
    """buildPrepLines() in main.js must say the same things build_prep() does.

    The sandbox shows a mechanic what the automation would tell them, so the two
    sets of wording drifting apart would make the sandbox quietly dishonest.
    """
    print("prep copy parity with main.js")
    js = (rw.ROOT / "raceTracker/assets/js/main.js").read_text()
    for phrase in ("Rain tires and wet setup",
                   "recheck ride height and front-end toe after run 1",
                   "expect a loose entry down the straight",
                   "drop tire pressures, plan driver cooling and hydration",
                   "warmers, richer jetting, longer out-laps",
                   "richen the main a step, recheck clutch engagement",
                   "run the standard pressure and jetting baseline",
                   "Based on past seasons, not a forecast"):
        check(f"js carries {phrase!r}", phrase in js)

    py = (rw.ROOT / "scripts/refresh_race_weather.py").read_text()
    check("notify window mirrored in main.js",
          f"RACE_WX_NOTIFY_WINDOW_DAYS = {rw.NOTIFY_WINDOW_DAYS}" in js)
    check("python still owns the notify window", "NOTIFY_WINDOW_DAYS = 7" in py)


def main() -> int:
    for test in (test_risk, test_key_formula, test_multi_location_parse, test_climate,
                 test_summary, test_content_hash, test_mode_selection,
                 test_unavailable_reasons, test_temp_drop, test_alerting,
                 test_thresholds_match_js, test_prep_copy_matches_js):
        test()
    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
        return 1
    print("All race-weather checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
