# AGENTS.md — raceTracker

This repo is the canonical working copy for raceTracker.

Canonical path
- `/Users/wmestrinho/Workspace/Projects/raceTracker`

Legacy path
- `/Users/wmestrinho/.openclaw/workspace/projects/raceTracker`
- Treat it as deprecated after migration. Do not start new work there unless Luiz explicitly says the migration is paused or reversed.

Project purpose
- Static frontend prototype for karting operations, workshop execution, and telemetry visibility.
- Live target: `https://tracker.absolutelyplausible.com`

Client / branding context
- Current client context: Sergio “Nuno” Campos.
- “Nash” may appear in internal theme/branding references; it is intentional original naming for this client-specific theme.
- Keep external app naming as raceTracker so this prototype/MVP can later be adapted for other teams, mechanics, or vendors.

Source of truth
- Frontend assets live only under `raceTracker/`.
- Do not create parallel site roots such as `docs/`, root `assets/`, `site/`, or duplicate HTML trees.
- Deployment config lives in `wrangler.jsonc`.

Case/path guardrails
- The canonical frontend directory is exactly `raceTracker/`.
- On macOS, `RaceTracker/` and `racetracker/` may resolve to the same directory because the filesystem is case-insensitive; do not create or reference those aliases.
- Do not add logo variants under `raceTracker/assets/images/` unless the validation script is intentionally updated. The canonical logo is `raceTracker/assets/images/racetracker-logo.png`.
- Do not commit `.DS_Store` files.

Required files
- `README.md` — project overview, local preview, deploy notes, guardrails.
- `VERSION` — single source of truth for UI version.
- `scripts/validate_structure.py` — pre-commit validation.
- `raceTracker/index.html` — static entrypoint.
- `raceTracker/assets/css/style.css`
- `raceTracker/assets/js/main.js`
- `raceTracker/assets/images/racetracker-logo.png`

Version rule
- Every web UI must visibly display the version.
- Single source of truth: `VERSION`.
- Current version is displayed in the footer of `raceTracker/index.html`.
- Bump version for behavior/UI changes:
  - PATCH: bug fix, copy tweak, visual polish
  - MINOR: new section, new feature, meaningful UI addition
  - MAJOR: rewrite, breaking deployment/source layout change
- Commit messages that bump version should include it, for example: `feat: add telemetry feed — v0.2.0 alpha`.

Before committing
- Run: `python3 scripts/validate_structure.py`
- Run: `git status --short --branch`
- Confirm changes are only in this repo unless intentionally coordinating a wider workspace migration.

Deployment
- Static assets directory: `raceTracker`
- Config: `wrangler.jsonc`
- Deploy using Wrangler/Cloudflare Workers or Pages according to the configured project.

Live data guardrails
- Browser-side live data must use public, credential-free APIs only.
- Credentialed sources must go through a backend/Cloudflare Worker proxy; never put API keys in static JS or checked-in data files.
- Track/weather defaults live in `raceTracker/assets/data/track-context.json`.
- Default high-frequency tracks are New Castle Motorsports Park (IN) and Trackhouse Motorplex (Mooresville, NC).
- Highest-value orchestration is live event schedule + registration-list ingestion by event/track.
- Early ops data may use Google Sheets via `scripts/ingest_google_sheet.py`, but design toward Supabase/backend ownership for durable multi-client use.
- Supabase planning lives under `supabase/`; local secrets belong only in ignored `.env.local` and must not be copied into Git, static JS, markdown, or memory.
- Candidate event/registration sources currently include NCMP official schedule, Route 66/USPKS Race Select, Trackhouse official events, Trackhouse MotorsportReg, and Trackhouse Clubspeed/timing.
- Telemetry is integration/export-only for now; do not build first-party telemetry collection without a team-approved source/API.

Coordination warning
- Another AI agent may be working on this project. Before destructive edits, branch resets, rebases, or force pushes, check `git status` and coordinate with Luiz.
