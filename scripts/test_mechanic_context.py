#!/usr/bin/env python3
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "raceTracker" / "assets" / "js" / "main.js"
CSS = ROOT / "raceTracker" / "assets" / "css" / "style.css"
DATA = ROOT / "raceTracker" / "assets" / "data"
PAGES = sorted((ROOT / "raceTracker").glob("*.html"))
WORKSHOP = ROOT / "raceTracker" / "workshop.html"
SETTINGS = ROOT / "raceTracker" / "settings.html"


def read(path):
    return path.read_text(encoding="utf-8")


def assert_in(needle, haystack, label):
    if needle not in haystack:
        raise AssertionError(f"Missing {label}: {needle}")


def load_json(path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def assert_real_data_contract():
    mechanics = load_json(DATA / "mechanics.json")
    tasks = load_json(DATA / "workshop-tasks.json")

    mechanic_names = {item["name"] for item in mechanics["mechanics"]}
    assert "Luiz" in mechanic_names, "Luiz mechanic profile should be present"
    assert len(mechanic_names) >= 3, "Expected at least 3 mechanic profiles"

    task_items = tasks["tasks"]
    assert len(task_items) >= 6, "Expected at least 6 workshop tasks"
    for task in task_items:
        for key in ["owner", "kart", "task", "due", "status", "priority"]:
            if key not in task:
                raise AssertionError(f"Workshop task missing {key}: {task}")
        if task["owner"] not in mechanic_names:
            raise AssertionError(f"Task owner not in mechanics.json: {task['owner']}")


def main():
    js = read(JS)
    css = read(CSS)
    workshop = read(WORKSHOP)
    settings = read(SETTINGS)

    assert_in("raceTracker.mechanicProfile", js, "persistent mechanic profile key")
    assert_in("initMechanicContext", js, "mechanic context initializer")
    assert_in("loadMechanicData", js, "JSON-backed mechanic data loader")
    assert_in("/assets/data/mechanics.json", js, "mechanics JSON endpoint")
    assert_in("/assets/data/workshop-tasks.json", js, "workshop tasks JSON endpoint")
    assert_in("data-mechanic-select", js, "mechanic selector hook")
    assert_in("data-owner", workshop, "workshop task ownership data")
    assert_in("data-my-task-count", workshop, "my task count KPI")
    assert_in("Mechanic profile", settings, "settings mechanic profile section")
    assert_in(".mechanic-switcher", css, "mechanic switcher styles")
    assert_in(".is-my-task", css, "selected mechanic task highlight")

    for page in PAGES:
        text = read(page)
        assert_in("data-mechanic-slot", text, f"mechanic slot in {page.name}")

    assert_real_data_contract()

    print("MECHANIC CONTEXT TESTS OK")


if __name__ == "__main__":
    main()
