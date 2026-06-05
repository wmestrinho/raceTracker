# CLAUDE.md — raceTracker

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

Static frontend prototype for karting operations, workshop execution, and telemetry visibility.
**Client context:** Sergio "Nuno" Campos (internal branding reference: "Nash")
**Live site:** [tracker.absolutelyplausible.com](https://tracker.absolutelyplausible.com)

Keep external app naming as `raceTracker` so it can be adapted for other teams, mechanics, or vendors later.

## Architecture

| Path | Purpose |
|------|---------|
| `raceTracker/index.html` | Static entrypoint — canonical frontend root |
| `raceTracker/assets/css/style.css` | All styles |
| `raceTracker/assets/js/main.js` | All client-side logic |
| `raceTracker/assets/images/racetracker-logo.png` | Canonical logo |
| `raceTracker/assets/data/track-context.json` | Track/weather defaults |
| `supabase/` | Supabase planning and migrations |
| `scripts/` | Validation and data ingestion scripts |
| `wrangler.jsonc` | Cloudflare Workers/Pages deployment config |
| `VERSION` | Single source of truth for version |

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
- Current version: `v1.10.1`
- Version must be visibly displayed in the footer of `raceTracker/index.html`
- Bump format: PATCH (bug/copy/polish) · MINOR (new section/feature) · MAJOR (rewrite/breaking layout)
- Include version in commit messages: `feat: add lap timer — v1.8.0`

## Live Data Guardrails

- Browser-side live data must use **public, credential-free APIs only**
- Credentialed sources go through a Cloudflare Worker proxy — **never** put API keys in static JS
- Default tracks: New Castle Motorsports Park (IN) and Trackhouse Motorplex (Mooresville, NC)
- Supabase secrets belong only in `.env.local` (gitignored) — never in Git, static JS, markdown, or memory
- Telemetry is integration/export-only for now

## Before Committing

- Run: `python3 scripts/validate_structure.py`
- Run: `git status --short --branch`
- Confirm changes are only in this repo

## Case/Path Guardrails

- The canonical frontend directory is exactly `raceTracker/` (capital T)
- On macOS the filesystem is case-insensitive — do not create `RaceTracker/` or `racetracker/` aliases
- Do not add logo variants under `raceTracker/assets/images/` without updating the validation script

## Constraints

- No npm, no bundlers, no frameworks — static HTML/CSS/JS only
- Do not start first-party telemetry collection without a team-approved source/API
