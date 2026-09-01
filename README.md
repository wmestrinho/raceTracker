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
- `raceTracker/assets/data/race-weather.json` (generated — see Race weekend weather)
- `raceTracker/assets/images/racetracker-logo.png`
- `scripts/refresh_race_weather.py`
- `.github/workflows/refresh-race-weather.yml`

Version rule
- Single source of truth: `VERSION`
- Current version: `v1.13.0`
- The version must be visibly displayed in the web UI footer.
- Bump the version for UI/behavior changes.

Race weekend weather
- Every round in `series-calendars.json` gets a weather outlook in the generated
  `raceTracker/assets/data/race-weather.json`, keyed `seriesId:division:round`.
- Open-Meteo's forecast reaches only 16 days, so each weekend lands in one of four modes:
  `actual` (already run — ERA5 archive), `forecast` (within 16 days), `climate`
  (further out — normals averaged over past seasons, +/-3 calendar days per year),
  and `unavailable` (venue TBA, multi-month event, non-race, or a failed fetch).
- Regenerate with `python3 scripts/refresh_race_weather.py`. It reuses recorded past
  weather and climate normals under 30 days old, so a normal run makes ~2 API calls.
  The file is left untouched when the content hash is unchanged.
- `.github/workflows/refresh-race-weather.yml` runs it daily and commits only real
  changes. Note that GitHub disables scheduled workflows after 60 days of repository
  inactivity, and that the commit publishes only if `CLOUDFLARE_API_TOKEN` is set as a
  repository secret — otherwise the live site waits for a manual `wrangler deploy`.
- The schedule page degrades to an em dash in the weather column when the file is
  absent, and flags data older than 3 days rather than hiding it.
- Series are tagged `engineType` (`2-stroke` / `4-stroke` / `mixed`) and `country`;
  the schedule page defaults to 2-stroke US racing.
- Rounds marked `"sourceConfidence": "unverified"` came from a single source. Verify
  them against the series' own `scheduleUrl` before relying on them for travel.
- Add missing venue coordinates with
  `RACETRACKER_WEATHER_GEOCODE=1 python3 scripts/refresh_race_weather.py`, which prints
  paste-ready entries; `track-context.json` stays hand-curated.
- Tests: `python3 scripts/test_race_weather.py` (no network required).
- Alerts: a weekend whose forecast classifies as `alert` inside 7 days posts to
  `RACETRACKER_WEATHER_WEBHOOK_URL` (Slack or Discord — the payload shape is inferred
  from the URL). Climate normals never page anyone, and an unchanged alert set is
  skipped via `alertDigest`, so the channel stays quiet until something actually moves.
  Set the repository secret of the same name to switch alerting on; without it the run
  just reports how many weekends would have alerted.
- `severeTempDropF` (15°F) triggers on the day-over-day fall in the daily high, so an
  overnight collapse alerts even when neither day is hot or cold in absolute terms. The
  day before the weekend is included, so a Thursday-to-Friday collapse is caught on day one.
- `raceTracker/weather.html` is a trigger sandbox: pick a scenario, move a threshold and
  read the tire and engine call it produces. It runs the shipped classifier, not a copy.
  Draft thresholds live in `localStorage` only — copy them into **both**
  `WEATHER_THRESHOLDS` (main.js) and `RISK_THRESHOLDS` (refresh script) to make them real.

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
- Current baseline version: `v1.13.0`
- Keep version source documented.
- Web UIs must visibly display the version.

Validation:
- Run `python3 scripts/validate_agent_baseline.py`.
- Also run project-specific tests/builds when present.


Case-sensitive path guardrail
- The only canonical frontend directory name is exactly `raceTracker/`.
- On macOS, `RaceTracker/` or `racetracker/` may appear to resolve because the filesystem is case-insensitive; do not create or reference those aliases.
- Future agents should run `python3 scripts/validate_structure.py` before committing to catch duplicate roots, logo variants, stale versions, and macOS metadata.
