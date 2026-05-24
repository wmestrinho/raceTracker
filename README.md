     1|# raceTracker
     2|
     3|Prototype frontend for raceTracker (karting operations + telemetry).
     4|
     5|Live site
     6|- https://tracker.absolutelyplausible.com
     7|
     8|Canonical project structure (single source of truth)
     9|- raceTracker/index.html (overview)
    10|- raceTracker/telemetry.html
    11|- raceTracker/workshop.html
    12|- raceTracker/inventory.html
    13|- raceTracker/schedule.html
    14|- raceTracker/team.html
    15|- raceTracker/settings.html
    16|- raceTracker/assets/css/style.css
    17|- raceTracker/assets/js/main.js
    18|- raceTracker/assets/data/telemetry.json
    19|- raceTracker/assets/images/racetracker-logo.png
    20|
    21|Deployment
    22|- Cloudflare Workers/Pages via Wrangler
    23|- Config: wrangler.jsonc
    24|- Static assets directory: raceTracker
    25|
    26|Local preview
    27|- Open raceTracker/index.html in a browser
    28|
    29|Guardrails
    30|- Do not create parallel site roots (for example docs/ plus raceTracker/).
    31|- Keep all frontend edits inside raceTracker/ only.
    32|- Run `python3 scripts/validate_structure.py` before commit.
    33|
    34|Roadmap (next)
    35|- Replace simulated telemetry with JSON-fed data source
    36|- Accessibility pass (focus states, semantics, contrast)
    37|- SEO/social metadata (description, OG tags, favicon set)
    38|