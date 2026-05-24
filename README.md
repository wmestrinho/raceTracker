# raceTracker

Prototype frontend for raceTracker (karting operations + telemetry).

Live site
- https://tracker.absolutelyplausible.com

Canonical project structure (single source of truth)
- raceTracker/index.html
- raceTracker/assets/css/style.css
- raceTracker/assets/js/main.js
- raceTracker/assets/images/racetracker-logo.png

Deployment
- Cloudflare Workers/Pages via Wrangler
- Config: wrangler.jsonc
- Static assets directory: raceTracker

Local preview
- Open raceTracker/index.html in a browser

Guardrails
- Do not create parallel site roots (for example docs/ plus raceTracker/).
- Keep all frontend edits inside raceTracker/ only.
- Run `python3 scripts/validate_structure.py` before commit.

Roadmap (next)
- Replace simulated telemetry with JSON-fed data source
- Accessibility pass (focus states, semantics, contrast)
- SEO/social metadata (description, OG tags, favicon set)
