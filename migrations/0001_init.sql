-- raceTracker operational schema — Cloudflare D1 (SQLite).
--
-- Replaces the abandoned Supabase plan (project lumllkbsiuxoohdolrtm, which no
-- longer resolves and never held real data). Identity comes from Cloudflare
-- Access: the verified `email` claim on the Access JWT is the join key into
-- `profiles`. There is deliberately no password, session or magic-link table —
-- Access owns authentication, this schema owns authorization and records.
--
-- Row-level enforcement that Postgres RLS used to provide now lives in the
-- Worker (ops-api.js). Every query there is entity-scoped and clearance-checked.
--
-- Apply:  npx wrangler d1 migrations apply OPS_DB --local
--         npx wrangler d1 migrations apply OPS_DB --remote

-- ── Businesses ────────────────────────────────────────────────────────────
-- Mirrors raceTracker/assets/data/entities.json. Two legally separate
-- businesses, one shell. Nothing operational is ever entity-less.

CREATE TABLE IF NOT EXISTS entities (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  short_name  TEXT NOT NULL
);

INSERT OR IGNORE INTO entities (id, name, short_name) VALUES
  ('evolution-kart-school', 'Evolution Kart School', 'Evolution'),
  ('the-kart-depot',        'The Kart Depot',        'Kart Depot');

-- ── Staff identity ────────────────────────────────────────────────────────
-- One row per person who can sign in. `email` must match the Access JWT claim.
-- Provisioning is admin-side only: adding an email to the Access policy grants
-- entry to the app, and a row here grants a role — deliberately two steps, so
-- neither alone is enough.

CREATE TABLE IF NOT EXISTS profiles (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'Staff',
  clearance   TEXT NOT NULL DEFAULT 'staff' CHECK (clearance IN ('admin', 'staff', 'driver', 'parent')),
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email COLLATE NOCASE);

-- Which businesses a staff member may act in. Emerson, Tito and Luiz all get
-- both rows; a coach hired by one business gets one. Business hierarchy is not
-- application permission: seniority never implies an entity grant.
CREATE TABLE IF NOT EXISTS profile_entities (
  profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  PRIMARY KEY (profile_id, entity_id)
);

-- ── Clients, drivers, mechanics ───────────────────────────────────────────
-- A `family`-type client carries the guardian contact directly, so a parent
-- booking for a child is one record, not two. A separate guardian table is
-- only worth adding when a driver needs a guardian who is not the client
-- contact — don't pre-build it.

CREATE TABLE IF NOT EXISTS clients (
  id                    TEXT PRIMARY KEY,
  entity_id             TEXT NOT NULL REFERENCES entities(id),
  name                  TEXT NOT NULL,
  client_type           TEXT NOT NULL CHECK (client_type IN ('family', 'individual', 'company', 'team')),
  contact_name          TEXT NOT NULL,
  contact_email         TEXT,
  contact_phone         TEXT,
  preferred_language    TEXT NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'pt', 'es')),
  responsible_profile_id TEXT REFERENCES profiles(id),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'prospect', 'inactive')),
  notes                 TEXT,
  request_id            TEXT NOT NULL,
  created_by            TEXT REFERENCES profiles(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_request ON clients (request_id);
CREATE INDEX IF NOT EXISTS idx_clients_entity_status ON clients (entity_id, status, name);
CREATE INDEX IF NOT EXISTS idx_clients_contact_email ON clients (contact_email);

CREATE TABLE IF NOT EXISTS drivers (
  id          TEXT PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  client_id   TEXT REFERENCES clients(id),
  name        TEXT NOT NULL,
  class       TEXT,
  kart_number TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'prospect', 'inactive')),
  notes       TEXT,
  request_id  TEXT NOT NULL,
  created_by  TEXT REFERENCES profiles(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_request ON drivers (request_id);
CREATE INDEX IF NOT EXISTS idx_drivers_entity_status ON drivers (entity_id, status, name);
CREATE INDEX IF NOT EXISTS idx_drivers_client ON drivers (client_id);

-- `profile_id` is nullable and stays that way: recording a mechanic must never
-- create an application login. A mechanic who also signs in gets a profiles
-- row provisioned separately and linked here.
CREATE TABLE IF NOT EXISTS mechanics (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT REFERENCES profiles(id),
  name        TEXT NOT NULL,
  specialty   TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'prospect', 'inactive')),
  notes       TEXT,
  request_id  TEXT NOT NULL,
  created_by  TEXT REFERENCES profiles(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mechanics_request ON mechanics (request_id);
CREATE INDEX IF NOT EXISTS idx_mechanics_status ON mechanics (status, name);

-- The same mechanic can serve both businesses, so entity assignment is a
-- join table rather than a column.
CREATE TABLE IF NOT EXISTS mechanic_entities (
  mechanic_id TEXT NOT NULL REFERENCES mechanics(id) ON DELETE CASCADE,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  PRIMARY KEY (mechanic_id, entity_id)
);

-- ── Intake ────────────────────────────────────────────────────────────────
-- Shape matches evo-krt-schl's committed intake_requests so Evolution's
-- Pages Function can point here as a binding change, not a redesign.
-- An intake request becomes a client/driver through a tracked conversion:
-- `converted_client_id` records it, so a retry cannot create a second person.

CREATE TABLE IF NOT EXISTS intake_requests (
  id                  TEXT PRIMARY KEY,
  entity_id           TEXT NOT NULL REFERENCES entities(id),
  intake_type         TEXT NOT NULL,
  contact_name        TEXT NOT NULL,
  contact_email       TEXT,
  contact_phone       TEXT,
  preferred_language  TEXT NOT NULL DEFAULT 'en',
  message             TEXT,
  source_path         TEXT,
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'declined')),
  converted_client_id TEXT REFERENCES clients(id),
  request_id          TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_request ON intake_requests (request_id);
CREATE INDEX IF NOT EXISTS idx_intake_status ON intake_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_contact_email ON intake_requests (contact_email);

-- ── Mechanic pre-tech sign-offs ───────────────────────────────────────────
-- Carried over from v1.17.0. One sign-off per mechanic per business per day.
-- `items` holds the checklist as JSON text (SQLite has no JSON column type);
-- the Worker parses it so the browser sees the same object shape as before.

CREATE TABLE IF NOT EXISTS pretech_signoffs (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id),
  entity_id     TEXT NOT NULL REFERENCES entities(id),
  signoff_date  TEXT NOT NULL,
  kart          TEXT,
  notes         TEXT,
  items         TEXT NOT NULL DEFAULT '{}',
  complete      INTEGER NOT NULL DEFAULT 0,
  signed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pretech_daily
  ON pretech_signoffs (profile_id, entity_id, signoff_date);
CREATE INDEX IF NOT EXISTS idx_pretech_date ON pretech_signoffs (signoff_date DESC);

-- ── Activity log ──────────────────────────────────────────────────────────
-- Records who actually performed each action. Luiz can manage Emerson's
-- responsibilities without logging in as Emerson, so the actor must be stored
-- explicitly rather than inferred from the record's owner.

CREATE TABLE IF NOT EXISTS activity_log (
  id            TEXT PRIMARY KEY,
  actor_profile_id TEXT REFERENCES profiles(id),
  actor_email   TEXT NOT NULL,
  entity_id     TEXT REFERENCES entities(id),
  action        TEXT NOT NULL,
  record_type   TEXT NOT NULL,
  record_id     TEXT,
  detail        TEXT,
  at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_record ON activity_log (record_type, record_id);
