# CLAUDE.md — raceTracker

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

Static frontend prototype for karting operations, workshop execution, and telemetry visibility.
**Client context:** Sergio "Nuno" Campos (internal branding reference: "Nash")
**Live site:** [tracker.absolutelyplausible.com](https://tracker.absolutelyplausible.com)

Keep external app naming as `raceTracker` so it can be adapted for other teams, mechanics, or vendors later.

## Architecture

**Do not** create parallel site roots (`docs/`, root `assets/`, `site/`, etc.).

## Deployment

Deploy via Cloudflare Workers/Pages using Wrangler:

```sh
wrangler deploy
```

Static assets directory: `raceTracker/`
Custom domain: `tracker.absolutelyplausible.com` (set by `CNAME` file)

## Version Rule

- Single source of truth: `VERSION`
- Current version: `v1.12.0`
- Version must be visibly displayed in the footer of `raceTracker/index.html`
- Bump format: PATCH (bug/copy/polish) · MINOR (new section/feature) · MAJOR (rewrite/breaking layout)
- Include version in commit messages: `feat: add lap timer — v1.8.0`

## Live Data Guardrails

- Browser-side live data must use **public, credential-free APIs only**
- Credentialed sources go through a Cloudflare Worker proxy — **never** put API keys in static JS
- Default tracks: New Castle Motorsports Park (IN) and Trackhouse Motorplex (Mooresville, NC)
- Supabase secrets belong only in `.env.local` (gitignored) — never in Git, static JS, markdown, or memory
- Telemetry is integration/export-only for now

## Race Weekend Weather

- `raceTracker/assets/data/race-weather.json` is **generated** — edit
  `scripts/refresh_race_weather.py`, never the JSON by hand
- Weekend keys are `seriesId:division:round`. That formula is duplicated in three
  places (`calRoundKey` in `main.js`, `weekend_key` in the refresh script, and
  `validate_structure.py`) and all three must stay in step
- Risk thresholds live in `WEATHER_THRESHOLDS` (`main.js`) and `RISK_THRESHOLDS`
  (refresh script); `validate_structure.py` fails the build if they drift
- Series carry `engineType` (`2-stroke` / `4-stroke` / `mixed`) and `country`; the
  schedule page defaults to 2-stroke US
- Calendar rounds sourced from a single reference are marked
  `"sourceConfidence": "unverified"` — do not silently promote them to confirmed

## Before Committing

- Run: `python3 scripts/validate_structure.py`
- Run: `python3 scripts/test_race_weather.py`
- Run: `git status --short --branch`
- Confirm changes are only in this repo

## Case/Path Guardrails

- The canonical frontend directory is exactly `raceTracker/` (capital T)
- On macOS the filesystem is case-insensitive — do not create `RaceTracker/` or `racetracker/` aliases
- Do not add logo variants under `raceTracker/assets/images/` without updating the validation script

## Constraints

- No npm, no bundlers, no frameworks — static HTML/CSS/JS only
- Do not start first-party telemetry collection without a team-approved source/API
