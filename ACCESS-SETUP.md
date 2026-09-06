# Cloudflare Access setup — raceTracker staff sign-in

One-time account configuration. Until it is done, `/api/*` answers **503** by design
(`access-jwt.js` fails closed) and `wrangler deploy` should be held.

Everything in the repo is already in place. What is missing is three values only the
Cloudflare dashboard can give you, and the policy that decides who gets in.

## Status

| Piece | State |
| --- | --- |
| D1 database `racetracker-ops` | ✅ created, `088559e7-70dc-49a1-9366-73c35e441db6` |
| Schema (`migrations/0001_init.sql`) | ✅ applied local **and** remote, 10 tables |
| Luiz's admin profile | ✅ seeded (`absolutelyplausible@gmail.com`, both businesses) |
| Emerson's + Tito's profiles | ⛔ their login emails are not recorded anywhere in this repo — see step 5 |
| Access application | ⛔ **step 1 below** |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` in `wrangler.jsonc` | ⛔ **step 4 below** |

## 1. Create the Access application

Zero Trust → **Access controls → Applications → Add an application → Self-hosted**.

- **Application name:** `raceTracker`
- **Public hostname:** `tracker.absolutelyplausible.com` (path empty — the whole host)
- **Session duration:** 24 hours is a reasonable trackside default; a race weekend
  should not ask twice a day.

## 2. Identity provider: One-time PIN

Zero Trust → **Integrations → Identity providers → Add new → One-time PIN**.

Cloudflare's own account login is now the default IdP and is more secure where it
applies, but Emerson and Tito do not have Cloudflare accounts. One-time PIN emails
them a code and needs nothing set up on their side. Enable it on the application.

If your mail provider filters the codes, allowlist `noreply@notify.cloudflare.com`.

## 3. Policies — order matters

Access evaluates **Bypass before Allow**, so add the bypasses first.

**Bypass** (these must stay reachable with no sign-in):

| Path | Why |
| --- | --- |
| `/registrations.html` | the driver-facing Pre-Tech form is deliberately open (`data-auth-required="false"`) |
| `/assets/*` | CSS/JS/images that page needs |
| `/api/calendar` | read-only public calendar adapter |

Rule for each: Include → **Everyone**.

`/assets/data/*.json` rides along in `/assets/*`. Those files are already
world-readable on the live site today, so this is not a regression — but narrow the
bypass to `/assets/css/*`, `/assets/js/*`, `/assets/images/*` once Phase 3 moves
mechanics and billing into D1.

**Allow** (who gets into the app):

| Action | Rule | Selector | Value |
| --- | --- | --- | --- |
| Allow | Include | **Emails** | `absolutelyplausible@gmail.com`, plus Emerson's and Tito's |

> Do **not** use Include → Login Methods → One-time PIN. That admits anyone with a
> working email address. The allowlist is the whole point.

## 4. Fill in `wrangler.jsonc`

From the application's **Overview** tab, copy the **Application Audience (AUD) tag**,
and from Zero Trust → Settings → Custom Pages (or the URL you log in at) your team
domain.

```jsonc
"vars": {
  "ACCESS_TEAM_DOMAIN": "<your-team>.cloudflareaccess.com",
  "ACCESS_AUD": "<the AUD tag>"
}
```

Neither is a secret. The AUD tag is an identifier `ops-api.js` **checks** so a token
minted for a different Access application is rejected; it is never presented as a
credential. That is why they live in committed config rather than in `wrangler secret`.

## 5. Add the other staff

Two separate steps, on purpose — neither alone is enough, and signing in creates
neither:

1. add the person's email to the **Allow** policy in step 3 (lets them into the app)
2. add a `profiles` row (gives them a role inside it)

```sh
npx wrangler d1 execute OPS_DB --remote --command "
INSERT INTO profiles (id, email, name, role, clearance, active)
VALUES ('emerson', 'EMERSON_EMAIL', 'Emerson', 'Owner / Team Principal', 'admin', 1);
INSERT INTO profile_entities (profile_id, entity_id) VALUES
  ('emerson', 'evolution-kart-school'), ('emerson', 'the-kart-depot');
"
```

Clearances are `admin`, `staff`, `driver`, `parent`. Give Tito `admin` only if he
should see other people's sign-off history — operational leadership does not imply
it, and `staff` already covers running the day. Recording a mechanic in the
`mechanics` table never creates a login.

## 6. Deploy and verify

```sh
python3 scripts/validate_structure.py && node --test scripts/test_ops.mjs
npx wrangler deploy
```

Then check all four, from outside any session:

```sh
# gated: expect 302 to the Access login
curl -s -o /dev/null -w '%{http_code}\n' https://tracker.absolutelyplausible.com/index.html
# bypassed: expect 200
curl -s -o /dev/null -w '%{http_code}\n' https://tracker.absolutelyplausible.com/registrations.html
# public calendar: expect 200 and 23 events
curl -s https://tracker.absolutelyplausible.com/api/calendar | python3 -m json.tool | head -5
# no session: expect 401 and no profile in the body
curl -s -o /dev/null -w '%{http_code}\n' https://tracker.absolutelyplausible.com/api/me
```

Finally, in a fresh private window: open the site, get the PIN by email, and confirm
the Overview page shows your name and role in the top bar. A wrong-email sign-in
should land on "No profile yet" with your address named — not a redirect loop.
