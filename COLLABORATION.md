# Evolution / TKD shared operations plan

Updated: 2026-09-05. Owner: Luiz / Absolutely Plausible.
This is the raceTracker coordination entry point for the three repositories.
It records the user's current direction; it is not a claim that planned work is live.

## Priorities agreed with Luiz

1. Make the staff dashboard the place to onboard clients, drivers and mechanics,
   building on the existing app, identities, workshop and supervision features.
2. Use exactly one operational calendar: Emerson's calendar published at
   https://events.thekartdepot.com/events.json. Preserve its event IDs and dates.
   Calendar edits belong to the Events source owner; no independent raceTracker calendar.
   Emerson's own prototype at https://calenderrace.netlify.app/ is the *origin* of that
   feed, copied by hand once on 2026-09-04; scripts/check_calendar_drift.py reports what
   has diverged since. https://thekartdepot.netlify.app/ is a different prototype — the
   "Race Day Loadout" pricing page — and is not a calendar source.
3. Require connectivity for operational data collection. A successful save means
   the server acknowledged it. Browser storage is not a shared operational database.
   The datastore is Cloudflare D1 (`racetracker-ops`) and identity is Cloudflare Access.
4. Build a separate customer/student portal over the same records, with permissions
   based on customers, guardians, drivers and assignments. Analytics must derive from
   recorded activity and approved integration/export sources.

The businesses are already operating. The user's report of changes at the Orlando
track is context for adaptable planning, not a confirmed new event, partnership or
public claim. Add no dates or commitments on that basis.

## Ownership and authority

| Area | Owner |
| --- | --- |
| Business direction and final business authority | Emerson |
| Second-in-command and daily operational leadership | Tito |
| Cross-functional management, consultancy and delegated coverage | Luiz |
| Absolutely Plausible, platform, websites, Shopify, logos and social content | Luiz |
| Staff app, shared operational schema and customer portal | raceTracker |
| Shopify, products, checkout, canonical calendar, Events RSVP and inventory intake | kart-depot-shopify |
| Evolution site/intake, engagement decisions and brand masters | evo-krt-schl |

Emerson and Luiz need full management access across both businesses. Tito needs
operational management across both. Each acts through their own identity; record
the actual actor, timestamp and owning business. Do not infer financial approval
limits or grant new staff access from their job title alone. Creating a mechanic
record must not automatically grant an application login or administrator rights.

## Delivery sequence and acceptance criteria

### A. One calendar

- Read the published Events feed through a fixed, read-only Worker adapter.
- Schedule, overview, registration event choices and billing event choices use the
  same IDs; local calendar JSON is retained only for legacy tooling/history.
- Show last successful check and unavailable/stale states; never fall back to a
  competing calendar. Refresh active calendar views every 60 seconds and on return
  to the tab or reconnection. This is polling, not a claim of push updates.
- Keep weather independent until a reviewed venue/date join to canonical event IDs
  exists. Do not attach historical series-weather keys by guessing matching names.

### B. Shared onboarding dashboard — next implementation

- First screen: search directory, Add client, Add driver, Add mechanic, and intake
  requests awaiting action. Replace illustrative home-page counts with real queries.
- Client: owning business, name, customer type, contact name, email, phone, preferred
  language and responsible staff member. Proposed types: family/individual/company/team.
- Driver: link to client/guardian, name, class, owning business and lifecycle status.
  Collect age/guardian information only where needed; avoid collecting unnecessary
  sensitive information during the first interaction.
- Mechanic: existing person/identity link where available, contact, specialty,
  business assignments and lifecycle status. Support the same person in both entities.
- Extend existing drivers, mechanics and profiles after inspecting the deployed schema.
  Add client and relationship tables rather than creating disconnected copies.
- Keep Evolution intake_requests compatible with the prepared intake function. An
  intake request becomes a linked client/driver record through a tracked conversion;
  retries must not produce duplicate people or requests.
- Test save/read from two separate sessions, duplicate submission, revoked access,
  entity isolation, validation errors and reconnect after a response is lost.

### C. Online operations

- Shared writes require an active authorized session and server validation.
- Use request IDs for safe retries; preserve an unsaved form in memory if a save fails.
  Do not display success, silently queue an offline write, or erase the form on failure.
- Separate connection status for the database and calendar; browser online status
  alone does not prove either service is available.
- Push committed updates where appropriate, with a bounded refresh fallback and an
  explicit stale state. Resolve conflicting edits using a record version.
- Paginate directories and activity, index actual query paths, and load event details
  on demand. Proposed measured targets: normal reads under 1s and saves under 2s at
  p95 on representative trackside connectivity; validate before promising these.
- Migrate browser-only billing, task additions, setup and driver pre-tech records
  with a reviewed import/duplicate-resolution path. Existing local records must not
  disappear during migration. These features are not yet online-only in v1.18.0.

### D. Customer and student portal

- Customers/guardians see their own linked accounts and drivers; drivers see their
  own released information; coaches see assigned drivers; mechanics see assigned work.
  These relationship rules are proposed pending Luiz's response.
- Share upcoming canonical events, confirmed bookings, released session summaries,
  coaching feedback and progress over time. Internal notes and other customers'
  records stay private. Publishing a report is an explicit staff action.
- Separate customer-facing routes/navigation from staff operations. Keep one backend
  and auth model. Plan English, Portuguese and Spanish customer experiences.
- Audit existing broad authenticated policies before enabling customer logins. Hiding
  a nav link is not authorization. Test unrelated-account, inactive-user and direct
  API access for every exposed record type.
- Use real telemetry imports/exports only; no first-party telemetry collection.

## Current handoff / blockers

Updated 2026-09-05 by the raceTracker session, after v1.18.0's calendar work.

### Settled this pass — the Supabase convergence target is void

The project every repo was pointing at, `lumllkbsiuxoohdolrtm`, **no longer exists**.
`lumllkbsiuxoohdolrtm.supabase.co` and its direct DB host both return **NXDOMAIN** — the
project is deleted, not paused. Luiz confirms **it never launched: test phase only, no
data lost.** So this is a clean redesign, not a recovery.

That voids the decision in `evo-krt-schl/docs/05-decision-log.md` (2026-09-05), which
moved Evolution's intake *off* working D1 *onto* Supabase on the stated grounds that
"raceTracker runs on Supabase Postgres with magic-link auth and RLS." It does not, and
did not.

**Luiz's decision, 2026-09-05: the shared platform is Cloudflare.** Everything else in
the ecosystem already was — four D1 databases, thirteen Workers, and Evolution's own
intake shipped on D1 hours before it was moved off.

- **Datastore:** Cloudflare D1, `racetracker-ops`, binding `OPS_DB`. Schema in
  `raceTracker/migrations/0001_init.sql`.
- **Staff identity:** Cloudflare Access on `tracker.absolutelyplausible.com` (self-hosted
  application, One-time PIN, email allowlist). No login form, no password, no auth token
  in client JavaScript. `access-jwt.js` re-verifies the assertion in the Worker.
- **Authorization:** explicit in `ops-api.js`, replacing Postgres RLS. Writes take the
  actor from the verified token; reads are scoped to `profile_entities`.
- **Customer/parent portal auth is a separate, later decision** — Access is right for a
  staff allowlist, not for families self-serving at scale.

### Consumer action for the siblings

- **evo-krt-schl:** `wrangler.jsonc` vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) and
  `functions/api/intake.js` point at the dead project. Its D1 database `evolution-intake`
  and the D1 intake path still work. **Stay on D1** until the rebind below. Not edited
  from this session.

  **Correction, same day:** 0001's `intake_requests` did *not* match Evolution's committed
  shape, and 56e3fb8's commit message wrongly said it did. The Evolution session caught it.
  Verified against both `evo-krt-schl/docs/05-decision-log.md` (2026-09-05 DDL) and the live
  validation in `functions/api/intake.js`: the form collects each driver's **age** (validated
  4-80), a **guardian name**, an **acknowledgement**, and a type-specific detail block, none
  of which 0001 had a column for. Those are the fields a karting school and an
  arrive-and-drive booking legally turn on, so putting them in `message` as prose was not an
  acceptable downgrade. `migrations/0002_intake_driver_details.sql` adds `driver_count`,
  `drivers_json`, `detail_json`, `guardian_name` and `acknowledgement`; applied local and
  remote (the table held no rows).

  **Agreed intake contract.** Evolution conforms to raceTracker's column names and
  constraints; raceTracker carries Evolution's richer fields. Writers send `entity_id`
  `'evolution-kart-school'`, `status` `'new'`, `notes` as `message`, and one `request_id`
  per *form instance* rather than per submit, so a double-click or a retry dedupes instead
  of creating a second lead. **Language is `'pt'`, not `'pt-BR'`** — one vocabulary with
  `clients.preferred_language`, because an intake request becomes a client and two
  spellings would diverge at exactly that conversion. A trigger refuses anything else at
  write time rather than letting it fail silently later. `converted_client_id` stays
  raceTracker's; the public form never writes it.
- **kart-depot-shopify:** unaffected — `kart-depot-events-rsvp` was already D1. It remains
  the owner of `events.json`, and therefore the only repo that applies reported calendar
  drift. Four confirmed ROK Cup USA rounds on Emerson's page are currently unpublished
  (see below); confirm whether that was deliberate before adding them.

### raceTracker state

- Local **v1.19.0**, not deployed. Two commits on top of `8d496c9` / v1.17.0: the pending
  v1.18.0 calendar work as built, then the Access + D1 auth swap.
- Green: `validate_structure.py`, `test_calendar.mjs` (6), `test_ops.mjs` (17),
  `test_race_weather.py`, `test_calendar_drift.py`.
- `supabase/` deleted. The Supabase CDN script tag removed from all 12 pages.
  `login.html` is now a session-status page, not a login form.
- **Deployment is blocked on account configuration only** — the Access application must
  exist and `wrangler.jsonc`'s three `REPLACE_WITH_*` placeholders must be filled
  (D1 database id, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) before `wrangler deploy`. Until
  then `/api/*` correctly answers 503, and the live site is still v1.17.0 with a
  broken login.
- Calendar drift as of this pass: 4 confirmed rounds on Emerson's page are not in the
  published feed, all ROK Cup USA (ROK Fest West 2026-07-10, ROK Sonoma Triple Crown 2
  rounds 2 and 3, Florida Winter Tour round 1 2027-01-22). 12 further rounds are held
  because Emerson has not set a venue. Reported, not applied.

### Still open

- Customer onboarding UI, online write migration and the customer portal remain planned
  (sections B–D). No customer records exist yet.
- Browser-only billing, task, setup and driver pre-tech records still need a reviewed
  import path into D1. They are not online-only yet.
- Whether Emerson still edits `calenderrace.netlify.app` is unconfirmed — the drift check
  makes it self-answering over time rather than requiring an answer now.
- Shared tokens must come from a named committed source revision, not another agent's
  working tree. Typography provenance is unresolved in the sibling notes.
- Keep the sidebar app shell. Branding instructions conflict; reconcile separately before
  a palette redesign. Do not add public marketing components to staff workflows.
- Customer definitions and first portal access scope are pending optional clarification.

## Coordination protocol

Record each cross-repo change with: source repo and commit, contract affected,
consumer action, tests, deployment status and prerequisites. Push agreed records
when the corresponding work is committed so another machine can resume accurately.
Never describe local work as deployed. Never transmit notifications, invitations
or client communications without Luiz's explicit authorization.
