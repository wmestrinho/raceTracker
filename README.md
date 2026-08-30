# raceTracker

Static frontend prototype for raceTracker: karting operations, workshop execution, and telemetry visibility.

Live site
- https://tracker.absolutelyplausible.com

Canonical local path
- `/Users/wmestrinho/Workspace/Projects/raceTracker`

Legacy local path
- `/Users/wmestrinho/.openclaw/workspace/projects/raceTracker`
- Deprecated after migration. Do not start new work there.


Client / MVP context
- Current client context: Sergio “Nuno” Campos.
- “Nash” may appear in internal theme/branding references; it is the original internal naming for this client-specific theme and is intentional.
- Keep external app naming as raceTracker so the prototype can later be adapted for other teams, mechanics, or vendors.

Agent instructions
- Read `AGENTS.md` before making changes.
- Check `git status --short --branch` before editing, committing, rebasing, or pushing.

Canonical project structure (single source of truth)
- `raceTracker/index.html` (overview)
- `raceTracker/telemetry.html`
- `raceTracker/workshop.html`
- `raceTracker/inventory.html`
- `raceTracker/schedule.html`
- `raceTracker/weather.html`
- `raceTracker/team.html`
- `raceTracker/settings.html`
- `raceTracker/assets/css/style.css`
- `raceTracker/assets/js/main.js`
- `raceTracker/assets/data/telemetry.json`
- `raceTracker/assets/data/track-context.json`
- `raceTracker/assets/data/event-schedule.json`
- `raceTracker/assets/data/series-calendars.json`
- `raceTracker/assets/data/weather-alert-rules.json`
- `raceTracker/assets/data/race-weather.json` (generated)
- `raceTracker/assets/images/racetracker-logo.png`

Version rule
- Single source of truth: `VERSION`
- Current version: `v1.12.0`
- The version must be visibly displayed in the web UI footer.
- Bump the version for UI/behavior changes.

Live data
- Weather source: Open-Meteo forecast API, configured by `raceTracker/assets/data/track-context.json`.
- Default high-frequency tracks: New Castle Motorsports Park (IN) and Trackhouse Motorplex (Mooresville, NC).
- Event source scaffold: `raceTracker/assets/data/event-schedule.json` now tracks candidate official/registration providers.
- Highest-value orchestration target: event schedule + registration list ingestion by event/track.
- Candidate sources found:
  - New Castle Motorsports Park official schedule: `https://newcastlemotorsportspark.com/schedule`
  - Route 66 / USPKS Race Select registration candidates: `https://raceselect.com/route66/2026`, `https://raceselect.com/uspks/2026`
  - Trackhouse official events: `https://trackhousemotorplex.com/events/`
  - Trackhouse MotorsportReg venue: `https://www.motorsportreg.com/venues/trackhouse-motorplex-mooresville-nc`
  - Trackhouse Clubspeed booking/timing candidate: `https://bookings.clubspeed.com/MM/MMMooresville`
- Keep public/browser-safe APIs in frontend JS only; any credentialed data source needs a backend/Worker proxy.
- Google Sheets bridge: publish a Sheet tab as CSV and run `python3 scripts/ingest_google_sheet.py` with `RACETRACKER_EVENT_SHEET_CSV_URL` set.
- Supabase plan: `supabase/schema.sql` defines the durable backend model. Local Supabase secrets are kept in ignored `.env.local`, never in Git.
- Telemetry is integration/export-only for now; do not build first-party telemetry collection unless a team-approved API/source is confirmed.

Race-weekend weather pipeline
- Purpose: forecast every 2026 race weekend from track coordinates and alert the crew when rain or a severe track-temperature drop lands inside seven days of an event.
- Data chain:
  - `raceTracker/assets/data/series-calendars.json` — rounds, each carrying a `trackId`. The ten SKUSA/USPKS national professional 2-stroke rounds are tagged `nationalTier: "pro-2stroke"`.
  - `raceTracker/assets/data/track-context.json` — latitude, longitude and timezone per facility. `coordinateConfidence: "approximate"` marks points set from a mailing address rather than a surveyed paddock fix.
  - `raceTracker/assets/data/weather-alert-rules.json` — thresholds mapped to tire, engine, chassis and crew actions.
  - `raceTracker/assets/data/race-weather.json` — generated feed; do not hand-edit.
- Run it: `python3 scripts/build_weather_forecast.py` (add `--notify` to post webhook alerts, `--check` for an offline calendar/track join validation).
- Automation: `.github/workflows/race-weather.yml` runs daily at 11:00 UTC, commits the refreshed feed, and posts an alert when the firing rule set changes.
- Provider: Open-Meteo by default — public and credential-free, so no API key ever enters static JS or Git, and it returns 16 forecast days rather than the 5 offered by OpenWeatherMap's free tier. Keyed providers (OpenWeatherMap, Tomorrow.io) can be registered in `PROVIDERS` in the script; their keys belong in GitHub Actions secrets only.
- Alerting: set the repository secret `RACETRACKER_WEATHER_WEBHOOK_URL` to a Slack or Discord incoming webhook. The payload shape is inferred from the URL. The same JSON feed is what a desk display (Arduino or otherwise) should poll.
- UI: `raceTracker/weather.html` renders the forecast board and an interactive trigger sandbox. The sandbox evaluates the same rule grammar in the browser; tuned thresholds are stored per-browser in `localStorage` and must be copied back into `weather-alert-rules.json` to change what the automation does.

Deployment
- Cloudflare Workers/Pages via Wrangler
- Config: `wrangler.jsonc`
- Static assets directory: `raceTracker`

Local preview
- Open `raceTracker/index.html` in a browser.

Validation
- Run before commit:
  - `python3 scripts/validate_structure.py`
  - `python3 scripts/validate_agent_baseline.py`
  - `python3 scripts/test_weather_pipeline.py`

Guardrails
- Do not create parallel site roots, for example `docs/` plus `raceTracker/`.
- Do not create root-level duplicate `assets/` trees.
- Keep frontend edits inside `raceTracker/` only.

Roadmap (next)
- Replace simulated telemetry with live/API-backed data source.
- Accessibility pass: focus states, semantics, contrast.
- SEO/social metadata: description, OG tags, favicon set.

---

## AI Agent Handoff

Canonical local path:
- `/Users/wmestrinho/Workspace/Projects/raceTracker`

Legacy local path:
- `/Users/wmestrinho/.openclaw/workspace/projects/raceTracker`

Before editing:
- Read `AGENTS.md`.
- Check `git status --short --branch`.
- Preserve any project-specific instructions in `CLAUDE.md`.

Deployment notes:
- Cloudflare Workers/Pages via Wrangler. Config: `wrangler.jsonc` or `wrangler.toml`.

Version rule:
- Current baseline version: `v1.12.0`
- Keep version source documented.
- Web UIs must visibly display the version.

Validation:
- Run `python3 scripts/validate_agent_baseline.py`.
- Also run project-specific tests/builds when present.


Case-sensitive path guardrail
- The only canonical frontend directory name is exactly `raceTracker/`.
- On macOS, `RaceTracker/` or `racetracker/` may appear to resolve because the filesystem is case-insensitive; do not create or reference those aliases.
- Future agents should run `python3 scripts/validate_structure.py` before committing to catch duplicate roots, logo variants, stale versions, and macOS metadata.
