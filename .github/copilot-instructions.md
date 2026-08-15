# Copilot instructions — raceTracker

Authoritative agent guidance for this repo lives in [`CLAUDE.md`](../CLAUDE.md).
This file mirrors the key rules so Copilot's inline help stays aligned.

## What this repo is
Static frontend for karting operations, workshop execution, and telemetry
visibility at `tracker.absolutelyplausible.com`. Keep app naming `raceTracker` so
it can be adapted for other teams later. Deploys via Cloudflare Workers/Pages
(`wrangler deploy`), static assets dir `raceTracker/`.

## Rules that matter
- **Version:** `VERSION` file is the single source of truth (`v1.11.1`), shown in
  the footer of `raceTracker/index.html`. Bump PATCH/MINOR/MAJOR; include the
  version in commit subjects (e.g. `feat: add lap timer — v1.8.0`).
- **Canonical root is exactly `raceTracker/`** (capital T). Do **not** create
  parallel roots (`docs/`, root `assets/`, `site/`) or case-variant aliases
  (`RaceTracker/`, `racetracker/`) — macOS is case-insensitive.
- **Live-data guardrails:** browser-side data must use public, credential-free
  APIs only. Credentialed sources go through a Cloudflare Worker proxy — **never**
  put API keys or Supabase secrets in static JS. Secrets live only in `.env.local`.
- **Before committing:** run `python3 scripts/validate_structure.py` and
  `git status --short --branch`.
- **No npm/bundlers/frameworks.**

## Paired sources of truth — never auto-edit without review
- `VERSION` ↔ footer version in `raceTracker/index.html`.

## Division of labor
Copilot: inline completions in `assets/js/main.js` and CSS, in-editor
explanations. Leave deploys, the structure-validation gate, and anything touching
credentials/proxies to Claude Code.

## Commits
Convention: `type(scope): subject — vX.Y.Z`.
