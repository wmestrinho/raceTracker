-- Correction to 0001: intake_requests did NOT match evo-krt-schl's shape.
--
-- 0001's comment claimed it did. It did not. The committed DDL in
-- evo-krt-schl/docs/05-decision-log.md (2026-09-05) and the live validation in
-- evo-krt-schl/functions/api/intake.js both carry per-driver detail that 0001
-- had nowhere to put:
--
--   * each driver's age, validated 4-80 by that Function
--   * the guardian's name, required in practice when a driver is under 18
--   * the submitter's explicit "this is a request, not a booking" acknowledgement
--
-- A karting school and an arrive-and-drive booking turn on exactly those facts,
-- so folding them into `message` as prose would have made the legally material
-- fields unqueryable. Raised by the evo-krt-schl session; verified against both
-- that repo's decision log and its Function before applying.
--
-- Additive only, and the table holds no rows, so this is safe to apply remote.
--
-- Apply:  npx wrangler d1 migrations apply OPS_DB --local
--         npx wrangler d1 migrations apply OPS_DB --remote

-- How many drivers one submission covers (that Function allows 1..10).
ALTER TABLE intake_requests ADD COLUMN driver_count INTEGER NOT NULL DEFAULT 0;

-- Per-driver detail as JSON text: fullName, age, yearsDriving, classCategory,
-- equipmentNotes. SQLite has no JSON column type; the Worker parses on read,
-- the same way pretech_signoffs.items is handled.
ALTER TABLE intake_requests ADD COLUMN drivers_json TEXT NOT NULL DEFAULT '[]';

-- The intake-type-specific block. school: programInterest, experienceLevel,
-- preferredSchedule, goals. arrive_drive: preferredDates[], trackPreference,
-- ownEquipment, supportNeeds. Kept as one column rather than a union of
-- nullable ones, because the two shapes have nothing in common.
ALTER TABLE intake_requests ADD COLUMN detail_json TEXT NOT NULL DEFAULT '{}';

-- Nullable by design: an adult booking for themselves has no guardian, and
-- requiring one would push staff to invent a value. Whether it is present is a
-- policy question about the drivers in drivers_json, enforced by the writer.
ALTER TABLE intake_requests ADD COLUMN guardian_name TEXT;

-- The submitter ticked "this is a request, not a confirmed booking". Stored so
-- a later dispute can be answered from the record rather than from memory.
ALTER TABLE intake_requests ADD COLUMN acknowledgement INTEGER NOT NULL DEFAULT 0;

-- Language vocabulary is shared with clients.preferred_language on purpose:
-- an intake request becomes a client, and two spellings of Portuguese would
-- diverge at exactly that conversion. Writers send 'pt', not 'pt-BR', and get
-- a constraint error at write time rather than a silent mismatch later.
CREATE TRIGGER IF NOT EXISTS trg_intake_language_insert
BEFORE INSERT ON intake_requests
FOR EACH ROW WHEN NEW.preferred_language NOT IN ('en', 'pt', 'es')
BEGIN
  SELECT RAISE(ABORT, 'preferred_language must be en, pt or es');
END;

CREATE TRIGGER IF NOT EXISTS trg_intake_language_update
BEFORE UPDATE OF preferred_language ON intake_requests
FOR EACH ROW WHEN NEW.preferred_language NOT IN ('en', 'pt', 'es')
BEGIN
  SELECT RAISE(ABORT, 'preferred_language must be en, pt or es');
END;

-- Triage reads the queue by type and recency; the Evolution decision log's
-- idx_intake_triage covered the same path.
CREATE INDEX IF NOT EXISTS idx_intake_triage
  ON intake_requests (intake_type, status, created_at DESC);
