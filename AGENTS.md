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

Source of truth
- Frontend assets live only under `raceTracker/`.
- Do not create parallel site roots such as `docs/`, root `assets/`, `site/`, or duplicate HTML trees.
- Deployment config lives in `wrangler.jsonc`.

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

Coordination warning
- Another AI agent may be working on this project. Before destructive edits, branch resets, rebases, or force pushes, check `git status` and coordinate with Luiz.
