# raceTracker

Static frontend prototype for raceTracker: karting operations, workshop execution, and telemetry visibility.

Live site
- https://tracker.absolutelyplausible.com

Canonical local path
- `/Users/wmestrinho/Workspace/Projects/raceTracker`

Legacy local path
- `/Users/wmestrinho/.openclaw/workspace/projects/raceTracker`
- Deprecated after migration. Do not start new work there.

Agent instructions
- Read `AGENTS.md` before making changes.
- Check `git status --short --branch` before editing, committing, rebasing, or pushing.

Canonical project structure (single source of truth)
- `raceTracker/index.html` (overview)
- `raceTracker/telemetry.html`
- `raceTracker/workshop.html`
- `raceTracker/inventory.html`
- `raceTracker/schedule.html`
- `raceTracker/team.html`
- `raceTracker/settings.html`
- `raceTracker/assets/css/style.css`
- `raceTracker/assets/js/main.js`
- `raceTracker/assets/data/telemetry.json`
- `raceTracker/assets/images/racetracker-logo.png`

Version rule
- Single source of truth: `VERSION`
- Current version: `v1.2.1`
- The version must be visibly displayed in the web UI footer.
- Bump the version for UI/behavior changes.

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
