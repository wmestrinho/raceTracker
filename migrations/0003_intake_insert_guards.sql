-- Make the public-intake trust boundary structural instead of code-dependent.
--
-- evo-krt-schl's Pages Function writes into this table as itself, holding the
-- D1 binding and no Access token — it is a public form, so there is no user
-- identity to check. Its code hardcodes status 'new' and reads neither
-- `status`, `converted_client_id` nor `entity_id` from the request body, and
-- that session has verified as much. But code is the only thing enforcing it,
-- and a future edit could widen it by accident. On the abandoned Supabase plan
-- this was RLS's job ("anon may INSERT, may not SELECT or UPDATE"); on D1
-- nothing enforces it unless we say so here.
--
-- Raised by the evo-krt-schl session as defence in depth. Taken.
--
-- Deliberately INSERT-only. Conversion is an UPDATE — staff move a request to
-- 'contacted'/'converted' and set converted_client_id through the ops API — so
-- guarding UPDATE too would break the one flow these columns exist for.

-- A newly submitted request is always 'new'. Any other value on INSERT means a
-- writer is trying to book, decline or pre-triage on the public's behalf.
CREATE TRIGGER IF NOT EXISTS trg_intake_insert_status_new
BEFORE INSERT ON intake_requests
FOR EACH ROW WHEN NEW.status <> 'new'
BEGIN
  SELECT RAISE(ABORT, 'a new intake request must have status ''new''; conversion is an update');
END;

-- Linking a request to a client is a staff action taken later, against a client
-- record that exists. Arriving already linked means the link was asserted, not
-- performed.
CREATE TRIGGER IF NOT EXISTS trg_intake_insert_unconverted
BEFORE INSERT ON intake_requests
FOR EACH ROW WHEN NEW.converted_client_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'converted_client_id is set by conversion, never on insert');
END;
