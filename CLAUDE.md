# CLAUDE.md — raceTracker

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

Shared operations app for Evolution Kart School and The Kart Depot, built on the raceTracker codebase.
**Client context:** Emerson Silveira
**Live site:** [tracker.absolutelyplausible.com](https://tracker.absolutelyplausible.com)

The repository and storage keys retain `raceTracker`; the deployed interface is branded for Evolution/TKD.

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
- Current version: `v1.17.0`
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
- Alerting is webhook-only and opt-in via `RACETRACKER_WEATHER_WEBHOOK_URL` (GitHub
  Actions secret, never in the repo). Only real forecasts inside `NOTIFY_WINDOW_DAYS`
  page the crew — never climate normals
- `raceTracker/weather.html` runs the shipped classifier in the browser. If you change
  `build_prep`, change `buildPrepLines` in main.js too — `test_race_weather.py` asserts
  the wording matches

## Businesses and Theme

- raceTracker is the internal app for **Evolution Kart School** and **The Kart Depot** —
  legally separate businesses, same owner. `raceTracker/assets/data/entities.json` defines both
- The shell structure is shared (same layout, components, nav), but the two businesses now run
  **distinct per-entity color themes**, scoped via the `data-entity` attribute `applyEntity()`
  sets on `<body>` (`raceTracker/assets/js/main.js`): **Evolution reads blue** (navy ground,
  blue accent, unchanged from the original Trackside Navy look, just with lighter card/nav
  surface tokens — `--evo-surface`/`--evo-surface-soft` in `style.css`); **The Kart Depot reads
  yellow** (warm amber ground/surfaces via the `body[data-entity="the-kart-depot"]` block in
  `style.css`, `--tkd-*` tokens). As a brand rule going forward: **yellow signals TKD, blue
  signals Evolution** — apply that association to any new UI, not just the shell background
- This supersedes the earlier "one shared palette, no per-entity colour systems" rule. Extend
  the theming through the semantic tokens (`--bg`, `--surface`, `--surface-soft`, `--carbon`,
  `--text`, `--muted`, `--border`) so it cascades automatically — don't hand-pick colours per
  component
- Every `billing.json` expense needs an `entityId`; the validator fails without one.
  Two sets of books must never blend
- Brand colours come from `kart-depot-shopify/brand/tokens.json`; web logo copies derive from
  the masters in `evo-krt-schl/assets/brand/`
- Inventory is entity-neutral (static HTML, no data file). Entity-tagged stock needs an
  `inventory.json` that does not exist yet — do not fake it
- The palette lives entirely in `:root` (plus the `body[data-entity="the-kart-depot"]` override
  block). Never write a raw brand `rgba()` literal; use `rgb(var(--primary-rgb) / a)`.
  `validate_structure.py` fails the build on one
- `<meta name="theme-color">` is statically pinned to `--navy` (Evolution, the default entity's
  ground) by the validator for the pre-JS first paint — it cannot use a var. `applyEntity()`
  repaints it at runtime via `ENTITY_THEME_COLOR` in `main.js` when The Kart Depot is selected;
  keep that mapping in step with `--tkd-bg` by hand, the validator can't check it
- **Series badge colours (`.cal-sbadge--*`) are the series' own identity, not ours.** Do not
  harmonise them with the Evolution/TKD palette, however tempting it looks

## Scope

- **US series only** through roughly 2028. Non-US series and rounds were removed deliberately;
  recover from git history if that changes
- `validate_structure.py` fails on any series or round with a country other than `US`

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
