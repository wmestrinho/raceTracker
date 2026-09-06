#!/usr/bin/env python3
"""Fixture tests for check_calendar_drift.py.

This checker parses Emerson's hand-maintained prototype page — someone else's
source, which can be reshaped at any time. These tests pin the behaviour that
matters: translated titles and fuller venue spellings must not read as drift,
a genuinely missing round must, and a page whose shape we can no longer read
must say so rather than quietly reporting "in sync".
"""

import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent / "check_calendar_drift.py"
FIXTURES = Path(__file__).parent / "fixtures"

failures = []


def run(origin: Path, feed: Path, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--origin-file", str(origin), "--feed-file", str(feed), *extra],
        capture_output=True, text=True, timeout=60
    )


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label}{f' — {detail}' if detail else ''}")
        print(f"  FAIL {label}{f' — {detail}' if detail else ''}")


origin = FIXTURES / "origin-calendar.html"

print("A feed that matches the origin reads as in sync")
result = run(origin, FIXTURES / "feed-in-sync.json")
check("exits 0", result.returncode == 0, result.stderr.strip())
check("reports IN SYNC", "IN SYNC" in result.stdout)
check("a translated title is not drift", "DRIFT" not in result.stdout, result.stdout)
check("a fuller venue spelling is not a venue change", "VENUE" not in result.stdout, result.stdout)
check("an 'a confirmar' round is held, not missing",
      "HELD   1 round(s)" in result.stdout, result.stdout)

print("\nA feed missing a confirmed round reports drift")
result = run(origin, FIXTURES / "feed-drifted.json")
check("names the missing round", "ROK Vegas" in result.stdout, result.stdout)
check("reports the moved venue", "VENUE" in result.stdout and "New Castle" in result.stdout, result.stdout)
check("reports the unmatched published event", "SKUSA" in result.stdout, result.stdout)
check("still exits 0 by default — raceTracker does not own this calendar",
      result.returncode == 0, f"exit {result.returncode}")

print("\n--fail-on-drift is opt-in")
check("in-sync stays 0", run(origin, FIXTURES / "feed-in-sync.json", "--fail-on-drift").returncode == 0)
check("drift becomes 1", run(origin, FIXTURES / "feed-drifted.json", "--fail-on-drift").returncode == 1)

print("\nAn unreadable origin page is reported, never treated as in sync")
unreadable = FIXTURES / "_tmp-unreadable.html"
unreadable.write_text("<html><body>Emerson redesigned the page</body></html>", encoding="utf-8")
try:
    result = run(unreadable, FIXTURES / "feed-in-sync.json")
    check("says UNREADABLE", "UNREADABLE" in result.stdout, result.stdout)
    check("does not claim IN SYNC", "IN SYNC" not in result.stdout, result.stdout)
finally:
    unreadable.unlink()

print()
if failures:
    print(f"{len(failures)} calendar-drift check(s) failed:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("All calendar-drift checks passed.")
