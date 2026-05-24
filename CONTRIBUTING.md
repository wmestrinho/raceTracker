# Contributing

Frontend source of truth
- All site files live in `raceTracker/`.
- Do not create a second site root (`docs/`, duplicate `assets/`, etc.).

Before opening a PR
1. Run: `python3 scripts/validate_structure.py`
2. Confirm no duplicate site roots were introduced.
3. If changing deployment, update `wrangler.jsonc` and `README.md` in the same PR.

Deployment
- Wrangler serves static assets from `raceTracker` (see `wrangler.jsonc`).
