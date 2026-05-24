#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "raceTracker" / "assets" / "js" / "main.js"
CSS = ROOT / "raceTracker" / "assets" / "css" / "style.css"
PAGES = sorted((ROOT / "raceTracker").glob("*.html"))
WORKSHOP = ROOT / "raceTracker" / "workshop.html"
SETTINGS = ROOT / "raceTracker" / "settings.html"


def read(path):
    return path.read_text(encoding="utf-8")


def assert_in(needle, haystack, label):
    if needle not in haystack:
        raise AssertionError(f"Missing {label}: {needle}")


def main():
    js = read(JS)
    css = read(CSS)
    workshop = read(WORKSHOP)
    settings = read(SETTINGS)

    assert_in("raceTracker.mechanicProfile", js, "persistent mechanic profile key")
    assert_in("initMechanicContext", js, "mechanic context initializer")
    assert_in("data-mechanic-select", js, "mechanic selector hook")
    assert_in("data-owner", workshop, "workshop task ownership data")
    assert_in("data-my-task-count", workshop, "my task count KPI")
    assert_in("Mechanic profile", settings, "settings mechanic profile section")
    assert_in(".mechanic-switcher", css, "mechanic switcher styles")
    assert_in(".is-my-task", css, "selected mechanic task highlight")

    for page in PAGES:
        text = read(page)
        assert_in("data-mechanic-slot", text, f"mechanic slot in {page.name}")

    print("MECHANIC CONTEXT TESTS OK")


if __name__ == "__main__":
    main()
