# raceTracker Supabase Plan

This folder holds the planned durable backend schema for raceTracker.

Important security rule
- Do not commit Supabase database passwords, direct connection strings, service-role keys, or private API tokens.
- Local secrets belong in `.env.local`, which is ignored by Git.
- The browser/static frontend may only use public, publishable credentials and public APIs.

Project
- Supabase URL: `https://lumllkbsiuxoohdolrtm.supabase.co`
- Project ref: `lumllkbsiuxoohdolrtm`

Local secret location
- `/Users/wmestrinho/Workspace/Projects/raceTracker/.env.local`
- This file is intentionally ignored by Git and contains the project-specific database password/direct connection string supplied by Luiz.

Schema plan
- `schema.sql` defines the first durable data model for:
  - tracks
  - candidate event sources
  - events
  - registration entries
  - teams/drivers/karts/mechanics
  - workshop tasks
  - inventory
  - setup notes
  - weather snapshots
  - telemetry export references

Before applying
1. Review `schema.sql` in Supabase Studio SQL editor.
2. Confirm which tables should be public-read through the Data API.
3. Replace placeholder authenticated write policies before multi-client production use.
4. Run Supabase advisors after applying schema changes.

Prototype data path
1. Static frontend keeps using local JSON while the schema is reviewed.
2. Google Sheets can publish a CSV for early event schedule entry.
3. `scripts/ingest_google_sheet.py` can convert that CSV into `raceTracker/assets/data/event-schedule.json`.
4. Supabase becomes the source of truth once event source ingestion and auth are confirmed.
